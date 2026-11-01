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

console.log(
  `Wrote data/world-cache.json (${(bytes / 1024).toFixed(1)} KiB): ` +
    `${answered}/${sources.length} sources answered, ${plan.records.length} unique records, ` +
    `${current.removed} duplicates removed.`,
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
