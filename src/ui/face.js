import { MOOD_COPY } from '../config.js';

let faceCounter = 0;

/**
 * The face is a single SVG with mood-dependent CSS. Every instance gets unique
 * title/description IDs so the live face and the preview face remain separately
 * labelled for assistive technology.
 */
export function faceSvg(mood = 'calm', { preview = false } = {}) {
  const safeMood = MOOD_COPY[mood] ? mood : 'calm';
  const copy = MOOD_COPY[safeMood];
  faceCounter += 1;
  const id = `murmur-face-${faceCounter}`;

  return `
  <svg class="face face--${safeMood}" viewBox="0 0 240 240" role="img" aria-labelledby="${id}-title ${id}-desc"${preview ? ' data-preview="true"' : ''}>
    <title id="${id}-title">Murmur's ${copy.label.toLowerCase()} face</title>
    <desc id="${id}-desc">A ${copy.label.toLowerCase()} expression: ${copy.aria}.</desc>
    <ellipse class="face-shadow" cx="120" cy="219" rx="54" ry="8"></ellipse>
    <g class="face-bob">
      <g class="face-antenna">
        <line x1="120" y1="47" x2="120" y2="27"></line>
        <circle cx="120" cy="22" r="5"></circle>
      </g>
      <ellipse class="face-head" cx="120" cy="123" rx="86" ry="81"></ellipse>
      <g class="face-brows">
        <path class="brow brow-left" d="M74 96 q16 -9 31 -3"></path>
        <path class="brow brow-right" d="M135 93 q15 -6 31 3"></path>
      </g>
      <g class="face-eyes">
        <ellipse class="eye-white" cx="91" cy="119" rx="16" ry="19"></ellipse>
        <ellipse class="eye-white" cx="149" cy="119" rx="16" ry="19"></ellipse>
        <circle class="pupil pupil-left" cx="93" cy="121" r="7.5"></circle>
        <circle class="pupil pupil-right" cx="147" cy="121" r="7.5"></circle>
        <circle class="eye-shine" cx="96" cy="117" r="2.4"></circle>
        <circle class="eye-shine" cx="150" cy="117" r="2.4"></circle>
        <path class="eye-closed" d="M76 120 q15 12 30 0"></path>
        <path class="eye-closed" d="M134 120 q15 12 30 0"></path>
      </g>
      <g class="face-cheeks">
        <ellipse cx="72" cy="149" rx="14" ry="7"></ellipse>
        <ellipse cx="168" cy="149" rx="14" ry="7"></ellipse>
      </g>
      <path class="mouth mouth-happy" d="M99 156 q21 24 42 0"></path>
      <path class="mouth mouth-sad" d="M102 169 q18 -16 36 0"></path>
      <path class="mouth mouth-mad" d="M104 166 h32"></path>
      <path class="mouth mouth-confused" d="M102 162 q10 -8 18 0 t18 0"></path>
      <path class="mouth mouth-calm" d="M105 161 q15 8 30 0"></path>
      <path class="mouth mouth-neutral" d="M108 160 h24"></path>
      <ellipse class="face-tear" cx="76" cy="143" rx="4" ry="6"></ellipse>
      <text class="face-question" x="186" y="70">?</text>
    </g>
  </svg>`;
}
