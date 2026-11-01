import { CALM_THRESHOLD, LOCATION, MOODS, MOOD_COPY } from '../config.js';
import { escapeHtml } from '../lib/validate.js';

const WIDTH = 720;
const HEIGHT = 250;
const PADDING = { left: 44, right: 16, top: 18, bottom: 38 };

function shortDate(timestamp) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: LOCATION.timezone,
    }).format(new Date(Number(timestamp)));
  } catch {
    return new Date(Number(timestamp)).toISOString().slice(5, 10);
  }
}

function moodLabel(mood) {
  return MOOD_COPY[mood]?.label ?? 'Calm';
}

function moodColor(mood) {
  return MOOD_COPY[mood]?.accent ?? 'var(--muted)';
}

function chartMarkup(points) {
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const minAt = points[0].at;
  const maxAt = points[points.length - 1].at;
  const span = Math.max(1, maxAt - minAt);
  const highest = Math.max(CALM_THRESHOLD, ...points.map((point) => point.score));
  const yMax = Math.max(0.25, Math.ceil(highest * 4) / 4);
  const x = (at) => PADDING.left + ((at - minAt) / span) * innerWidth;
  const y = (score) => PADDING.top + (1 - score / yMax) * innerHeight;
  const line =
    points.length > 1
      ? `M ${points.map((point) => `${x(point.at).toFixed(1)} ${y(point.score).toFixed(1)}`).join(' L ')}`
      : '';

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => {
      const score = yMax * fraction;
      const top = y(score);
      return `<g>
        <line class="mood-chart-grid" x1="${PADDING.left}" y1="${top.toFixed(1)}" x2="${WIDTH - PADDING.right}" y2="${top.toFixed(1)}"></line>
        <text class="mood-chart-axis-label" x="${PADDING.left - 8}" y="${(top + 3.5).toFixed(1)}" text-anchor="end">${score.toFixed(2)}</text>
      </g>`;
    })
    .join('');

  const threshold =
    CALM_THRESHOLD <= yMax
      ? `<g>
          <line class="mood-chart-threshold" x1="${PADDING.left}" y1="${y(CALM_THRESHOLD).toFixed(1)}" x2="${WIDTH - PADDING.right}" y2="${y(CALM_THRESHOLD).toFixed(1)}"></line>
          <text class="mood-chart-threshold-label" x="${WIDTH - PADDING.right}" y="${(y(CALM_THRESHOLD) - 5).toFixed(1)}" text-anchor="end">calm cutoff</text>
        </g>`
      : '';

  const dots = points
    .map((point) => {
      const title = `${shortDate(point.at)} · ${moodLabel(point.mood)} · ${point.score.toFixed(3)}`;
      return `<circle class="mood-chart-dot" cx="${x(point.at).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="3.1" fill="${escapeHtml(moodColor(point.mood))}"><title>${escapeHtml(title)}</title></circle>`;
    })
    .join('');

  const labelIndexes = points.length > 1 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0];
  const xLabels = [...new Set(labelIndexes)]
    .map((index) => {
      const point = points[index];
      const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
      return `<text class="mood-chart-axis-label" x="${x(point.at).toFixed(1)}" y="${HEIGHT - 12}" text-anchor="${anchor}">${escapeHtml(shortDate(point.at))}</text>`;
    })
    .join('');

  return `<div class="mood-chart">
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Mood score over the last ${points.length === 1 ? 'hour' : 'period'}, from ${escapeHtml(shortDate(minAt))} to ${escapeHtml(shortDate(maxAt))}">
      ${grid}
      ${threshold}
      ${line ? `<path class="mood-chart-line" d="${line}"></path>` : ''}
      ${dots}
      ${xLabels}
    </svg>
  </div>`;
}

/**
 * Render the compact hourly history. This is a record of Murmur's simulated
 * mood, not a survey or a measurement of public opinion.
 */
export function moodHistoryMarkup({
  points = [],
  missing = [],
  days = 30,
  error = null,
  loading = false,
} = {}) {
  if (loading && !points.length) {
    return '<p class="muted">Loading hourly mood history…</p>';
  }
  if (error) {
    return `<p class="notice" data-tone="bad">Mood history is unavailable right now: ${escapeHtml(error)}</p>`;
  }
  if (!points.length) {
    return '<p class="empty-state">Mood history will appear after the next hourly cache is deployed. It records one point per build.</p>';
  }

  const safePoints = points.filter(
    (point) =>
      point &&
      Number.isFinite(Number(point.at)) &&
      Number.isFinite(Number(point.score)) &&
      MOODS.includes(point.mood),
  );
  if (!safePoints.length) {
    return '<p class="empty-state">Mood history contains no usable points.</p>';
  }

  const counts = Object.fromEntries(MOODS.map((mood) => [mood, 0]));
  for (const point of safePoints) counts[point.mood] += 1;
  const calmCount = counts.calm;
  const calmShare = Math.round((calmCount / safePoints.length) * 100);
  const highest = safePoints.reduce((best, point) => (point.score > best.score ? point : best), safePoints[0]);
  const presentMoods = MOODS.filter((mood) => counts[mood] > 0);
  const legend = presentMoods
    .map(
      (mood) =>
        `<span class="mood-legend-item"><span class="mood-legend-swatch" style="background:${escapeHtml(moodColor(mood))}"></span>${escapeHtml(moodLabel(mood))}</span>`,
    )
    .join('');
  const missingNote = missing.length
    ? `<p class="mood-history-note">Some monthly history could not be loaded: ${missing.map(escapeHtml).join(', ')}.</p>`
    : '';

  return `<p class="mood-history-summary">
      Last ${escapeHtml(String(days))} days: <strong>${safePoints.length}</strong> hourly points ·
      <strong>${calmShare}%</strong> calm · highest <strong>${highest.score.toFixed(2)}</strong>
      (${escapeHtml(moodLabel(highest.mood))}).
    </p>
    ${chartMarkup(safePoints)}
    <div class="mood-legend" aria-label="Mood colors">${legend}</div>
    <p class="mood-history-note">A record of Murmur's simulated mood at cache-build time. It is not a survey of Charlotte or a measure of public opinion.</p>
    ${missingNote}`;
}
