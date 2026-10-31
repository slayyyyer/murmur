import { parseTimestamp } from './time.js';

const IP_HOST = /^(\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:]+\]$|^[0-9a-f:]+$/i;
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$|cmpid$)/i;

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Return a normalized HTTPS URL, or null. Rejects credentials, IP literals,
 * non-default ports, and anything that is not https.
 */
export function safeHttpsUrl(value, { allowedHosts = null } = {}) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '443') return null;
  if (!url.hostname || !url.hostname.includes('.')) return null;
  if (IP_HOST.test(url.hostname)) return null;
  if (Array.isArray(allowedHosts) && !allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    return null;
  }

  return url.href;
}

/** Strip fragments and common tracking parameters; keep the story URL stable. */
export function canonicalizeUrl(value) {
  const safe = safeHttpsUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = '';
  const kept = new URLSearchParams();
  for (const [key, paramValue] of url.searchParams) {
    if (!TRACKING_PARAMS.test(key)) kept.append(key, paramValue);
  }
  url.search = kept.toString();
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const code = Number.parseInt(decimal, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&([a-z]+);/gi, (match, name) => (name.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[name.toLowerCase()] : match));
}

/** Remove tags and control characters, collapse whitespace, and bound length. */
export function sanitizeText(value, maxLength = 280) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  text = text.replace(/<[^>]*>/g, ' ');
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  if (text.length > maxLength) {
    const cut = text.slice(0, maxLength - 1);
    const lastSpace = cut.lastIndexOf(' ');
    text = `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
  }
  return text;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Valid epoch, not implausibly in the future (allows 5 minutes of clock skew). */
export function validTimestamp(value, { now = Date.now(), maxFutureMs = 300_000, requireTimestamp = false } = {}) {
  const parsed = parseTimestamp(value);
  if (parsed === null) return null;
  if (requireTimestamp && parsed > now + maxFutureMs) return null;
  return parsed;
}

export function validLatitude(value) {
  return isFiniteNumber(value) && value >= -90 && value <= 90;
}

export function validLongitude(value) {
  return isFiniteNumber(value) && value >= -180 && value <= 180;
}

export function validCoordinates(latitude, longitude) {
  return validLatitude(latitude) && validLongitude(longitude);
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Coarse distance: exact geometry is never stored. */
export function coarseDistanceKm(km) {
  if (!Number.isFinite(km)) return null;
  if (km > 500) return Math.round(km / 100) * 100;
  if (km > 100) return Math.round(km / 10) * 10;
  return Math.round(km / 5) * 5;
}

export function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}
