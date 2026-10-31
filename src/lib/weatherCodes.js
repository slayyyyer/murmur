const CODES = {
  0: { label: 'Clear sky', glyph: '☀️', family: 'clear' },
  1: { label: 'Mainly clear', glyph: '🌤️', family: 'clear' },
  2: { label: 'Partly cloudy', glyph: '⛅', family: 'cloud' },
  3: { label: 'Overcast', glyph: '☁️', family: 'cloud' },
  45: { label: 'Fog', glyph: '🌫️', family: 'fog' },
  48: { label: 'Rime fog', glyph: '🌫️', family: 'fog' },
  51: { label: 'Light drizzle', glyph: '🌦️', family: 'rain' },
  53: { label: 'Drizzle', glyph: '🌦️', family: 'rain' },
  55: { label: 'Dense drizzle', glyph: '🌧️', family: 'rain' },
  56: { label: 'Freezing drizzle', glyph: '🌧️', family: 'freezing' },
  57: { label: 'Dense freezing drizzle', glyph: '🌧️', family: 'freezing' },
  61: { label: 'Light rain', glyph: '🌦️', family: 'rain' },
  63: { label: 'Rain', glyph: '🌧️', family: 'rain' },
  65: { label: 'Heavy rain', glyph: '🌧️', family: 'rain' },
  66: { label: 'Freezing rain', glyph: '🌧️', family: 'freezing' },
  67: { label: 'Heavy freezing rain', glyph: '🌧️', family: 'freezing' },
  71: { label: 'Light snow', glyph: '🌨️', family: 'snow' },
  73: { label: 'Snow', glyph: '❄️', family: 'snow' },
  75: { label: 'Heavy snow', glyph: '❄️', family: 'snow' },
  77: { label: 'Snow grains', glyph: '🌨️', family: 'snow' },
  80: { label: 'Light rain showers', glyph: '🌦️', family: 'rain' },
  81: { label: 'Rain showers', glyph: '🌧️', family: 'rain' },
  82: { label: 'Violent rain showers', glyph: '⛈️', family: 'rain' },
  85: { label: 'Snow showers', glyph: '🌨️', family: 'snow' },
  86: { label: 'Heavy snow showers', glyph: '❄️', family: 'snow' },
  95: { label: 'Thunderstorm', glyph: '⛈️', family: 'thunder' },
  96: { label: 'Thunderstorm with hail', glyph: '⛈️', family: 'thunder' },
  99: { label: 'Severe thunderstorm with hail', glyph: '⛈️', family: 'thunder' },
};

export function describeWeatherCode(code, isDay = true) {
  const entry = CODES[Number(code)];
  if (!entry) {
    return { label: 'Unknown conditions', glyph: '◌', family: 'unknown', code: Number(code) };
  }
  const glyph = entry.family === 'clear' && !isDay ? '🌙' : entry.glyph;
  return { ...entry, glyph, code: Number(code) };
}

export const WEATHER_FAMILIES = Object.keys(CODES).reduce((families, code) => {
  families[CODES[code].family] = true;
  return families;
}, {});
