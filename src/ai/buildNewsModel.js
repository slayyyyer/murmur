import { buildNewsPrompt, validateModelReactions } from './newsInterpretation.js';

export const NEWS_MODEL_DEFAULTS = Object.freeze({
  provider: 'Z.ai',
  baseUrl: 'https://api.z.ai/api/paas/v4',
  model: 'glm-4.5-flash',
  batchSize: 8,
  maxHeadlines: 24,
  timeoutMs: 60_000,
});

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function resolveNewsModelConfig(env = {}) {
  const apiKey = String(env.NEWS_MODEL_API_KEY || env.ZAI_API_KEY || '').trim();
  const baseUrl = String(env.NEWS_MODEL_BASE_URL || NEWS_MODEL_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const model = String(env.NEWS_MODEL_NAME || NEWS_MODEL_DEFAULTS.model).trim();
  const provider = String(env.NEWS_MODEL_PROVIDER || NEWS_MODEL_DEFAULTS.provider).trim();

  return {
    configured: Boolean(apiKey),
    apiKey,
    provider: provider || NEWS_MODEL_DEFAULTS.provider,
    baseUrl: baseUrl || NEWS_MODEL_DEFAULTS.baseUrl,
    model: model || NEWS_MODEL_DEFAULTS.model,
    batchSize: integer(env.NEWS_MODEL_BATCH_SIZE, NEWS_MODEL_DEFAULTS.batchSize, 1, 10),
    maxHeadlines: integer(env.NEWS_MODEL_MAX_HEADLINES, NEWS_MODEL_DEFAULTS.maxHeadlines, 1, 80),
    timeoutMs: integer(env.NEWS_MODEL_TIMEOUT_MS, NEWS_MODEL_DEFAULTS.timeoutMs, 5_000, 120_000),
  };
}

function responseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

async function postCompletion({ config, records, fetchImpl, signal }) {
  const body = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: 'You classify headlines for a fictional mood engine. Return only the requested JSON object.',
      },
      { role: 'user', content: buildNewsPrompt(records) },
    ],
    temperature: 0.2,
    max_tokens: 1_500,
    stream: false,
  };
  if (/z\.ai/i.test(config.baseUrl)) body.thinking = { type: 'disabled' };

  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    return { ok: false, retryable: response.status === 429 || response.status >= 500, error: `Model API returned HTTP ${response.status}.` };
  }

  const text = await response.text();
  if (text.length > 2_000_000) {
    return { ok: false, retryable: false, error: 'Model API response was larger than the allowed limit.' };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return { ok: false, retryable: false, error: 'Model API returned malformed JSON.' };
  }

  const raw = responseText(payload);
  if (!raw) {
    return { ok: false, retryable: false, error: 'Model API response did not include message content.' };
  }

  return { ok: true, raw };
}

async function requestBatch({ config, records, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? NEWS_MODEL_DEFAULTS.timeoutMs,
  );

  try {
    let result = await postCompletion({ config, records, fetchImpl, signal: controller.signal });
    if (!result.ok && result.retryable) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      result = await postCompletion({ config, records, fetchImpl, signal: controller.signal });
    }
    if (!result.ok) {
      return { ...result, reactions: [], rejected: [] };
    }

    const validated = validateModelReactions(result.raw, new Set(records.map((record) => record.key)));
    return {
      ok: validated.ok,
      reactions: validated.reactions,
      rejected: validated.rejected,
      error: validated.error,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, reactions: [], rejected: [], error: 'Model request timed out.' };
    }
    return {
      ok: false,
      reactions: [],
      rejected: [],
      error: error?.message || 'Model request failed.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Interpret a bounded set of headlines at cache-build time. This runs in the
 * GitHub Actions Node process, never in the browser, so the API key stays on
 * the server side.
 */
export async function interpretNewsWithModel({
  records = [],
  config,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  if (!config?.configured) {
    return {
      ok: false,
      error: 'No news-model API key is configured.',
      reactions: [],
      rejected: [],
      model: config?.model ?? null,
      provider: config?.provider ?? null,
    };
  }
  if (!records.length) {
    return { ok: true, error: null, reactions: [], rejected: [], model: config.model, provider: config.provider };
  }

  const batchSize = config.batchSize ?? NEWS_MODEL_DEFAULTS.batchSize;
  const maxHeadlines = config.maxHeadlines ?? NEWS_MODEL_DEFAULTS.maxHeadlines;
  const candidates = records
    .filter((record) => record?.group === 'news' && record.key)
    .slice(0, maxHeadlines);

  const reactions = [];
  const rejected = [];
  const errors = [];

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const result = await requestBatch({ config, records: batch, fetchImpl });
    reactions.push(...(result.reactions ?? []));
    rejected.push(...(result.rejected ?? []));
    if (!result.ok) {
      errors.push(result.error ?? 'Model request failed.');
    }
  }

  const error = errors[0] ?? null;
  return {
    ok: reactions.length > 0,
    error: error ?? (reactions.length > 0 ? null : 'No usable reactions passed validation.'),
    partial: Boolean(errors.length && reactions.length > 0),
    reactions,
    rejected,
    model: config.model,
    provider: config.provider,
    at: now,
  };
}
