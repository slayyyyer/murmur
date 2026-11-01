import assert from 'node:assert/strict';
import { test } from './harness.js';
import { CALM_THRESHOLD } from '../src/config.js';
import { computeMood } from '../src/mood/engine.js';
import {
  createMoodPoint,
  mergeMoodMonth,
  moodHistoryIndex,
  moodMonthKey,
  normalizeMoodIndex,
  normalizeMoodMonth,
  normalizeMoodPoint,
} from '../src/app/moodHistory.js';
import { DAY, HOUR, NOW, measuredReaction } from './fixtures.js';

function point(at, overrides = {}) {
  return {
    at,
    mood: 'uneasy',
    topEmotion: 'uneasy',
    score: 0.2,
    isCalm: false,
    activeCount: 3,
    groups: { news: 0.1, weather: 0.05 },
    scores: { uneasy: 0.2 },
    topicCounts: { world: 1 },
    ...overrides,
  };
}

test('mood history points keep the computed mood, score, groups and topic mix', () => {
  const mood = computeMood({
    reactions: [measuredReaction({ key: 'weather', group: 'weather', intensity: 0.95 })],
    now: NOW,
  });
  const entry = createMoodPoint(mood, { at: NOW });

  assert.equal(entry.at, NOW);
  assert.equal(entry.mood, mood.mood);
  assert.equal(entry.topEmotion, mood.topEmotion);
  assert.equal(entry.score, Math.round(mood.score * 1_000_000) / 1_000_000);
  assert.equal(entry.groups.weather, Math.round(mood.groups.find((group) => group.group === 'weather').used * 1_000_000) / 1_000_000);
  assert.equal(entry.scores.happy, Math.round(mood.byMood.happy.score * 1_000_000) / 1_000_000);
  assert.equal(entry.isCalm, mood.mood === 'calm');
  assert.ok(entry.score < CALM_THRESHOLD || entry.mood !== 'calm');
});

test('monthly mood history merges a same-hour rerun instead of duplicating it', () => {
  const month = moodMonthKey(NOW);
  assert.equal(month, '2026-10');

  const first = point(NOW - 2 * HOUR);
  const second = point(NOW - HOUR);
  const existing = normalizeMoodMonth({ month, points: [first] }, month);
  const merged = mergeMoodMonth(existing, second, { now: NOW, retentionDays: 365 });
  assert.equal(merged.points.length, 2);
  assert.equal(merged.month, month);

  const rerun = mergeMoodMonth(merged, point(NOW - HOUR + 10 * 60_000, { score: 0.3 }), {
    now: NOW,
    retentionDays: 365,
  });
  assert.equal(rerun.points.length, 2);
  assert.equal(rerun.points.find((entry) => entry.at === NOW - HOUR + 10 * 60_000).score, 0.3);
});

test('monthly mood history prunes points outside the retention window', () => {
  const old = point(NOW - 400 * DAY);
  const merged = mergeMoodMonth({ points: [old] }, point(NOW), { now: NOW, retentionDays: 365 });
  assert.equal(merged.points.length, 1);
  assert.equal(merged.points[0].at, NOW);
});

test('mood history accepts only known moods and well-formed months', () => {
  assert.equal(normalizeMoodPoint({ at: NOW, mood: 'angry', score: 0.2 }), null);
  assert.equal(normalizeMoodPoint({ at: NOW, mood: 'uneasy', score: 2 }), null);
  assert.equal(normalizeMoodMonth({ month: '2026-09', points: [point(NOW)] }, '2026-10'), null);

  assert.deepEqual(normalizeMoodIndex({ months: ['2026-11', 'bad', '2026-10', '2026-11'] }).months, [
    '2026-10',
    '2026-11',
  ]);
  assert.deepEqual(moodHistoryIndex(['2026-11', '2026-10'], { updatedAt: NOW }).months, [
    '2026-10',
    '2026-11',
  ]);
});

test('mood month keys follow Charlotte calendar time', () => {
  assert.equal(moodMonthKey(Date.UTC(2026, 10, 15, 12)), '2026-11');
  assert.equal(moodMonthKey(Date.UTC(2026, 9, 31, 20)), '2026-10');
});
