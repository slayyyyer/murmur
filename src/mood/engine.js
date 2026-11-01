import {
  BUDGETS,
  CALM_THRESHOLD,
  DECAY,
  GROUP_LABELS,
  MOODS,
  NEWS_SLOTS_PER_TOPIC,
  NEWS_SLOT_WEIGHT,
  NEWS_TOPICS,
  PUBLISHER_STORY_LIMIT,
  WEIGHTS,
} from '../config.js';
import { contribution, HOUR_MS } from '../lib/time.js';

export const GROUP_ORDER = ['news', 'weather', 'alerts', 'air', 'water', 'wildlife', 'earthquake', 'eonet'];
const MOOD_ORDER = Object.fromEntries(MOODS.map((mood, index) => [mood, index]));

export function publisherOf(reaction) {
  return reaction.publisher || reaction.sourceId || 'unknown';
}

/** News decays from first interpretation; everything else from its observation. */
export function reactionAnchorAt(reaction) {
  if (!reaction) return null;
  if (reaction.group === 'news') return reaction.firstInterpretedAt ?? null;
  return reaction.observedAt ?? reaction.originalAt ?? reaction.firstInterpretedAt ?? null;
}

export function reactionAgeHours(reaction, now) {
  const anchor = Number(reactionAnchorAt(reaction));
  if (!Number.isFinite(anchor)) return Infinity;
  return Math.max(0, (now - anchor) / HOUR_MS);
}

/**
 * A saved reaction is eligible until its age exceeds the configured window.
 * News must also still be within the publication window, so an old article
 * cannot be kept alive by a recent interpretation.
 */
export function eligibility(reaction, now) {
  const config = DECAY[reaction?.group];
  if (!config) return { eligible: false, reason: 'Unknown source group.' };
  if (!MOODS.includes(reaction.mood)) return { eligible: false, reason: 'Unknown mood.' };

  const intensity = Number(reaction.intensity);
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    return { eligible: false, reason: 'Invalid intensity.' };
  }

  if (Number.isFinite(Number(reaction.expiresAt)) && now > Number(reaction.expiresAt)) {
    return { eligible: false, reason: 'The official alert has expired.' };
  }

  const age = reactionAgeHours(reaction, now);
  if (!Number.isFinite(age)) return { eligible: false, reason: 'Missing observation time.' };

  if (reaction.group === 'news') {
    const publishedAt = Number(reaction.originalAt);
    if (!Number.isFinite(publishedAt)) return { eligible: false, reason: 'Missing publication date.' };
    const publishedAge = Math.max(0, (now - publishedAt) / HOUR_MS);
    if (publishedAge > config.maxAgeHours) {
      return { eligible: false, reason: `Published more than ${config.maxAgeHours} hours ago.`, ageHours: age };
    }
  }

  if (age > config.maxAgeHours) {
    return { eligible: false, reason: `Expired after ${config.maxAgeHours} hours.`, ageHours: age };
  }

  return { eligible: true, ageHours: age };
}

function compareNews(a, b) {
  return (
    Number(b.originalAt ?? 0) - Number(a.originalAt ?? 0) ||
    Number(b.firstInterpretedAt ?? 0) - Number(a.firstInterpretedAt ?? 0) ||
    String(a.key).localeCompare(String(b.key))
  );
}

function chooseCandidate(candidates, { usedKeys, publisherCounts, avoidPublisher = null }) {
  for (const candidate of candidates) {
    if (usedKeys.has(candidate.key)) continue;
    const publisher = publisherOf(candidate);
    if ((publisherCounts.get(publisher) ?? 0) >= PUBLISHER_STORY_LIMIT) continue;
    if (avoidPublisher && publisher === avoidPublisher) continue;
    return candidate;
  }
  return null;
}

/**
 * Fill two slots per topic in round-robin order. Slot one is filled for every
 * topic first, then slot two. Within a topic the second slot prefers a
 * different publisher. A publisher may never hold more than six active stories.
 */
export function selectNewsReactions(eligibleNews) {
  const byTopic = new Map(NEWS_TOPICS.map((topic) => [topic.id, []]));
  for (const reaction of eligibleNews) {
    const topicId = byTopic.has(reaction.topic) ? reaction.topic : 'world';
    byTopic.get(topicId).push(reaction);
  }
  for (const list of byTopic.values()) list.sort(compareNews);

  const selected = [];
  const usedKeys = new Set();
  const publisherCounts = new Map();
  const topicSelections = new Map(NEWS_TOPICS.map((topic) => [topic.id, []]));

  for (let slotIndex = 0; slotIndex < NEWS_SLOTS_PER_TOPIC; slotIndex += 1) {
    for (const topic of NEWS_TOPICS) {
      const chosen = topicSelections.get(topic.id);
      if (chosen.length < slotIndex) continue;
      if (chosen.length > slotIndex) continue;

      const candidates = byTopic.get(topic.id) ?? [];
      const avoidPublisher = slotIndex > 0 && chosen[0] ? publisherOf(chosen[0]) : null;

      const pick =
        chooseCandidate(candidates, { usedKeys, publisherCounts, avoidPublisher }) ??
        (slotIndex > 0 ? chooseCandidate(candidates, { usedKeys, publisherCounts }) : null);

      if (!pick) continue;

      usedKeys.add(pick.key);
      const publisher = publisherOf(pick);
      publisherCounts.set(publisher, (publisherCounts.get(publisher) ?? 0) + 1);
      chosen.push(pick);
      selected.push({ reaction: pick, topic: topic.id, slotIndex });
    }
  }

  return { selected, publisherCounts, topicSelections };
}

function newestReaction(reactions) {
  return [...reactions].sort(
    (a, b) =>
      Number(b.observedAt ?? b.originalAt ?? 0) - Number(a.observedAt ?? a.originalAt ?? 0) ||
      String(a.key).localeCompare(String(b.key)),
  )[0] ?? null;
}

function strongestEarthquake(reactions) {
  return [...reactions].sort(
    (a, b) =>
      (Number(b.magnitude) || 0) - (Number(a.magnitude) || 0) ||
      Number(b.observedAt ?? b.originalAt ?? 0) - Number(a.observedAt ?? a.originalAt ?? 0) ||
      String(a.key).localeCompare(String(b.key)),
  )[0] ?? null;
}

const ALERT_SEVERITY_RANK = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

function strongestAlert(reactions) {
  return [...reactions].sort(
    (a, b) =>
      (ALERT_SEVERITY_RANK[b.severity] ?? 0) - (ALERT_SEVERITY_RANK[a.severity] ?? 0) ||
      Number(b.observedAt ?? b.originalAt ?? 0) - Number(a.observedAt ?? a.originalAt ?? 0) ||
      String(a.key).localeCompare(String(b.key)),
  )[0] ?? null;
}

/**
 * Choose the reactions that may influence the face right now. Only one
 * weather/air/wildlife/eonet reaction and one earthquake can be active, so
 * duplicate observations never multiply their group's influence.
 */
export function selectActive(reactions, now = Date.now()) {
  const eligible = [];
  const ignored = [];

  for (const reaction of reactions ?? []) {
    const verdict = eligibility(reaction, now);
    if (verdict.eligible) eligible.push(reaction);
    else ignored.push({ reaction, reason: verdict.reason });
  }

  const byGroup = Object.fromEntries(GROUP_ORDER.map((group) => [group, []]));
  for (const reaction of eligible) {
    if (byGroup[reaction.group]) byGroup[reaction.group].push(reaction);
  }

  const news = selectNewsReactions(byGroup.news);
  const active = news.selected.map((slot) => ({
    reaction: slot.reaction,
    weight: NEWS_SLOT_WEIGHT,
    ageHours: reactionAgeHours(slot.reaction, now),
    slot: { topic: slot.topic, index: slot.slotIndex },
  }));

  const singles = [
    ['weather', newestReaction],
    ['alerts', strongestAlert],
    ['air', newestReaction],
    ['water', newestReaction],
    ['wildlife', newestReaction],
    ['earthquake', strongestEarthquake],
    ['eonet', newestReaction],
  ];

  for (const [group, picker] of singles) {
    const reaction = picker(byGroup[group]);
    if (!reaction) continue;
    active.push({
      reaction,
      weight: WEIGHTS[group],
      ageHours: reactionAgeHours(reaction, now),
      slot: null,
    });
  }

  for (const item of active) {
    item.contribution = contribution({
      intensity: item.reaction.intensity,
      weight: item.weight,
      ageHours: item.ageHours,
      halfLifeHours: DECAY[item.reaction.group].halfLifeHours,
    });
  }

  active.sort((a, b) => b.contribution - a.contribution || String(a.reaction.key).localeCompare(String(b.reaction.key)));

  return {
    active,
    ignored,
    eligible,
    news,
    weights: { newsSlot: NEWS_SLOT_WEIGHT, ...WEIGHTS },
  };
}

export function influencePhrase(reaction) {
  if (!reaction) return 'no strong source';
  switch (reaction.group) {
    case 'news':
      return `${reaction.publisherLabel ?? 'News'} coverage`;
    case 'weather':
      return 'Charlotte weather';
    case 'alerts':
      return 'an official weather alert';
    case 'air':
      return 'Charlotte air quality';
    case 'water':
      return 'the South Fork Catawba gauge';
    case 'wildlife':
      return 'a nearby wildlife observation';
    case 'earthquake':
      return 'a recent earthquake';
    case 'eonet':
      return 'a NASA natural-event listing';
    default:
      return 'a public source';
  }
}

function describeMood(mood, { isCalm, leadReaction }) {
  const phrase = influencePhrase(leadReaction);
  if (mood === 'calm') {
    return isCalm && !leadReaction
      ? 'Quiet inside — no source is pulling hard enough to stir a strong mood.'
      : `Settled and quiet — ${phrase} is only a gentle pull.`;
  }
  switch (mood) {
    case 'happy':
      return `Light and open — ${phrase} is the strongest pull right now.`;
    case 'sad':
      return `A little heavy — ${phrase} is weighing most.`;
    case 'mad':
      return `Frustrated — ${phrase} is stirring the sharpest reaction.`;
    case 'confused':
      return `Unsettled — ${phrase} leaves more questions than answers.`;
    default:
      return 'Quiet inside — no strong mood is forming.';
  }
}

export function computeMood({ reactions = [], now = Date.now() } = {}) {
  const selection = selectActive(reactions, now);

  const byMood = Object.fromEntries(
    MOODS.map((mood) => [mood, { mood, score: 0, supports: [] }]),
  );

  for (const item of selection.active) {
    const bucket = byMood[item.reaction.mood];
    if (!bucket) continue;
    bucket.score += item.contribution;
    bucket.supports.push({
      reaction: item.reaction,
      contribution: item.contribution,
      weight: item.weight,
      ageHours: item.ageHours,
      slot: item.slot,
    });
  }

  for (const bucket of Object.values(byMood)) {
    bucket.supports.sort(
      (a, b) => b.contribution - a.contribution || String(a.reaction.key).localeCompare(String(b.reaction.key)),
    );
  }

  const ranked = [...MOODS]
    .map((mood) => byMood[mood])
    .sort((a, b) => b.score - a.score || MOOD_ORDER[a.mood] - MOOD_ORDER[b.mood]);

  const top = ranked[0];
  const isCalm = top.score < CALM_THRESHOLD;
  const mood = isCalm ? 'calm' : top.mood;

  const leadReaction = isCalm
    ? selection.active[0]?.reaction ?? null
    : byMood[mood]?.supports[0]?.reaction ?? null;

  const groups = GROUP_ORDER.map((group) => {
    const items = selection.active.filter((item) => item.reaction.group === group);
    const used = items.reduce((total, item) => total + item.contribution, 0);
    return {
      group,
      label: GROUP_LABELS[group],
      budget: BUDGETS[group],
      maxSlotWeight: WEIGHTS[group],
      activeCount: items.length,
      used,
      items,
    };
  });

  const newsTopics = NEWS_TOPICS.map((topic) => {
    const chosen = selection.news.topicSelections.get(topic.id) ?? [];
    return {
      ...topic,
      slots: chosen.map((reaction) => {
        const item = selection.active.find((entry) => entry.reaction.key === reaction.key);
        return {
          reaction,
          contribution: item?.contribution ?? 0,
        };
      }),
    };
  });

  return {
    mood,
    topEmotion: top.mood,
    score: top.score,
    isCalm,
    description: describeMood(mood, { isCalm, leadReaction }),
    byMood,
    active: selection.active,
    ignored: selection.ignored,
    totalContribution: selection.active.reduce((total, item) => total + item.contribution, 0),
    groups,
    newsTopics,
    publisherCounts: Object.fromEntries(selection.news.publisherCounts),
    weights: selection.weights,
    generatedAt: now,
  };
}

export function activeReactionKeys(moodState) {
  return new Set((moodState?.active ?? []).map((item) => item.reaction.key));
}
