import { FETCH } from '../config.js';

export class SourceError extends Error {
  constructor(message, kind = 'unavailable', options = {}) {
    super(message, options);
    this.name = 'SourceError';
    this.kind = kind;
  }
}

async function readBounded(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    const size = new TextEncoder().encode(text).byteLength;
    if (size > maxBytes) throw new SourceError('Source response was larger than the allowed limit.', 'malformed');
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw new SourceError('Source response was larger than the allowed limit.', 'malformed');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(`Connection broke while reading the source (${error.message}).`, 'unavailable', {
      cause: error,
    });
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(joined);
}

export async function fetchText(
  url,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = FETCH.timeoutMs,
    maxBytes = FETCH.feedMaxBytes,
    method = 'GET',
    headers = {},
    body = undefined,
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new SourceError('This browser does not provide fetch().', 'unavailable');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          accept: 'application/rss+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.1',
          ...headers,
        },
        body,
        signal: controller.signal,
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new SourceError(`The source took longer than ${Math.round(timeoutMs / 1000)} seconds.`, 'unavailable');
      }
      throw new SourceError(`Could not reach the source (${error?.message ?? 'network error'}).`, 'unavailable', {
        cause: error,
      });
    }

    if (!response.ok) {
      const kind = response.status === 429 || response.status >= 500 ? 'unavailable' : 'malformed';
      throw new SourceError(`The source returned HTTP ${response.status}.`, kind);
    }

    const text = await readBounded(response, maxBytes);
    return {
      text,
      status: response.status,
      contentType: response.headers?.get?.('content-type') ?? '',
      url: response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, options = {}) {
  const response = await fetchText(url, {
    ...options,
    maxBytes: options.maxBytes ?? FETCH.jsonMaxBytes,
    headers: { accept: 'application/json, application/geo+json;q=0.9', ...(options.headers ?? {}) },
  });

  try {
    return { ...response, data: JSON.parse(response.text) };
  } catch {
    throw new SourceError('The source returned malformed JSON.', 'malformed');
  }
}
