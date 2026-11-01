import assert from 'node:assert/strict';
import { test } from './harness.js';
import { cacheRequestUrl, loadWorldCache, validateWorldCache } from '../src/app/worldCache.js';
import { NOW, newsRecord, weatherRecord } from './fixtures.js';

function snapshot({ generatedAt = NOW - 30 * 60_000, sources } = {}) {
  return {
    schemaVersion: 2,
    generatedAt,
    newsModel: {
      provider: 'Test',
      model: 'test-model',
      configured: true,
      available: true,
      error: null,
      reactionCount: 1,
      interpretedThisRun: 1,
      generatedAt,
    },
    newsReactions: [
      {
        sourceId: 'news:record-one',
        mood: 'happy',
        intensity: 0.4,
        text: 'A small, hopeful feeling.',
        interpretedAt: generatedAt,
      },
    ],
    sources:
      sources ??
      [
        {
          sourceId: 'weather',
          status: 'live',
          error: null,
          fetchedAt: generatedAt,
          records: [weatherRecord({ fetchedAt: generatedAt })],
        },
        {
          sourceId: 'bbc',
          status: 'live',
          error: null,
          fetchedAt: generatedAt,
          records: [newsRecord({ fetchedAt: generatedAt })],
        },
      ],
  };
}

test('a valid world cache keeps source metadata and records', () => {
  const cache = validateWorldCache(snapshot(), { now: NOW });
  assert.equal(cache.schemaVersion, 2);
  assert.equal(cache.sources.length, 2);
  assert.equal(cache.sources[0].label, 'Charlotte weather');
  assert.equal(cache.sources[0].records[0].sourceLabel, 'Charlotte weather');
  assert.equal(cache.sources[1].records[0].data.topic, 'world');
  assert.equal(cache.staleHours, 0.5);
  assert.equal(cache.invalidRecords, 0);
  assert.equal(cache.newsModel.reactionCount, 1);
  assert.equal(cache.newsReactions.length, 1);
  assert.equal(cache.newsReactions[0].interpretedAt, NOW - 30 * 60_000);
});

test('an unsupported cache schema or missing generation time is rejected', () => {
  assert.throws(() => validateWorldCache({ ...snapshot(), schemaVersion: 3 }, { now: NOW }), /schema/);
  assert.throws(() => validateWorldCache({ ...snapshot(), generatedAt: null }, { now: NOW }), /generation time/);
  assert.throws(() => validateWorldCache({ ...snapshot(), sources: [] }, { now: NOW }), /source list/);
});

test('legacy schema 1 caches still load without news reactions', () => {
  const legacy = snapshot();
  legacy.schemaVersion = 1;
  delete legacy.newsModel;
  delete legacy.newsReactions;
  const cache = validateWorldCache(legacy, { now: NOW });
  assert.equal(cache.newsReactions.length, 0);
  assert.equal(cache.newsModel.reactionCount, 0);
});

test('unknown or undated cached news reactions are dropped', () => {
  const payload = snapshot();
  payload.newsReactions.push(
    {
      sourceId: 'news:missing',
      mood: 'sad',
      intensity: 0.3,
      text: 'A missing story.',
      interpretedAt: payload.generatedAt,
    },
    {
      sourceId: 'news:record-one',
      mood: 'sad',
      intensity: 0.3,
      text: 'No timestamp.',
    },
  );
  const cache = validateWorldCache(payload, { now: NOW });
  assert.equal(cache.newsReactions.length, 1);
  assert.equal(cache.newsModel.reactionCount, 1);
  assert.equal(cache.invalidReactions, 2);
});

test('cached hopeful and uneasy reactions survive validation', () => {
  const payload = snapshot();
  payload.sources[1].records.push(newsRecord({ key: 'news:record-two', title: 'A second headline' }));
  payload.newsReactions = [
    {
      sourceId: 'news:record-one',
      mood: 'hopeful',
      intensity: 0.4,
      text: 'Encouraged by a possible improvement.',
      interpretedAt: payload.generatedAt,
    },
    {
      sourceId: 'news:record-two',
      mood: 'uneasy',
      intensity: 0.3,
      text: 'Watchful about a possible threat.',
      interpretedAt: payload.generatedAt,
    },
  ];

  const cache = validateWorldCache(payload, { now: NOW });
  assert.deepEqual(cache.newsReactions.map((reaction) => reaction.mood), ['hopeful', 'uneasy']);
  assert.equal(cache.invalidReactions, 0);
});

test('invalid cached records are dropped without discarding the source', () => {
  const payload = snapshot();
  payload.sources[0].records.push(
    weatherRecord({ key: 'weather:bad-url', url: 'http://example.com/not-https' }),
    weatherRecord({ key: 'weather:bad-time', originalAt: NOW + 60 * 60_000 }),
  );
  const cache = validateWorldCache(payload, { now: NOW });
  assert.equal(cache.sources[0].records.length, 1);
  assert.equal(cache.invalidRecords, 2);
  assert.equal(cache.sources[0].status, 'live');
});

test('a live source with no surviving records becomes malformed', () => {
  const payload = snapshot();
  payload.sources[0].records = [weatherRecord({ url: 'javascript:alert(1)' })];
  const cache = validateWorldCache(payload, { now: NOW });
  assert.equal(cache.sources[0].status, 'malformed');
  assert.match(cache.sources[0].error, /validation/);
});

test('cache URLs preserve a project Pages subpath and change every ten minutes', () => {
  const url = 'https://slayyyyer.github.io/murmur/data/world-cache.json';
  const first = cacheRequestUrl(url, NOW);
  const second = cacheRequestUrl(url, NOW + 10 * 60_000);
  assert.match(first, /^https:\/\/slayyyyer\.github\.io\/murmur\/data\/world-cache\.json\?v=\d+$/);
  assert.notEqual(first, second);
});

test('loadWorldCache fetches the versioned cache and validates it', async () => {
  let requested = null;
  const fetchImpl = async (url) => {
    requested = url;
    return new Response(JSON.stringify(snapshot()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const cache = await loadWorldCache({
    fetchImpl,
    url: 'https://slayyyyer.github.io/murmur/data/world-cache.json',
    now: NOW,
  });
  assert.match(requested, /\?v=\d+$/);
  assert.equal(cache.sources.length, 2);
});
