import {
  FEED_BY_PUBLISHER,
  FETCH,
  NEWS_INGEST_MAX_AGE_HOURS,
  NEWS_ITEMS_PER_FEED,
  PUBLISHERS,
  NEWS_TOPIC_IDS,
} from '../config.js';
import { dedupeRecords, hashString } from '../lib/dedupe.js';
import { HOUR_MS, parseTimestamp } from '../lib/time.js';
import { canonicalizeUrl, sanitizeText } from '../lib/validate.js';
import { parseFeed } from '../lib/parseFeed.js';
import { fetchText } from './http.js';

const KEYWORDS = {
  local: ['charlotte', 'carolinas', 'carolina', 'mecklenburg', 'catawba', 'gaston', 'cabarrus', 'lake norman', 'north carolina'],
  health: ['health', 'hospital', 'virus', 'disease', 'vaccine', 'cancer', 'medicine', 'medical', 'outbreak', 'patients', 'cdc'],
  technology: [
    'artificial intelligence',
    'technology',
    'software',
    'cyber',
    'robot',
    'quantum',
    'chip',
    'chips',
    'algorithm',
    'social media',
    'data breach',
    'internet',
    'smartphone',
  ],
  environment: [
    'climate',
    'environment',
    'wildfire',
    'flood',
    'drought',
    'biodiversity',
    'species',
    'emissions',
    'pollution',
    'ocean',
    'forest',
    'heatwave',
    'heat wave',
    'conservation',
    'wildlife',
    'ecosystem',
    'hurricane',
  ],
  economy: [
    'economy',
    'economic',
    'market',
    'markets',
    'inflation',
    'trade',
    'bank',
    'jobs',
    'unemployment',
    'budget',
    'tax',
    'currency',
    'oil',
    'company',
    'business',
    'tariff',
  ],
  science: [
    'nasa',
    'space',
    'spacecraft',
    'rocket',
    'telescope',
    'research',
    'researcher',
    'scientist',
    'study',
    'physics',
    'asteroid',
    'moon',
    'mars',
    'satellite',
    'astronomy',
  ],
  culture: [
    'film',
    'movie',
    'music',
    'art',
    'arts',
    'book',
    'festival',
    'museum',
    'theatre',
    'theater',
    'fashion',
    'food',
    'sport',
    'culture',
    'novel',
  ],
  progress: [
    'community',
    'volunteer',
    'nonprofit',
    'kindness',
    'cooperation',
    'restored',
    'rescued',
    'solidarity',
    'mutual aid',
    'neighbors',
    'grassroots',
    'progress',
  ],
};

const SHORT_WORDS = new Set(['art', 'arts', 'ai', 'tax', 'oil', 'bank', 'mars', 'moon', 'cdc']);

function keywordHit(text, keyword) {
  if (SHORT_WORDS.has(keyword)) {
    return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
  }
  return text.includes(keyword);
}

/** Choose a topic for broad feeds. Specific feeds keep their declared topic. */
export function classifyTopic(text) {
  const haystack = String(text ?? '').toLowerCase();
  const order = ['local', 'health', 'technology', 'environment', 'economy', 'science', 'culture', 'progress'];
  for (const topic of order) {
    if (KEYWORDS[topic].some((keyword) => keywordHit(haystack, keyword))) return topic;
  }
  return 'world';
}

export function proxyUrl(target, proxyBase = '') {
  const base = String(proxyBase ?? '').replace(/\/+$/, '');
  return `${base}/api/proxy?url=${encodeURIComponent(target)}`;
}

export function classifyNewsItem(item, feed, { now = Date.now(), fetchedAt = now } = {}) {
  const title = sanitizeText(item?.title, 200);
  const url = canonicalizeUrl(item?.link);
  if (!title || !url) return { record: null, reason: 'invalid' };

  const publishedAt = parseTimestamp(item.publishedRaw);
  if (!Number.isFinite(publishedAt)) return { record: null, reason: 'invalid' };

  const age = (now - publishedAt) / HOUR_MS;
  if (age > NEWS_INGEST_MAX_AGE_HOURS || age < -5 / 60) return { record: null, reason: 'filtered' };

  const categoryText = Array.isArray(item.categories) ? item.categories.join(' ') : '';
  const topic =
    feed.topic && NEWS_TOPIC_IDS.includes(feed.topic) ? feed.topic : classifyTopic(`${title} ${categoryText}`);

  const publisher = PUBLISHERS[feed.publisher];
  const summary = sanitizeText(item.summary, 320);

  return {
    reason: null,
    record: {
      key: `news:${hashString(url)}`,
      group: 'news',
      sourceId: feed.publisher,
      sourceLabel: publisher.label,
      provider: publisher.provider,
      title,
      summary,
      url,
      originalAt: publishedAt,
      observedAt: publishedAt,
      updatedAt: null,
      fetchedAt,
      dateOnly: false,
      data: {
        publisher: feed.publisher,
        publisherLabel: publisher.label,
        topic,
        feedLabel: feed.label,
        categories: Array.isArray(item.categories) ? item.categories.slice(0, 6) : [],
      },
    },
  };
}

export function normalizeNewsItem(item, feed, options = {}) {
  return classifyNewsItem(item, feed, options).record;
}

export async function loadFeed(feed, { fetchImpl = globalThis.fetch, proxyBase = '', now = Date.now() } = {}) {
  const fetchedAt = Date.now();
  try {
    const response = await fetchText(proxyUrl(feed.url, proxyBase), {
      fetchImpl,
      timeoutMs: FETCH.timeoutMs,
      maxBytes: FETCH.feedMaxBytes,
    });

    let parsed;
    try {
      parsed = parseFeed(response.text);
    } catch (error) {
      return {
        feed,
        status: 'malformed',
        error: error.message,
        records: [],
        itemCount: 0,
        fetchedAt,
      };
    }

    const records = [];
    let invalid = 0;
    let filtered = 0;
    for (const item of parsed.items.slice(0, 40)) {
      const result = classifyNewsItem(item, feed, { now, fetchedAt });
      if (result.record) records.push(result.record);
      else if (result.reason === 'invalid') invalid += 1;
      else filtered += 1;
    }

    records.sort((a, b) => b.originalAt - a.originalAt);
    const unique = dedupeRecords(records).records.slice(0, NEWS_ITEMS_PER_FEED);
    const detail = {
      invalid: invalid + parsed.invalidItems,
      filtered,
      parsed: parsed.items.length,
      total: parsed.totalItems,
    };

    if (!parsed.items.length) {
      if (parsed.invalidItems > 0) {
        return {
          feed,
          status: 'malformed',
          error: `Feed contained ${parsed.invalidItems} item${
            parsed.invalidItems === 1 ? '' : 's'
          } without a usable headline and link.`,
          records: [],
          itemCount: 0,
          detail,
          fetchedAt,
        };
      }
      return { feed, status: 'empty', error: null, records: [], itemCount: 0, detail, fetchedAt };
    }
    if (!records.length) {
      if (invalid > 0) {
        return {
          feed,
          status: 'malformed',
          error: `No item had a usable headline, safe link, and original date; ${invalid} malformed item${
            invalid === 1 ? '' : 's'
          }.`,
          records: [],
          itemCount: parsed.items.length,
          detail,
          fetchedAt,
        };
      }
      return {
        feed,
        status: 'empty',
        error: null,
        records: [],
        itemCount: parsed.items.length,
        detail,
        fetchedAt,
      };
    }

    return {
      feed,
      status: 'live',
      error: null,
      records: unique,
      itemCount: parsed.items.length,
      detail,
      fetchedAt,
    };
  } catch (error) {
    return {
      feed,
      status: error.kind === 'malformed' ? 'malformed' : 'unavailable',
      error: error.message,
      records: [],
      itemCount: 0,
      fetchedAt,
    };
  }
}

export function createNewsLoader(publisherId, { fetchImpl = globalThis.fetch, proxyBase = '', now = Date.now() } = {}) {
  const publisher = PUBLISHERS[publisherId];
  const feeds = FEED_BY_PUBLISHER[publisherId] ?? [];

  return {
    id: publisherId,
    label: publisher.label,
    provider: publisher.provider,
    homepage: publisher.homepage,
    group: 'news',
    async load() {
      const fetchedAt = Date.now();
      const results = await Promise.all(
        feeds.map((feed) => loadFeed(feed, { fetchImpl, proxyBase, now: fetchedAt })),
      );

      const records = dedupeRecords(results.flatMap((result) => result.records)).records;
      const hasLive = records.length > 0;
      const allEmpty = results.every((result) => result.status === 'empty');
      const anyMalformed = results.some((result) => result.status === 'malformed');
      const status = hasLive ? 'live' : allEmpty ? 'empty' : anyMalformed ? 'malformed' : 'unavailable';

      return {
        status,
        records,
        fetchedAt,
        error: results.find((result) => result.error)?.error ?? null,
        detail: {
          feeds: results.map((result) => ({
            label: result.feed.label,
            url: result.feed.url,
            status: result.status,
            error: result.error,
            itemCount: result.records.length,
            invalid: result.detail?.invalid ?? 0,
            filtered: result.detail?.filtered ?? 0,
            fetchedAt: result.fetchedAt,
          })),
        },
      };
    },
  };
}
