import { LLM_DEFAULTS } from '../config.js';
import { normalizeEndpoint } from '../ai/newsInterpretation.js';

export const SETTINGS_KEY = 'murmur.settings.v1';

export function defaultSettings() {
  return {
    llm: {
      enabled: LLM_DEFAULTS.enabled,
      endpoint: LLM_DEFAULTS.endpoint,
      model: LLM_DEFAULTS.model,
    },
    motion: 'auto',
  };
}

export function normalizeSettings(raw) {
  const fallback = defaultSettings();
  if (!raw || typeof raw !== 'object') return fallback;

  const endpoint = normalizeEndpoint(raw?.llm?.endpoint) ?? fallback.llm.endpoint;
  const model =
    typeof raw?.llm?.model === 'string' && raw.llm.model.trim()
      ? raw.llm.model.trim().slice(0, 80)
      : fallback.llm.model;

  return {
    llm: {
      enabled: Boolean(raw?.llm?.enabled),
      endpoint,
      model,
    },
    motion: raw?.motion === 'reduced' ? 'reduced' : 'auto',
  };
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadSettings(storage) {
  const target = getStorage(storage);
  if (!target) return defaultSettings();
  try {
    const raw = target.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings, storage) {
  const target = getStorage(storage);
  const normalized = normalizeSettings(settings);
  if (!target) return normalized;
  try {
    target.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    /* storage can be unavailable or full; settings simply do not persist */
  }
  return normalized;
}
