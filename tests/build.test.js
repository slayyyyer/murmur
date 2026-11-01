import assert from 'node:assert/strict';
import { test } from './harness.js';
import { composeSnapshot, prepareBuild, recordIsRetained } from '../src/app/buildSnapshot.js';
import { validateWorldCache } from '../src/app/worldCache.js';
import { HOUR, NOW, newsRecord, weatherRecord } from './fixtures.js';

const modelConfig = { configured: true, provider: 'Test', model: 'test-model' };
const modelReaction = {
  sourceId: 'news:record-one',
  mood: 'happy',
  intensity: 0.4,
  text: 'Encouraged by people choosing to cooperate.',
};

function sourceOutcome(sourceId, status, records, fetchedAt, extra = {}) {
  const groups = {
    weather: { label: 'Charlotte weather', provider: 'Open-Meteo', homepage: 'https://open-meteo.com/', group: 'weather' },
    bbc: { label: 'BBC', provider: 'BBC News', homepage: 'https://www.bbc.com/news', group: 'news' },
  };
  return {
    sourceId,
    ...groups[sourceId],
    status,
    records,
    error: extra.error ?? null,
    fetchedAt,
    ...extra,
  };
}

test('a failed news feed retains the published record and original interpretation timestamp', () => {
  const firstNews = newsRecord();
  const firstWeather = weatherRecord();
  const plan1 = prepareBuild({
    outcomes: [
      sourceOutcome('bbc', 'live', [firstNews], NOW),
      sourceOutcome('weather', 'live', [firstWeather], NOW),
    ],
    records: [firstNews, firstWeather],
    now: NOW,
  });
  assert.equal(plan1.pending.length, 1);

  const snapshot1 = composeSnapshot({
    plan: plan1,
    modelResult: { ok: true, error: null, reactions: [modelReaction], rejected: [] },
    modelConfig,
    now: NOW,
  });
  assert.equal(snapshot1.newsReactions[0].interpretedAt, NOW);
  assert.equal(validateWorldCache(snapshot1, { now: NOW }).newsReactions.length, 1);

  const failed = prepareBuild({
    outcomes: [
      sourceOutcome('bbc', 'unavailable', [], NOW + HOUR, { error: 'HTTP 503' }),
      sourceOutcome('weather', 'live', [firstWeather], NOW + HOUR),
    ],
    records: [firstWeather],
    previous: snapshot1,
    now: NOW + HOUR,
  });
  const newsSource = failed.sources.find((source) => source.sourceId === 'bbc');
  assert.equal(newsSource.status, 'unavailable');
  assert.equal(newsSource.records.length, 1);
  assert.equal(newsSource.records[0].key, firstNews.key);
  assert.equal(newsSource.lastSuccessAt, NOW);
  assert.equal(failed.pending.length, 0);
  assert.equal(failed.carried.length, 1);
  assert.equal(failed.carried[0].interpretedAt, NOW);

  const snapshot2 = composeSnapshot({ plan: failed, modelConfig, now: NOW + HOUR });
  assert.equal(snapshot2.newsReactions.length, 1);
  assert.equal(snapshot2.newsReactions[0].interpretedAt, NOW);
  assert.equal(snapshot2.sources.find((source) => source.sourceId === 'bbc').lastSuccessAt, NOW);

  const recovered = prepareBuild({
    outcomes: [
      sourceOutcome('bbc', 'live', [newsRecord()], NOW + 2 * HOUR),
      sourceOutcome('weather', 'live', [weatherRecord()], NOW + 2 * HOUR),
    ],
    records: [newsRecord(), weatherRecord()],
    previous: snapshot2,
    now: NOW + 2 * HOUR,
  });
  assert.equal(recovered.pending.length, 0);
  const snapshot3 = composeSnapshot({ plan: recovered, modelConfig, now: NOW + 2 * HOUR });
  assert.equal(snapshot3.newsReactions.length, 1);
  assert.equal(snapshot3.newsReactions[0].interpretedAt, NOW);
});

test('an empty successful feed is distinct from a failure with retained history', () => {
  const firstNews = newsRecord();
  const snapshot1 = composeSnapshot({
    plan: prepareBuild({
      outcomes: [sourceOutcome('bbc', 'live', [firstNews], NOW)],
      records: [firstNews],
      now: NOW,
    }),
    modelResult: { ok: true, error: null, reactions: [modelReaction], rejected: [] },
    modelConfig,
    now: NOW,
  });

  const empty = prepareBuild({
    outcomes: [sourceOutcome('bbc', 'empty', [], NOW + HOUR)],
    records: [],
    previous: snapshot1,
    now: NOW + HOUR,
  });
  assert.equal(empty.sources[0].status, 'empty');
  assert.equal(empty.sources[0].records.length, 0);
  assert.equal(empty.carried.length, 0);
  assert.equal(empty.pending.length, 0);
});

test('retention removes expired history instead of publishing it indefinitely', () => {
  const old = newsRecord({
    key: 'news:old',
    originalAt: NOW - 49 * HOUR,
    observedAt: NOW - 49 * HOUR,
  });
  const snapshot1 = composeSnapshot({
    plan: prepareBuild({
      outcomes: [sourceOutcome('bbc', 'live', [old], NOW - 49 * HOUR)],
      records: [old],
      now: NOW - 49 * HOUR,
    }),
    modelResult: {
      ok: true,
      error: null,
      reactions: [{ ...modelReaction, sourceId: 'news:old' }],
      rejected: [],
    },
    modelConfig,
    now: NOW - 49 * HOUR,
  });

  const failed = prepareBuild({
    outcomes: [sourceOutcome('bbc', 'unavailable', [], NOW, { error: 'HTTP 503' })],
    records: [],
    previous: snapshot1,
    now: NOW,
  });
  assert.equal(failed.sources[0].records.length, 0);
  assert.equal(failed.carried.length, 0);
  assert.equal(recordIsRetained(old, NOW), false);
});

test('a model failure is visible while healthy sources and prior reactions still deploy', () => {
  const oldNews = newsRecord();
  const newNews = newsRecord({ key: 'news:new', title: 'A second headline' });
  const previous = composeSnapshot({
    plan: prepareBuild({
      outcomes: [sourceOutcome('bbc', 'live', [oldNews], NOW)],
      records: [oldNews],
      now: NOW,
    }),
    modelResult: { ok: true, error: null, reactions: [modelReaction], rejected: [] },
    modelConfig,
    now: NOW,
  });

  const plan = prepareBuild({
    outcomes: [
      sourceOutcome('bbc', 'live', [oldNews, newNews], NOW + HOUR),
      sourceOutcome('weather', 'live', [weatherRecord()], NOW + HOUR),
    ],
    records: [oldNews, newNews, weatherRecord()],
    previous,
    now: NOW + HOUR,
  });
  assert.equal(plan.pending.length, 1);
  const snapshot = composeSnapshot({
    plan,
    modelResult: { ok: false, error: 'HTTP 401', reactions: [], rejected: [] },
    modelConfig,
    now: NOW + HOUR,
  });

  assert.equal(snapshot.newsModel.available, false);
  assert.equal(snapshot.newsModel.error, 'HTTP 401');
  assert.equal(snapshot.newsReactions.length, 1);
  assert.equal(snapshot.newsReactions[0].interpretedAt, NOW);
  assert.equal(snapshot.sources.find((source) => source.sourceId === 'weather').status, 'live');
});

test('a failed source without a prior success does not invent a last-success time', () => {
  const plan = prepareBuild({
    outcomes: [sourceOutcome('bbc', 'unavailable', [], NOW, { error: 'HTTP 503' })],
    records: [],
    previous: null,
    now: NOW,
  });
  assert.equal(plan.sources[0].lastSuccessAt, null);
});