import { FETCH, LOCATION } from '../config.js';
import { hashString } from '../lib/dedupe.js';
import { parseTimestamp } from '../lib/time.js';
import {
  coarseDistanceKm,
  haversineKm,
  isPlainObject,
  readFiniteNumber,
  safeHttpsUrl,
  sanitizeText,
} from '../lib/validate.js';
import { fetchJson, SourceError } from './http.js';
import { proxyUrl } from './news.js';

export const QUAKE_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

export function normalizeEarthquakes(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !Array.isArray(payload.features)) {
    throw new SourceError('Earthquake response had no feature list.', 'malformed');
  }

  const features = payload.features;
  const records = [];
  let invalid = 0;
  let filtered = 0;

  for (const feature of features) {
    if (!isPlainObject(feature)) {
      invalid += 1;
      continue;
    }
    const properties = feature.properties;
    const geometry = feature.geometry;
    if (!isPlainObject(properties) || !isPlainObject(geometry)) {
      invalid += 1;
      continue;
    }

    if (properties.mag === null || properties.mag === undefined || properties.mag === '') {
      invalid += 1;
      continue;
    }

    const magnitude = readFiniteNumber(properties.mag);
    const originAt = parseTimestamp(properties.time);
    const updatedAt = parseTimestamp(properties.updated);
    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const longitude = readFiniteNumber(coordinates[0]);
    const latitude = readFiniteNumber(coordinates[1]);
    const depthKm = readFiniteNumber(coordinates[2]);

    if (
      magnitude === null ||
      magnitude < -2 ||
      magnitude > 10 ||
      !Number.isFinite(originAt) ||
      latitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude === null ||
      longitude < -180 ||
      longitude > 180
    ) {
      invalid += 1;
      continue;
    }
    if (originAt > now + 5 * 60 * 1000) {
      filtered += 1;
      continue;
    }

    const id = typeof feature.id === 'string' && feature.id.trim() ? feature.id.trim() : null;
    const fallbackUrl = id
      ? `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`
      : null;
    const url = safeHttpsUrl(properties.url) ?? safeHttpsUrl(fallbackUrl);
    if (!url) {
      invalid += 1;
      continue;
    }

    const distanceKm = coarseDistanceKm(
      haversineKm(LOCATION.latitude, LOCATION.longitude, latitude, longitude),
    );
    const place = sanitizeText(properties.place, 120) || 'Unlocated earthquake';
    const depthText = depthKm === null ? 'depth unknown' : `${Math.round(depthKm)} km deep`;

    records.push({
      key: `quake:${id ?? hashString(`${originAt}:${latitude}:${longitude}:${magnitude}`)}`,
      group: 'earthquake',
      sourceId: 'earthquake',
      sourceLabel: 'USGS',
      provider: 'USGS earthquake hazards program',
      title: `M ${magnitude.toFixed(1)} · ${place}`,
      summary: `${depthText} · about ${distanceKm.toLocaleString('en-US')} km from Charlotte · tsunami flag: ${
        properties.tsunami ? 'yes' : 'no'
      }`,
      url,
      originalAt: originAt,
      observedAt: originAt,
      updatedAt: updatedAt ?? null,
      fetchedAt,
      dateOnly: false,
      data: {
        magnitude,
        depthKm,
        place,
        distanceKm,
        tsunami: Boolean(properties.tsunami),
        alert: typeof properties.alert === 'string' ? properties.alert : null,
        significance: readFiniteNumber(properties.sig),
        status: typeof properties.status === 'string' ? properties.status : null,
      },
    });
  }

  records.sort((a, b) => b.originalAt - a.originalAt);
  let limited = records.slice(0, 120);
  if (records.length > limited.length) {
    // Recency is the default order, but a major earthquake must not be pushed
    // out of the snapshot by a burst of newer, tiny events.
    const strongest = records.reduce((best, record) => {
      if (!best) return record;
      if (record.data.magnitude > best.data.magnitude) return record;
      if (record.data.magnitude === best.data.magnitude && record.originalAt > best.originalAt) return record;
      return best;
    }, null);
    if (strongest && !limited.includes(strongest)) {
      limited = [...limited.slice(0, -1), strongest].sort((a, b) => b.originalAt - a.originalAt);
    }
  }

  return {
    records: limited,
    skipped: invalid + filtered,
    invalid,
    filtered,
    total: features.length,
  };
}

export function earthquakeLoader({ fetchImpl = globalThis.fetch, proxyBase = '' } = {}) {
  return {
    id: 'earthquake',
    label: 'Recent earthquakes',
    provider: 'USGS',
    homepage: 'https://earthquake.usgs.gov/earthquakes/feed/',
    group: 'earthquake',
    async load() {
      const fetchedAt = Date.now();
      try {
        const response = await fetchJson(proxyUrl(QUAKE_URL, proxyBase), {
          fetchImpl,
          timeoutMs: FETCH.timeoutMs,
          maxBytes: FETCH.jsonMaxBytes,
        });
        const { records, skipped, invalid, filtered, total } = normalizeEarthquakes(response.data, {
          now: fetchedAt,
          fetchedAt,
        });
        const malformed = records.length === 0 && invalid > 0;
        return {
          status: records.length ? 'live' : malformed ? 'malformed' : 'empty',
          records,
          fetchedAt,
          error: malformed ? `No usable earthquake features; ${invalid} malformed entr${invalid === 1 ? 'y' : 'ies'}.` : null,
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
