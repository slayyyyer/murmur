const PUBLISHER_SUFFIX =
  /\s+[-–—|:]\s+(bbc news|bbc|the guardian|guardian|al jazeera|nasa|positive news|wfae|npr)\s*$/i;

export function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeTitle(title) {
  return String(title ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&/g, ' and ')
    .replace(PUBLISHER_SUFFIX, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Remove repeated records. Records are sorted newest-first so the freshest
 * copy of a syndicated story survives. News is deduped by URL key and by
 * normalized headline; other groups are deduped by stable key.
 */
export function dedupeRecords(records) {
  const seenKeys = new Set();
  const seenTitles = new Set();
  const kept = [];
  let removed = 0;

  const sorted = [...records].sort(
    (a, b) =>
      Number(b.originalAt ?? b.observedAt ?? 0) - Number(a.originalAt ?? a.observedAt ?? 0) ||
      String(a.key).localeCompare(String(b.key)),
  );

  for (const record of sorted) {
    if (!record || !record.key) {
      removed += 1;
      continue;
    }
    const titleKey = record.group === 'news' ? normalizeTitle(record.title) : '';
    if (seenKeys.has(record.key) || (titleKey.length >= 12 && seenTitles.has(titleKey))) {
      removed += 1;
      continue;
    }
    seenKeys.add(record.key);
    if (titleKey.length >= 12) seenTitles.add(titleKey);
    kept.push(record);
  }

  return { records: kept, removed };
}
