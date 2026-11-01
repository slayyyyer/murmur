import { formatDate } from '../lib/time.js';

const feelsLike = (data) =>
  Number.isFinite(data?.apparentC) ? data.apparentC : Number.isFinite(data?.temperatureC) ? data.temperatureC : null;

function rounded(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function weatherRule(record) {
  const data = record?.data ?? {};
  const code = Number(data.weatherCode);
  const temperature = Number(data.temperatureC);
  const feels = feelsLike(data);
  if (!Number.isFinite(code) || !Number.isFinite(temperature) || !Number.isFinite(feels)) return null;
  const tempText = `${Math.round(temperature)}°C`;

  if ([95, 96, 99].includes(code)) {
    return {
      mood: 'confused',
      intensity: 0.5,
      text: `Thunderstorms around Charlotte at ${tempText}. The sky feels unpredictable rather than calm.`,
    };
  }
  if ([56, 57, 66, 67, 77].includes(code)) {
    return {
      mood: 'confused',
      intensity: 0.4,
      text: `Freezing precipitation at ${tempText} makes the day feel sharp-edged and uncertain.`,
    };
  }
  if (feels >= 35) {
    return {
      mood: 'mad',
      intensity: 0.45,
      text: `It feels like ${Math.round(feels)}°C in Charlotte. The heat has an impatient edge.`,
    };
  }
  if (feels <= 0) {
    return {
      mood: 'sad',
      intensity: 0.3,
      text: `It feels like ${Math.round(feels)}°C in Charlotte. The cold asks for patience.`,
    };
  }
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) {
    return {
      mood: 'sad',
      intensity: code >= 65 ? 0.4 : 0.3,
      text: `Rain over Charlotte at ${tempText}. The afternoon has a softer, heavier weight.`,
    };
  }
  if ([45, 48].includes(code)) {
    return {
      mood: 'confused',
      intensity: 0.25,
      text: `Fog at ${tempText} blurs the edges of the Charlotte morning.`,
    };
  }
  if ([71, 73, 75, 85, 86].includes(code)) {
    return {
      mood: 'confused',
      intensity: 0.3,
      text: `Snow at ${tempText} is unusual enough around Charlotte to make the day feel slowed and strange.`,
    };
  }
  if (code === 0 || code === 1) {
    return {
      mood: 'happy',
      intensity: 0.6,
      text: `Clear skies and ${tempText} in Charlotte — an easy day to be outside.`,
    };
  }
  if (code === 2) {
    return {
      mood: 'happy',
      intensity: 0.42,
      text: `Soft clouds and ${tempText} — the Charlotte sky is undemanding today.`,
    };
  }
  if (code === 3) {
    return {
      mood: 'calm',
      intensity: 0.3,
      text: `Overcast and ${tempText} in Charlotte. The sky is asking for nothing.`,
    };
  }
  return {
    mood: 'calm',
    intensity: 0.2,
    text: `${data.condition ?? 'Mild conditions'} and ${tempText} in Charlotte — a quiet, ordinary sky.`,
  };
}

export function airRule(record) {
  const aqi = Number(record?.data?.usAqi);
  if (!Number.isFinite(aqi) || aqi < 0) return null;
  const value = Math.round(aqi);
  if (aqi <= 25) {
    return { mood: 'happy', intensity: 0.35, text: `Air quality is excellent around Charlotte (US AQI ${value}).` };
  }
  if (aqi <= 50) {
    return { mood: 'happy', intensity: 0.22, text: `Air quality is good around Charlotte (US AQI ${value}).` };
  }
  if (aqi <= 100) {
    return {
      mood: 'confused',
      intensity: 0.2,
      text: `Air quality is moderate around Charlotte (US AQI ${value}) — a little haze in the picture.`,
    };
  }
  if (aqi <= 150) {
    return {
      mood: 'sad',
      intensity: 0.35,
      text: `Air quality is unhealthy for sensitive groups (US AQI ${value}), according to the modeled reading.`,
    };
  }
  if (aqi <= 200) {
    return {
      mood: 'sad',
      intensity: 0.55,
      text: `Air quality is unhealthy around Charlotte (US AQI ${value}), according to the modeled reading.`,
    };
  }
  return {
    mood: 'mad',
    intensity: 0.65,
    text: `The modeled air quality is very unhealthy (US AQI ${value}). That feels unfair to everyone breathing it.`,
  };
}

export function wildlifeRule(record) {
  const data = record?.data ?? {};
  const name = data.commonName || data.taxonName;
  if (!name) return null;

  const distanceText = Number.isFinite(data.distanceKm)
    ? data.distanceKm <= 5
      ? 'within 5 km of Charlotte'
      : `about ${data.distanceKm} km from Charlotte`
    : 'within 50 km of Charlotte';

  const dateText = data.dateOnly
    ? `observed on ${formatDate(record.originalAt, { dateOnly: true })} (date only)`
    : 'recently observed';

  return {
    mood: 'happy',
    intensity: 0.5,
    text: `A research-grade ${name} observation ${dateText}, ${distanceText}. A small local bright note.`,
  };
}

export function earthquakeRule(record) {
  const data = record?.data ?? {};
  const magnitude = Number(data.magnitude);
  if (!Number.isFinite(magnitude) || magnitude < 4) return null;

  const intensity = magnitude >= 6.5 ? 0.7 : magnitude >= 6 ? 0.55 : magnitude >= 5 ? 0.35 : 0.2;
  const distanceText = Number.isFinite(data.distanceKm)
    ? data.distanceKm <= 5
      ? ' within 5 km of Charlotte'
      : ` about ${data.distanceKm.toLocaleString('en-US')} km from Charlotte`
    : '';

  return {
    mood: 'confused',
    intensity,
    text: `USGS recorded a magnitude ${magnitude.toFixed(1)} earthquake${distanceText}. No local impact is assumed.`,
  };
}

export function eonetRule(record) {
  const data = record?.data ?? {};
  const label = data.categoryLabel;
  if (!label) return null;

  const title = record.title ? `: “${record.title}”` : '';
  return {
    mood: 'confused',
    intensity: data.categoryId === 'volcanoes' ? 0.25 : 0.3,
    text: `NASA EONET lists an open ${label.toLowerCase()} event${title}. The listing does not establish damage or danger to Charlotte.`,
  };
}

export function alertRule(record) {
  const data = record?.data ?? {};
  const event = data.event;
  if (!event) return null;

  const severity = ['Extreme', 'Severe', 'Moderate', 'Minor'].includes(data.severity)
    ? data.severity
    : 'Unknown';
  const intensity = { Extreme: 0.85, Severe: 0.7, Moderate: 0.5, Minor: 0.3, Unknown: 0.25 }[severity];
  const mood = /heat|fire weather|red flag/i.test(event)
    ? 'mad'
    : /air quality|smoke/i.test(event)
      ? 'sad'
      : 'confused';
  const area = data.areaDesc && data.areaDesc !== 'the alert area' ? ` for ${data.areaDesc}` : ' for the Charlotte area';

  return {
    mood,
    intensity,
    text: `The National Weather Service has an active ${event}${area}. This is an official alert; no damage or danger beyond the listed area is assumed.`,
  };
}

export function waterRule(record) {
  const data = record?.data ?? {};
  const stage = Number(data.stageFt);
  if (!Number.isFinite(stage)) return null;

  const place = data.name || 'the South Fork Catawba at Lowell';
  const stageText = `${stage.toFixed(2)} ft`;
  const action = Number(data.actionStageFt);
  const actionText = Number.isFinite(action) ? `, below its ${action.toFixed(1)} ft action stage` : '';

  switch (data.category) {
    case 'action':
      return {
        mood: 'confused',
        intensity: 0.35,
        text: `${place} is at ${stageText}, at its action stage. The river is running high; no local damage is assumed.`,
      };
    case 'minor':
      return {
        mood: 'confused',
        intensity: 0.55,
        text: `${place} is at ${stageText}, in minor flooding at the gauge. This is a river reading, not a claim about damage elsewhere.`,
      };
    case 'moderate':
      return {
        mood: 'sad',
        intensity: 0.7,
        text: `${place} is at ${stageText}, in moderate flooding at the gauge. The high water is a heavy local note; no broader impact is assumed.`,
      };
    case 'major':
      return {
        mood: 'sad',
        intensity: 0.85,
        text: `${place} is at ${stageText}, in major flooding at the gauge. This is a serious reading, not a claim about damage beyond the gauge.`,
      };
    default:
      return {
        mood: 'calm',
        intensity: 0.15,
        text: `${place} is at ${stageText}${actionText}. The river is quiet at the gauge today.`,
      };
  }
}

export const MEASURED_RULES = Object.freeze({
  weather: weatherRule,
  air: airRule,
  alerts: alertRule,
  water: waterRule,
  wildlife: wildlifeRule,
  earthquake: earthquakeRule,
  eonet: eonetRule,
});
