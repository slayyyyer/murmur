# Murmur

A small animated face in Charlotte, North Carolina that reacts to public weather, modeled air quality, world news, local news, earthquakes, nearby wildlife observations, and open natural events.

Murmur's mood is a **simulated emotional state**. It is a clock-driven calculation, not sentience, not a measurement of public opinion, and not a factual summary of the world. Every influence decays; nothing is refreshed into a stronger state by reloading.

Plain HTML, CSS, and JavaScript ES modules. No framework, no build step, no runtime dependencies, and no Python.

---

## Run it

Requires **Node.js 18.17+** (or Bun). The included server is dependency-free.

```bash
cd murmur
npm start
```

Open <http://127.0.0.1:8080>.

With Bun:

```bash
bun proxy/server.js
```

Optional environment variables:

```bash
PORT=8081 npm start          # different port
HOST=0.0.0.0 npm start       # expose to your local network (for phone testing)
```

The app must be served through this server. It provides the same-origin CORS relay that several feeds require. Opening `index.html` from the filesystem will leave news and earthquakes unavailable, because the relay routes do not exist there.

### Tests

```bash
npm test
# or
bun tests/run.js
```

There is no install step. Tests use only `node:assert` and the project's ES modules.

---

## What is on screen

- **Face and mood** — happy, sad, mad, confused, or calm, drawn as an inline animated SVG.
- **Mood sentence** — a short description of the current simulated mood.
- **Three thought bubbles** — the strongest active influences, with source and decayed strength. Empty bubbles say so instead of inventing an influence.
- **Charlotte weather and modeled air quality** — current observation, source link, observation time, and whether it is outside the six-hour mood window.
- **Refresh world** — manual refresh, with a ten-minute automatic refresh and a status line explaining what each source did.
- **Source availability** — one chip per source with live/cached/empty/malformed/unavailable state and a direct link.
- **Explore the world** — expandable, filterable by nine news topics plus weather, air, earthquakes, wildlife, and NASA events. Distinguishes active reactions from recorded-but-not-governing inputs. Each record shows source, link, original date, update/retrieval dates, and status.
- **Sources and mood** — expandable ledger of each emotion's strength, supporting records, per-group budgets, news slot allocation, publisher caps, source statuses, and the calculation rules.
- **Expression preview** — five clearly fictional scenarios, fixed by hand. They never affect the live mood.

All times are displayed in Charlotte's time zone.

---

## Sources

| Input | Provider | Endpoint | Browser access |
| --- | --- | --- | --- |
| Charlotte weather | Open-Meteo | `https://api.open-meteo.com/v1/forecast` | Direct, CORS `*` |
| Modeled air quality | Open-Meteo | `https://air-quality-api.open-meteo.com/v1/air-quality` | Direct, CORS `*` |
| World news | BBC | `https://feeds.bbci.co.uk/news/...` | Via local relay (no CORS header) |
| World news | Al Jazeera | `https://www.aljazeera.com/xml/rss/all.xml` | Via local relay (no CORS header) |
| Science and space | NASA | `https://www.nasa.gov/feed/` | Via local relay for consistency |
| World and topics | The Guardian | `https://www.theguardian.com/.../rss` | Via local relay (no CORS header) |
| Community and progress | Positive News | `https://www.positive.news/feed/` | Via local relay (no CORS header) |
| Charlotte and Carolinas | WFAE | `https://www.wfae.org/news.rss` | Via local relay (no CORS header) |
| Recent earthquakes | USGS | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson` | Via local relay, with IPv4 preference |
| Wildlife and plants | iNaturalist | `https://api.inaturalist.org/v1/observations` | Direct, CORS `*` |
| Fires, storms, volcanoes | NASA EONET | `https://eonet.gsfc.nasa.gov/api/v3/events?status=open` | Direct, CORS `*` |

Endpoints were checked before integration. All are public and keyless. Open-Meteo's air quality is a **modeled** field, not a local sensor, and the UI says so.

### Why a relay exists

BBC, Al Jazeera, The Guardian, Positive News, and WFAE do not send `Access-Control-Allow-Origin`, so a browser cannot read them directly. The included server exposes exactly one relay route:

```
GET /api/proxy?url=<allowlisted HTTPS URL>
```

`proxy/allowlist.js` lists every permitted origin and path prefix. The relay:

- accepts `GET`/`HEAD` only,
- requires HTTPS with no credentials, IP literal, or non-default port,
- rejects paths containing `..`,
- validates redirects against the same allowlist (Guardian topic feeds redirect to `/us/...`),
- uses a 12-second deadline and a 3 MiB ceiling,
- accepts only feed/JSON/text content types,
- returns no cookies and sets no-store,
- prefers IPv4 when resolving, so a broken IPv6 route on a host cannot take down the USGS feed (this was observed during development).

The USGS feed supports CORS, but it is routed through the relay for that IPv4 reliability. If you change a feed URL, update both `src/config.js` and `proxy/allowlist.js`.

The proxy is a local convenience, not a public service. It binds to `127.0.0.1` by default and has no request-body handling.

---

## Optional local model (Ollama)

News needs a model to become an emotional influence. Without one, headlines are still collected, dated, linked, and browsable, but they do **not** affect the mood; the interface labels that state explicitly. Weather, air, earthquakes, wildlife, and EONET continue working because their rules are deterministic.

1. Install Ollama from <https://ollama.com/>.
2. Allow this page's origin, then start the server:

   macOS / Linux:

   ```bash
   OLLAMA_ORIGINS=http://localhost:8080 ollama serve
   ```

   Windows PowerShell:

   ```powershell
   $env:OLLAMA_ORIGINS="http://localhost:8080"; ollama serve
   ```

   If you use `http://127.0.0.1:8080` instead, include that exact origin too.

3. Pull a small instruction model:

   ```bash
   ollama pull llama3.1
   ```

4. In Murmur, open **Model settings**, set the endpoint (`http://localhost:11434`) and model, choose **Interpret world news with this model**, and press **Test connection**.
5. Save, then **Refresh world**. Newly eligible headlines are interpreted in batches of eight, up to sixteen per refresh.

No API key is used or stored. The browser calls the endpoint directly; there is no server-side key. If you point the app at a remote model endpoint, that endpoint must allow the app origin and must not require a secret embedded in frontend code.

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

The perspective values compassion, cooperation, curiosity, and fairness. `mad` means fair-minded frustration at unfairness or harm, never hatred.

Output is rejected if it contains an unknown story ID, a duplicate ID, a mood outside `happy/sad/mad/confused`, an intensity outside 0–1, an empty or overlong text, a URL, a digit, a quotation mark, or words asserting casualties or harm (`killed`, `injured`, `destroyed`, `safe`, `confirmed`, and similar). A rejected item simply does not become a reaction. This is a heuristic guard, not a truth check; the prompt is the primary constraint.

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

A reaction is saved once, keyed by its evidence. Reloading, refreshing, polling, or seeing the same observation again:

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
- **News** — only the optional local model. No keyword sentiment fallback and no invented reaction when the model is off.

---

## Reliability and statuses

Each source has its own loader, deadline (12 s), byte ceiling (3 MiB JSON, 2 MiB feed), and status:

| Status | Meaning |
| --- | --- |
| `live` | Fresh response with at least one valid record |
| `empty` | Structurally valid response with no eligible records |
| `cached` | Fetch failed, but dated records from a previous success are retained |
| `malformed` | Envelope or fields were invalid (for example HTML instead of a feed) |
| `unavailable` | Network failure, timeout, HTTP error, or the relay is missing |

Valid empty is distinct from malformed: an empty USGS feature array is empty; a missing feature array is malformed. An RSS channel with zero items is empty; an HTML error page is malformed.

Validation covers:

- timestamps (finite, plausible, not implausibly future),
- geometry (latitude/longitude ranges, depth sanity),
- eligibility (research grade, not captive, open EONET event, allowed category),
- links (HTTPS only, no credentials, no IP literals, no non-default ports),
- text (tags stripped, control characters removed, bounded length),
- news publication dates (required, within the ingest window),
- date-only observations (flagged and labelled "date only").

Failed sources do not block other sources. `runRefresh` runs all loaders concurrently and converts a thrown loader into that loader's status.

---

## Privacy

- No accounts, analytics, trackers, or third-party scripts.
- No API keys in frontend code. The optional model needs none.
- Observations and reactions stay in the browser's IndexedDB.
- Wildlife records store the taxon, a coarse distance rounded to 5 km (or 10/100 km farther away), the observation link, and dates. They **do not** store observer identities, photos, place guesses, or precise coordinates. The distance is computed transiently from the API response and discarded.
- Headlines leave the browser only when a local model is explicitly configured, and then only to the endpoint you entered.
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
  config.js                Location, budgets, decay, feeds, publishers, previews
  main.js                  Bootstrap, refresh orchestration, rendering, events
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
    newsInterpretation.js  Ollama client, prompt, strict output validation
  app/
    runRefresh.js          Isolated fetch/ingest/reaction pipeline
    sourceState.js         Cached/live/malformed state derivation
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
proxy/
  server.js                Static server + allowlisted relay
  allowlist.js             The complete upstream allowlist
tests/                     Decay, expiry, persistence, adapters, model output
```

---

## Configuration

- **Location, budgets, decay, feeds, publishers, and previews:** `src/config.js`.
- **Relay allowlist:** `proxy/allowlist.js`.
- **Model endpoint and model name:** the in-app Model settings dialog (stored in `localStorage`).
- **Auto refresh interval and tick interval:** `AUTO_REFRESH_MS` and `TICK_MS` in `src/config.js`.
- **Batch limits:** `NEWS_BATCH_SIZE` and `NEWS_BATCHES_PER_REFRESH` in `src/config.js`.

If you add a feed, add it to `FEEDS` and add its origin/path prefix to the allowlist. If a feed has CORS enabled, the adapter still uses the relay by design, so the proxy must permit it.

---

## Honest limitations

- The face is a fiction. It does not understand news, feel anything, or predict anything.
- News reactions require the optional model. Without it, the 60% news budget is simply unused, which makes the face much quieter by design.
- Environmental reactions are hand-written rules, not analysis. Weather and air rules are intentionally simple.
- Open-Meteo air quality is modeled, not measured by a local sensor.
- EONET is filtered to fires, severe storms, and volcanoes; sea/lake ice and other categories are ignored.
- iNaturalist requests research-grade, licensed, non-captive observations. Some eligible observations may still be omitted when the API lacks a usable date or link.
- No demo data is included or substituted. Empty and failed states are shown as such.
- The model validator blocks numbers, quotes, URLs, and common harm claims in reaction text. That reduces invented detail but cannot prove a reaction is well-judged.
- Feed summaries are publisher-provided and may lag or change. Murmur never fetches article pages.
- The relay is a local development convenience. It has no authentication, rate limiting, or multi-user isolation; do not expose it to the public internet.
- Times use `America/New_York`, which includes daylight saving changes.
- A single browser tab owns the data. Multiple tabs can open the same IndexedDB database; the app does not coordinate refreshes between them.

No Python is used anywhere.
