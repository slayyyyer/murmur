/**
 * Every upstream the local proxy will ever contact.
 *
 * The list is intentionally narrow: exact origin plus a path prefix. It covers
 * the RSS feeds that do not send CORS headers, and the USGS feed that is
 * relayed so the proxy can prefer IPv4 (see proxy/server.js).
 */
export const ALLOWED_UPSTREAMS = Object.freeze([
  { origin: 'https://feeds.bbci.co.uk', pathPrefixes: ['/news/'], label: 'BBC News RSS' },
  { origin: 'https://www.aljazeera.com', pathPrefixes: ['/xml/rss/'], label: 'Al Jazeera RSS' },
  { origin: 'https://www.nasa.gov', pathPrefixes: ['/feed/'], label: 'NASA news feed' },
  // The Guardian redirects topic feeds to /us/... so the whole origin is allowed for GET only.
  { origin: 'https://www.theguardian.com', pathPrefixes: ['/'], label: 'The Guardian RSS' },
  { origin: 'https://www.positive.news', pathPrefixes: ['/feed/'], label: 'Positive News RSS' },
  { origin: 'https://www.wfae.org', pathPrefixes: ['/news.rss'], label: 'WFAE local news RSS' },
  { origin: 'https://earthquake.usgs.gov', pathPrefixes: ['/earthquakes/feed/'], label: 'USGS earthquake feed' },
]);

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;
const ALLOWED_PROTOCOLS = new Set(['https:']);

/**
 * @param {string} candidate
 * @returns {{allowed: boolean, reason?: string, url?: URL, rule?: object}}
 */
export function matchUpstream(candidate) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { allowed: false, reason: 'Not a valid URL.' };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { allowed: false, reason: 'Only HTTPS upstreams are allowed.' };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: 'Credentials in upstream URLs are not allowed.' };
  }
  if (url.port && url.port !== '443') {
    return { allowed: false, reason: 'Non-default ports are not allowed.' };
  }
  if (!url.hostname.includes('.') || IP_LITERAL.test(url.hostname)) {
    return { allowed: false, reason: 'Upstream must be a public hostname.' };
  }
  if (url.pathname.includes('..')) {
    return { allowed: false, reason: 'Unsafe upstream path.' };
  }

  const rule = ALLOWED_UPSTREAMS.find(
    (entry) =>
      entry.origin === url.origin &&
      entry.pathPrefixes.some((prefix) => url.pathname.startsWith(prefix)),
  );

  if (!rule) {
    return { allowed: false, reason: 'Upstream is not on the allowlist.' };
  }

  return { allowed: true, url, rule };
}

export function isAllowedUpstream(candidate) {
  return matchUpstream(candidate).allowed;
}
