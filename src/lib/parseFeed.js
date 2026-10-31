import { decodeEntities } from './validate.js';

export class FeedParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FeedParseError';
  }
}

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
const ENTRY_RE = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
const LINK_RE = /<link\b([^>]*?)(?:\/>|>([\s\S]*?)<\/link>)/gi;
const CATEGORY_RE = /<category\b[^>]*>([\s\S]*?)<\/category>/gi;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readTag(block, tag) {
  const safe = escapeRegExp(tag);
  const pattern = new RegExp(`<${safe}\\b[^>]*>([\\s\\S]*?)<\\/${safe}>`, 'i');
  const match = block.match(pattern);
  return match ? match[1] : '';
}

function cleanText(value) {
  if (!value) return '';
  let text = String(value);
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  text = text.replace(/<[^>]*>/g, ' ');
  text = decodeEntities(text);
  // A second pass catches feeds that HTML-encode their description twice.
  text = text.replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function readLink(block) {
  const candidates = [];
  LINK_RE.lastIndex = 0;
  let match;
  while ((match = LINK_RE.exec(block)) !== null) {
    const attrs = match[1] || '';
    const text = match[2] || '';
    const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const relMatch = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i);
    const href = hrefMatch ? hrefMatch[1] : cleanText(text);
    if (!href) continue;
    candidates.push({ href, rel: relMatch ? relMatch[1].toLowerCase() : '' });
  }

  if (candidates.length) {
    const alternate = candidates.find((candidate) => !candidate.rel || candidate.rel === 'alternate');
    return (alternate ?? candidates[0]).href.trim();
  }

  const guid = readTag(block, 'guid');
  return guid.trim();
}

function readTitle(block) {
  return cleanText(readTag(block, 'title'));
}

export function parseFeed(xml) {
  if (typeof xml !== 'string') {
    throw new FeedParseError('Feed response was not text.');
  }

  const source = xml.replace(/^\uFEFF/, '').trim();
  if (!source) {
    throw new FeedParseError('Feed response was empty.');
  }

  const head = source.slice(0, 6000);
  const isRss = /<rss\b/i.test(head);
  const isAtom = /<feed\b/i.test(head);
  if (!isRss && !isAtom) {
    throw new FeedParseError('Response is not an RSS or Atom feed.');
  }

  const blockPattern = isAtom && !isRss ? ENTRY_RE : ITEM_RE;
  const blocks = [];
  const pattern = new RegExp(blockPattern.source, blockPattern.flags);
  let match;
  while ((match = pattern.exec(source)) !== null) {
    blocks.push(match[1]);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  const items = [];
  for (const block of blocks) {
    const title = readTitle(block);
    const link = readLink(block);
    if (!title || !link) continue;

    const publishedRaw =
      readTag(block, 'pubDate') ||
      readTag(block, 'published') ||
      readTag(block, 'dc:date') ||
      readTag(block, 'updated') ||
      readTag(block, 'date');

    const summaryRaw =
      readTag(block, 'description') ||
      readTag(block, 'summary') ||
      readTag(block, 'content:encoded') ||
      readTag(block, 'content');

    const categories = [];
    CATEGORY_RE.lastIndex = 0;
    let categoryMatch;
    while ((categoryMatch = CATEGORY_RE.exec(block)) !== null) {
      const category = cleanText(categoryMatch[1]);
      if (category && !categories.includes(category)) categories.push(category);
      if (categories.length >= 8) break;
    }

    items.push({
      title,
      link,
      publishedRaw: cleanText(publishedRaw),
      summary: cleanText(summaryRaw).slice(0, 500),
      categories,
    });
  }

  const channelHead = source.split(/<item\b|<entry\b/i)[0] ?? '';
  return {
    title: cleanText(readTag(channelHead, 'title')),
    items,
    isAtom: isAtom && !isRss,
  };
}

export const feedInternals = { cleanText, readLink, readTag };
