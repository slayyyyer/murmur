import { PUBLISHERS } from '../config.js';
import { airLoader, weatherLoader } from './openMeteo.js';
import { alertsLoader } from './alerts.js';
import { waterLoader } from './water.js';
import { createNewsLoader } from './news.js';
import { earthquakeLoader } from './usgs.js';
import { wildlifeLoader } from './inaturalist.js';
import { eonetLoader } from './eonet.js';

/**
 * One loader per independently-reported source. News is split per publisher so
 * a single failing feed set cannot take the others down.
 */
export function createLoaders({ fetchImpl = globalThis.fetch, proxyBase = '', now = Date.now() } = {}) {
  return [
    weatherLoader({ fetchImpl }),
    airLoader({ fetchImpl }),
    alertsLoader({ fetchImpl }),
    waterLoader({ fetchImpl }),
    ...Object.keys(PUBLISHERS).map((publisherId) => createNewsLoader(publisherId, { fetchImpl, proxyBase, now })),
    earthquakeLoader({ fetchImpl, proxyBase }),
    wildlifeLoader({ fetchImpl }),
    eonetLoader({ fetchImpl }),
  ];
}
