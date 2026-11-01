#!/usr/bin/env node
/**
 * Run inside GitHub Actions (or locally with the relay running). Fetches all
 * sources, asks an external OpenAI-compatible model to interpret new
 * headlines, carries forward earlier valid reactions, and writes one static
 * cache for the browser. The model key never enters the browser.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { runRefresh } from '../src/app/runRefresh.js';
import { createLoaders } from '../src/sources/loaders.js';
import { createRepository } from '../src/store/repository.js';
import { createMemoryStore } from '../src/store/memoryStore.js';
import { dedupeRecords } from '../src/lib/dedupe.js';
import { WORLD_CACHE_SCHEMA_VERSION } from '../src/config.js';
import { interpretNewsWithModel, resolveNewsModelConfig } from '../src/ai/buildNewsModel.js';
import { composeSnapshot, prepareBuild } from '../src/app/buildSnapshot.js';
import { createReaction, measuredReaction } from '../src/interpret/reactions.js';
import { computeMood } from '../src/mood/engine.js';
import {
  createMoodPoint,
  mergeMoodMonth,
  moodHistoryIndex,
  moodMonthKey,
  normalizeMoodIndex,
  normalizeMoodMonth,
} from '../src/app/moodHistory.js';

const MAX_SOURCE_RECORDS = 250;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

const proxyBase = process.env.MURMUR_PROXY?.trim();
if (!proxyBase) {
  throw new Error('MURMUR_PROXY is required, for example http://127.0.0.1:8080');
}

async function fetchJsonWithTimeout(url, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readPreviousCache() {
  try {
    const local = JSON.parse(await readFile(new URL('../data/world-cache.json', import.meta.url), 'utf8'));
    if (local?.schemaVersion === 1 || local?.schemaVersion === WORLD_CACHE_SCHEMA_VERSION) return local;
  } catch {
    /* no local previous cache */
  }

  const url = process.env.PREVIOUS_CACHE_URL?.trim();
  if (!url) return null;
  const separator = url.includes('?') ? '&' : '?';
  return fetchJsonWithTimeout(`${url}${separator}v=${Date.now()}`);
}

function previousMoodIndexUrl() {
  const explicit = process.env.PREVIOUS_MOOD_INDEX_URL?.trim();
  if (explicit) return explicit;
  const cacheUrl = process.env.PREVIOUS_CACHE_URL?.trim();
  return cacheUrl ? new URL('mood/index.json', cacheUrl).href : null;
}

/** Rebuild the same reactions the browser derives, plus the cached news reactions. */
function reactionsForMood(plan, payload, now) {
  const measured = plan.records
    .filter((record) => record.group !== 'news')
    .map((record) => measuredReaction(record, { now }))
    .filter(Boolean);
  const news = payload.newsReactions
    .map((item) => {
      const record = plan.newsByKey.get(item.sourceId);
      return record ? createReaction(record, item, { now: item.interpretedAt }) : null;
    })
    .filter(Boolean);
  return [...measured, ...news];
}

async function updateMoodHistory({ plan, payload, now }) {
  const indexUrl = previousMoodIndexUrl();
  const months = new Map();

  if (indexUrl) {
    const separator = indexUrl.includes('?') ? '&' : '?';
    const rawIndex = await fetchJsonWithTimeout(`${indexUrl}${separator}v=${now}`);
    if (!rawIndex) {
      console.warn('Previous mood history index was unavailable; starting a new history file.');
    }
    const previousIndex = normalizeMoodIndex(rawIndex);
    await Promise.all(
      previousIndex.months.map(async (month) => {
        const monthUrl = new URL(`${month}.json`, indexUrl);
        monthUrl.searchParams.set('v', String(now));
        const raw = await fetchJsonWithTimeout(monthUrl.href);
        const normalized = normalizeMoodMonth(raw, month);
        if (normalized) months.set(month, normalized);
        else console.warn(`Mood history month ${month} was unavailable; omitting it from this deploy.`);
      }),
    );
  }

  const mood = computeMood({ reactions: reactionsForMood(plan, payload, now), now });
  const point = createMoodPoint(mood, { at: payload.generatedAt });
  if (!point) throw new Error('Could not create a mood history point.');
  const month = moodMonthKey(point.at);
  if (!month) throw new Error('Could not determine the mood history month.');
  const merged = mergeMoodMonth(months.get(month), point, { now: point.at });
  if (!merged) throw new Error('Could not merge the mood history point.');
  months.set(month, merged);

  for (const [key, value] of months) {
    if (!value.points.length) months.delete(key);
  }

  const moodDirectory = new URL('../data/mood/', import.meta.url);
  await mkdir(moodDirectory, { recursive: true });
  await Promise.all(
    [...months.entries()].map(([key, value]) =>
      writeFile(new URL(`${key}.json`, moodDirectory), JSON.stringify(value)),
    ),
  );
  const index = moodHistoryIndex([...months.keys()], { updatedAt: point.at });
  await writeFile(new URL('index.json', moodDirectory), JSON.stringify(index));

  return {
    point,
    months: months.size,
    points: [...months.values()].reduce((total, value) => total + value.points.length, 0),
  };
}

const now = Date.now();
const repository = createRepository(createMemoryStore());
const result = await runRefresh({
  loaders: createLoaders({ fetchImpl: fetch, proxyBase, now }),
  repository,
  now,
});

if (result.ingestError) {
  throw new Error(`The in-memory cache database rejected records: ${result.ingestError}`);
}

const current = dedupeRecords(result.outcomes.flatMap((source) => source.records));
const previous = await readPreviousCache();
const plan = prepareBuild({
  outcomes: result.outcomes,
  records: current.records,
  previous,
  now,
  maxSourceRecords: MAX_SOURCE_RECORDS,
});
const sources = plan.sources;

const answered = sources.filter((source) => source.status === 'live' || source.status === 'empty').length;
if (!sources.some((source) => source.status === 'live')) {
  throw new Error('No source returned usable data; the previous Pages deployment will be kept.');
}

const modelConfig = resolveNewsModelConfig(process.env);
let modelResult = {
  ok: modelConfig.configured,
  error: null,
  reactions: [],
  rejected: [],
  model: modelConfig.model,
  provider: modelConfig.provider,
};

if (plan.pending.length) {
  modelResult = await interpretNewsWithModel({
    records: plan.pending,
    config: modelConfig,
    fetchImpl: fetch,
    now,
  });
}

const payload = composeSnapshot({ plan, modelResult, modelConfig, now });
const newsModel = payload.newsModel;
const json = JSON.stringify(payload);
const bytes = Buffer.byteLength(json);
if (bytes > MAX_CACHE_BYTES) {
  throw new Error(`World cache is ${bytes} bytes, over the ${MAX_CACHE_BYTES}-byte limit.`);
}

const dataDirectory = new URL('../data/', import.meta.url);
await mkdir(dataDirectory, { recursive: true });
await writeFile(new URL('world-cache.json', dataDirectory), json);
const moodHistory = await updateMoodHistory({ plan, payload, now });

console.log(
  `Wrote data/world-cache.json (${(bytes / 1024).toFixed(1)} KiB): ` +
    `${answered}/${sources.length} sources answered, ${plan.records.length} unique records, ` +
    `${current.removed} duplicates removed.`,
);
console.log(
  `Mood history: ${moodHistory.points} points across ${moodHistory.months} month(s); ` +
    `latest ${new Date(moodHistory.point.at).toISOString()} ${moodHistory.point.mood} ${moodHistory.point.score.toFixed(3)}.`,
);
for (const source of sources) {
  console.log(`  ${source.sourceId.padEnd(12)} ${source.status.padEnd(12)} ${source.records.length} records`);
}

console.log(
  `News model ${modelConfig.provider}/${modelConfig.model}: ` +
    `${payload.newsReactions.length} cached reactions (${newsModel.interpretedThisRun} new, ${plan.carried.length} carried), ` +
    `${newsModel.rejectedThisRun} rejected, configured=${modelConfig.configured}, available=${newsModel.available}.`,
);
if (newsModel.error) console.log(`  Model note: ${newsModel.error}`);
