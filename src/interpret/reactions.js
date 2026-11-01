import { clamp, sanitizeText } from '../lib/validate.js';
import { MEASURED_RULES } from './rules.js';

export const NEWS_MOODS = Object.freeze(['happy', 'sad', 'mad', 'confused']);
export const ALL_MOODS = Object.freeze(['happy', 'sad', 'mad', 'confused', 'calm']);

/**
 * Build the stored reaction record. The public shape is
 * { sourceId, mood, intensity, text }; the extra fields are bookkeeping for
 * decay, selection, and explanation.
 */
export function createReaction(record, interpretation, { now = Date.now() } = {}) {
  if (!record || !interpretation) return null;
  const mood = interpretation.mood;
  if (!ALL_MOODS.includes(mood)) return null;
  const intensity = Number(interpretation.intensity);
  if (!Number.isFinite(intensity)) return null;
  const text = sanitizeText(interpretation.text, 220);
  if (!text) return null;

  return {
    key: `reaction:${record.key}`,
    recordKey: record.key,
    group: record.group,
    sourceId: record.sourceId,
    sourceLabel: record.sourceLabel,
    publisher: record.group === 'news' ? record.sourceId : null,
    publisherLabel: record.sourceLabel,
    topic: record.group === 'news' ? record.data?.topic ?? null : null,
    mood,
    intensity: clamp(intensity, 0, 1),
    text,
    firstInterpretedAt: now,
    observedAt: Number.isFinite(Number(record.observedAt)) ? Number(record.observedAt) : record.originalAt,
    originalAt: record.originalAt,
    magnitude: Number.isFinite(Number(record.data?.magnitude)) ? Number(record.data.magnitude) : undefined,
    severity: typeof record.data?.severity === 'string' ? record.data.severity : undefined,
    expiresAt: Number.isFinite(Number(record.data?.expiresAt)) ? Number(record.data.expiresAt) : undefined,
    title: record.title,
    url: record.url,
    dateOnly: Boolean(record.dateOnly),
  };
}

export function measuredReaction(record, { now = Date.now() } = {}) {
  const rule = MEASURED_RULES[record?.group];
  if (!rule) return null;
  const interpretation = rule(record);
  if (!interpretation) return null;
  return createReaction(record, interpretation, { now });
}
