---
title: 'Story 1.8: Search a place and see every centre in range'
type: 'feature'
created: '2026-10-28'
status: 'done'
review_loop_iteration: 0
baseline_commit: '32249e91e73e05a2bb67f291fde829a10834e746'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/EXPERIENCE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The search page (`web/index.html` → `App`) shows only its h1. Nobody can enter a town or postcode and see the test centres near them, which is the product's core job (FR1, FR2, FR4, FR11, FR27, FR28, FR30–FR32, NFR2).

**Approach:** Build the search page: a search bar (field, native radius select, primary button), place resolution against same-origin `places.json`, straight-line distance (shared haversine) to every snapshot centre, and a nearest-first list of uncovered cards, with all field, empty, loading and load-failure states. The search state lives in the URL fragment `#q=…&r=…&lang=…`.

## Boundaries & Constraints

**Always:**
- Page: h1 `search.heading`, then a `<form role="search">` with a visible `<label>` for the text field ("Town or postcode") and for a native `<select>` ("Radius") with options 10 / 20 / 40 / 60 / 100 km (default 40), and a primary submit `<button>` ("Search"). One row at ≥ 37.5em width; below it the field takes its own row and radius + button share the next. Not sticky. The field is focused on mount. Submitting never leaves the page (`preventDefault`); after every user-triggered search (submit, "Search N km", "Try again") focus is in the field. Changing the select alone does not search. An empty or whitespace-only submit does nothing.
- Data: on mount, fetch `${BASE_URL}snapshot.json` and `${BASE_URL}places.json` once, in parallel, each validated with its zod schema (`snapshotSchema`, `placesSchema`). These are the only network requests the page makes. Nothing refetches by itself; results never refresh or re-sort while the page is open. Only "Try again" refetches.
- Place resolution (all name comparisons through `normalizePlaceName`):
  - 5-digit input → rows whose `postcodes` include it; otherwise → rows whose normalised `name` equals the normalised input.
  - If any matching row has `state === 'BY'` → found; use the matching BY row with the lowest `key`.
  - Matches exist but none is BY → outside Bavaria: "Error: This site covers Bavaria only. You can only take the test in your own state."
  - No match → place not found: "Error: We don't know this place. Try a Bavarian town or postcode." plus up to 3 "Did you mean {name}?" links. Suggestions come only from BY rows and only for non-digit input: distinct names whose normalised form starts with the normalised input (input ≥ 2 characters), then those within Levenshtein distance ≤ 2 of it; ordered prefix matches first, then by distance, then `localeCompare(…, 'de')`. Each link's `href` is the fragment `#q=<name>&r=<current r>&lang=<lang>`; following it runs that search.
- Field messages: one `<p role="alert">` under the field, linked by `aria-describedby`; the input gets `aria-invalid="true"` and keeps its text. An error replaces any results. The message is stored as a code so a language switch re-renders it.
- Results: every snapshot centre with non-null `lat`/`lon` whose haversine distance from the found row's `lat`/`lon` is ≤ the radius, exactly once, as an uncovered card, ordered by distance, then `name` (`localeCompare(…, 'de')`), then `centre_id`. Distance shows as whole km (`Math.round`), e.g. "24 km". Results are a `<ul>` of cards.
- Above the list: count line "{dates} dates and {unchecked} unchecked centres within {radius} km" (`dates` is always 0 in this epic; use a singular variant when `unchecked` is 1: "…and 1 unchecked centre within…"), then the notice "No dates found nearby. These centres may still have dates on their own pages." Both in body text; the notice in `--notice-line-color`, no background.
- One `role="status"` element exists from page load (visually hidden). It announces "Loading dates…" once when a search waits for data, then the count line (or the no-centres line) after each search.
- No centres in range: "No test centres within {radius} km." and, unless the radius is 100, a `button-secondary` "Search {next} km" that sets the radius to the next allowed value and reruns the search.
- Loading: when a search is pending and data is not yet loaded, show 3 static skeleton cards (result-card outline, three `--color-surface-muted` bars, no animation) inside a list container with `aria-busy="true"`; the search runs as soon as data arrives.
- Load failure (network error, non-2xx, bad JSON, schema mismatch of either file), shown when a search is pending or attempted: "We couldn't load test dates. Try again." in `--color-error` with `role="alert"`, and a `button-secondary` "Try again" that refetches both files, then runs the pending search.
- `schemaVersion` mismatch (either file's JSON has a `schemaVersion` other than the one the app embeds): reload the page once, guarded by a `sessionStorage` flag; if the flag is already set, or `sessionStorage` throws, show the load-failure state instead. A successful load clears the flag.
- Uncovered card (`li > article`), fixed content order:
  - h3 centre name (`lang="de"`, `--font-card-date`) and a "Not checked" chip (unknown variant, `aria-hidden`).
  - Address line `street, postcode city` (meta, selectable, sits above the card's link layer) and "Map ↗" → `https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(address)>`, `target="_blank"`, `rel="noopener noreferrer"`, aria-label "Map: {address} (Google Maps, new tab)", ≥ 44 × 44 px target with 8 px clearance.
  - Body line "Not checked automatically. See the centre's page."
  - Key facts `<dl>`: Distance "24 km", Status "Not checked", Deadline "see website", Registration "see website" — four across when each cell gets `--space-fact-cell-min`, else 2 × 2.
  - Bottom row: destination line `{domain} ↗` (hostname without a leading `www.`, `aria-hidden`), and "Why?" → `${BASE_URL}about/#not-checked=&lang=<lang>` in the same tab, aria-label "Why is {name} not checked?", ≥ 44 px target.
  - The whole card is one stretched link: the link is the h3's `<a>` to `test_page_url ?? website`, `target="_blank"`, `rel="noopener noreferrer"`, aria-label "{name}, not checked, opens {domain} in a new tab". "Map ↗" and "Why?" are siblings above the link layer, never nested in it. When the card link has `:focus-visible`, the focus ring is drawn around the whole card. No freshness line.
  - A centre with neither URL: h3 is plain text, no destination line, no stretched link; everything else as above.
- Fragment: every submitted search (including ones that end in a field error) writes `#q=<trimmed input>&r=<km>&lang=<lang>` with `history.replaceState`; never coordinates, never the query string. On mount and on every `hashchange`, if the fragment's `q` (non-empty) or `r` differs from the last search run, fill the field and select and run that search; a change of only `lang` never reruns. `r` snapping: missing or non-numeric → 40; otherwise the nearest allowed value, ties → the larger. The language switch keeps the search (Story 1.2 `withLang`).
- All UI text from `web/src/i18n/{de,en}.json` (same keys, formal "Sie", no `!`). Centre names, addresses and domains are the only non-catalogue text. Styles only via tokens in `web/src/styles/base.css`; the design-tokens literal scanner must pass (no px, no `height:`, no inline styles). Targets ≥ 44 px; reflow at 320 px / 200 % zoom with the longest German strings and the longest centre name (89 chars), light and dark.

**Never:**
- No place suggestions/combobox or "Several places match" (Story 1.9), no location button (Story 1.10), no sort or booked-out toggle (Epic 2/3), no result or no-dates cards, no freshness line.
- No new dependencies, no third-party request at page load, no `web` import outside `shared`, no analytics/cookies/`localStorage`.
- No change to the About page's behaviour (it keeps showing its error on a version mismatch, without reloading).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Town | "Nürnberg", 20 km | every centre with coordinates ≤ 20 km, nearest first, as uncovered cards; count line + notice | N/A |
| Spelling variant | "nuernberg" / "NÜRNBERG" | same as "Nürnberg" | N/A |
| Postcode | "90443" | rows containing that postcode; lowest-key BY row used | N/A |
| Name in BY and another state | a name present as BY and SH rows | the BY row is searched | N/A |
| Non-Bavarian | "Kiel" or "24103" | Bavaria-only alert, input kept, `aria-invalid` | no results shown |
| Unknown | "Nurnbreg" | not-found alert + up to 3 "Did you mean …?" links (BY only) | link runs that search |
| Unknown digits | "12" | not-found alert, no suggestions | N/A |
| Centre without coordinates | `lat: null` | never listed | N/A |
| Centre without URLs | both null | card without link and destination; Map and Why? present | N/A |
| Nothing in range | radius 10, no centre ≤ 10 km | "No test centres within 10 km." + "Search 20 km" | button reruns at 20 km |
| Nothing at 100 km | no centre ≤ 100 km | no-centres line, no button | N/A |
| Shared link | `#q=Augsburg&r=20&lang=en` | English, field "Augsburg", 20 km, results | N/A |
| Bad radius | `r=35` / `r=30` / `r=abc` / none | 40 / 40 / 40 / 40, fragment rewritten on run | N/A |
| Unknown place in link | `#q=Atlantis` | not-found alert, field "Atlantis" | N/A |
| Data still loading | submit before fetch settles | 3 skeletons, `aria-busy`, "Loading dates…" announced once | search runs on arrival |
| Load fails | network error / 500 / bad JSON / schema error | load-failure alert + Try again | Try again refetches and runs the search |
| Version mismatch | `schemaVersion: 2`, no flag | `location.reload()` once, flag set | flag set → load-failure state |
| Language switch | results showing, DE → EN | same cards, English text, fragment `lang=en`, no rerun | N/A |
| Did-you-mean | click link | hashchange → search runs for that name | N/A |

</intent-contract>

## Code Map

- `web/src/app.tsx` -- today `SearchPage` renders only `<h1>{t('search.heading')}</h1>` inside `I18nProvider titleKey="search.title"` + `PageShell page="search"`. Keep `App({ catalogues })` (tests inject sentinel catalogues); replace `SearchPage` with the new page component.
- `web/src/i18n/i18n.tsx` -- `useI18n()` → `{ lang, hash, t, setLang }`; `hash` updates on `hashchange` and on `setLang` (via `replaceState`, which fires no `hashchange`). `MessageKey = keyof en.json`: new keys must exist in both JSONs.
- `web/src/fragment.ts` -- `parseFragment`, `serialiseFragment`, `withLang`. Build the search fragment with these.
- `web/src/data/snapshot.ts` -- `SNAPSHOT_URL`, `loadSnapshot(fetchImpl)` (throws on any failure; About relies on this). Make a version mismatch throw a distinguishable error (e.g. a `SchemaVersionError` class) while keeping every other failure a plain throw; About's catch stays unchanged.
- New `web/src/data/places.ts` -- `PLACES_URL`, `loadPlaces(fetchImpl)` mirroring `loadSnapshot` with `placesSchema` and the same version-error class.
- New `web/src/data/reload-once.ts` (or inside the page module) -- the sessionStorage-guarded reload, with `storage` and `reload` injectable for tests.
- `shared/places.ts` -- `placesSchema`, `PlaceRow`, `normalizePlaceName`, `PLACES_SCHEMA_VERSION`. Search uses only `state === 'BY'` rows for found/suggestions. `isInBoundary` is for Story 1.10, unused here.
- `shared/snapshot.ts` -- `snapshotSchema`, `SnapshotCentre` (fields: `name`, `address {street, postcode, city}`, `lat`/`lon` nullable, `website`/`test_page_url` nullable, `coverage`). Its doc comment says the app embeds `SNAPSHOT_SCHEMA_VERSION` — use it.
- New `shared/geo.ts` -- `haversineKm(lat1, lon1, lat2, lon2)` (mean Earth radius 6371.0088 km). The epic context places haversine in `shared/`; none exists yet.
- New `web/src/search/` -- suggested split: `search.ts` (pure: `RADII`, `DEFAULT_RADIUS`, `snapRadius`, `resolvePlace`, `didYouMean`, `centresInRange`, `parseSearchFragment`, `searchFragment`, `destinationDomain`, `mapsUrl`), `search-page.tsx`, `search-bar.tsx`, `uncovered-card.tsx`. Kebab-case file names.
- `web/src/i18n/en.json`, `de.json` -- existing keys to reuse: `card.not_checked_automatically`, `card.destination` ("{domain} ↗"), `error.place_not_found`, `link.external_mark`. Change `results.none_in_radius` to "No test centres within {radius} km." (the EXPERIENCE "Try 40 km" Do-string still matches its pattern in `tests/i18n.test.ts`). Unused sample keys (`status.*`, `freshness.*`, `card.not_checked_right_now`) stay.
- `web/src/styles/base.css` -- add search bar, field message, count/notice, card, chip, key facts, skeleton, visually-hidden and button styles. Tokens exist for all of them in `tokens.css` (`--search-bar-*`, `--button-primary-*`, `--button-secondary-*`, `--result-card-*`, `--key-facts-row-*`, `--status-chip-unknown-*`, `--address-line-*`, `--destination-line-*`, `--notice-line-*`, `--field-message-*`, `--space-fact-cell-min`). Media queries use `em`, never px (`tests/design-tokens.test.ts` flags any px value and any `height:`).
- `tests/shell.test.tsx` -- sentinel "no hard-coded UI text" loop renders `App` with sentinel catalogues; it must now stub `fetch` (both URLs) and add the search page's initial, loading, results, not-found (with suggestions), outside-Bavaria, no-centres and load-failure states, allowing centre names, addresses, domains and place names as data text. `stubFetch`, `settle`, `pendingFetch` helpers already exist there.
- `tests/fixtures/snapshot.ts` -- `snapshotCentre`, `coveredCentre`, `snapshotOf`, `jsonResponse` fixture builders; add a small places fixture alongside (`tests/fixtures/places.ts`).
- `tests/site-config.test.ts` -- `snapshot URL` block shows how to assert a production-base URL (`vi.stubEnv` + `vi.resetModules` + dynamic import); add the same for `PLACES_URL` → `/testplatz/places.json`.
- `data/public/places.json` -- partial (`complete: false`): BY 2142 rows, SH 1104, HH 1; other states absent until Story 1.11. `data/public/snapshot.json` -- 119 centres, 8 with null coordinates, 5 with neither URL, longest name 89 chars.

## Tasks & Acceptance

**Execution:**
- [x] `shared/geo.ts` -- `haversineKm` -- the one distance function (AD: shared holds haversine).
- [x] `web/src/data/snapshot.ts`, new `web/src/data/places.ts`, reload-once helper -- loaders with a distinguishable version-mismatch error; About behaviour unchanged.
- [x] `web/src/search/search.ts` -- pure search logic per Always (resolution, suggestions, range filter and order, radius snapping, fragment read/write, domain, maps URL).
- [x] `web/src/search/search-bar.tsx`, `uncovered-card.tsx`, `search-page.tsx`; `web/src/app.tsx` -- the page, states, live region, fragment sync, focus rules.
- [x] `web/src/i18n/en.json`, `de.json` -- all new copy (labels, radius option "{km} km", submit, count line + singular variant, notice, loading, load error, retry, "Search {radius} km", outside-Bavaria, did-you-mean, chip, fact labels/values, "see website", distance "{km} km", Map label, Why? + its label, card link label); change `results.none_in_radius`.
- [x] `web/src/styles/base.css` -- tokens only; one-row/two-row search bar at 37.5em; stretched-link card with whole-card focus ring (`:has(:focus-visible)`); Map/Why above the link layer; key facts 4 → 2 × 2; `min-width: 0` + `overflow-wrap: anywhere` on names, addresses and domains so nothing widens the page at 320 px.
- [x] `tests/geo.test.ts` -- zero distance, symmetry, a known pair (München 48.1374, 11.5755 → Nürnberg 49.4521, 11.0767 ≈ 151 km ± 2).
- [x] `tests/search.test.ts` -- every matrix row at the logic level with fixtures; plus the committed `data/public/places.json` + `snapshot.json` (read with `node:fs`): a BY town resolves, results are sorted, every listed centre is within the radius, every centre with coordinates within the radius is listed exactly once — expectations derived from the files, never fixed counts (the publish job runs `npm test` before `npm run pipeline`).
- [x] `tests/search-page.test.tsx` (happy-dom, stubbed `fetch`) -- every matrix row at the UI: card structure and attributes (link `target`/`rel`/aria-label, no `a a`, Map href and label, Why? href with `lang`, `dl` facts, `lang="de"` on names), count line incl. singular, notice, single `role="status"` present before any search, alerts with `aria-invalid`/`aria-describedby`, focus in the field after submit / Search N km / Try again, fragment written with `replaceState`, hashchange rerun, lang-only change does not rerun, reload-once flow (injected storage/reload), only the two same-origin URLs fetched, no refetch after results (advance timers).
- [x] `tests/site-config.test.ts` -- `PLACES_URL` under the production base.
- [x] `tests/shell.test.tsx` -- stub `fetch` for the search page; add its states to the sentinel loop.

**Acceptance Criteria:**
- Given the built site at `/testplatz/`, when I search "Nürnberg" with 20 km, then I see the uncovered cards of the Nürnberg-area centres nearest first, the count line and the notice, and the URL ends `#q=N%C3%BCrnberg&r=20&lang=…` (or the `+`/percent form `URLSearchParams` produces).
- Given a card, when I tap "Why?" and then go back, then About opens at `#not-checked` and back returns to the same results.
- Given the page at load and after a search, when I inspect network requests, then the only data requests are same-origin `/testplatz/snapshot.json` and `/testplatz/places.json`, and nothing loads from Google until "Map ↗" is tapped.
- Given 320 px and 1280 px at 200 % zoom, German, light and dark, when results show, then `document.documentElement.scrollWidth <= clientWidth`, and every interactive target is ≥ 44 px.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 31 findings — high 0, medium 1, low 21, false 9, maybe-false 0
- findings:
  - `[low]` `[patch]` Status region keeps the previous count line after a field error (BH) — confirmed in `show()`; patched: the announcement is cleared on a field error.
  - `[low]` `[patch]` A repeated identical field error is not re-announced (BH) — the `role="alert"` stays mounted with the same text; patched: the alert remounts per search, with a test.
  - `[low]` `[reject]` Language switch re-reads the count line (BH) — re-announcing the count in the newly chosen language is acceptable; avoiding it adds state.
  - `[low]` `[reject]` "Did you mean" uses the live select radius and adds a history entry (BH) — the spec's Always says the href is `#q=<name>&r=<current r>&lang=…`; only form-driven searches use `replaceState`.
  - `[low]` `[reject]` Removing `q` from the fragment leaves old results (BH) — needs a manual URL edit (every search entry carries `q`); the fix adds a reset branch.
  - `[low]` `[reject]` Ambiguous names resolve silently (BH) — deliberate until Story 1.9 (Design Notes, "Several matches before Story 1.9").
  - `[low]` `[reject]` Reload after a version mismatch may hit the HTTP cache / older data (BH) — the spec fixes reload-once; Pages revalidates HTML after 10 minutes; a direction check and cache directives add branches for a rare deploy race.
  - `[low]` `[reject]` Reload flag sticks after mismatch → reload → network failure (BH) — needs two failures in one tab; the flag is per tab and clears on the next good load.
  - `[low]` `[reject]` No focus ring without `:has()` (BH) — every browser in support has `:has()` since 2023; an `@supports` fallback adds rules for none in use.
  - `[false]` `[reject]` Covered centres would be labelled "Not checked" (BH) — `pipeline/stages/publish.ts` emits `coverage: 'not_checked'` for every centre in Epic 1 (all 119 in the committed snapshot); Epic 2 adds the other card types with the coverage-first rule.
  - `[low]` `[patch]` Data-file tests weaker than their names (BH) — the misspelling test can return early; patched with a deterministic misspelling and unconditional assertions. The first-200-postcodes and same-filter points are rejected: they still catch a wrong state or an unsorted list, and widening them adds runtime only.
  - `[low]` `[reject]` Ad-hoc plurals (BH) — `dates` is always 0 in Epic 1; Epic 2 owns the date count and its plural forms.
  - `[false]` `[reject]` Load effect deps covered only by a comment (BH) — `services` come from `App` props fixed at mount; no caller passes new ones.
  - `[false]` `[reject]` Re-normalising the whole table per search (BH) — about 2,100 short strings per submit is well under a frame; no measured harm.
  - `[false]` `[reject]` Bavarian town missing from the partial table wrongly gets "Bavaria only" (ECH) — `missing` lists no `ags-09*` query; every Bavarian prefix is present.
  - `[low]` `[reject]` "Berlin" gets not-found with Bavarian suggestions (ECH) — the documented partial-table state (Design Notes); Story 1.11 adds the rows and the code then shows "Bavaria only" unchanged.
  - `[low]` `[reject]` `hashchange` without `q` leaves stale state (ECH) — same as the BH fragment row.
  - `[low]` `[patch]` "Search N km" after editing the field leaves the edited text beside old results (ECH) — confirmed (`fill: false`); patched to `fill: true`.
  - `[low]` `[reject]` Suggestion href uses the unsubmitted radius (ECH) — same as the BH did-you-mean row.
  - `[false]` `[reject]` Page stays loading if `reload()` does not navigate (ECH) — `location.reload()` always navigates in a browser; only a test stub does not.
  - `[low]` `[patch]` "Loading dates…" re-announced on repeated submits while loading (ECH) — confirmed against the spec's "announced once"; patched: loading is announced only when no search was pending.
  - `[false]` `[reject]` Covered centres counted as unchecked (ECH) — same refutation as the BH coverage row.
  - `[medium]` `[patch]` `whyUrl` under the production base is untested (VG, pre-verified) — a dropped `BASE_URL` would 404 every "Why?" link in production; patched: `site-config.test.ts` asserts `/testplatz/about/#not-checked=&lang=en`.
  - `[low]` `[patch]` Re-announcing an identical count line is not pinned (VG, pre-verified) — patched: the spelling-variants test asserts a new status child per search.
  - `[low]` `[patch]` Stale status text after a field error (VG other) — same root cause as the BH status row; same patch.
  - `[low]` `[patch]` Data-file misspelling test can assert nothing (VG other) — same as the BH weak-tests row; same patch.
  - `[false]` `[reject]` No evidence the manual browser checks ran (IA) — the implementation report records `vite preview` checks: Nürnberg 20 km, network, 320 px with the 89-char name, dark mode, did-you-mean, whole-card focus ring.
  - `[low]` `[reject]` "Bavaria only" ships before Story 1.11 (IA) — documented dependency; the message logic is final and correct for present states; recorded as a residual risk for the release order.
  - `[false]` `[reject]` Always exactly 3 skeletons vs "up to 3" (IA) — 3 satisfies "up to 3", and the spec fixes 3.
  - `[low]` `[reject]` Did-you-mean adds a history entry (IA) — same as the BH did-you-mean row.
  - `[false]` `[reject]` `services` prop on `App` is an unrequested surface (IA) — an optional test seam with production defaults; no user-visible effect.

## Design Notes

**Centres without coordinates are left out.** Distance is "straight-line from the centre's stored coordinates"; with none stored, whether a centre is in range is unknowable, and the directory rule is never to guess. They stay listed on About (not checked) and are reported to the operator by the geocode tooling.

**Partial place table (Story 1.11 dependency).** The epic says 1.11 must land before 1.8 *ships* "Bavaria only". The logic here is final; with today's partial file, a town from a missing state (e.g. Berlin) has no row and gets "not found" instead of "Bavaria only". `placesSchema` documents exactly this: absent states are unknown, not outside. Nothing in the code needs to change when 1.11 completes the file.

**Several matches before Story 1.9.** Story 1.9 adds "Several places match. Pick one." Until then, the lowest-key BY row is used, so the same input always gives the same results and a shared link reproduces them.

**Why the fragment keeps the typed text, not the resolved name:** an unknown `q` must show place-not-found with the text filled in, and postcode searches should share as postcodes.

**Stretched link sketch:**
```css
.card { position: relative; }
.card__link::after { content: ''; position: absolute; inset: 0; }
.card__address, .card__why { position: relative; z-index: 1; }
.card:has(.card__link:focus-visible) { outline: var(--focus-ring-width) solid var(--focus-ring-color); outline-offset: var(--focus-ring-offset); }
```
The link's own outline must not be removed with `outline: none` (the scanner flags it); suppress it by matching the card rule instead, e.g. `.card__link:focus-visible { outline-color: transparent; }`.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run build` -- expected: all exit 0.

**Manual checks (if no CLI):**
- `npm run preview`, open `/testplatz/#q=N%C3%BCrnberg&r=20&lang=de` in the browser pane: results render; Map and Why? are separate targets; card opens in a new tab; at 320 px and 1280 px/200 % zoom, light and dark, no horizontal scroll; network shows only same-origin requests; "Kiel" gives Bavaria only; "Nurnbreg" gives suggestions.

## Auto Run Result

- **Summary:** The search page now works. Enter a Bavarian town or postcode and a radius (10 / 20 / 40 / 60 / 100 km, default 40), and every centre with coordinates in range appears once as an uncovered card, nearest first. Above the list are the count line ("0 dates and M unchecked centres within R km") and the no-dates notice. Field errors show "Bavaria only", or "not found" with up to 3 "Did you mean …?" links. The page also handles no centres in range (with a "Search N km" button), loading skeletons, a load failure with Try again, and a reload-once on a `schemaVersion` mismatch. The search is kept in the URL fragment `#q=…&r=…&lang=…`, so shared links reproduce it. The only requests are same-origin `snapshot.json` and `places.json`.
- **Files changed:**
  - `shared/geo.ts`: new; `haversineKm`.
  - `web/src/data/load-json.ts`: new; shared loader and `SchemaVersionError`.
  - `web/src/data/places.ts`: new; `PLACES_URL` and `loadPlaces`.
  - `web/src/data/reload-once.ts`: new; the reload-once guard (sessionStorage).
  - `web/src/data/snapshot.ts`: uses the shared loader; About behaviour unchanged.
  - `web/src/search/search.ts`: new; pure logic (resolve, suggestions, range, radius snapping, fragment, card helpers).
  - `web/src/search/search-bar.tsx`, `uncovered-card.tsx`, `search-page.tsx`: new; the UI and its states.
  - `web/src/app.tsx`: renders the search page; optional test `services`.
  - `web/src/i18n/i18n.tsx`: `replaceHash`, so the language links follow search fragments.
  - `web/src/fragment.ts`, `web/src/about-page.tsx`: `NOT_CHECKED_ID` moved into `fragment.ts` (About re-exports it).
  - `web/src/i18n/en.json`, `de.json`: the search copy; `results.none_in_radius` changed.
  - `web/src/styles/base.css`: search bar, cards, key facts, skeletons, states; tokens only.
  - `shared/snapshot.ts`: comment only.
  - Tests:
    - new: `tests/geo.test.ts`, `tests/search.test.ts`, `tests/search-page.test.tsx`, `tests/fixtures/places.ts`;
    - extended: `tests/shell.test.tsx`, `tests/site-config.test.ts`, `tests/snapshot-loader.test.ts`, `tests/i18n.test.ts`.
- **Review:** 1 pass, no loopback, 31 findings (high 0, medium 1, low 21, false 9).
  - **Patched:** 7 entries, at verdicts medium 1 and low 6.
    - A production-base test for the "Why?" URL (medium).
    - The status region is cleared on a field error.
    - "Loading dates…" is announced once.
    - "Search N km" refills the field.
    - A repeated field error is announced again.
    - A test pins re-announcing the count line.
    - The data-file misspelling test is deterministic.
  - **Deferred:** none.
  - **Rejected:** the rest, with reasons in the Review Triage Log. The main groups:
    - "Did you mean" links use the current select and add a history entry (as the spec says).
    - Stale state after removing `q` by hand.
    - Silent pick among same-name towns (Story 1.9).
    - Cache and direction edge cases of reload-once.
    - No `:has()` fallback.
    - Plurals for dates (Epic 2).
    - Covered-centre cards (false: every Epic 1 centre is `not_checked`).
- **Follow-up review recommended:** false. One medium patched, which is a test-only addition; no high.
- **Verification:**
  - `npm run typecheck`, `npm test` (565 passed, 1 skipped — the Story 1.5 boundary test, until Story 1.11), `npm run build`: all exit 0, after the patches.
  - Every I/O-matrix row has a passing test.
  - The implementation agent checked `vite preview` in the browser pane before the patches:
    - Nürnberg 20 km gave 9 cards.
    - The only data requests were `/testplatz/snapshot.json` and `/testplatz/places.json`.
    - At 320 px there was no horizontal scroll (also with the 89-character name), and every target was ≥ 44 px.
    - Dark mode and the did-you-mean flow worked.
    - The whole-card focus ring showed.
  - The browser checks were not repeated after the small patches.
- **Residual risks:**
  - The place table is still partial (Story 1.11). Towns from states not in the file yet (e.g. Berlin) get "We don't know this place" instead of "Bavaria only". The epic wants 1.11 to land before this ships, and pushing to `main` deploys.
  - Same-name Bavarian towns silently use the lowest-key row until Story 1.9.
  - The key facts switch from 2 × 2 to four across through a container query at `39em`. That value is hard-coded, because tokens cannot be used in query conditions.
  - The search page bundle includes zod and validates about 450 KB of `places.json` on load.
