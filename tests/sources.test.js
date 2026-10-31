import assert from 'node:assert/strict';
import { test } from './harness.js';
import { parseFeed, FeedParseError } from '../src/lib/parseFeed.js';
import { canonicalizeUrl, safeHttpsUrl } from '../src/lib/validate.js';
import { classifyTopic, loadFeed, normalizeNewsItem } from '../src/sources/news.js';
import { normalizeAir, normalizeWeather, parseLocalTimestamp } from '../src/sources/openMeteo.js';
import { normalizeEarthquakes } from '../src/sources/usgs.js';
import { normalizeWildlife } from '../src/sources/inaturalist.js';
import { normalizeEonet } from '../src/sources/eonet.js';
import { dedupeRecords } from '../src/lib/dedupe.js';
import { HOUR, NOW } from './fixtures.js';

function weatherPayload(epoch, overrides = {}) {
  const offset = -4 * 3600;
  const local = new Date(epoch + offset * 1000).toISOString().slice(0, 16);
  return {
    utc_offset_seconds: offset,
    current: {
      time: local,
      temperature_2m: 21.4,
      weather_code: 2,
      is_day: 1,
      relative_humidity_2m: 44,
      apparent_temperature: 22.1,
      wind_speed_10m: 8,
      precipitation: 0,
      cloud_cover: 30,
      uv_index: 3,
    },
    daily: {
      temperature_2m_max: [27],
      temperature_2m_min: [14],
      precipitation_probability_max: [10],
    },
    ...overrides,
  };
}

function airPayload(epoch) {
  const offset = -4 * 3600;
  const local = new Date(epoch + offset * 1000).toISOString().slice(0, 16);
  return {
    utc_offset_seconds: offset,
    current: { time: local, us_aqi: 31, pm2_5: 3.9, pm10: 4.5, ozone: 81, nitrogen_dioxide: 2.6 },
  };
}

test('Open-Meteo weather parses local time with the returned offset', () => {
  const now = Date.now();
  const record = normalizeWeather(weatherPayload(now), { now, fetchedAt: now });
  assert.equal(record.group, 'weather');
  assert.ok(record.key.startsWith('weather:'));
  assert.ok(Math.abs(record.observedAt - now) < 60_000);
  assert.equal(record.data.weatherCode, 2);
  assert.match(record.title, /Partly cloudy/);
  assert.equal(record.data.highC, 27);
});

test('Open-Meteo weather rejects a missing or invalid current block', () => {
  const now = Date.now();
  assert.throws(() => normalizeWeather({}, { now }), /no current observation/i);
  const invalidTime = weatherPayload(now);
  invalidTime.current.time = 'not-a-time';
  assert.throws(() => normalizeWeather(invalidTime, { now }), /time/i);
  const invalidCode = weatherPayload(now);
  invalidCode.current.weather_code = 'stormy';
  assert.throws(() => normalizeWeather(invalidCode, { now }), /code/i);
});

test('local timestamp parsing treats Open-Meteo time as wall clock plus offset', () => {
  assert.equal(parseLocalTimestamp('2026-10-31T16:15', -4 * 3600), Date.parse('2026-10-31T20:15:00Z'));
  assert.equal(parseLocalTimestamp('2026-10-31T16:15', undefined), null);
  assert.equal(parseLocalTimestamp('nope', 0), null);
});

test('Open-Meteo air quality is validated and categorized', () => {
  const now = Date.now();
  const record = normalizeAir(airPayload(now), { now, fetchedAt: now });
  assert.equal(record.group, 'air');
  assert.equal(record.data.usAqi, 31);
  assert.equal(record.data.category, 'Good');
  assert.throws(() => normalizeAir({ current: { time: 'x' } }, { now }), /Air-quality/i);
});

test('USGS preserves valid features and skips malformed ones', () => {
  const now = NOW;
  const payload = {
    features: [
      {
        id: 'us1',
        properties: {
          mag: 5.2,
          place: 'Somewhere',
          time: now - HOUR,
          updated: now - 30 * 60_000,
          url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us1',
          tsunami: 0,
          sig: 400,
        },
        geometry: { coordinates: [-80.84, 35.22, 10] },
      },
      {
        id: 'bad-mag',
        properties: { mag: null, time: now - HOUR },
        geometry: { coordinates: [-80, 35, 10] },
      },
      {
        id: 'http-url',
        properties: { mag: 4.1, time: now - HOUR, url: 'http://example.com/event' },
        geometry: { coordinates: [-80, 35, 10] },
      },
      {
        id: 'bad-geometry',
        properties: { mag: 4.2, time: now - HOUR },
        geometry: { coordinates: [999, 35, 10] },
      },
    ],
  };

  const { records, skipped } = normalizeEarthquakes(payload, { now, fetchedAt: now });
  assert.equal(records.length, 2);
  assert.equal(skipped, 2);
  assert.equal(records[0].key, 'quake:us1');
  assert.equal(records[0].data.magnitude, 5.2);
  assert.equal(records[0].url, payload.features[0].properties.url);
  assert.equal(records[1].url, 'https://earthquake.usgs.gov/earthquakes/eventpage/http-url');
});

test('USGS distinguishes a valid empty feed from a broken envelope', () => {
  const empty = normalizeEarthquakes({ features: [] }, { now: NOW, fetchedAt: NOW });
  assert.equal(empty.records.length, 0);
  assert.throws(() => normalizeEarthquakes({}, { now: NOW }), /feature list/i);
});

test('wildlife keeps eligibility fields and drops observer, photos, place and coordinates', () => {
  const now = Date.now();
  const observedAt = new Date(now - 2 * HOUR).toISOString();
  const payload = {
    results: [
      {
        id: 123,
        quality_grade: 'research',
        captive: false,
        observed_on: observedAt.slice(0, 10),
        time_observed_at: observedAt,
        taxon: {
          name: 'Cardinalis cardinalis',
          preferred_common_name: 'Northern Cardinal',
          rank: 'species',
          iconic_taxon_name: 'Aves',
        },
        uri: 'https://www.inaturalist.org/observations/123',
        updated_at: observedAt,
        location: '35.3000,-80.7000',
        place_guess: '123 Secret Street, Charlotte',
        user: { login: 'a-real-person' },
        photos: [{ url: 'https://example.com/photo.jpg' }],
      },
      {
        id: 124,
        quality_grade: 'casual',
        observed_on: observedAt.slice(0, 10),
        taxon: { name: 'Unknown' },
        uri: 'https://www.inaturalist.org/observations/124',
      },
    ],
  };

  const { records } = normalizeWildlife(payload, { now, fetchedAt: now });
  assert.equal(records.length, 1);
  const record = records[0];
  assert.equal(record.group, 'wildlife');
  assert.equal(record.dateOnly, false);
  assert.match(record.title, /Northern Cardinal/);
  assert.match(record.summary, /Research-grade/);

  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes('Secret Street'));
  assert.ok(!serialized.includes('a-real-person'));
  assert.ok(!serialized.includes('photo.jpg'));
  assert.ok(!serialized.includes('35.3000'));
  assert.ok(Number.isFinite(record.data.distanceKm));
  assert.equal(record.data.distanceKm % 5, 0);
});

test('date-only wildlife observations are labelled honestly', () => {
  const now = Date.now();
  const observedOn = new Date(now - 2 * 24 * HOUR).toISOString().slice(0, 10);
  const payload = {
    results: [
      {
        id: 125,
        quality_grade: 'research',
        observed_on: observedOn,
        time_observed_at: null,
        taxon: { name: 'Acer rubrum', preferred_common_name: 'Red Maple', rank: 'species' },
        uri: 'https://www.inaturalist.org/observations/125',
      },
    ],
  };
  const { records } = normalizeWildlife(payload, { now, fetchedAt: now });
  assert.equal(records.length, 1);
  assert.equal(records[0].dateOnly, true);
  assert.match(records[0].summary, /date only/);
});

test('EONET keeps only open fires, storms and volcanoes and preserves the earliest date', () => {
  const now = Date.now();
  const firstAt = new Date(now - 3 * 24 * HOUR).toISOString();
  const latestAt = new Date(now - HOUR).toISOString();
  const payload = {
    events: [
      {
        id: 'EONET_1',
        title: 'A fire',
        link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1',
        closed: null,
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        geometry: [
          { date: firstAt, coordinates: [-120, 38], magnitudeValue: 100, magnitudeUnit: 'acres' },
          { date: latestAt, coordinates: [-120.1, 38.1], magnitudeValue: 150, magnitudeUnit: 'acres' },
        ],
      },
      {
        id: 'EONET_2',
        title: 'An iceberg',
        link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_2',
        closed: null,
        categories: [{ id: 'seaLakeIce', title: 'Sea and Lake Ice' }],
        geometry: [{ date: latestAt, coordinates: [0, -60] }],
      },
      {
        id: 'EONET_3',
        title: 'A closed fire',
        link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_3',
        closed: latestAt,
        categories: [{ id: 'wildfires', title: 'Wildfires' }],
        geometry: [{ date: latestAt, coordinates: [-120, 38] }],
      },
    ],
  };

  const { records, skipped } = normalizeEonet(payload, { now, fetchedAt: now });
  assert.equal(records.length, 1);
  assert.equal(skipped, 2);
  assert.equal(records[0].key, 'eonet:EONET_1');
  assert.equal(records[0].originalAt, Date.parse(firstAt));
  assert.equal(records[0].observedAt, Date.parse(latestAt));
  assert.equal(records[0].data.categoryId, 'wildfires');
});

test('EONET rejects a broken envelope but treats a filtered list as valid empty', () => {
  assert.throws(() => normalizeEonet({}, { now: NOW }), /events list/i);
  const filtered = normalizeEonet({ events: [] }, { now: NOW, fetchedAt: NOW });
  assert.equal(filtered.records.length, 0);
});

test('RSS parser handles CDATA, entities, and channel items', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>BBC</title><item><title>Storm &amp; calm</title><link>https://www.bbc.com/news/story?utm_source=rss</link><pubDate>Fri, 30 Oct 2026 21:15:19 GMT</pubDate><description><![CDATA[<p>Some <b>text</b></p>]]></description><category>Science</category></item></channel></rss>`;
  const parsed = parseFeed(xml);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].title, 'Storm & calm');
  assert.match(parsed.items[0].summary, /Some text/);
  assert.deepEqual(parsed.items[0].categories, ['Science']);
  assert.equal(parsed.items[0].publishedRaw, 'Fri, 30 Oct 2026 21:15:19 GMT');
});

test('RSS parser distinguishes an empty feed from an HTML error page', () => {
  const empty = parseFeed('<rss version="2.0"><channel><title>Empty</title></channel></rss>');
  assert.equal(empty.items.length, 0);
  assert.throws(() => parseFeed('<html><body>Rate limit</body></html>'), FeedParseError);
  assert.throws(() => parseFeed(''), FeedParseError);
});

test('news items require a safe HTTPS link and a valid original date', () => {
  const feed = { publisher: 'wfae', topic: 'local', label: 'WFAE Local' };
  const now = NOW;
  const item = {
    title: 'Charlotte council votes on transit',
    link: 'https://www.wfae.org/news/story?utm_campaign=x',
    publishedRaw: new Date(now - HOUR).toUTCString(),
    summary: 'A local story.',
    categories: [],
  };
  const record = normalizeNewsItem(item, feed, { now, fetchedAt: now });
  assert.equal(record.group, 'news');
  assert.equal(record.data.topic, 'local');
  assert.ok(!record.url.includes('utm_'));
  assert.equal(normalizeNewsItem({ ...item, link: 'http://www.wfae.org/story' }, feed, { now }), null);
  assert.equal(normalizeNewsItem({ ...item, publishedRaw: 'not a date' }, feed, { now }), null);
  assert.equal(normalizeNewsItem({ ...item, publishedRaw: new Date(now - 100 * HOUR).toUTCString() }, feed, { now }), null);
});

test('topic classification and title dedupe behave deterministically', () => {
  assert.equal(classifyTopic('Charlotte council votes on transit'), 'local');
  assert.equal(classifyTopic('New vaccine trial shows promise'), 'health');
  assert.equal(classifyTopic('Wildfire smoke reaches the coast'), 'environment');
  assert.equal(classifyTopic('Central bank holds interest rates'), 'economy');
  assert.equal(classifyTopic('A quiet festival of books'), 'culture');

  const first = normalizeNewsItem(
    {
      title: 'Storm & calm',
      link: 'https://www.bbc.com/news/story?a=1',
      publishedRaw: new Date(NOW - HOUR).toUTCString(),
    },
    { publisher: 'bbc', topic: 'world', label: 'BBC World' },
    { now: NOW },
  );
  const second = { ...first, key: 'news:other', url: 'https://www.bbc.com/news/other' };
  assert.equal(dedupeRecords([first, second]).records.length, 1);
});

test('the feed loader reports malformed and empty responses separately', async () => {
  const feed = { publisher: 'wfae', topic: 'local', label: 'WFAE Local', url: 'https://www.wfae.org/news.rss' };
  const now = Date.now();
  const pubDate = new Date(now - HOUR).toUTCString();

  const validXml = `<?xml version="1.0"?><rss version="2.0"><channel><title>WFAE</title><item><title>Charlotte story</title><link>https://www.wfae.org/news/story</link><pubDate>${pubDate}</pubDate></item></channel></rss>`;

  const makeFetch = (xml) => async (url) => {
    assert.match(String(url), /\/api\/proxy\?url=/);
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => 'application/rss+xml' },
      text: async () => xml,
    };
  };

  const live = await loadFeed(feed, { fetchImpl: makeFetch(validXml), proxyBase: 'http://localhost:8080', now });
  assert.equal(live.status, 'live');
  assert.equal(live.records.length, 1);

  const malformed = await loadFeed(feed, {
    fetchImpl: makeFetch('<html><body>Blocked</body></html>'),
    proxyBase: 'http://localhost:8080',
    now,
  });
  assert.equal(malformed.status, 'malformed');

  const empty = await loadFeed(feed, {
    fetchImpl: makeFetch('<rss version="2.0"><channel><title>Empty</title></channel></rss>'),
    proxyBase: 'http://localhost:8080',
    now,
  });
  assert.equal(empty.status, 'empty');
});

test('safe URL and canonical URL validation reject unsafe forms', () => {
  assert.equal(safeHttpsUrl('http://example.com/x'), null);
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl('https://user:pass@example.com/x'), null);
  assert.equal(safeHttpsUrl('https://127.0.0.1/x'), null);
  assert.ok(safeHttpsUrl('https://www.wfae.org/news/story'));
  assert.equal(
    canonicalizeUrl('https://www.wfae.org/news/story/?utm_source=x&id=2#part'),
    'https://www.wfae.org/news/story?id=2',
  );
});
