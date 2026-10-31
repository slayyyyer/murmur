import { GROUP_LABELS_SHORT } from '../config.js';
import { formatClock, formatRelative, formatStrength } from '../lib/time.js';
import { escapeHtml } from '../lib/validate.js';

const PLACEHOLDERS = [
  ['weather', 'Charlotte weather'],
  ['news', 'world news'],
  ['wildlife', 'nearby wildlife'],
  ['air', 'Charlotte air quality'],
  ['earthquake', 'earthquakes'],
  ['eonet', 'NASA natural events'],
];

function sourceText(reaction) {
  const group = GROUP_LABELS_SHORT[reaction.group] ?? 'Source';
  const source = reaction.group === 'news' ? reaction.publisherLabel ?? 'News' : reaction.sourceLabel ?? '';
  return source ? `${group} · ${source}` : group;
}

function attentionText(value) {
  return value >= 0.18 ? 'pulling strongly' : value >= 0.08 ? 'a gentle pull' : 'a faint pull';
}

/** Three bubbles: strongest active influences first, then honest quiet slots. */
export function bubblesMarkup(moodState) {
  const active = moodState?.active ?? [];
  const present = new Set(active.map((item) => item.reaction.group));
  const quietSlots = PLACEHOLDERS.filter(([group]) => !present.has(group));
  const bubbles = [];

  for (let index = 0; index < 3; index += 1) {
    const item = active[index];
    if (item) {
      bubbles.push(`
        <li class="bubble">
          <p>${escapeHtml(item.reaction.text)}</p>
          <span>${escapeHtml(sourceText(item.reaction))} · ${attentionText(item.contribution)} ${formatStrength(
            item.contribution,
          )}</span>
        </li>`);
      continue;
    }

    const [, label] = quietSlots.shift() ?? [null, 'another source'];
    bubbles.push(`
      <li class="bubble bubble--empty">
        <p>No strong influence from ${escapeHtml(label)} yet.</p>
        <span>Below the calm threshold</span>
      </li>`);
  }

  return bubbles.join('');
}

export function wakingBubblesMarkup() {
  return ['Charlotte weather', 'world news', 'nearby wildlife']
    .map(
      (label) => `
      <li class="bubble bubble--empty">
        <p>Waiting for ${escapeHtml(label)}.</p>
        <span>No check yet</span>
      </li>`,
    )
    .join('');
}

export function moodTimeText({ mood, lastRefreshAt, cacheGeneratedAt = null, now }) {
  const active = mood?.active?.length ?? 0;
  const parts = [
    `Computed at ${formatClock(now)} Charlotte time`,
    `${active} active influence${active === 1 ? '' : 's'}`,
  ];
  if (cacheGeneratedAt) parts.push(`hourly cache generated ${formatRelative(cacheGeneratedAt, now)}`);
  else if (lastRefreshAt) parts.push(`cache loaded ${formatRelative(lastRefreshAt, now)}`);
  return parts.join(' · ');
}
