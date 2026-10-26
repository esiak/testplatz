# Epic 1 Context: Find every test centre near me

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Ship a free, static, bilingual (DE/EN) website where a person in Bavaria enters a town, postcode or their device location plus a radius and sees every BAMF-approved Einbürgerungstest centre in range: distance, address, map link and a direct link to the centre's test page. No dates are collected yet. Every centre shows as an uncovered "Not checked automatically" card, and that already saves the user from opening 5–10 provider sites to find out where they can test. The epic also lays the foundations later epics build on: the repo scaffold and stack, shared schemas, the polite HTTP client, the human-owned centre directory, the place table, the snapshot publish stage and the GitHub Pages deploy pipeline.

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

## Requirements & Constraints

- **Coverage:** every directory centre within the radius (straight-line distance from its stored coordinates) appears exactly once. In this epic all centres are `not_checked`, so each one renders as an uncovered card, ordered nearest first. Soonest/Nearest sorting arrives in Epic 2.
- **Radius:** 10 / 20 / 40 / 60 / 100 km, default 40.
- **Bavaria only:** only Bavarian place rows are searchable. A non-Bavarian place, or a device location outside the Bavaria boundary, shows the "Bavaria only" error.
- **Privacy:** the typed place and the device location never leave the browser. Matching and distance run client-side. At visit time the only requests are same-origin `snapshot.json` and `places.json`. There are no analytics, cookies or third-party requests at load, and Google Maps is contacted only when the user taps "Map ↗". Use `referrer` `no-referrer`; external links get `rel="noopener noreferrer"` and open in a new tab.
- **Shareable state:** the URL fragment carries `#q=<town>&r=<km>&lang=<lang>` (sort is added later). Never use the query string and never put coordinates in it. An unknown `r` snaps to the nearest allowed value. An unknown `q` shows place-not-found with the text filled in.
- **Honesty:** a gap must never read as "nothing available". When there are no dates, the page shows the count line "0 dates and M unchecked centres within R km" and a notice that these centres may still have dates on their own pages.
- **Results are static while open:** no auto-refresh and no re-sort. Reloading fetches new data.
- **Search only:** no booking, no provider accounts, no form submission to provider sites.
- **Polite fetching** (used by directory verification and geocoding): identified UA `bgtsearch-bot/<version> (+<About URL>)`, robots.txt respected, serial requests per host with delay and timeout. Nominatim is called manually, cached, at ≤ 1 req/s.
- **Directory:** about 116 centres seeded from rtpartner.de, each verified against the centre's own site. Entries that cannot be confirmed keep `verified_at: null` and are reported to the operator. `reader` is set from page fingerprints and defaults to `none` when unsure. Geocoding never guesses: an entry with no match, or a match outside Bavaria, is reported and left without coordinates.
- **Cost:** €0. Use only free tiers of a public GitHub repo, with no secrets beyond the default workflow token.
- **Private beta:** add a `noindex` meta tag and hide the Impressum/Privacy footer links.
- **Attribution:** show "Place data © OpenStreetMap contributors (ODbL)" in the footer, and credit Nominatim on the About page.
- **Accessibility:** WCAG AA contrast, full keyboard access, targets ≥ 44 px, and reflow at 320 px / 200% zoom with the longest German strings and text-spacing overrides.

## Technical Decisions

- **Paradigm:** a scheduled pipeline publishes a static snapshot, and a static Preact app serves it. There is no runtime backend.
- **Stack (pinned):** Node 26 (`.nvmrc`), TypeScript 6.0, Vite 8.3, Preact 11.0 via `npm create preact` (without ESLint), @preact/preset-vite 2.10, zod 4.6, cheerio 1.2 and Vitest 5.0. Use one root `package.json` with no workspaces.
- **Layout:** `shared/`, `pipeline/{fetch,readers/<system>,stages}`, `pipeline/config.ts`, `web/` (with `src/i18n/{de,en}.json`), `tools/` (geocode, build-places), `data/{directory,state,public}` and `.github/workflows/`.
- **Import rules (enforced by a test):** `readers` must not import `fetch` or `stages`; `web` must not import `pipeline` or `tools`; no project code may import `typescript`. `tools/` must do all HTTP through `pipeline/fetch`.
- **`shared/`** holds the zod schemas, enum codes, the place-name normaliser (folds case, umlauts and ß, so "Gunzburg" and "Guenzburg" both match Günzburg), haversine, and the time-threshold constants.
- **Directory (`data/directory/centres.json`)** is human-owned and the pipeline never writes it. Each entry has `centre_id` (a lowercase slug that is stable forever), name, address, lat/lon (nullable until geocoded), website, `test_page_url`, `reader` (`kuferweb` / `itemkg` / `none`), an optional typed `reader_config`, `opted_out`, `source` (`"rtpartner"`) and `verified_at`. CI validates it against the schema and fails on duplicate ids.
- **`snapshot.json`** has the shape `{ schemaVersion: 1, generated_at, systems: [], centres[], listings: [] }`. Every centre appears once with `coverage: "not_checked"` (opted-out centres are always `not_checked`), and `last_result`, `last_checked_at` and `last_success_at` are all `null`. Publish refuses to write output that fails the schema, so a failed run fails and the last good site stays live.
- **`places.json`** has rows `{ key, name, postcodes[], district, state, lat, lon }` for all of Germany, plus a simplified Bavaria boundary polygon. It is built offline by `tools/build-places` from an OSM-derived dataset; this story chooses the dataset and records the choice. Flag the file if it exceeds ~300 KB gzipped. The nearest-town lookup for "use my location" uses only Bavarian rows.
- **Schema versioning:** the app embeds the `schemaVersion` it expects. On a mismatch it reloads once, then shows the load-error state.
- **Card type is chosen from `coverage` first:** `not_checked` gives the uncovered card.
- **Codes in data, words in translation files:** CI fails on missing or extra i18n keys, and components contain no hard-coded UI text.
- **Conventions:** kebab-case files; ISO 8601 strings, never epoch numbers; `null` for missing values, never `"unknown"` strings or omitted keys.
- **Workflows:**
  - `ci.yml` runs tests, type-checks and the directory schema check. It ignores `data/state/**` and `data/public/**`.
  - `pipeline.yml` triggers on push to `main` and on dispatch; Epic 2 adds the schedule. It uses one concurrency group with `cancel-in-progress: false`, commits `data/public/` in one commit if anything changed, and deploys with `actions/deploy-pages` only from the pushed SHA.
- **Hosting:** repo `esiak/testplatz`, served at `https://esiak.github.io/testplatz/`. Vite `base` must match. The About URL on this host is the one named in the bot UA.

## UX & Interaction Patterns

- **Tokens:** every DESIGN.md colour (light and dark via `prefers-color-scheme`), typography (system font stack, rem sizes), spacing, radii and component value becomes a CSS custom property. No component uses literal colours or px font sizes. Controls use `min-height`, never a fixed height.
- **Focus ring:** 2 px in `action` with a 2 px offset on every focusable element. When the card link has focus, the ring surrounds the whole card; "Map ↗" and "Why?" get their own ring.
- **Layout:** a single column with 16 px gutters, centred at max 720 px.
  - The search bar is a field, a native radius select and a primary button. It sits on one row on wide screens; on phones the field gets its own row with radius and button below. It is not sticky.
  - Focus stays in the field after submit.
  - On first visit the field is focused and the h1 reads "Find Einbürgerungstest dates near you in Bavaria."
- **Uncovered card:**
  - The whole card is one stretched link to the test page (new tab).
  - Content: centre name in card-date style, a "Not checked" chip (unknown tint), and the address line with "Map ↗" (own 44 px target, 8 px dead zone, link name "Map: <address> (Google Maps, new tab)").
  - The body line reads "Not checked automatically. See the centre's page."
  - Key facts are a `dl` in the order Distance "24 km", Status "Not checked", Deadline "see website", Registration "see website". They show 4 across when each cell is ≥ 9em, otherwise 2×2.
  - The destination domain is followed by ↗ and is `aria-hidden`.
  - "Why?" is its own 44 px target linking to About `#not-checked`, named "Why is <centre> not checked?".
  - There is no freshness line and no nested links. The results are a `<ul>` with h3 per card.
- **States:**
  - Place not found: show up to three "Did you mean …?" links.
  - Outside Bavaria: show the Bavaria-only error.
  - Location denied: show "Error: Location not shared. Type a town or postcode instead." and focus the field.
  - Field errors use `role=alert` plus `aria-invalid` and `aria-describedby`, keep the input, and are prefixed with an icon and "Error".
  - No centres in radius: show "No test centres within 20 km." with a secondary "Search 40 km" button (full width on phones).
  - Loading: show up to 3 static skeletons (no shimmer), set `aria-busy`, and announce "Loading dates…" once.
  - Load failure: show "We couldn't load test dates. Try again." with a "Try again" button.
- **Live region:** one `role=status` present from page load announces the count line, the loading message and suggestion counts.
- **Suggestions:** an ARIA 1.2 combobox that opens after 2 characters and shows at most 6 rows (each ≥ 44 px). A row shows the town in body text, then postcode · district in meta. ↑/↓ move the highlight, Enter picks and searches, Escape closes. Pressing Enter without a pick searches if there is one match or an exact postcode; with several matches it shows "Several places match. Pick one."; with none it shows place-not-found.
- **Use my location:** a 44×44 icon button inside the right end of the field, hidden when the browser has no geolocation. While locating it announces "Finding your location…". On success the field reads "Near <town>" and the fragment holds that town.
- **Language switch:** "DE | EN" in the header. It switches instantly without a reload, keeps the search, updates `lang` in the fragment and keeps focus. The active link has `aria-current` and `lang`. The initial language follows the browser (German for any other language), and `<html lang>` follows the choice.
- **About the data:** h1, then h2 sections:
  - how it works;
  - centres not checked automatically at `#not-checked`, with the reasons and a linked list of centres;
  - sources;
  - attribution;
  - an opt-out link that opens a new GitHub issue from an "Opt-out request" template.

  The booking-system status section comes in Epic 3. The back button from About must return to the results with the search intact.
- **Banned patterns:** filters that drop items, separate "Open this date" buttons, nested links, infinite scroll, pop-ups or cookie walls, carousels, staleness banners, and custom pickers replacing native controls.
- **Microcopy:** all strings come from the EXPERIENCE.md voice-and-tone Do column, with the same meaning in DE and EN and no exclamation marks.

## Cross-Story Dependencies

- 1.1 (scaffold, `shared/`, workflows, deploy) comes before everything else.
- 1.2 (tokens, i18n, shell, footer) is needed by 1.7–1.10.
- 1.3 creates `pipeline/fetch` and the directory schema. 1.4 needs both, because geocoding goes through fetch.
- 1.3 and 1.4 produce the directory with coordinates that 1.6 publishes.
- 1.5 produces `places.json` and the shared normaliser, which 1.8, 1.9 and 1.10 need.
- 1.6 produces `snapshot.json`, which 1.7 (centre list) and 1.8 (results) need.
- 1.8 builds the search bar, results, fragment state and error states. 1.9 and 1.10 extend that search bar.
- Epic 2 later adds readers, merge/state, scheduled runs, result and no-dates cards, and the Soonest/Nearest sort. The schemas, the fetch client and the card-from-coverage logic must stay extensible for it. Epic 3 adds the booking-system status section on the About page.
