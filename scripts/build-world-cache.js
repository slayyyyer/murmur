#!/usr/bin/env node
/**
 * Run inside GitHub Actions (or locally with the relay running) after all
 * source adapters have fetched through the allowlist. The output is a static
 * snapshot; the browser never contacts a feed or the relay at runtime.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { runRefresh } from '../src/app/runRefresh.js';
import { createLoaders } from '../src/sources/loaders.js';
import { createRepository } from '../src/store/repository.js';
import { createMemoryStore } from '../src/store/memoryStore.js';
import { dedupeRecords } from '../src/lib/dedupe.js';
import { WORLD_CACHE_SCHEMA_VERSION } from '../src/config.js';
import { sanitizeText } from '../src/lib/validate.js';

const MAX_SOURCE_RECORDS = 250;
const MAX_CACHE_BYTES = 4 * 1024 * 1024;

const proxyBase = process.env.MURMUR_PROXY?.trim();
if (!proxyBase) {
  throw new Error('MURMUR_PROXY is required, for example http://127.0.0.1:8080');
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

const deduped = dedupeRecords(result.outcomes.flatMap((source) => source.records));

const sources = result.outcomes.map((source) => ({
  sourceId: source.sourceId,
  label: source.label,
  provider: source.provider,
  homepage: source.homepage,
  group: source.group,
  status: source.status,
  error: source.error ? sanitizeText(source.error, 300) : null,
  fetchedAt: Number.isFinite(Number(source.fetchedAt)) ? Number(source.fetchedAt) : now,
  records: deduped.records
    .filter((record) => record.sourceId === source.sourceId)
    .slice(0, MAX_SOURCE_RECORDS),
}));

const answered = sources.filter((source) => source.status === 'live' || source.status === 'empty').length;
if (!sources.some((source) => source.status === 'live')) {
  throw new Error('No source returned usable data; the previous Pages deployment will be kept.');
}

const payload = {
  schemaVersion: WORLD_CACHE_SCHEMA_VERSION,
  generatedAt: now,
  sources,
};
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
    `${answered}/${sources.length} sources answered, ${deduped.records.length} unique records, ` +
    `${deduped.removed} duplicates removed.`,
);
for (const source of sources) {
  console.log(`  ${source.sourceId.padEnd(12)} ${source.status.padEnd(12)} ${source.records.length} records`);
}
