import { FETCH, LOCATION, WATER_GAUGE } from '../config.js';
import { parseTimestamp } from '../lib/time.js';
import {
  coarseDistanceKm,
  haversineKm,
  isPlainObject,
  sanitizeText,
  validCoordinates,
} from '../lib/validate.js';
import { fetchJson, SourceError } from './http.js';

const CATEGORY_LABELS = {
  no_flooding: 'No flooding',
  action: 'Action stage',
  minor: 'Minor flooding',
  moderate: 'Moderate flooding',
  major: 'Major flooding',
};

export const WATER_URL = `https://api.water.noaa.gov/nwps/v1/gauges/${WATER_GAUGE.siteId}`;

export function normalizeWater(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !isPlainObject(payload.status)) {
    throw new SourceError('River-gauge response had no status block.', 'malformed');
  }
  const observed = payload.status.observed;
  if (!isPlainObject(observed)) {
    throw new SourceError('River-gauge response had no observed stage.', 'malformed');
  }

  if (observed.primary === null || observed.primary === undefined || observed.primary === '') {
    throw new SourceError('River-gauge stage was missing or invalid.', 'malformed');
  }
  const stageFt = Number(observed.primary);
  const observedAt = parseTimestamp(observed.validTime);
  if (!Number.isFinite(stageFt) || stageFt < -20 || stageFt > 200) {
    throw new SourceError('River-gauge stage was missing or invalid.', 'malformed');
  }
  if (!Number.isFinite(observedAt) || observedAt > now + 6 * 60 * 60 * 1000 || now - observedAt > 7 * 24 * 60 * 60 * 1000) {
    throw new SourceError('River-gauge observation time was missing or outside the plausible window.', 'malformed');
  }

  const category = typeof observed.floodCategory === 'string' ? observed.floodCategory : 'unknown';
  const categoryLabel = CATEGORY_LABELS[category] ?? 'Category unknown';
  const name = sanitizeText(payload.name, 120) || WATER_GAUGE.name;
  const categories = isPlainObject(payload.flood?.categories) ? payload.flood.categories : {};
  const threshold = (key) => {
    const value = Number(categories[key]?.stage);
    return Number.isFinite(value) ? value : null;
  };

  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const distanceKm =
    validCoordinates(latitude, longitude)
      ? coarseDistanceKm(haversineKm(LOCATION.latitude, LOCATION.longitude, latitude, longitude))
      : null;

  const thresholds = [
    ['action', threshold('action')],
    ['minor', threshold('minor')],
    ['moderate', threshold('moderate')],
    ['major', threshold('major')],
  ]
    .filter(([, value]) => Number.isFinite(value))
    .map(([label, value]) => `${label} ${value.toFixed(1)} ft`)
    .join(' · ');

  return {
    key: `water:${WATER_GAUGE.siteId}:${observedAt}`,
    group: 'water',
    sourceId: 'water',
    sourceLabel: 'NOAA NWPS',
    provider: 'NOAA National Water Prediction Service',
    title: `${name} — ${categoryLabel}`,
    summary: `Observed ${stageFt.toFixed(2)} ft${
      distanceKm === null ? '' : ` · about ${distanceKm.toLocaleString('en-US')} km from Charlotte`
    }${thresholds ? ` · ${thresholds}` : ''} · provisional gauge data`,
    url: WATER_GAUGE.homepage,
    originalAt: observedAt,
    observedAt,
    updatedAt: null,
    fetchedAt,
    dateOnly: false,
    data: {
      siteId: WATER_GAUGE.siteId,
      lid: sanitizeText(payload.lid, 20),
      name,
      stageFt,
      category,
      categoryLabel,
      distanceKm,
      actionStageFt: threshold('action'),
      minorStageFt: threshold('minor'),
      moderateStageFt: threshold('moderate'),
      majorStageFt: threshold('major'),
    },
  };
}

export function waterLoader({ fetchImpl = globalThis.fetch } = {}) {
  return {
    id: 'water',
    label: WATER_GAUGE.name,
    provider: 'NOAA National Water Prediction Service',
    homepage: WATER_GAUGE.homepage,
    group: 'water',
    async load() {
      const fetchedAt = Date.now();
      try {
        const response = await fetchJson(WATER_URL, {
          fetchImpl,
          timeoutMs: FETCH.timeoutMs,
          maxBytes: FETCH.jsonMaxBytes,
        });
        const record = normalizeWater(response.data, { now: fetchedAt, fetchedAt });
        return { status: 'live', records: [record], fetchedAt, error: null };
      } catch (error) {
        return {
          status: error.kind === 'malformed' ? 'malformed' : 'unavailable',
          records: [],
          fetchedAt,
          error: error.message,
        };
      }
    },
  };
}
