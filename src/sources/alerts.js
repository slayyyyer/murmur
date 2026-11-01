import { FETCH, LOCATION } from '../config.js';
import { parseTimestamp } from '../lib/time.js';
import { isPlainObject, safeHttpsUrl, sanitizeText } from '../lib/validate.js';
import { fetchJson, SourceError } from './http.js';

const SEVERITIES = new Set(['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']);
const ALERT_HOSTS = ['api.weather.gov', 'www.weather.gov'];

export const ALERTS_URL = `https://api.weather.gov/alerts/active?point=${LOCATION.latitude},${LOCATION.longitude}`;

export function normalizeAlerts(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !Array.isArray(payload.features)) {
    throw new SourceError('Weather-alert response had no feature list.', 'malformed');
  }

  const records = [];
  let invalid = 0;
  let filtered = 0;

  for (const feature of payload.features) {
    if (!isPlainObject(feature) || !isPlainObject(feature.properties)) {
      invalid += 1;
      continue;
    }

    const properties = feature.properties;
    if (properties.status && properties.status !== 'Actual') {
      filtered += 1;
      continue;
    }
    if (properties.messageType === 'Cancel') {
      filtered += 1;
      continue;
    }

    const event = sanitizeText(properties.event, 100);
    if (!event) {
      invalid += 1;
      continue;
    }

    const sentAt = parseTimestamp(properties.sent ?? properties.effective ?? properties.onset);
    const expiresAt = parseTimestamp(properties.expires ?? properties.ends);
    if (!Number.isFinite(sentAt) || sentAt > now + 5 * 60 * 1000 || !Number.isFinite(expiresAt)) {
      invalid += 1;
      continue;
    }
    if (expiresAt <= now) {
      filtered += 1;
      continue;
    }

    const rawId = sanitizeText(properties.id ?? feature.id, 160);
    if (!rawId) {
      invalid += 1;
      continue;
    }

    const severity = SEVERITIES.has(properties.severity) ? properties.severity : 'Unknown';
    const urgency = sanitizeText(properties.urgency, 40) || 'Unknown';
    const certainty = sanitizeText(properties.certainty, 40) || 'Unknown';
    const areaDesc = sanitizeText(properties.areaDesc, 140) || 'the alert area';
    const senderName = sanitizeText(properties.senderName, 100);
    const headline = sanitizeText(properties.headline, 200);

    const url =
      safeHttpsUrl(properties['@id'], { allowedHosts: ALERT_HOSTS }) ??
      safeHttpsUrl(feature.id, { allowedHosts: ALERT_HOSTS }) ??
      ALERTS_URL;

    records.push({
      key: `alert:${rawId}`,
      group: 'alerts',
      sourceId: 'alerts',
      sourceLabel: 'NWS',
      provider: 'National Weather Service',
      title: event,
      summary: `${severity} severity · ${urgency} urgency · ${areaDesc}`,
      url,
      originalAt: sentAt,
      observedAt: sentAt,
      updatedAt: null,
      fetchedAt,
      dateOnly: false,
      data: {
        event,
        severity,
        urgency,
        certainty,
        areaDesc,
        senderName,
        headline,
        expiresAt,
        onsetAt: parseTimestamp(properties.onset ?? properties.effective) ?? null,
      },
    });
  }

  records.sort((a, b) => b.originalAt - a.originalAt);
  return {
    records: records.slice(0, 20),
    skipped: invalid + filtered,
    invalid,
    filtered,
    total: payload.features.length,
  };
}

export function alertsLoader({ fetchImpl = globalThis.fetch } = {}) {
  return {
    id: 'alerts',
    label: 'NWS weather alerts',
    provider: 'National Weather Service',
    homepage: 'https://www.weather.gov/',
    group: 'alerts',
    async load() {
      const fetchedAt = Date.now();
      try {
        const response = await fetchJson(ALERTS_URL, {
          fetchImpl,
          timeoutMs: FETCH.timeoutMs,
          headers: { 'user-agent': 'Murmur/1.0 (https://github.com/slayyyyer/murmur)' },
        });
        const { records, skipped, invalid, filtered, total } = normalizeAlerts(response.data, {
          now: fetchedAt,
          fetchedAt,
        });
        const malformed = records.length === 0 && invalid > 0;
        return {
          status: records.length ? 'live' : malformed ? 'malformed' : 'empty',
          records,
          fetchedAt,
          error: malformed ? `No usable weather alerts; ${invalid} malformed entr${invalid === 1 ? 'y' : 'ies'}.` : null,
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
