/**
 * Murmur's fixed configuration. Anything a person might reasonably want to
 * change lives here: the location, the influence budgets, the decay schedule,
 * the news feeds, and the local-model defaults.
 */

export const LOCATION = Object.freeze({
  city: 'Charlotte',
  name: 'Charlotte, North Carolina',
  latitude: 35.2271,
  longitude: -80.8431,
  timezone: 'America/New_York',
  radiusKm: 50,
});

export const BUDGETS = Object.freeze({
  news: 0.6,
  weather: 0.25,
  air: 0.05,
  wildlife: 0.05,
  earthquake: 0.025,
  eonet: 0.025,
});

export const NEWS_TOPICS = Object.freeze([
  { id: 'world', label: 'World affairs' },
  { id: 'science', label: 'Science and space' },
  { id: 'environment', label: 'Environment' },
  { id: 'health', label: 'Health' },
  { id: 'technology', label: 'Technology' },
  { id: 'economy', label: 'Economy' },
  { id: 'culture', label: 'Culture' },
  { id: 'progress', label: 'Community and progress' },
  { id: 'local', label: 'Charlotte and Carolinas' },
]);

export const NEWS_TOPIC_IDS = NEWS_TOPICS.map((topic) => topic.id);
export const NEWS_TOPIC_LABELS = Object.fromEntries(NEWS_TOPICS.map((topic) => [topic.id, topic.label]));

export const NEWS_SLOTS_PER_TOPIC = 2;
export const PUBLISHER_STORY_LIMIT = 6;

/** Each of the 18 news slots carries an equal slice of the 60% news budget. */
export const NEWS_SLOT_WEIGHT = BUDGETS.news / (NEWS_TOPICS.length * NEWS_SLOTS_PER_TOPIC);

export const WEIGHTS = Object.freeze({
  news: NEWS_SLOT_WEIGHT,
  weather: BUDGETS.weather,
  air: BUDGETS.air,
  wildlife: BUDGETS.wildlife,
  earthquake: BUDGETS.earthquake,
  eonet: BUDGETS.eonet,
});

export const DECAY = Object.freeze({
  news: { halfLifeHours: 6, maxAgeHours: 48 },
  weather: { halfLifeHours: 3, maxAgeHours: 6 },
  air: { halfLifeHours: 3, maxAgeHours: 6 },
  wildlife: { halfLifeHours: 24, maxAgeHours: 168 },
  earthquake: { halfLifeHours: 6, maxAgeHours: 24 },
  eonet: { halfLifeHours: 24, maxAgeHours: 168 },
});

export const CALM_THRESHOLD = 0.18;

export const MOODS = Object.freeze(['happy', 'sad', 'mad', 'confused', 'calm']);

export const GROUP_LABELS = Object.freeze({
  news: 'News',
  weather: 'Weather',
  air: 'Air quality',
  wildlife: 'Nearby wildlife',
  earthquake: 'Earthquakes',
  eonet: 'NASA natural events',
});

export const GROUP_LABELS_SHORT = Object.freeze({
  news: 'News',
  weather: 'Weather',
  air: 'Air',
  wildlife: 'Wildlife',
  earthquake: 'Quakes',
  eonet: 'NASA events',
});

export const PUBLISHERS = Object.freeze({
  bbc: {
    id: 'bbc',
    label: 'BBC',
    provider: 'BBC News',
    homepage: 'https://www.bbc.com/news',
    description: 'World and topic feeds',
  },
  aljazeera: {
    id: 'aljazeera',
    label: 'Al Jazeera',
    provider: 'Al Jazeera',
    homepage: 'https://www.aljazeera.com/',
    description: 'All-news feed',
  },
  nasa: {
    id: 'nasa',
    label: 'NASA',
    provider: 'NASA',
    homepage: 'https://www.nasa.gov/',
    description: 'Agency news feed',
  },
  guardian: {
    id: 'guardian',
    label: 'The Guardian',
    provider: 'The Guardian',
    homepage: 'https://www.theguardian.com/',
    description: 'World and topic feeds',
  },
  positive: {
    id: 'positive',
    label: 'Positive News',
    provider: 'Positive News',
    homepage: 'https://www.positive.news/',
    description: 'Constructive journalism feed',
  },
  wfae: {
    id: 'wfae',
    label: 'WFAE',
    provider: 'WFAE 90.7 · Charlotte NPR',
    homepage: 'https://www.wfae.org/',
    description: 'Charlotte and Carolinas news',
  },
});

/**
 * topic: null means "classify this feed's headlines by keyword". Topic-specific
 * feeds keep their declared topic, which is more reliable than keyword guesses.
 */
export const FEEDS = Object.freeze([
  { publisher: 'bbc', topic: 'world', label: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  {
    publisher: 'bbc',
    topic: 'science',
    label: 'BBC Science & Environment',
    url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  },
  {
    publisher: 'bbc',
    topic: 'technology',
    label: 'BBC Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
  },
  { publisher: 'bbc', topic: 'economy', label: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { publisher: 'bbc', topic: 'health', label: 'BBC Health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
  {
    publisher: 'bbc',
    topic: 'culture',
    label: 'BBC Entertainment & Arts',
    url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
  },
  { publisher: 'aljazeera', topic: null, label: 'Al Jazeera All', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { publisher: 'nasa', topic: 'science', label: 'NASA News', url: 'https://www.nasa.gov/feed/' },
  { publisher: 'guardian', topic: 'world', label: 'Guardian World', url: 'https://www.theguardian.com/world/rss' },
  {
    publisher: 'guardian',
    topic: 'science',
    label: 'Guardian Science',
    url: 'https://www.theguardian.com/science/rss',
  },
  {
    publisher: 'guardian',
    topic: 'environment',
    label: 'Guardian Environment',
    url: 'https://www.theguardian.com/environment/rss',
  },
  {
    publisher: 'guardian',
    topic: 'technology',
    label: 'Guardian Technology',
    url: 'https://www.theguardian.com/technology/rss',
  },
  {
    publisher: 'guardian',
    topic: 'economy',
    label: 'Guardian Business',
    url: 'https://www.theguardian.com/business/rss',
  },
  { publisher: 'guardian', topic: 'culture', label: 'Guardian Culture', url: 'https://www.theguardian.com/culture/rss' },
  {
    publisher: 'guardian',
    topic: 'health',
    label: 'Guardian Health',
    url: 'https://www.theguardian.com/society/health/rss',
  },
  { publisher: 'positive', topic: 'progress', label: 'Positive News', url: 'https://www.positive.news/feed/' },
  { publisher: 'wfae', topic: 'local', label: 'WFAE Local', url: 'https://www.wfae.org/news.rss' },
]);

export const FEED_BY_PUBLISHER = Object.freeze(
  Object.fromEntries(Object.keys(PUBLISHERS).map((id) => [id, FEEDS.filter((feed) => feed.publisher === id)])),
);

export const SOURCE_DEFS = Object.freeze([
  {
    id: 'weather',
    group: 'weather',
    label: 'Charlotte weather',
    provider: 'Open-Meteo forecast API',
    homepage: 'https://open-meteo.com/',
  },
  {
    id: 'air',
    group: 'air',
    label: 'Charlotte air quality',
    provider: 'Open-Meteo air-quality API',
    homepage: 'https://open-meteo.com/en/docs/air-quality-api',
  },
  ...Object.values(PUBLISHERS).map((publisher) => ({
    id: publisher.id,
    group: 'news',
    label: publisher.label,
    provider: publisher.provider,
    homepage: publisher.homepage,
  })),
  {
    id: 'earthquake',
    group: 'earthquake',
    label: 'Recent earthquakes',
    provider: 'USGS earthquake hazards program',
    homepage: 'https://earthquake.usgs.gov/earthquakes/feed/',
  },
  {
    id: 'wildlife',
    group: 'wildlife',
    label: 'Nearby wildlife',
    provider: 'iNaturalist',
    homepage: 'https://www.inaturalist.org/',
  },
  {
    id: 'eonet',
    group: 'eonet',
    label: 'NASA natural events',
    provider: 'NASA EONET v3',
    homepage: 'https://eonet.gsfc.nasa.gov/',
  },
]);

export const FETCH = Object.freeze({
  timeoutMs: 12_000,
  jsonMaxBytes: 3 * 1024 * 1024,
  feedMaxBytes: 2 * 1024 * 1024,
});

export const NEWS_INGEST_MAX_AGE_HOURS = 72;
export const NEWS_ITEMS_PER_FEED = 24;
export const NEWS_BATCH_SIZE = 8;
export const NEWS_BATCHES_PER_REFRESH = 2;

export const LLM_DEFAULTS = Object.freeze({
  enabled: false,
  endpoint: 'http://localhost:11434',
  model: 'llama3.1',
  timeoutMs: 45_000,
});

export const AUTO_REFRESH_MS = 10 * 60 * 1000;
export const TICK_MS = 30 * 1000;
export const RECORD_PAGE_SIZE = 40;

export const MOOD_COPY = Object.freeze({
  happy: {
    label: 'Happy',
    aria: 'eyes bright, cheeks warm, and a wide soft smile',
    accent: 'var(--happy)',
  },
  sad: {
    label: 'Sad',
    aria: 'brows tilted up, eyes lowered, and a small frown',
    accent: 'var(--sad)',
  },
  mad: {
    label: 'Mad',
    aria: 'brows pressed in, a flat mouth, and warm cheeks',
    accent: 'var(--mad)',
  },
  confused: {
    label: 'Confused',
    aria: 'one brow raised, eyes looking apart, and a wavy mouth',
    accent: 'var(--confused)',
  },
  calm: {
    label: 'Calm',
    aria: 'eyes gently closed and a small, level smile',
    accent: 'var(--calm)',
  },
});

/** Fixed, clearly fictional previews. These never enter the mood engine. */
export const PREVIEW_SCENARIOS = Object.freeze([
  {
    id: 'kindness',
    mood: 'happy',
    title: 'Kindness in the news',
    description:
      'A fictional neighborhood group shares its harvest with newcomers. Murmur would feel light and hopeful — a made-up example, not a live story.',
  },
  {
    id: 'loss',
    mood: 'sad',
    title: 'Distant loss',
    description:
      'A fictional coastal town loses its library to a flood. Murmur would feel heavy and quiet, with no claim about the real world.',
  },
  {
    id: 'unfair',
    mood: 'mad',
    title: 'An unfair decision',
    description:
      'A fictional rule makes it harder for small farms to compete. Murmur would feel a fair-minded frustration, not hatred.',
  },
  {
    id: 'uncertain',
    mood: 'confused',
    title: 'Contradicting reports',
    description:
      'Two fictional studies describe the same river in opposite ways. Murmur would feel uncertain and want to know more.',
  },
  {
    id: 'quiet',
    mood: 'calm',
    title: 'Quiet morning',
    description:
      'A fictional morning of mild air, slow clouds, and one bird at the feeder. Murmur would feel settled and unhurried.',
  },
]);
