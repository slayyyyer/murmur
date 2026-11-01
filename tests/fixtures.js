export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 9, 31, 20, 0, 0);

export function newsReaction({
  key = 'news:one',
  topic = 'world',
  publisher = 'bbc',
  mood = 'happy',
  intensity = 1,
  publishedAt = NOW - HOUR,
  interpretedAt = NOW,
  title = 'A headline',
} = {}) {
  return {
    key: `reaction:${key}`,
    recordKey: key,
    group: 'news',
    sourceId: publisher,
    publisher,
    publisherLabel: publisher.toUpperCase(),
    topic,
    mood,
    intensity,
    text: 'A short reaction to a headline.',
    firstInterpretedAt: interpretedAt,
    observedAt: publishedAt,
    originalAt: publishedAt,
    title,
    url: 'https://example.com/story',
  };
}

export function measuredReaction({
  key = 'measure',
  group = 'weather',
  mood = 'happy',
  intensity = 1,
  observedAt = NOW,
  magnitude,
  severity,
  expiresAt,
} = {}) {
  return {
    key: `reaction:${key}`,
    recordKey: key,
    group,
    sourceId: group,
    publisher: null,
    publisherLabel: null,
    topic: null,
    mood,
    intensity,
    text: 'A deterministic measured reaction.',
    firstInterpretedAt: NOW,
    observedAt,
    originalAt: observedAt,
    magnitude,
    severity,
    expiresAt,
    title: 'A measured record',
    url: 'https://example.com/record',
  };
}

export function weatherRecord(overrides = {}) {
  return {
    key: 'weather:one',
    group: 'weather',
    sourceId: 'weather',
    sourceLabel: 'Open-Meteo',
    title: 'Clear sky, 20°C',
    summary: 'Feels like 20°C',
    url: 'https://api.open-meteo.com/v1/forecast',
    originalAt: NOW,
    observedAt: NOW,
    updatedAt: null,
    fetchedAt: NOW,
    dateOnly: false,
    data: {
      temperatureC: 20,
      apparentC: 20,
      weatherCode: 0,
      humidity: 40,
      windKmh: 8,
    },
    ...overrides,
  };
}

export function newsRecord(overrides = {}) {
  return {
    key: 'news:record-one',
    group: 'news',
    sourceId: 'bbc',
    sourceLabel: 'BBC',
    title: 'A headline',
    summary: '',
    url: 'https://www.bbc.com/news/story',
    originalAt: NOW - HOUR,
    observedAt: NOW - HOUR,
    updatedAt: null,
    fetchedAt: NOW,
    dateOnly: false,
    data: { publisher: 'bbc', publisherLabel: 'BBC', topic: 'world' },
    ...overrides,
  };
}
