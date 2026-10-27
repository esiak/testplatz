# Epic 1 Context: Find every test centre near me

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Ship a free, static, bilingual (DE/EN) site where someone in Bavaria enters a town, postcode or their device location plus a radius, and sees every BAMF-approved Einbürgerungstest centre in range. Each centre shows its distance, address, a map link and a direct link to its test page. No dates are collected yet, so every centre renders as an uncovered "Not checked automatically" card. That alone saves opening 5–10 provider sites. The epic also lays the foundations later epics build on: the scaffold, shared schemas, the polite HTTP client, the human-owned directory, the place table, snapshot publish and the GitHub Pages deploy.

## Stories

- Story 1.1: Scaffold the project and deploy an empty site
- Story 1.2: Bilingual page shell with design tokens
- Story 1.3: Seed and verify the centre directory
- Story 1.4: Geocode centre addresses
- Story 1.5: Build the place table
- Story 1.6: Publish a snapshot of all centres
- Story 1.7: About the data page
- Story 1.8: Search a place and see every centre in range
- Story 1.9: Place suggestions while typing
- Story 1.10: Search from my location
- Story 1.11: Complete the place table

## Requirements & Constraints

- **Coverage:** every directory centre within the radius appears exactly once, measured as straight-line distance from its stored coordinates. In this epic all centres are `not_checked`, so all render as uncovered cards, nearest first.
- **Radius:** 10 / 20 / 40 / 60 / 100 km, default 40.
- **Bavaria only:** only Bavarian place rows can be searched. A non-Bavarian place, or a device location outside the Bavaria boundary, shows the "Bavaria only" error.
- **Privacy:** the typed place and the device location never leave the browser. At visit time the page requests only same-origin `snapshot.json` and `places.json`. No analytics, cookies or third-party requests; Google Maps loads only when the user taps "Map ↗". Referrer policy is `no-referrer`, and external links get `rel="noopener noreferrer"`.
- **Shareable state:** the URL fragment holds `#q=…&r=…&lang=…` (sort comes in Epic 2). Never the query string, never coordinates. An unknown `r` snaps to the nearest allowed value; an unknown `q` shows place-not-found with the text kept.
- **Honesty:** a gap must never read as "nothing available".
- **Static results:** results never refresh or re-sort while the page is open.
- **Scope:** search only. No booking, no provider accounts, no form submission to provider sites.
- **Cost and beta:** €0 on the free tiers of a public repo. During the private beta the page carries `noindex` and the Impressum/Privacy links are hidden.
- **Attribution:** the footer shows "Place data © OpenStreetMap contributors (ODbL)". Nominatim is credited on the About page.
- **Accessibility:** WCAG AA, full keyboard access, targets of at least 44 px, and reflow at 320 px / 200% zoom with the longest German strings.
- **Directory accuracy:** never guess. Entries that cannot be verified keep `verified_at: null`, and those with no geocode match or a match outside Bavaria keep null coordinates. Both are reported to the operator.

## Technical Decisions

- **Paradigm:** a batch pipeline publishes a static snapshot, which a static Preact app reads. There is no runtime backend.
- **Stack (pinned):** Node 26 (`.nvmrc`), TypeScript 6.0, Vite 8.3, Preact 11.0, @preact/preset-vite 2.10, zod 4.6, cheerio 1.2, Vitest 5.0. One root `package.json`, no workspaces.
- **Imports (enforced by a test):** `web` → `shared`; `tools` → `fetch` and `shared`; `readers` → `shared` only. `web` never imports `pipeline` or `tools`, and no project code imports `typescript`.
- **`shared/`** holds the zod schemas, codes, the one place-name normaliser (folds case, umlauts and ß), haversine and the 12 h / 24 h constants.
- **One polite HTTP path:** all outbound HTTP, from both pipeline and `tools/`, goes through `pipeline/fetch`. It sends the identified bot UA, checks robots.txt once per host per run, and fetches serially per host with a delay and a timeout. It also decodes charsets and refuses a centre host already visited 4 times in 24 h, based on the visit log in `data/state/`.
  - Exactly two robots exemptions, each an explicit per-client option passed only by its own tool: `tools/geocode` → Nominatim `/search` (manual, cached, ≤ 1 req/s, never scheduled); `tools/build-places` → Overpass `https://overpass-api.de/api/interpreter` (manual, cached, serial, ≥ 10 s apart, never scheduled). Every other host and path keeps full robots checks. The 4-visits-in-24-h cap applies to centre hosts only; Nominatim and Overpass are bounded by their usage rules.
- **Directory** (`data/directory/centres.json`) is human-owned, and the pipeline never writes it. Its fields: `centre_id` (a stable lowercase slug), name, address, lat/lon, website, `test_page_url`, `reader` (`kuferweb` / `itemkg` / `none`), a typed `reader_config`, `opted_out`, `source`, `verified_at`. CI validates the schema and rejects duplicate ids.
- **Public data contracts:** both are zod schemas in `shared/`, and the producer refuses to emit an invalid file.
  - `snapshot.json` is `{schemaVersion, generated_at, systems[], centres[], listings[]}`. Each centre carries `coverage` plus `last_result`, `last_checked_at` and `last_success_at`, all `null` in this epic. A centre is `not_checked` when its reader is `none`, it is opted out, or robots disallow it.
  - `places.json` is described under Story 1.5 below.
  - The app embeds the `schemaVersion` it expects. On a mismatch it reloads once, then shows the load error.
- **Card choice is coverage-first:** `not_checked` → uncovered card.
- **Codes in data, words in `web/src/i18n/{de,en}.json`:** CI fails on missing or extra keys.
- **Conventions:** kebab-case files; ISO 8601 strings, never epoch numbers; `null` for missing values, never `"unknown"` or omitted keys. An error that would make a published file invalid fails the run, so the last good site stays live.
- **Deploy:** `pipeline.yml` (push to `main` and dispatch, one concurrency group, no cancel-in-progress) commits `data/public/` in one commit and deploys only the pushed SHA via `actions/deploy-pages`. `ci.yml` ignores `data/state/**` and `data/public/**`. The site is served at `https://esiak.github.io/testplatz/`, and Vite `base` must match.
- **`places.json`:** `tools/build-places` builds it offline from OpenStreetMap via the Overpass API (ODbL), with a per-query cache in `data/places/cache/`, and the file is committed.
  - Rows are `{key, name, postcodes[], district, state, lat, lon}` covering all German municipalities and postcodes, plus a simplified Bavaria boundary polygon.
  - Search matches only rows with `state = BY`; a non-Bavarian match, or a device location outside the polygon, gives "Bavaria only". The nearest-town lookup uses only Bavarian rows. Every name match goes through the shared normaliser.
  - The current file is partial (`complete: false`; Bavaria, Schleswig-Holstein, Hamburg; no boundary). Story 1.11 completes it (`complete: true`, `missing: []`). If the file exceeds about 300 KB gzipped, flag it and consider lazy-loading or splitting.

## UX & Interaction Patterns

- **Tokens:** every DESIGN.md colour, type, spacing and radius value is a CSS custom property, with light and dark via `prefers-color-scheme`. Controls use `min-height`. The focus ring is 2 px `action` with a 2 px offset.
- **Layout:** a single column with 16 px gutters, max 720 px wide.
  - The search bar is a field, a native radius select and a primary button, not sticky. Focus stays in the field after submit.
  - On first visit the field is focused.
- **Uncovered card:**
  - The whole card is one stretched link to the test page, opening in a new tab.
  - It shows a "Not checked" chip and the address with "Map ↗" (its own 44 px target).
  - The body line reads "Not checked automatically. See the centre's page."
  - Key facts form a `dl`: Distance, Status, Deadline, Registration.
  - The destination domain is `aria-hidden`. "Why?" links to About `#not-checked`.
  - No freshness line and no nested links.
- **States:**
  - Field errors (`role=alert`, `aria-invalid`, input kept): place not found with up to 3 "Did you mean …?" links, outside Bavaria, location denied.
  - No centres in range: a "Search <next> km" button.
  - Loading: up to 3 static skeletons with `aria-busy`.
  - Load failure: a "Try again" button.
  - One `role=status` live region exists from page load.
- **Suggestions:** an ARIA 1.2 combobox that opens after 2 characters and shows at most 6 rows. Same-name towns show postcode · district.
- **Location:** a 44×44 button inside the field, hidden when the browser has no geolocation. On success the field fills with "Near <town>".
- **Language switch:** "DE | EN". It switches instantly, keeps the search and updates `lang` in the fragment.
- **Banned patterns:** filters that drop items, separate "Open" buttons, nested links, infinite scroll, pop-ups or cookie walls, carousels, staleness banners, custom pickers.

## Cross-Story Dependencies

- 1.1 comes first.
- 1.2 (tokens, i18n, shell) is needed by 1.7–1.10.
- 1.3 creates `pipeline/fetch` and the directory schema, which 1.4 uses for geocoding. Together they produce the directory that 1.6 publishes.
- 1.5 produces `tools/build-places`, a partial `places.json` and the shared normaliser, which 1.8–1.10 need. 1.11 completes the table (all states plus the Bavaria boundary) and must land before 1.8 ships the "Bavaria only" error and before 1.10.
- 1.6's `snapshot.json` feeds 1.7 and 1.8. 1.9 and 1.10 extend 1.8's search bar.
- Epic 2 adds readers, merge/state, the schedule, result and no-dates cards, and sorting, so schemas, fetch and the coverage-first card logic must stay extensible.
