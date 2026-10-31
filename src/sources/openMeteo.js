import { FETCH, LOCATION } from '../config.js';
import { HOUR_MS } from '../lib/time.js';
import { isPlainObject, isFiniteNumber } from '../lib/validate.js';
import { describeWeatherCode } from '../lib/weatherCodes.js';
import { fetchJson, SourceError } from './http.js';

const WEATHER_PARAMS = new URLSearchParams({
  latitude: String(LOCATION.latitude),
  longitude: String(LOCATION.longitude),
  current:
    'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,cloud_cover,uv_index,is_day',
  daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  timezone: LOCATION.timezone,
  forecast_days: '1',
});

const AIR_PARAMS = new URLSearchParams({
  latitude: String(LOCATION.latitude),
  longitude: String(LOCATION.longitude),
  current: 'pm2_5,pm10,us_aqi,ozone,nitrogen_dioxide',
  timezone: LOCATION.timezone,
});

export const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?${WEATHER_PARAMS.toString()}`;
export const AIR_URL = `https://air-quality-api.open-meteo.com/v1/air-quality?${AIR_PARAMS.toString()}`;

/** Open-Meteo returns local wall-clock strings plus a UTC offset in seconds. */
export function parseLocalTimestamp(value, offsetSeconds) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?$/);
  if (!match) return null;
  if (!Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) > 18 * 3600) return null;
  const wallClock = Date.parse(`${match[1]}:00Z`);
  if (!Number.isFinite(wallClock)) return null;
  return wallClock - offsetSeconds * 1000;
}

function optionalNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

export function aqiCategory(aqi) {
  if (!Number.isFinite(aqi)) return 'Unknown';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

export function normalizeWeather(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !isPlainObject(payload.current)) {
    throw new SourceError('Weather response had no current observation.', 'malformed');
  }
  const current = payload.current;
  const offset = Number(payload.utc_offset_seconds);
  const observedAt = parseLocalTimestamp(current.time, offset);
  if (!Number.isFinite(observedAt)) {
    throw new SourceError('Weather observation time was missing or invalid.', 'malformed');
  }
  if (observedAt > now + 6 * HOUR_MS || now - observedAt > 7 * 24 * HOUR_MS) {
    throw new SourceError('Weather observation time was outside the plausible window.', 'malformed');
  }

  const temperatureC = Number(current.temperature_2m);
  const weatherCode = Number(current.weather_code);
  if (!isFiniteNumber(temperatureC) || temperatureC < -90 || temperatureC > 60) {
    throw new SourceError('Weather temperature was missing or invalid.', 'malformed');
  }
  if (!Number.isInteger(weatherCode) || weatherCode < 0 || weatherCode > 99) {
    throw new SourceError('Weather code was missing or invalid.', 'malformed');
  }

  const isDay = current.is_day === 1 || current.is_day === true;
  const condition = describeWeatherCode(weatherCode, isDay);
  const humidity = optionalNumber(current.relative_humidity_2m, 0, 100);
  const apparentC = optionalNumber(current.apparent_temperature, -100, 70);
  const precipitationMm = optionalNumber(current.precipitation, 0, 500);
  const windKmh = optionalNumber(current.wind_speed_10m, 0, 500);
  const cloudCover = optionalNumber(current.cloud_cover, 0, 100);
  const uvIndex = optionalNumber(current.uv_index, 0, 30);

  const daily = isPlainObject(payload.daily) ? payload.daily : {};
  const highC = optionalNumber(Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null, -100, 70);
  const lowC = optionalNumber(Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null, -100, 70);
  const precipitationChance = optionalNumber(
    Array.isArray(daily.precipitation_probability_max) ? daily.precipitation_probability_max[0] : null,
    0,
    100,
  );

  return {
    key: `weather:${observedAt}`,
    group: 'weather',
    sourceId: 'weather',
    sourceLabel: 'Open-Meteo',
    provider: 'Open-Meteo forecast API',
    title: `${condition.label}, ${Math.round(temperatureC)}°C`,
    summary: `Feels like ${Math.round(apparentC ?? temperatureC)}°C · ${humidity ?? '—'}% humidity · wind ${Math.round(
      windKmh ?? 0,
    )} km/h`,
    url: WEATHER_URL,
    originalAt: observedAt,
    observedAt,
    updatedAt: null,
    fetchedAt,
    dateOnly: false,
    data: {
      temperatureC,
      apparentC,
      humidity,
      precipitationMm,
      weatherCode,
      condition: condition.label,
      conditionFamily: condition.family,
      glyph: condition.glyph,
      isDay,
      windKmh,
      cloudCover,
      uvIndex,
      highC,
      lowC,
      precipitationChance,
      timezone: LOCATION.timezone,
    },
  };
}

export function normalizeAir(payload, { now = Date.now(), fetchedAt = now } = {}) {
  if (!isPlainObject(payload) || !isPlainObject(payload.current)) {
    throw new SourceError('Air-quality response had no current reading.', 'malformed');
  }
  const current = payload.current;
  const offset = Number(payload.utc_offset_seconds);
  const observedAt = parseLocalTimestamp(current.time, offset);
  if (!Number.isFinite(observedAt)) {
    throw new SourceError('Air-quality observation time was missing or invalid.', 'malformed');
  }
  if (observedAt > now + 6 * HOUR_MS || now - observedAt > 7 * 24 * HOUR_MS) {
    throw new SourceError('Air-quality observation time was outside the plausible window.', 'malformed');
  }

  const usAqi = Number(current.us_aqi);
  if (!isFiniteNumber(usAqi) || usAqi < 0 || usAqi > 500) {
    throw new SourceError('Modeled US AQI was missing or invalid.', 'malformed');
  }

  const pm25 = optionalNumber(current.pm2_5, 0, 1000);
  const pm10 = optionalNumber(current.pm10, 0, 2000);
  const ozone = optionalNumber(current.ozone, 0, 1000);
  const no2 = optionalNumber(current.nitrogen_dioxide, 0, 1000);
  const category = aqiCategory(usAqi);

  return {
    key: `air:${observedAt}`,
    group: 'air',
    sourceId: 'air',
    sourceLabel: 'Open-Meteo air quality',
    provider: 'Open-Meteo air-quality API',
    title: `US AQI ${Math.round(usAqi)} — ${category}`,
    summary: `PM2.5 ${pm25 ?? '—'} µg/m³ · PM10 ${pm10 ?? '—'} µg/m³ · modeled, not a sensor reading`,
    url: AIR_URL,
    originalAt: observedAt,
    observedAt,
    updatedAt: null,
    fetchedAt,
    dateOnly: false,
    data: {
      usAqi,
      category,
      pm25,
      pm10,
      ozone,
      no2,
      timezone: LOCATION.timezone,
    },
  };
}

export function weatherLoader({ fetchImpl = globalThis.fetch } = {}) {
  return {
    id: 'weather',
    label: 'Charlotte weather',
    provider: 'Open-Meteo',
    homepage: 'https://open-meteo.com/',
    group: 'weather',
    async load() {
      const fetchedAt = Date.now();
      try {
        const response = await fetchJson(WEATHER_URL, { fetchImpl, timeoutMs: FETCH.timeoutMs });
        const record = normalizeWeather(response.data, { now: fetchedAt, fetchedAt });
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

export function airLoader({ fetchImpl = globalThis.fetch } = {}) {
  return {
    id: 'air',
    label: 'Charlotte air quality',
    provider: 'Open-Meteo',
    homepage: 'https://open-meteo.com/en/docs/air-quality-api',
    group: 'air',
    async load() {
      const fetchedAt = Date.now();
      try {
        const response = await fetchJson(AIR_URL, { fetchImpl, timeoutMs: FETCH.timeoutMs });
        const record = normalizeAir(response.data, { now: fetchedAt, fetchedAt });
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
