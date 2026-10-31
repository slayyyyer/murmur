export const SETTINGS_KEY = 'murmur.settings.v1';

export function defaultSettings() {
  return { motion: 'auto' };
}

export function normalizeSettings(raw) {
  return {
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
