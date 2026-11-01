import { FETCH, LOCATION } from '../config.js';
import { parseTimestamp } from '../lib/time.js';
import {
  coarseDistanceKm,
  haversineKm,
  isPlainObject,
  readFiniteNumber,
  safeHttpsUrl,
  sanitizeText,
  validCoordinates,
} from '../lib/validate.js';
import { fetchJson, SourceError } from './http.js';

const CATEGORY_LABELS = {
  wildfires: 'Wildfire',
  severeStorms: 'Severe storm',
  volcanoes: 'Volcano',
};

const ALLOWED_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

const PARAMS = new URLSearchParams({
  status: 'open',
  days: '30',
  limit: '50',
});

export const EONET_URL = `https://eonet.gsfc.nasa.gov/api/v3/events?${PARAMS.toString()}`;

export function normalizeEonet(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !Array.isArray(payload.events)) {
    throw new SourceError('NASA EONET response had no events list.', 'malformed');
  }

  const records = [];
  let invalid = 0;
  let filtered = 0;

  for (const event of payload.events) {
    if (!isPlainObject(event)) {
      invalid += 1;
      continue;
    }
    if (event.closed === undefined) {
      invalid += 1;
      continue;
    }
    if (event.closed !== null) {
      filtered += 1;
      continue;
    }

    if (!Array.isArray(event.categories)) {
      invalid += 1;
      continue;
    }
    const categories = event.categories.filter(
      (category) => isPlainObject(category) && ALLOWED_CATEGORIES.has(category.id),
    );
    if (!categories.length) {
      filtered += 1;
      continue;
    }

    const geometry = Array.isArray(event.geometry) ? event.geometry : [];
    if (!geometry.length) {
      invalid += 1;
      continue;
    }
    const points = [];
    let invalidPoint = false;
    for (const point of geometry) {
      if (!isPlainObject(point)) {
        invalidPoint = true;
        continue;
      }
      const at = parseTimestamp(point.date);
      const coordinates = Array.isArray(point.coordinates) ? point.coordinates : [];
      const longitude = readFiniteNumber(coordinates[0]);
      const latitude = readFiniteNumber(coordinates[1]);
      if (!Number.isFinite(at) || latitude === null || longitude === null || !validCoordinates(latitude, longitude)) {
        invalidPoint = true;
        continue;
      }
      if (at > now + 5 * 60 * 1000) continue;
      points.push({ at, latitude, longitude, magnitudeValue: point.magnitudeValue, magnitudeUnit: point.magnitudeUnit });
    }

    if (!points.length) {
      if (invalidPoint) invalid += 1;
      else filtered += 1;
      continue;
    }

    points.sort((a, b) => a.at - b.at);
    const first = points[0];
    const latest = points[points.length - 1];
    const id = typeof event.id === 'string' && event.id.trim() ? event.id.trim() : null;
    if (!id) {
      invalid += 1;
      continue;
    }

    const url =
      safeHttpsUrl(event.link, { allowedHosts: ['eonet.gsfc.nasa.gov'] }) ??
      safeHttpsUrl(`https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(id)}`);
    if (!url) {
      invalid += 1;
      continue;
    }

    const title = sanitizeText(event.title, 140) || 'Unnamed natural event';
    const category = categories[0];
    const categoryLabel = CATEGORY_LABELS[category.id];
    const distanceKm = coarseDistanceKm(
      haversineKm(LOCATION.latitude, LOCATION.longitude, latest.latitude, latest.longitude),
    );

    records.push({
      key: `eonet:${id}`,
      group: 'eonet',
      sourceId: 'eonet',
      sourceLabel: 'NASA EONET',
      provider: 'NASA EONET v3',
      title,
      summary: `Open ${categoryLabel.toLowerCase()} event · latest observation about ${distanceKm.toLocaleString(
        'en-US',
      )} km from Charlotte · status: open`,
      url,
      originalAt: first.at,
      observedAt: latest.at,
      updatedAt: latest.at,
      fetchedAt,
      dateOnly: false,
      data: {
        categoryId: category.id,
        categoryLabel,
        status: 'open',
        firstAt: first.at,
        latestAt: latest.at,
        distanceKm,
        magnitudeValue: readFiniteNumber(latest.magnitudeValue),
        magnitudeUnit: sanitizeText(latest.magnitudeUnit, 20),
      },
    });
  }

  records.sort((a, b) => b.observedAt - a.observedAt);
  return {
    records: records.slice(0, 50),
    skipped: invalid + filtered,
    invalid,
    filtered,
    total: payload.events.length,
  };
}

export function eonetLoader({ fetchImpl = globalThis.fetch } = {}) {
  return {
    id: 'eonet',
    label: 'NASA natural events',
    provider: 'NASA EONET',
    homepage: 'https://eonet.gsfc.nasa.gov/',
    group: 'eonet',
    async load() {
      const fetchedAt = Date.now();
      try {
        const response = await fetchJson(EONET_URL, {
          fetchImpl,
          timeoutMs: FETCH.timeoutMs,
          maxBytes: FETCH.jsonMaxBytes,
        });
        const { records, skipped, invalid, filtered, total } = normalizeEonet(response.data, {
          now: fetchedAt,
          fetchedAt,
        });
        const malformed = records.length === 0 && invalid > 0;
        return {
          status: records.length ? 'live' : malformed ? 'malformed' : 'empty',
          records,
          fetchedAt,
          error: malformed ? `No usable NASA events; ${invalid} malformed entr${invalid === 1 ? 'y' : 'ies'}.` : null,
          detail: { skipped, invalid, filtered, total },
        };
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
