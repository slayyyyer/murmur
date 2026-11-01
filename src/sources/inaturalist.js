import { FETCH, LOCATION } from '../config.js';
import { DAY_MS, HOUR_MS, isDateOnly, parseTimestamp } from '../lib/time.js';
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

const PARAMS = new URLSearchParams({
  lat: String(LOCATION.latitude),
  lng: String(LOCATION.longitude),
  radius: String(LOCATION.radiusKm),
  quality_grade: 'research',
  captive: 'false',
  licensed: 'true',
  per_page: '30',
  order_by: 'observed_on',
  order: 'desc',
  locale: 'en',
});

export const INAT_URL = `https://api.inaturalist.org/v1/observations?${PARAMS.toString()}`;

function distanceFromObservation(location) {
  if (typeof location !== 'string') return null;
  const parts = location.split(',');
  if (parts.length !== 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!validCoordinates(latitude, longitude)) return null;
  return coarseDistanceKm(haversineKm(LOCATION.latitude, LOCATION.longitude, latitude, longitude));
}

export function normalizeWildlife(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !Array.isArray(payload.results)) {
    throw new SourceError('Wildlife response had no results list.', 'malformed');
  }

  const records = [];
  let invalid = 0;
  let filtered = 0;

  for (const observation of payload.results) {
    if (!isPlainObject(observation)) {
      invalid += 1;
      continue;
    }
    if (typeof observation.quality_grade !== 'string' || !observation.quality_grade) {
      invalid += 1;
      continue;
    }
    if (observation.quality_grade !== 'research' || observation.captive === true) {
      filtered += 1;
      continue;
    }
    const taxon = observation.taxon;
    if (!isPlainObject(taxon) || typeof taxon.name !== 'string' || !taxon.name.trim()) {
      invalid += 1;
      continue;
    }
    const id = readFiniteNumber(observation.id);
    if (id === null) {
      invalid += 1;
      continue;
    }

    const timeObservedAt = parseTimestamp(observation.time_observed_at);
    const observedOn = typeof observation.observed_on === 'string' ? observation.observed_on.trim() : '';
    let observedAt = timeObservedAt;
    let dateOnly = false;

    if (!Number.isFinite(observedAt)) {
      if (!isDateOnly(observedOn)) {
        invalid += 1;
        continue;
      }
      observedAt = parseTimestamp(observedOn);
      dateOnly = true;
    }

    if (!Number.isFinite(observedAt)) {
      invalid += 1;
      continue;
    }
    if (observedAt > now + HOUR_MS || now - observedAt > 45 * DAY_MS) {
      filtered += 1;
      continue;
    }

    const fallbackUrl = `https://www.inaturalist.org/observations/${id}`;
    const url =
      safeHttpsUrl(observation.uri, { allowedHosts: ['inaturalist.org'] }) ?? safeHttpsUrl(fallbackUrl);
    if (!url) {
      invalid += 1;
      continue;
    }

    const commonName = sanitizeText(taxon.preferred_common_name, 80);
    const scientificName = sanitizeText(taxon.name, 80);
    const name = commonName || scientificName;
    const distanceKm = distanceFromObservation(observation.location);
    const distanceText = Number.isFinite(distanceKm) ? `about ${distanceKm} km from Charlotte` : 'within 50 km of Charlotte';

    records.push({
      key: `wildlife:${id}`,
      group: 'wildlife',
      sourceId: 'wildlife',
      sourceLabel: 'iNaturalist',
      provider: 'iNaturalist',
      title: commonName ? `${commonName} (${scientificName})` : scientificName,
      summary: `Research-grade observation · ${distanceText}${dateOnly ? ' · date only' : ''}`,
      url,
      originalAt: observedAt,
      observedAt,
      updatedAt: parseTimestamp(observation.updated_at),
      fetchedAt,
      dateOnly,
      data: {
        taxonName: scientificName,
        commonName,
        name,
        rank: sanitizeText(taxon.rank, 30),
        iconicTaxon: sanitizeText(taxon.iconic_taxon_name, 30),
        distanceKm,
        dateOnly,
        qualityGrade: 'research',
      },
    });
  }

  records.sort((a, b) => b.observedAt - a.observedAt);
  return {
    records: records.slice(0, 40),
    skipped: invalid + filtered,
    invalid,
    filtered,
    total: payload.results.length,
  };
}

export function wildlifeLoader({ fetchImpl = globalThis.fetch } = {}) {
  return {
    id: 'wildlife',
    label: 'Nearby wildlife',
    provider: 'iNaturalist',
    homepage: 'https://www.inaturalist.org/',
    group: 'wildlife',
    async load() {
      const fetchedAt = Date.now();
      try {
        const response = await fetchJson(INAT_URL, {
          fetchImpl,
          timeoutMs: FETCH.timeoutMs,
          maxBytes: FETCH.jsonMaxBytes,
        });
        const { records, skipped, invalid, filtered, total } = normalizeWildlife(response.data, {
          now: fetchedAt,
          fetchedAt,
        });
        const malformed = records.length === 0 && invalid > 0;
        return {
          status: records.length ? 'live' : malformed ? 'malformed' : 'empty',
          records,
          fetchedAt,
          error: malformed ? `No usable wildlife observations; ${invalid} malformed entr${invalid === 1 ? 'y' : 'ies'}.` : null,
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
