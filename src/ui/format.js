import { GROUP_LABELS, MOOD_COPY, NEWS_TOPIC_LABELS } from '../config.js';
import { formatDate, formatDateTime, formatRelative } from '../lib/time.js';
import { escapeHtml } from '../lib/validate.js';

export { escapeHtml };

export function moodLabel(mood) {
  return MOOD_COPY[mood]?.label ?? 'Calm';
}

export function groupLabel(group) {
  return GROUP_LABELS[group] ?? 'Source';
}

export function topicLabel(topic) {
  return NEWS_TOPIC_LABELS[topic] ?? 'World affairs';
}

export function kindLabel(group) {
  if (group === 'news') return { label: 'News', kind: 'news' };
  if (group === 'weather' || group === 'air' || group === 'earthquake') {
    return { label: 'Measurement', kind: 'measurement' };
  }
  return { label: 'Observation', kind: 'observation' };
}

export function sourceTone(status) {
  switch (status) {
    case 'live':
      return 'live';
    case 'cached':
    case 'malformed':
    case 'empty':
      return status === 'empty' ? 'warn' : 'warn';
    case 'unavailable':
      return 'bad';
    default:
      return 'warn';
  }
}

export function sourceStatusText(state, now = Date.now()) {
  if (!state) return 'Not checked yet';
  const records = `${state.recordCount ?? 0} record${state.recordCount === 1 ? '' : 's'}`;
  const snapshot = state.fromSnapshot === true;
  switch (state.status) {
    case 'live':
      return snapshot
        ? `Hourly cache · ${records} · fetched ${state.lastSuccessAt ? formatRelative(state.lastSuccessAt, now) : 'at build time'}`
        : `Live · ${records}`;
    case 'empty':
      return snapshot ? 'Hourly cache · no current items' : 'Reachable · no current items';
    case 'cached':
      return `Cached · last live ${state.lastSuccessAt ? formatRelative(state.lastSuccessAt, now) : 'unknown'}`;
    case 'malformed':
      return `Malformed response · ${state.recordCount ? `showing ${records}` : 'nothing saved'}`;
    case 'unavailable':
      return `Unavailable · ${state.recordCount ? `showing ${records}` : 'no cache'}`;
    default:
      return `Not checked · ${records}`;
  }
}

export function sourceLongStatus(state, now = Date.now()) {
  if (!state) return 'Not checked yet.';
  const attempted = state.lastAttemptAt ? `Checked ${formatRelative(state.lastAttemptAt, now)}.` : '';
  const success = state.lastSuccessAt ? ` Last good response ${formatRelative(state.lastSuccessAt, now)}.` : '';
  return `${sourceStatusText(state, now)}. ${attempted}${success}${state.error ? ` ${state.error}` : ''}`.trim();
}

export function dateSummary(record) {
  if (!record) return [];
  const out = [];

  switch (record.group) {
    case 'news':
      out.push(`Published ${formatDateTime(record.originalAt)}`);
      break;
    case 'weather':
    case 'air':
      out.push(`Observed ${formatDateTime(record.observedAt ?? record.originalAt)}`);
      break;
    case 'earthquake':
      out.push(`Origin ${formatDateTime(record.originalAt)}`);
      break;
    case 'wildlife':
      out.push(
        record.dateOnly
          ? `Observed ${formatDate(record.originalAt, { dateOnly: true })} (date only)`
          : `Observed ${formatDateTime(record.observedAt ?? record.originalAt)}`,
      );
      break;
    case 'eonet':
      out.push(`First observed ${formatDateTime(record.originalAt)}`);
      out.push(`Latest observation ${formatDateTime(record.observedAt)}`);
      break;
    default:
      out.push(`Original date ${formatDateTime(record.originalAt)}`);
  }

  if ((record.group === 'earthquake' || record.group === 'wildlife') && record.updatedAt) {
    if (record.updatedAt !== record.originalAt) {
      out.push(`Upstream update ${formatDateTime(record.updatedAt)}`);
    }
  }

  if (record.group !== 'eonet' && Number.isFinite(Number(record.fetchedAt))) {
    out.push(`Retrieved ${formatDateTime(record.fetchedAt)}`);
  }

  return out;
}

export function recordStatus({ record, reaction, active, ignoredReason, now, newsModel }) {
  if (reaction && active) return { label: 'Active reaction', tone: 'active' };
  if (reaction) {
    return {
      label: 'Saved reaction · not governing',
      tone: 'recorded',
      detail: ignoredReason ?? 'Another reaction currently has the slot.',
    };
  }
  if (record.group === 'news') {
    if (record.originalAt && now - record.originalAt > 48 * 3600 * 1000) {
      return { label: 'Expired for mood', tone: 'expired' };
    }
    if (!newsModel?.configured && !newsModel?.reactionCount) {
      return { label: 'Not interpreted · model not configured', tone: 'unavailable' };
    }
    if (newsModel?.error) return { label: 'Not interpreted · model unavailable', tone: 'unavailable' };
    if (newsModel?.reactionCount) return { label: 'No cached reaction', tone: 'recorded' };
    return { label: 'Awaiting build-time interpretation', tone: 'recorded' };
  }
  return { label: 'Recorded · no active reaction', tone: 'recorded' };
}
