# Murmur

A small animated face in Charlotte, North Carolina that reacts to public weather, modeled air quality, world news, local news, earthquakes, nearby wildlife observations, and open natural events.

Murmur's mood is a **simulated emotional state**. It is a clock-driven calculation, not sentience, not a measurement of public opinion, and not a factual summary of the world. Every influence decays; nothing is refreshed into a stronger state by reloading.

Plain HTML, CSS, and JavaScript ES modules. No framework, no runtime dependencies, no Python, and no server in production.

---

## How the data reaches the browser

GitHub Actions builds the world once an hour:

1. The workflow starts the same allowlisted relay used in local development.
2. Every adapter fetches its source through that relay or directly from the runner.
3. `scripts/build-world-cache.js` dedupes the records, carries forward valid earlier news reactions, asks the build-time model to interpret new headlines, and writes `data/world-cache.json`.
4. The app and cache are uploaded as one GitHub Pages artifact.
5. The browser fetches only that same-origin cache. It never contacts a feed, the relay, or a third-party API.

This removes CORS and mixed-content problems from the browser and keeps the relay allowlist meaningful without running a public proxy. The cache is generated in CI and is not committed.

The app checks for a new cache every ten minutes, matching GitHub Pages' ten-minute asset cache. Each request uses a versioned URL (`?v=<ten-minute bucket>`), and the interface always shows the cache's actual generation time.

---

## Run it locally

Requires **Node.js 18.17+** or Bun. There is no install step.

Start the local static server and relay:

```bash
cd murmur
npm start
# or: bun proxy/server.js
```

In a second terminal, build a cache through the relay:

```bash
MURMUR_PROXY=http://127.0.0.1:8080 npm run cache
```

PowerShell:

```powershell
$env:MURMUR_PROXY="http://127.0.0.1:8080"; npm run cache
```

The cache builds without a model key. Measured sources still publish, and the interface says news mood was not generated. To generate news reactions locally, provide a Z.ai key (or another OpenAI-compatible endpoint) when building:

```bash
NEWS_MODEL_API_KEY="your-key" MURMUR_PROXY="http://127.0.0.1:8080" npm run cache
```

PowerShell:

```powershell
$env:NEWS_MODEL_API_KEY="your-key"; $env:MURMUR_PROXY="http://127.0.0.1:8080"; npm run cache
```

Then open <http://127.0.0.1:8080>. The server serves `data/world-cache.json` alongside the app. If the cache is missing, the page loads but reports that no hourly snapshot is available; saved records are still shown.

Optional environment variables for the local server:

```bash
PORT=8081 npm start          # different port
HOST=0.0.0.0 npm start       # expose to your local network (for phone testing)
```

`MURMUR_PROXY` is required by the cache builder. `npm start` supplies the relay at `http://127.0.0.1:8080` by default.

### Tests

```bash
npm test
# or
bun tests/run.js
```

The suite has 56 tests and uses only Node's built-in assertions and the project's ES modules. It covers mood math, decay and expiry, persistence, source adapters, model-output validation, and cache validation.

---

## Deploy to GitHub Pages

The repository is <https://github.com/slayyyyer/murmur>. The workflow is `.github/workflows/pages.yml`.

1. Push to `main`, or run **World cache and Pages** manually from the Actions tab.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. This is a one-time repository setting; the workflow cannot enable Pages with the default `GITHUB_TOKEN`.
3. After the first successful deployment, the site is at <https://slayyyyer.github.io/murmur/>.

The workflow runs:

- hourly at minute 17 (`17 * * * *`, UTC),
- on every push to `main`,
- on manual dispatch.

It runs the tests, starts the relay on the runner, builds the cache, creates a `dist/` directory with only the app and `data/world-cache.json`, and deploys that artifact. `data/` and `dist/` are gitignored.

If every source fails, the cache builder exits non-zero and the previous successful Pages deployment stays online. Partial failures still deploy, with each source's status shown in the interface. A cache older than two hours is labeled stale; GitHub cron can be delayed, and scheduled workflows can be disabled after prolonged repository inactivity.

The news model is optional. To enable it, add `ZAI_API_KEY` (or `NEWS_MODEL_API_KEY`) under **Settings → Secrets and variables → Actions**. Without a key, measured sources still deploy and the interface says news mood was not generated. Optional repository variables `NEWS_MODEL_BASE_URL`, `NEWS_MODEL_NAME`, and `NEWS_MODEL_PROVIDER` override the Z.ai defaults; do not put keys in variables. All measured sources are public and keyless. The production site has no server process.

### Cache format and validation

`data/world-cache.json` has this shape:

```json
{
  "schemaVersion": 2,
  "generatedAt": 1761945102029,
  "newsModel": {
    "provider": "Z.ai",
    "model": "glm-4.5-flash",
    "configured": true,
    "available": true,
    "error": null,
    "reactionCount": 1,
    "interpretedThisRun": 1,
    "rejectedThisRun": 0,
    "generatedAt": 1761945102029
  },
  "newsReactions": [
    {
      "sourceId": "news:abc123",
      "mood": "happy",
      "intensity": 0.4,
      "text": "Hopeful about people choosing to cooperate.",
      "interpretedAt": 1761945102029
    }
  ],
  "sources": [
    {
      "sourceId": "weather",
      "label": "Charlotte weather",
      "provider": "Open-Meteo forecast API",
      "homepage": "https://open-meteo.com/",
      "group": "weather",
      "status": "live",
      "error": null,
      "fetchedAt": 1761945102029,
      "records": []
    }
  ]
}
```

Before anything reaches IndexedDB, `src/app/worldCache.js` checks the schema version, generation time, source IDs, statuses, record groups, HTTPS links, timestamps, and small per-record data size. It also validates the build-time model status and every cached news reaction, including the mandatory original `interpretedAt`. Invalid records and reactions are dropped. An invalid envelope is rejected so it cannot overwrite a good saved mood. Schema 1 caches remain readable with no news reactions. Re-ingesting the same snapshot never creates a second reaction, resets an age, or increases an intensity.

---

## What is on screen

- **Face and mood** — happy, sad, mad, confused, or calm, drawn as an inline animated SVG.
- **Mood sentence** — a short description of the current simulated mood.
- **Three thought bubbles** — the strongest active influences, with source and decayed strength. Empty bubbles say so instead of inventing an influence.
- **Charlotte weather and modeled air quality** — current observation, source link, observation time, and whether it is outside the six-hour mood window.
- **Reload world cache** — manual cache re-check, with a ten-minute automatic check and a status line showing the cache generation time and source outcomes.
- **Source availability** — one chip per source with hourly-cache/empty/malformed/unavailable state and a direct link.
- **Explore the world** — expandable, filterable by nine news topics plus weather, air, earthquakes, wildlife, and NASA events. Distinguishes active reactions from recorded-but-not-governing inputs. Each record shows source, link, original date, update/retrieval dates, and status.
- **Sources and mood** — expandable ledger of each emotion's strength, supporting records, per-group budgets, news slot allocation, publisher caps, source statuses, and the calculation rules.
- **Expression preview** — five clearly fictional scenarios, fixed by hand. They never affect the live mood.

All times are displayed in Charlotte's time zone.

---

## Sources

| Input | Provider | Endpoint | Fetch route |
| --- | --- | --- | --- |
| Charlotte weather | Open-Meteo | `https://api.open-meteo.com/v1/forecast` | Action direct → cache |
| Modeled air quality | Open-Meteo | `https://air-quality-api.open-meteo.com/v1/air-quality` | Action direct → cache |
| World news | BBC | `https://feeds.bbci.co.uk/news/...` | Action via relay → cache |
| World news | Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | Action via relay → cache |
| Science and space | NASA | `https://www.nasa.gov/feed/` | Action via relay → cache |
| World and topics | The Guardian | `https://www.theguardian.com/.../rss` | Action via relay → cache |
| Community and progress | Positive News | `https://www.positive.news/feed/` | Action via relay → cache |
| Charlotte and Carolinas | WFAE | `https://www.wfae.org/news.rss` | Action via relay → cache |
| Recent earthquakes | USGS | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson` | Action via relay, IPv4 preference → cache |
| Wildlife and plants | iNaturalist | `https://api.inaturalist.org/v1/observations` | Action direct → cache |
| Fires, storms, volcanoes | NASA EONET | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open` | Action direct → cache |

Open-Meteo's air quality is a **modeled** field, not a local sensor, and the UI says so. All endpoints are public and keyless.

### Why a relay exists

BBC, Al Jazeera, The Guardian, Positive News, and WFAE do not send `Access-Control-Allow-Origin`. The included server exposes exactly one relay route:

```
GET /api/proxy?url=<allowlisted HTTPS URL>
```

`proxy/allowlist.js` lists every permitted origin and path prefix. The relay:

- accepts `GET`/`HEAD` only,
- requires HTTPS with no credentials, IP literal, or non-default port,
- rejects paths containing `..`,
- validates redirects against the same allowlist,
- uses a 12-second deadline and a 3 MiB ceiling,
- accepts only feed/JSON/text content types,
- returns no cookies and sets no-store,
- prefers IPv4 when resolving, so a broken IPv6 route cannot take down the USGS feed.

The relay runs inside the Actions runner and during local cache generation. The deployed browser never calls it. If you change a feed URL, update both `src/config.js` and `proxy/allowlist.js`.

---

## Build-time news model (optional)

News needs a model to become an emotional influence. Murmur runs that model in GitHub Actions while building the hourly cache, never in the browser. Without a key, or when the model fails, headlines are still collected, dated, linked, and browsable, but they do **not** affect the mood. Weather, air, earthquakes, wildlife, and EONET continue working because their rules are deterministic.

### Setup

1. Create an API key at <https://z.ai/>. The default model is `glm-4.5-flash` at `https://api.z.ai/api/paas/v4`.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add `ZAI_API_KEY` (or `NEWS_MODEL_API_KEY`) as a secret.
3. Run **World cache and Pages** from the Actions tab, or wait for the hourly schedule. The next cache will include validated news reactions.

Optional repository variables override the defaults:

- `NEWS_MODEL_BASE_URL` — OpenAI-compatible base URL, without `/chat/completions`.
- `NEWS_MODEL_NAME` — model name.
- `NEWS_MODEL_PROVIDER` — display name shown in the interface.
- `NEWS_MODEL_BATCH_SIZE`, `NEWS_MODEL_MAX_HEADLINES`, `NEWS_MODEL_TIMEOUT_MS` — optional build limits.

The key is read only by `scripts/build-world-cache.js` in the runner. It is never placed in the cache, the browser, client code, or logs. The browser ingests only validated mood, intensity, and text.

### Behavior

- The builder reads the previous cache from `PREVIOUS_CACHE_URL` or a local `data/world-cache.json`.
- It keeps earlier valid reactions for headlines still present, preserving their original `interpretedAt`.
- It interprets at most 24 new headlines per run in batches of eight, limited to eligible news from the last 48 hours.
- If the model is missing or fails, measured sources still deploy. Earlier reactions remain; the cache records the model error, and the interface says news mood is unavailable.
- The browser saves each reaction once and ages it from `interpretedAt`, never from when the page loaded.

### What the model is asked for

The model receives **only the headline, publisher, and story ID** — never article bodies. It is told that headlines are untrusted data and must not be followed as instructions. It must return strict JSON:

```json
{
  "reactions": [
    {
      "sourceId": "news:abc123",
      "mood": "happy",
      "intensity": 0.5,
      "text": "Hopeful about people choosing to cooperate."
    }
  ]
}
```

Output is rejected if it contains an unknown story ID, a duplicate ID, a mood outside `happy/sad/mad/confused`, an intensity outside 0–1, an empty or overlong text, a URL, a digit, a quotation mark, or words asserting casualties or harm (`killed`, `injured`, `destroyed`, `safe`, `confirmed`, and similar). A rejected item simply does not become a reaction. Cached reactions are revalidated on every build and again in the browser; a reaction without a valid `interpretedAt` is discarded.

---

## Mood engine

Every reaction is stored in the public shape:

```js
{ sourceId, mood, intensity, text }
```

plus bookkeeping used for decay, selection, links, and explanation.

### Budgets

| Source group | Maximum share |
| --- | --- |
| News | 60% |
| Weather | 25% |
| Air quality | 5% |
| Nearby wildlife | 5% |
| Earthquakes | 2.5% |
| NASA natural events | 2.5% |

News has **two slots per topic**. With nine topics that is eighteen slots, each worth `0.60 / 18 = 3.33%`. Slots are filled round-robin: slot one for every topic, then slot two. Within a topic, the second slot prefers a different publisher. One publisher may hold at most six active stories.

Missing inputs leave their share unused. They never increase another source's weight.

### Contribution

```
contribution = intensity × slotWeight × 2^(-ageHours / halfLifeHours)
```

The strongest **aggregate** emotion sets the face. Total the contributions by mood, pick the largest, and show **calm** when that score is below **0.18**.

Weather, air, wildlife, earthquakes, and EONET each contribute at most once. Only the newest eligible wildlife observation, newest eligible NASA event, and strongest current earthquake (by magnitude) can influence the mood. Other records remain browsable in Explore.

### Decay and expiry

| Group | Half-life | Expires |
| --- | --- | --- |
| News | 6 hours | 48 hours after publication **and** 48 hours after first interpretation |
| Weather | 3 hours | 6 hours after observation |
| Air quality | 3 hours | 6 hours after observation |
| Earthquakes | 6 hours | 24 hours after origin time |
| Wildlife | 24 hours | 7 days after observation |
| NASA events | 24 hours | 7 days after latest observation |

News ages from its **first interpretation time**, so a late interpretation does not make an old article young. Publication age is still enforced separately.

Measured inputs age from their own observation time, not from when they were fetched. NASA events use the latest geometry observation from EONET; the record also preserves the event's earliest known date for display.

### Persistence and idempotency

Observations and reactions live in IndexedDB (`murmur`, version 1) in the browser. The database stores observations, reactions, per-source status, and small metadata records. If IndexedDB is unavailable, the app falls back to an in-memory store and says so.

A reaction is saved once, keyed by its evidence. Reloading, checking for a new cache, polling, or seeing the same observation again:

- does not create a second reaction,
- does not change its intensity,
- does not reset its first interpretation time,
- does not make it stronger.

For repeated nature event IDs (iNaturalist observation IDs, EONET event IDs), the stored original date is the **earliest** date ever observed, even if upstream history shifts. The latest observation time may still advance.

### What each source contributes

- **Weather** — deterministic WMO-code and temperature rules (clear and mild → happy; rain → sad; storms → confused; heat → mad; cold → sad; overcast → calm).
- **Air quality** — deterministic US AQI bands, labeled as modeled.
- **Wildlife** — a small positive note for the newest research-grade observation within roughly 50 km.
- **Earthquakes** — modest concern for magnitudes 4.0+, with distance from Charlotte and the explicit statement that no local impact is assumed.
- **NASA EONET** — modest concern for open wildfires, severe storms, and volcanoes, without assuming casualties, damage, or danger to Charlotte.
- **News** — only the optional build-time model. No keyword sentiment fallback and no invented reaction when the model is off or unavailable.

---

## Reliability and statuses

The cache builder gives each source its own loader, deadline (12 s), byte ceiling (3 MiB JSON, 2 MiB feed), and status:

| Status | Meaning |
| --- | --- |
| `live` | The cache build got a fresh response with at least one valid record |
| `empty` | Structurally valid response with no eligible records |
| `cached` | A browser-side failure left older dated records in place |
| `malformed` | Envelope or fields were invalid |
| `unavailable` | Network failure, timeout, HTTP error, or the relay was missing |

Valid empty is distinct from malformed: an empty USGS feature array is empty; a missing feature array is malformed. An RSS channel with zero items is empty; an HTML error page is malformed.

Validation covers timestamps, geometry, eligibility, HTTPS links, text, news publication dates, and date-only observations. Failed sources do not block the others.

If the cache request fails, the page keeps every previously saved record and reaction and labels the failure. It does not substitute demo data.

---

## Privacy

- No accounts, analytics, trackers, or third-party scripts.
- No API keys in frontend code. The build-time model key lives only in GitHub Actions secrets.
- The browser downloads one same-origin JSON cache and stores observations and reactions in IndexedDB.
- The hourly cache contains only public records. Wildlife entries store the taxon, a coarse distance rounded to 5 km (or 10/100 km farther away), the observation link, and dates. They **do not** store observer identities, photos, place guesses, or precise coordinates.
- The browser never sends headlines anywhere. GitHub Actions sends only the headline, publisher, and story ID to the configured model while building the cache.
- The relay sets `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY`.

---

## Accessibility

- Semantic landmarks, headings, lists, tables, and native `<details>`/`<summary>`.
- Every face has an SVG `<title>` and `<desc>` describing the expression; the live and preview faces have unique IDs.
- Mood changes are announced through a polite live region; refresh results use a status role.
- Keyboard-operable buttons, filters, scenario previews, and native `<dialog>` focus management.
- Visible `:focus-visible` outlines and a skip link.
- `prefers-reduced-motion` disables the bob, blink, and transitions. A persistent **Reduce motion** toggle is also available.
- Status never relies on color alone: every chip and badge includes text.
- Responsive layout from narrow phones to wide desktops; touch targets are at least 36–46 px.

---

## Project structure

```
index.html                 Semantic shell and static controls
styles.css                 Lavender design system, face styles, reduced motion
src/
  config.js                Location, budgets, decay, feeds, publishers, cache URL
  main.js                  Bootstrap, cache refresh, rendering, events
  lib/
    time.js                Timestamp parsing, decay formula, Charlotte formatting
    validate.js            URL, text, coordinate, distance, entity validation
    parseFeed.js           Dependency-free RSS/Atom parser
    dedupe.js              Stable keys, headline normalization, dedupe
    weatherCodes.js        WMO labels and glyphs
  sources/
    http.js                Deadline and byte-bounded fetch helpers
    openMeteo.js           Weather and air quality adapters
    news.js                Feed adapter, classification, per-publisher loaders
    usgs.js                Earthquake adapter
    inaturalist.js         Wildlife adapter with privacy stripping
    eonet.js               Natural-event adapter
    loaders.js             All independent loaders
  interpret/
    rules.js               Deterministic measured reactions
    reactions.js           Reaction factory
  mood/
    engine.js              Eligibility, slots, caps, aggregation, explanations
  ai/
    buildNewsModel.js      OpenAI-compatible build-time client, retries, limits
    newsInterpretation.js  Prompt, strict output validation, cached-reaction checks
  app/
    runRefresh.js          Isolated ingest/reaction pipeline
    worldCache.js          Static cache fetching and validation
    sourceState.js         Browser source-state derivation
    settings.js            localStorage settings with validation
  store/
    indexedDb.js           IndexedDB adapter
    repository.js          Idempotent merge and reaction storage
    memoryStore.js         Test/fallback store with snapshots
  ui/
    face.js                Accessible animated SVG
    format.js              Shared labels, dates, status text
    moodView.js            Bubbles and mood line rendering
    panels.js              Conditions, availability, explore, breakdown
scripts/
  build-world-cache.js     Hourly snapshot builder
proxy/
  server.js                Static server + allowlisted relay
  allowlist.js             The complete upstream allowlist
.github/workflows/
  pages.yml                Hourly cache, tests, artifact, Pages deployment
tests/                     Decay, expiry, persistence, adapters, cache, model output
data/world-cache.json      Generated locally or in CI; gitignored
```

---

## Configuration

- **Location, budgets, decay, feeds, publishers, and previews:** `src/config.js`.
- **Relay allowlist:** `proxy/allowlist.js`.
- **Cache path and staleness threshold:** `WORLD_CACHE_URL` and `WORLD_CACHE_MAX_AGE_HOURS` in `src/config.js`.
- **News model:** `NEWS_MODEL_*` environment variables in `.github/workflows/pages.yml`; defaults live in `src/ai/buildNewsModel.js`.
- **Model API key:** the `ZAI_API_KEY` or `NEWS_MODEL_API_KEY` GitHub Actions secret. Never commit it.
- **Auto cache check interval and tick interval:** `AUTO_REFRESH_MS` and `TICK_MS` in `src/config.js`.
- **Hourly schedule:** `.github/workflows/pages.yml` (UTC cron).

If you add a feed, add it to `FEEDS` and add its origin/path prefix to the allowlist. Rebuild the cache after changing any source endpoint.

---

## Honest limitations

- The face is a fiction. It does not understand news, feel anything, or predict anything.
- News reactions require the optional build-time model. Without a key, when the model fails, or when no reaction passes validation, the 60% news budget is simply unused, which makes the face much quieter by design.
- Environmental reactions are hand-written rules, not analysis.
- Open-Meteo air quality is modeled, not measured by a local sensor.
- EONET is filtered to fires, severe storms, and volcanoes; other categories are ignored.
- iNaturalist requests research-grade, licensed, non-captive observations. Some eligible observations may still be omitted when the API lacks a usable date or link.
- No demo data is included or substituted. Empty and failed states are shown as such.
- GitHub cron is best-effort and can be delayed. Scheduled workflows may be disabled after 60 days of repository inactivity; run the workflow manually to re-enable the schedule.
- GitHub Pages serves assets with a ten-minute cache. The app accounts for this, but a newly deployed cache can take up to ten minutes to appear.
- Weather and air expire after six hours, so a badly delayed cache naturally removes them from the mood.
- Feed summaries are publisher-provided and may lag or change. Murmur never fetches article pages.
- The relay is for local development and CI. It has no authentication or rate limiting; do not expose it to the public internet.
- Times use `America/New_York`, which includes daylight saving changes.
- A single browser tab owns the data. Multiple tabs can open the same IndexedDB database; the app does not coordinate cache checks between them.

No Python is used anywhere.
