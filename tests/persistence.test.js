import assert from 'node:assert/strict';
import { test } from './harness.js';
import { createMemoryStore, memoryStoreFromSnapshot } from '../src/store/memoryStore.js';
import { createRepository } from '../src/store/repository.js';
import { runRefresh } from '../src/app/runRefresh.js';
import { buildSourceStates } from '../src/app/sourceState.js';
import { computeMood } from '../src/mood/engine.js';
import { dedupeRecords } from '../src/lib/dedupe.js';
import { measuredReaction } from '../src/interpret/reactions.js';
import { HOUR, NOW, newsRecord, weatherRecord } from './fixtures.js';

test('ingesting the same observation twice keeps one row and its first-seen time', async () => {
  const repository = createRepository(createMemoryStore());
  const record = weatherRecord();

  const first = await repository.ingestRecords([record], NOW);
  const second = await repository.ingestRecords([record], NOW + 5 * 60_000);

  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);

  const stored = await repository.listRecords();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].firstSeenAt, NOW);
  assert.equal(stored[0].lastSeenAt, NOW + 5 * 60_000);
});

test('a reaction is saved once and never strengthened by repeated evidence', async () => {
  const repository = createRepository(createMemoryStore());
  const record = weatherRecord();
  await repository.ingestRecords([record], NOW);

  const reaction = measuredReaction(record, { now: NOW });
  const first = await repository.saveReactionIfAbsent(reaction);
  const second = await repository.saveReactionIfAbsent({ ...reaction, intensity: 1, firstInterpretedAt: NOW + HOUR });

  assert.equal(first.saved, true);
  assert.equal(second.saved, false);

  const stored = await repository.listReactions();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].firstInterpretedAt, NOW);
  assert.equal(stored[0].intensity, reaction.intensity);

  const moodNow = computeMood({ reactions: stored, now: NOW });
  const moodLater = computeMood({ reactions: stored, now: NOW + 3 * HOUR });
  assert.ok(moodLater.score < moodNow.score);
});

test('saved reactions survive a simulated restart with their original age', async () => {
  const store = createMemoryStore();
  const repository = createRepository(store);
  const record = weatherRecord({ originalAt: NOW - 2 * HOUR, observedAt: NOW - 2 * HOUR });
  await repository.ingestRecords([record], NOW);
  const reaction = measuredReaction(record, { now: NOW - 2 * HOUR });
  await repository.saveReactionIfAbsent(reaction);

  const snapshot = store.snapshot();
  const restarted = createRepository(memoryStoreFromSnapshot(snapshot));
  const stored = await restarted.listReactions();

  assert.equal(stored.length, 1);
  assert.equal(stored[0].firstInterpretedAt, NOW - 2 * HOUR);

  const mood = computeMood({ reactions: stored, now: NOW });
  const active = mood.active.find((item) => item.reaction.group === 'weather');
  assert.ok(active);
  assert.ok(
    Math.abs(active.contribution - stored[0].intensity * 0.25 * 2 ** (-2 / 3)) < 1e-12,
  );
});

test('repeat nature IDs keep the earliest original date while observations advance', async () => {
  const repository = createRepository(createMemoryStore());
  const base = {
    key: 'eonet:EONET_1',
    group: 'eonet',
    sourceId: 'eonet',
    sourceLabel: 'NASA EONET',
    title: 'Open wildfire',
    summary: '',
    url: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_1',
    observedAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    fetchedAt: NOW,
    dateOnly: false,
    data: { categoryId: 'wildfires', categoryLabel: 'Wildfire' },
  };

  await repository.ingestRecords([{ ...base, originalAt: NOW - 10 * 24 * HOUR }], NOW);
  await repository.ingestRecords(
    [{ ...base, originalAt: NOW - 9 * 24 * HOUR, observedAt: NOW - 30 * 60_000, updatedAt: NOW - 30 * 60_000 }],
    NOW,
  );

  const [stored] = await repository.listRecords();
  assert.equal(stored.originalAt, NOW - 10 * 24 * HOUR);
  assert.equal(stored.observedAt, NOW - 30 * 60_000);
  assert.equal(stored.updatedAt, NOW - 30 * 60_000);
});

test('duplicate headlines from two URLs are removed', () => {
  const first = newsRecord({ key: 'news:a', title: 'Storm & calm', url: 'https://example.com/a' });
  const second = newsRecord({ key: 'news:b', title: 'Storm and calm', url: 'https://example.com/b' });
  const { records, removed } = dedupeRecords([first, second]);
  assert.equal(records.length, 1);
  assert.equal(removed, 1);
});

test('source failures are independent and cached records survive', async () => {
  const repository = createRepository(createMemoryStore());
  const weatherLoader = {
    id: 'weather',
    label: 'Charlotte weather',
    provider: 'Open-Meteo',
    group: 'weather',
    async load() {
      return { status: 'live', records: [weatherRecord()], fetchedAt: NOW, error: null };
    },
  };
  const wildlifeLoader = {
    id: 'wildlife',
    label: 'Nearby wildlife',
    provider: 'iNaturalist',
    group: 'wildlife',
    async load() {
      throw new Error('upstream down');
    },
  };

  const result = await runRefresh({ loaders: [weatherLoader, wildlifeLoader], repository, now: NOW });
  const wildlifeOutcome = result.outcomes.find((outcome) => outcome.sourceId === 'wildlife');
  assert.equal(wildlifeOutcome.status, 'unavailable');
  assert.match(wildlifeOutcome.error, /upstream down/);
  assert.equal((await repository.listRecords()).length, 1);
  assert.equal(result.reactionsSaved.length, 1);

  const firstStates = buildSourceStates({ outcomes: result.outcomes, records: await repository.listRecords(), now: NOW });
  const failingWeather = {
    id: 'weather',
    label: 'Charlotte weather',
    provider: 'Open-Meteo',
    group: 'weather',
    async load() {
      throw new Error('timeout');
    },
  };
  const second = await runRefresh({ loaders: [failingWeather, wildlifeLoader], repository, now: NOW + HOUR });
  const records = await repository.listRecords();
  const states = buildSourceStates({
    outcomes: second.outcomes,
    records,
    previousStates: firstStates,
    now: NOW + HOUR,
  });

  const weatherState = states.find((state) => state.sourceId === 'weather');
  assert.equal(records.length, 1);
  assert.equal(weatherState.status, 'cached');
  assert.equal(weatherState.recordCount, 1);
  assert.equal(weatherState.lastSuccessAt, NOW);
});

test('refresh creates no news reactions on its own', async () => {
  const repository = createRepository(createMemoryStore());
  const loader = {
    id: 'bbc',
    label: 'BBC',
    provider: 'BBC News',
    group: 'news',
    async load() {
      return { status: 'live', records: [newsRecord()], fetchedAt: NOW, error: null };
    },
  };
  await runRefresh({ loaders: [loader], repository, now: NOW });
  const reactions = await repository.listReactions();
  assert.equal(reactions.length, 0);
});

test('source state records the cache fetch time, not the browser load time', () => {
  const fetchedAt = NOW - 2 * HOUR;
  const states = buildSourceStates({
    outcomes: [
      {
        sourceId: 'weather',
        label: 'Charlotte weather',
        provider: 'Open-Meteo',
        homepage: 'https://open-meteo.com/',
        group: 'weather',
        status: 'live',
        records: [],
        error: null,
        fetchedAt,
      },
    ],
    records: [weatherRecord({ fetchedAt })],
    now: NOW,
    attemptAt: fetchedAt,
  });

  assert.equal(states[0].lastSuccessAt, fetchedAt);
  assert.equal(states[0].lastAttemptAt, fetchedAt);
});
