# Epic 1 Context: Find every test centre near me

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Ship a free, static, bilingual (DE/EN) site where someone enters a Bavarian town or postcode plus a radius and sees every BAMF-approved Einbürgerungstest centre in range, each with distance, address, a map link and a direct link to its test page. No dates are collected yet, so every centre renders as an uncovered "Not checked automatically" card, which already saves opening 5–10 provider sites. The epic also lays the foundations later epics build on: scaffold, shared schemas, the polite HTTP client, the human-owned directory, the place table, snapshot publish and the GitHub Pages deploy. On 2026-10-28 the operator deferred "Search from my location" (1.10) and "Complete the place table" (1.11) out of this epic, because the public Overpass run is too slow and fails; the epic closes with 1.1–1.9 plus 1.12, which fixes the search bugs the Epic 1 retrospective found.

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
- Story 1.12: Search shows every centre and the right place

(Deferred out of Epic 1: 1.10 Search from my location, 1.11 Complete the place table.)

## Requirements & Constraints

- **Coverage:** every directory centre in range appears exactly once, by straight-line distance from its stored coordinates. All centres are `not_checked` in this epic, so all render as uncovered cards, nearest first. A centre with no coordinates must never silently vanish: show it with Distance "unknown" (never guessed) after the distanced cards when its postcode or city matches the searched place, and otherwise surface it via a notice and About `#no-location`.
- **Radius:** 10 / 20 / 40 / 60 / 100 km, default 40.
- **Bavaria only:** only Bavarian rows are searched. A place that matches only outside Bavaria shows "Bavaria only" and must never be swapped for a similarly named Bavarian town. Bavarian names with a qualifier ("Lindau (Bodensee)") must resolve from their leading words before any non-Bavarian exact match is considered.
- **Privacy:** typed place never leaves the browser. At visit time only same-origin `snapshot.json` and `places.json` are requested; no analytics, cookies or third-party requests; Google Maps loads only on tap. `no-referrer`; external links `rel="noopener noreferrer"`.
- **Shareable state:** fragment `#q=…&r=…&lang=…` only, never the query string or coordinates. Unknown `r` snaps to the nearest allowed value; unknown `q` shows place-not-found with the text kept.
- **Honesty:** a gap must never read as "nothing available". Results never refresh or re-sort while open.
- **Scope/cost:** search only, €0 on free tiers. Private beta: `noindex`, Impressum/Privacy links hidden.
- **Attribution:** footer "Place data © OpenStreetMap contributors (ODbL)"; Nominatim credited on About.
- **Accessibility:** WCAG AA, full keyboard access, ≥ 44 px targets, reflow at 320 px / 200% zoom with the longest German strings.
- **Directory accuracy:** never guess. Unverified entries keep `verified_at: null`; unmatched or out-of-Bavaria geocodes keep null coordinates and are reported. Hand-set coordinates (no geocode-cache record) must not break `npm test`, which gates publishing.

## Technical Decisions

- **Paradigm:** batch pipeline → static snapshot → static Preact app; no runtime backend.
- **Stack (pinned):** Node 26 (`.nvmrc`), TypeScript 6.0, Vite 8.3, Preact 11.0, @preact/preset-vite 2.10, zod 4.6, cheerio 1.2, Vitest 5.0; one root `package.json`.
- **Imports (test-enforced):** `web` → `shared`; `tools` → `fetch`, `shared`; `readers` → `shared` only. Nothing imports `typescript`.
- **`shared/`:** zod schemas, codes, the one place-name normaliser (case, umlauts, ß), haversine, 12 h / 24 h constants.
- **One polite HTTP path** (`pipeline/fetch`) for pipeline and `tools/`: bot UA, robots.txt once per host per run, serial per host with delay/timeout, charset decoding, ≤ 4 visits per centre host per 24 h. Only two robots exemptions, each opt-in by its own tool: `tools/geocode` → Nominatim `/search` (≤ 1 req/s, cached, manual); `tools/build-places` → Overpass interpreter (serial, ≥ 10 s apart, cached, manual).
- **Directory** (`data/directory/centres.json`) is human-owned; the pipeline never writes it. CI validates schema and rejects duplicate `centre_id`s.
- **`snapshot.json`:** `{schemaVersion, generated_at, systems[], centres[], listings[]}`; each centre carries `coverage` plus `last_result`/`last_checked_at`/`last_success_at` (all `null` here). Card choice is coverage-first; `not_checked` → uncovered card. App reloads once on `schemaVersion` mismatch, then shows the load error.
- **`places.json`:** built offline by `tools/build-places` from OSM via Overpass with a cache in `data/places/cache/`; rows `{key, name, postcodes[], district, state, lat, lon}` plus a Bavaria boundary. It stays partial (`complete: false`, no boundary) while 1.11 is deferred; non-Bavarian municipalities are filled in as name+state-only rows from the cached Overpass index (no new requests). Flag if > 300 KB gzipped.
- **Codes in data, words in `web/src/i18n/{de,en}.json`;** CI fails on missing/extra keys.
- **Conventions:** kebab-case files; ISO 8601 strings; `null` for missing values. An error that would make a published file invalid fails the run, so the last good site stays live.
- **Deploy:** `pipeline.yml` (push/dispatch, one concurrency group, no cancel-in-progress) commits `data/public/` once and deploys only the pushed SHA via `actions/deploy-pages` to `https://esiak.github.io/testplatz/` (Vite `base` matches). `ci.yml` ignores `data/state/**` and `data/public/snapshot.json`, but runs on `places.json` and `data/directory/**` changes.

## UX & Interaction Patterns

- **Tokens:** all DESIGN.md colours, type, spacing, radii as CSS custom properties, light/dark via `prefers-color-scheme`; `min-height` on controls; 2 px `action` focus ring, 2 px offset.
- **Layout:** single column, 16 px gutters, max 720 px. Search bar = field + native radius select + primary button, not sticky; focus stays in the field; field focused on first visit.
- **Uncovered card:** whole card one stretched link to the test page (new tab); "Not checked" chip; address with "Map ↗" (own 44 px target); "Not checked automatically. See the centre's page."; key facts as `dl` (Distance, Status, Deadline, Registration); `aria-hidden` destination domain; "Why?" → About `#not-checked`; no freshness line, no nested links.
- **States:** field errors (`role=alert`, `aria-invalid`, input kept) for place not found (≤ 3 "Did you mean …?"), outside Bavaria, several places match; no centres in range → "Search <next> km"; loading → ≤ 3 static skeletons with `aria-busy`; load failure → "Try again". One `role=status` region from page load.
- **Suggestions:** ARIA 1.2 combobox, opens after 2 characters, ≤ 6 rows, same-name towns show postcode · district; Enter without a pick searches one match, prompts "Several places match. Pick one." for several.
- **Language switch:** "DE | EN", instant, keeps search, updates `lang` in the fragment.
- **Banned:** filters that drop items, separate "Open" buttons, nested links, infinite scroll, pop-ups/cookie walls, carousels, staleness banners, custom pickers.

## Cross-Story Dependencies

- 1.1 first; 1.2 (tokens, i18n, shell) underpins 1.7–1.9 and 1.12.
- 1.3 builds `pipeline/fetch` and the directory schema; 1.4 geocodes with it; 1.6 publishes the result.
- 1.5 provides `tools/build-places`, the partial `places.json` and the shared normaliser used by 1.8, 1.9 and 1.12.
- 1.12 fixes bugs where 1.4 + 1.8 (centres without coordinates dropped) and 1.5 + 1.9 (partial place table, single-suggestion auto-search) interact; it touches search matching, the About page (`#no-location`), `tools/build-places`, the directory tests and `ci.yml`. Operator task alongside: fix or hand-set the 8 missing coordinates listed in `data/directory/geocode-note.md`.
- Deferred 1.10 depends on deferred 1.11 (Bavaria boundary); see `implementation-artifacts/deferred-work.md`.
- Epic 2 adds readers, merge/state, schedule, result/no-dates cards and sorting; keep schemas, fetch and coverage-first card logic extensible.
