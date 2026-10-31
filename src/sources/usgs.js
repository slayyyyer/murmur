import { FETCH, LOCATION } from '../config.js';
import { hashString } from '../lib/dedupe.js';
import { parseTimestamp } from '../lib/time.js';
import { coarseDistanceKm, haversineKm, isPlainObject, safeHttpsUrl, sanitizeText } from '../lib/validate.js';
import { fetchJson, SourceError } from './http.js';
import { proxyUrl } from './news.js';

export const QUAKE_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';

export function normalizeEarthquakes(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !Array.isArray(payload.features)) {
    throw new SourceError('Earthquake response had no feature list.', 'malformed');
  }

  const records = [];
  let skipped = 0;

  for (const feature of payload.features.slice(0, 400)) {
    if (!isPlainObject(feature)) {
      skipped += 1;
      continue;
    }
    const properties = feature.properties;
    const geometry = feature.geometry;
    if (!isPlainObject(properties) || !isPlainObject(geometry)) {
      skipped += 1;
      continue;
    }

    if (properties.mag === null || properties.mag === undefined || properties.mag === '') {
      skipped += 1;
      continue;
    }

    const magnitude = Number(properties.mag);
    const originAt = parseTimestamp(properties.time);
    const updatedAt = parseTimestamp(properties.updated);
    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    const depthKm = Number(coordinates[2]);

    if (
      !Number.isFinite(magnitude) ||
      magnitude < -2 ||
      magnitude > 10 ||
      !Number.isFinite(originAt) ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      skipped += 1;
      continue;
    }
    if (originAt > now + 5 * 60 * 1000) {
      skipped += 1;
      continue;
    }

    const id = typeof feature.id === 'string' && feature.id.trim() ? feature.id.trim() : null;
    const fallbackUrl = id
      ? `https://earthquake.usgs.gov/earthquakes/eventpage/${encodeURIComponent(id)}`
      : null;
    const url = safeHttpsUrl(properties.url) ?? safeHttpsUrl(fallbackUrl);
    if (!url) {
      skipped += 1;
      continue;
    }

    const distanceKm = coarseDistanceKm(
      haversineKm(LOCATION.latitude, LOCATION.longitude, latitude, longitude),
    );
    const place = sanitizeText(properties.place, 120) || 'Unlocated earthquake';
    const depthText = Number.isFinite(depthKm) ? `${Math.round(depthKm)} km deep` : 'depth unknown';

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
        depthKm: Number.isFinite(depthKm) ? depthKm : null,
        place,
        distanceKm,
        tsunami: Boolean(properties.tsunami),
        alert: typeof properties.alert === 'string' ? properties.alert : null,
        significance: Number.isFinite(Number(properties.sig)) ? Number(properties.sig) : null,
        status: typeof properties.status === 'string' ? properties.status : null,
      },
    });
  }

  records.sort((a, b) => b.originalAt - a.originalAt);
  return { records: records.slice(0, 120), skipped };
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
        const { records, skipped } = normalizeEarthquakes(response.data, { now: fetchedAt, fetchedAt });
        return {
          status: records.length ? 'live' : 'empty',
          records,
          fetchedAt,
          error: null,
          detail: { skipped, total: Array.isArray(response.data?.features) ? response.data.features.length : 0 },
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
