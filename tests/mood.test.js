import assert from 'node:assert/strict';
import { test } from './harness.js';
import {
  CALM_THRESHOLD,
  NEWS_SLOT_WEIGHT,
  NEWS_TOPIC_IDS,
  NEWS_TOPICS,
  PUBLISHER_STORY_LIMIT,
} from '../src/config.js';
import { contribution } from '../src/lib/time.js';
import { computeMood, eligibility, selectNewsReactions } from '../src/mood/engine.js';
import { HOUR, NOW, measuredReaction, newsReaction } from './fixtures.js';

test('contribution follows intensity × weight × 2^(-age / half-life)', () => {
  assert.equal(contribution({ intensity: 1, weight: 1, ageHours: 0, halfLifeHours: 6 }), 1);
  assert.equal(contribution({ intensity: 1, weight: 1, ageHours: 6, halfLifeHours: 6 }), 0.5);
  assert.equal(contribution({ intensity: 1, weight: 1, ageHours: 12, halfLifeHours: 6 }), 0.25);
  assert.ok(Math.abs(contribution({ intensity: 0.5, weight: 0.25, ageHours: 3, halfLifeHours: 3 }) - 0.0625) < 1e-12);
});

test('news uses eighteen equal slots worth 60%', () => {
  assert.equal(NEWS_TOPICS.length * 2, 18);
  assert.ok(Math.abs(NEWS_SLOT_WEIGHT - 0.6 / 18) < 1e-12);
});

test('maximum inputs can add up to exactly 1.000, never more', () => {
  const reactions = [];
  NEWS_TOPICS.forEach((topic, topicIndex) => {
    for (let slot = 0; slot < 2; slot += 1) {
      reactions.push(
        newsReaction({
          key: `news-${topic.id}-${slot}`,
          topic: topic.id,
          publisher: `publisher-${topicIndex}-${slot}`,
        }),
      );
    }
  });

  for (const group of ['weather', 'air', 'wildlife', 'earthquake', 'eonet']) {
    reactions.push(measuredReaction({ key: `${group}-one`, group, intensity: 1 }));
  }

  const mood = computeMood({ reactions, now: NOW });
  assert.equal(mood.active.length, 23);
  assert.ok(mood.totalContribution <= 1.0000001, `total was ${mood.totalContribution}`);
  assert.ok(mood.totalContribution > 0.9999, `total was ${mood.totalContribution}`);
  assert.equal(mood.byMood.happy.score > 0.999, true);
});

test('missing inputs leave their budget unused instead of redistributing', () => {
  const mood = computeMood({
    reactions: [measuredReaction({ key: 'weather-only', group: 'weather', intensity: 1 })],
    now: NOW,
  });
  const news = mood.groups.find((group) => group.group === 'news');
  const weather = mood.groups.find((group) => group.group === 'weather');
  assert.equal(mood.active.length, 1);
  assert.equal(news.used, 0);
  assert.equal(news.budget, 0.6);
  assert.equal(weather.used, 0.25);
  assert.equal(mood.score, 0.25);
});

test('a publisher cannot hold more than six active news stories', () => {
  const reactions = [];
  NEWS_TOPICS.forEach((topic) => {
    for (let slot = 0; slot < 2; slot += 1) {
      reactions.push(newsReaction({ key: `${topic.id}-${slot}`, topic: topic.id, publisher: 'bbc' }));
    }
  });

  const mood = computeMood({ reactions, now: NOW });
  const newsActive = mood.active.filter((item) => item.reaction.group === 'news');
  assert.equal(newsActive.length, PUBLISHER_STORY_LIMIT);
  assert.deepEqual(mood.publisherCounts, { bbc: 6 });
});

test('two slots per topic prefer different publishers', () => {
  const reactions = [
    newsReaction({ key: 'world-a', topic: 'world', publisher: 'bbc', publishedAt: NOW - HOUR }),
    newsReaction({ key: 'world-b', topic: 'world', publisher: 'guardian', publishedAt: NOW - 2 * HOUR }),
    newsReaction({ key: 'world-c', topic: 'world', publisher: 'aljazeera', publishedAt: NOW - 3 * HOUR }),
  ];

  const mood = computeMood({ reactions, now: NOW });
  const world = mood.newsTopics.find((topic) => topic.id === 'world');
  assert.equal(world.slots.length, 2);
  assert.deepEqual(
    world.slots.map((slot) => slot.reaction.publisher).sort(),
    ['bbc', 'guardian'],
  );
  assert.equal(mood.active.filter((item) => item.reaction.topic === 'world').length, 2);
});

test('news decays from first interpretation, not publication', () => {
  const mood = computeMood({
    reactions: [
      newsReaction({
        key: 'late-interpretation',
        publishedAt: NOW - 20 * HOUR,
        interpretedAt: NOW,
      }),
    ],
    now: NOW,
  });
  const active = mood.active.find((item) => item.reaction.group === 'news');
  assert.ok(active);
  assert.ok(Math.abs(active.contribution - NEWS_SLOT_WEIGHT) < 1e-12);
});

test('news is expired by both interpretation age and publication age', () => {
  const interpretedNow = newsReaction({ key: 'fresh', publishedAt: NOW - 49 * HOUR, interpretedAt: NOW });
  assert.equal(eligibility(interpretedNow, NOW).eligible, false);
  assert.match(eligibility(interpretedNow, NOW).reason, /Published/);

  const oldInterpretation = newsReaction({
    key: 'old',
    publishedAt: NOW - HOUR,
    interpretedAt: NOW - 49 * HOUR,
  });
  assert.equal(eligibility(oldInterpretation, NOW).eligible, false);

  const stillFresh = newsReaction({ key: 'fresh-2', publishedAt: NOW - 47 * HOUR, interpretedAt: NOW - 47 * HOUR });
  assert.equal(eligibility(stillFresh, NOW).eligible, true);
});

test('weather, air, quake, wildlife and EONET expiry windows are enforced', () => {
  assert.equal(
    eligibility(measuredReaction({ group: 'weather', observedAt: NOW - 6 * HOUR - 1 }), NOW).eligible,
    false,
  );
  assert.equal(eligibility(measuredReaction({ group: 'weather', observedAt: NOW - 5 * HOUR }), NOW).eligible, true);
  assert.equal(
    eligibility(measuredReaction({ group: 'air', observedAt: NOW - 7 * HOUR }), NOW).eligible,
    false,
  );
  assert.equal(
    eligibility(measuredReaction({ group: 'earthquake', observedAt: NOW - 25 * HOUR }), NOW).eligible,
    false,
  );
  assert.equal(
    eligibility(measuredReaction({ group: 'wildlife', observedAt: NOW - 7 * 24 * HOUR - 1 }), NOW).eligible,
    false,
  );
  assert.equal(
    eligibility(measuredReaction({ group: 'eonet', observedAt: NOW - 6 * 24 * HOUR }), NOW).eligible,
    true,
  );
});

test('strongest earthquake and newest wildlife are the only active singles', () => {
  const reactions = [
    measuredReaction({ key: 'quake-small', group: 'earthquake', magnitude: 4.4, intensity: 1 }),
    measuredReaction({ key: 'quake-large', group: 'earthquake', magnitude: 6.7, intensity: 1 }),
    measuredReaction({ key: 'wildlife-old', group: 'wildlife', observedAt: NOW - 2 * HOUR, intensity: 1 }),
    measuredReaction({ key: 'wildlife-new', group: 'wildlife', observedAt: NOW - HOUR, intensity: 0.5 }),
  ];

  const mood = computeMood({ reactions, now: NOW });
  const quakes = mood.active.filter((item) => item.reaction.group === 'earthquake');
  const wildlife = mood.active.filter((item) => item.reaction.group === 'wildlife');

  assert.equal(quakes.length, 1);
  assert.equal(quakes[0].reaction.magnitude, 6.7);
  assert.equal(wildlife.length, 1);
  assert.equal(wildlife[0].reaction.key, 'reaction:wildlife-new');
  assert.ok(Math.abs(wildlife[0].contribution - 0.5 * 0.05 * 2 ** (-1 / 24)) < 1e-12);
});

test('calm appears below 0.18 and the strongest emotion otherwise', () => {
  const quiet = computeMood({
    reactions: [measuredReaction({ key: 'quiet-weather', group: 'weather', intensity: 0.6 })],
    now: NOW,
  });
  assert.equal(quiet.mood, 'calm');
  assert.ok(quiet.score < CALM_THRESHOLD);

  const brighter = computeMood({
    reactions: [measuredReaction({ key: 'bright-weather', group: 'weather', intensity: 0.8 })],
    now: NOW,
  });
  assert.equal(brighter.mood, 'happy');
  assert.ok(brighter.score >= CALM_THRESHOLD);
});

test('news slot selection is deterministic and bounded by topic slots', () => {
  const reactions = NEWS_TOPIC_IDS.map((topic, index) =>
    newsReaction({ key: `slot-${index}`, topic, publisher: `pub-${index}` }),
  );
  const selected = selectNewsReactions(reactions);
  assert.equal(selected.selected.length, 9);
  assert.equal(selected.selected.filter((slot) => slot.slotIndex === 0).length, 9);
  assert.equal(new Set(selected.selected.map((slot) => slot.reaction.key)).size, 9);
});
