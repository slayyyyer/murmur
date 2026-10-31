export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a timestamp into epoch milliseconds.
 * Date-only strings are anchored at UTC midnight and flagged where it matters.
 * @returns {number|null}
 */
export function parseTimestamp(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  if (DATE_ONLY.test(text)) {
    const time = Date.parse(`${text}T00:00:00Z`);
    return Number.isFinite(time) ? time : null;
  }

  const time = Date.parse(text);
  return Number.isFinite(time) ? time : null;
}

export function isDateOnly(value) {
  return typeof value === 'string' && DATE_ONLY.test(value.trim());
}

export function isValidEpoch(value) {
  return Number.isFinite(value) && value > 0 && value < 8_640_000_000_000_000;
}

export function ageHours(anchorAt, now) {
  if (!Number.isFinite(Number(anchorAt))) return Infinity;
  return Math.max(0, (now - Number(anchorAt)) / HOUR_MS);
}

export function ageHoursBetween(anchorAt, now) {
  return ageHours(anchorAt, now);
}

/**
 * contribution = intensity × slotWeight × 2^(-ageHours / halfLifeHours)
 */
export function contribution({ intensity, weight, ageHours: age, halfLifeHours }) {
  const intensityValue = Number(intensity);
  const weightValue = Number(weight);
  const ageValue = Number(age);
  const halfLife = Number(halfLifeHours);
  if (!Number.isFinite(intensityValue) || !Number.isFinite(weightValue) || !Number.isFinite(ageValue)) {
    return 0;
  }
  if (!Number.isFinite(halfLife) || halfLife <= 0) return 0;
  const boundedIntensity = Math.min(1, Math.max(0, intensityValue));
  return boundedIntensity * weightValue * Math.pow(2, -Math.max(0, ageValue) / halfLife);
}

export function decayFactor(age, halfLifeHours) {
  if (!Number.isFinite(age) || !Number.isFinite(halfLifeHours) || halfLifeHours <= 0) return 0;
  return Math.pow(2, -Math.max(0, age) / halfLifeHours);
}

export function formatDateTime(epoch, timeZone = 'America/New_York') {
  if (!Number.isFinite(Number(epoch))) return 'Unknown time';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(new Date(Number(epoch)));
  } catch {
    return new Date(Number(epoch)).toISOString();
  }
}

export function formatDate(epoch, { dateOnly = false } = {}) {
  if (!Number.isFinite(Number(epoch))) return 'Unknown date';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: dateOnly ? 'UTC' : 'America/New_York',
    }).format(new Date(Number(epoch)));
  } catch {
    return new Date(Number(epoch)).toISOString().slice(0, 10);
  }
}

export function formatClock(epoch, timeZone = 'America/New_York') {
  if (!Number.isFinite(Number(epoch))) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(new Date(Number(epoch)));
  } catch {
    return '';
  }
}

export function formatRelative(epoch, now = Date.now()) {
  if (!Number.isFinite(Number(epoch))) return 'unknown';
  const delta = Math.max(0, now - Number(epoch));
  if (delta < MINUTE_MS) return 'just now';
  if (delta < HOUR_MS) {
    const minutes = Math.round(delta / MINUTE_MS);
    return `${minutes} min ago`;
  }
  if (delta < DAY_MS) {
    const hours = Math.round(delta / HOUR_MS);
    return `${hours} h ago`;
  }
  const days = Math.round(delta / DAY_MS);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatDuration(minutes) {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 1) return 'less than a minute';
  if (safe === 1) return '1 minute';
  if (safe < 60) return `${safe} minutes`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!rest) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} h ${rest} min`;
}

export function formatPercent(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export function formatStrength(value) {
  if (!Number.isFinite(Number(value))) return '0.000';
  return Number(value).toFixed(3);
}
