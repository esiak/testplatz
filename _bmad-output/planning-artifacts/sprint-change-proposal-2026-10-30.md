# Sprint Change Proposal — Measure distance to each test date's own address

- **Date:** 2026-10-30
- **Author:** Eleni (decision), drafted with the Developer agent
- **Trigger:** Stories 2.3/2.4 readers (each date carries its own address) and Story 2.7 result cards (distance still comes from the centre)
- **Mode:** Batch
- **Scope:** Moderate (two new stories in Epic 2, an architecture amendment; Developer agent implements)
- **Status:** Approved by Eleni on 2026-10-30; edits 4.1–4.7 applied

## 1. Issue Summary

Every test date has its own address: the place where the test happens. Search and distance still use the **centre's** coordinates, so a date held in another town is filtered and measured as if it were at the centre.

**Evidence (snapshot of 2026-10-30, 92 listings, 25 distinct test addresses):**

- 52 of 92 listings have an address that differs from the centre address. Most differ only in spelling ("Löwenstraße" vs "Löwenstr."), but some are in other towns:
  - `vhs-starnberger-see-e-v`: centre in 82319 Starnberg, tests in 82211 Herrsching (about 15 km away).
  - `vhs-der-gemeinden-im-landkreis-roth`: centre in 91161 Hilpoldstein, tests in 91154 Roth.
  - `vhs-ebersberger-land-grafing-bei-muenchen`: centre in 85567 Grafing, tests in 85560 Ebersberg.
  - `vhs-fichtelgebirge`: tests at Ludwigsmühle 10, 95100 Selb. The centre is listed at 95615.
  - Bad Kissingen and Beilngries: tests at a different street in the same town.
- So a user searching "Herrsching, 10 km" doesn't see the Herrsching dates, and "Starnberg, 10 km" shows them with the wrong km.

**Category:** a misunderstanding of the original requirements. The spec always said "full address of the test location" (CAP-2), but CAP-1 and AD-2 measured distance from the centre.

**Decisions (operator, 2026-10-30):**

1. **Search by test address.** Each date is filtered and measured by its own test address.
2. **Centre as placeholder.** The centre's coordinates are used only when a date has no test address (the reader couldn't parse one) or its address can't be located.
3. **The pipeline geocodes.** The daily run looks up only *new* test addresses on Nominatim. Results are cached in `data/state/`, requests are paced at ≤ 1 per second, and each run has a lookup cap. This amends AD-5, which until now allowed Nominatim only from the manual `tools/geocode`.
4. **Out-of-range centres are left out.** A covered centre whose current dates are all at addresses outside the radius doesn't appear, even if its own address is inside. A centre outside the radius appears if one of its test addresses is inside.

## 2. Impact Analysis

### Checklist summary

| Item | Status | Note |
|---|---|---|
| 1.1 Trigger | [x] | Readers 2.3/2.4 emit per-date addresses; 2.7 cards measure from the centre |
| 1.2 Problem | [x] | Misread requirement: distance must use the test location |
| 1.3 Evidence | [x] | Snapshot analysis above |
| 2.1 Current epic | [x] | Epic 2 can still finish; it gains 2 stories |
| 2.2 Epic changes | [!] | Add Stories 2.10 and 2.11; amend goal notes and FR coverage |
| 2.3 Future epics | [x] | Epic 3: no change (3.2 counts and 3.4 alerts work per card). Epic 4: privacy text unchanged, because geocoding is server-side and has nothing to do with users |
| 2.4 Obsolete/new epics | [N/A] | None |
| 2.5 Order | [!] | Build 2.10 → 2.11; 2.9 (sort) can come before or after, since it sorts by each card's distance |
| 3.1 Spec (PRD) | [!] | CAP-1 and CAP-4 success criteria; `data-sources.md` listing fields and geocoding |
| 3.2 Architecture | [!] | AD-2, AD-5, AD-6, AD-8, AD-9; pipeline diagram and layer table |
| 3.3 UX | [!] | Wording only: "Distance" is to the test address. No layout change |
| 3.4 Other | [!] | `epic-2-context.md` must be regenerated; `pipeline/config.ts` gets a lookup cap; snapshot `schemaVersion` 2 → 3 |
| 4.1 Direct adjustment | Viable | Low–medium effort, low risk |
| 4.2 Rollback | Not viable | Nothing to revert; listings already carry addresses |
| 4.3 MVP review | Not needed | MVP gets more accurate, not bigger |
| 6.4 sprint-status.yaml | [N/A] | No sprint-status file exists; stories are tracked in `epics.md` |

### Epic impact

- **Epic 2 (in progress, 2.1–2.8 done, 2.9 backlog):** two new stories. 2.10 locates each test date in the pipeline. 2.11 makes search and distance use it in the web app. 2.5's address fallback stays and gains a coordinates fallback in 2.10.
- **Epic 1 (done):** no code change. Story 1.12's rule for centres without coordinates (postcode/city match, Distance "unknown") still applies. It now covers dates that have neither venue nor centre coordinates.
- **Epics 3 and 4:** no change.

### Story impact

| Story | Status | Change |
|---|---|---|
| 2.5 Normalise and merge | done | Planning text only: coordinates fallback is added by 2.10 |
| 2.7 Result cards | done | Code changed by 2.11 (Distance from the listing) |
| 2.9 Sort | backlog | "Distance" means each card's distance (no AC change, clarified in a note) |
| **2.10 Locate each test date** | **new** | Pipeline geocodes test addresses, listing gets coordinates, schema v3 |
| **2.11 Search by test location** | **new** | Web filters and measures dated cards by their own coordinates |

### Technical impact

- **`pipeline/`:** new stage `pipeline/stages/locate.ts` between normalise and merge. The Nominatim lookup and the acceptance rules move out of `tools/geocode.ts` into `pipeline/fetch/nominatim.ts`, which both use (tools → fetch is an allowed import). `pipeline/config.ts` gains `LOCATE_MAX_LOOKUPS_PER_RUN`.
- **`data/state/`:** new bot-owned `venues.json`, the cache of test-address lookups (hits and misses with `fetched_at`). Only merge writes it (AD-6).
- **`shared/`:** listing gains `lat`, `lon` (nullable) and `location` (`venue` | `centre`). Snapshot `schemaVersion` 3.
- **`web/`:** `web/src/search/search.ts` and `results.ts` select dated cards per listing and no longer per centre. The count line, no-centres state and notices count by card.
- **Cost / privacy:** €0. The user's place still never leaves the browser. Nominatim sees only provider addresses, from the pipeline.

## 3. Recommended Approach

**Direct adjustment.** Add two stories to Epic 2 and amend the spec, architecture and UX wording in place.

- **Effort:** Medium-low. One pipeline stage that reuses the existing geocoder, one schema field set, and a change to the search selection.
- **Risk:** Low.
  - Nominatim downtime or a miss never fails the run: the date falls back to the centre.
  - The first run makes about 25 lookups. After that it only looks up new addresses.
  - Main risk: free-text addresses that the structured lookup can't parse. These fall back to the centre and are listed in the run log.
- **Timeline:** +2 stories in Epic 2. Epic 3 can still start after Epic 2 closes.
- **Alternatives considered:**
  - Operator-run geocoding: keeps AD-5 unchanged, but new venues stay wrong until someone runs the tool. Rejected.
  - Centre-based inclusion with venue km only: simpler, but still hides Herrsching dates from a Herrsching search. Rejected.

## 4. Detailed Change Proposals

### 4.1 Spec — `specs/spec-einbuergerungstest-search/SPEC.md`

**CAP-1 success**

OLD:
`- **success:** For a Bavarian town and radius, results include every centre in the directory within that radius; Soonest orders dated results by date then distance, Nearest by distance then date; each result shows its km value and a Google Maps link to its address; past test dates are not listed.`

NEW:
`- **success:** For a Bavarian town and radius, results include every current test date whose test address is within that radius, and every centre without current dates whose own address is within it; a date's position is its test address, or its centre's address only when the date has no test address or it cannot be located; Soonest orders dated results by date then distance, Nearest by distance then date; each result shows its km value and a Google Maps link to its address; past test dates are not listed.`

**CAP-4 success**

OLD:
`- **success:** A search covering an uncovered centre lists it with that marker; no directory centre within the radius is ever absent.`

NEW:
`- **success:** A search covering an uncovered centre lists it with that marker; no directory centre within the radius is ever absent, except a covered centre whose current dates are all at test addresses outside the radius.`

**Assumptions: add**

`- Test addresses published on provider pages can be located by Nominatim's structured search ("street, postcode city"); those that cannot fall back to the centre's position.`

Rationale: operator decisions 1, 2 and 4.

### 4.2 Spec — `specs/spec-einbuergerungstest-search/data-sources.md`

**Listing fields table: replace the `address` row and add two rows after it**

OLD:
`| address | yes | full street address of the test location; falls back to the centre address |`

NEW:
```
| address | yes | full street address of the test location; falls back to the centre address |
| lat, lon | no | coordinates of the test address (geocoded by the pipeline); the centre's coordinates when the date has no address or it cannot be located; `null` only if neither is known |
| location | yes | `venue` when lat/lon come from the test address, `centre` when they are the centre's placeholder |
```

**Centre directory: after "Centre coordinates: …" add**

`- Test-address coordinates: the daily pipeline geocodes each new test address once with Nominatim (structured search, ≤ 1 req/s, capped per run, attribution), caches hits and misses in bot-owned state, and never re-queries a cached address; a miss is retried after 30 days. An address equal to the centre's reuses the centre's coordinates without a request.`

**User location: second bullet**

OLD:
`- Matching and straight-line distance run in the browser; no runtime geocoding service.`

NEW:
`- Matching and straight-line distance run in the browser; no runtime geocoding service. Distance is measured to each date's test-address coordinates (centre coordinates for centre-only cards); all geocoding of provider addresses happens in the pipeline, never in the browser.`

### 4.3 Architecture — `ARCHITECTURE-SPINE.md`

**Pipeline diagram:** insert `L[locate<br/>test-address coordinates]` between `N` and `M` (`N --> L --> M`), and add `ST <--> L` (cache read).

**Layer table, `stages` row**

OLD: `| stages | \`pipeline/stages/\` | normalise, merge, publish. |`
NEW: `| stages | \`pipeline/stages/\` | normalise, locate, merge, publish. |`

**AD-2 rule**

OLD: `Place matching and distance (haversine, km, from centre coordinates) run in \`web/\`.`
NEW: `Place matching and distance (haversine, km) run in \`web/\`: a result card measures from its listing's coordinates, a no-dates or uncovered card from its centre's coordinates.`

**AD-5: add a third exemption after the Overpass bullet**

`- \`pipeline/stages/locate\` calls only Nominatim's \`/search\` (scheduled, but only for test addresses not yet in the \`data/state/venues.json\` cache, serial, ≤ 1 req/s, at most \`LOCATE_MAX_LOOKUPS_PER_RUN\` per run). It uses the same lookup and acceptance rules as \`tools/geocode\` (\`pipeline/fetch/nominatim.ts\`). A failed or skipped lookup never fails the run; the listing falls back to its centre's coordinates. Operator decision of 2026-10-30.`

…and change `\`tools/geocode\` calls only Nominatim's \`/search\` (manual, cached, ≤ 1 req/s, never scheduled)` → `\`tools/geocode\` calls only Nominatim's \`/search\` for centre addresses (manual, cached, ≤ 1 req/s, never scheduled)`. Also change "exactly two robots exemptions" → "exactly three robots exemptions".

**AD-6: add a bullet**

`- Merge also persists the test-address cache (\`data/state/venues.json\`) from locate's new lookups; locate only reads it.`

**AD-8, card selection: amend the `covered` with current listings line**

OLD: `- \`covered\` with current listings → result cards;`
NEW: `- \`covered\` with current listings → one result card per listing whose own coordinates are in range (the centre is absent if none are);`

**AD-9, each listing**

OLD: `… Its \`address\` is already filled from the centre address when the provider gives none.`
NEW: `… Its \`address\` is already filled from the centre address when the provider gives none, and it carries \`lat\`, \`lon\` (nullable) and \`location\` (\`venue\` | \`centre\`) from locate.`

**Capability map, CAP-1 row:** `\`web/\`, \`places.json\`` → `\`web/\`, \`places.json\`, \`pipeline/stages/locate\``; governed by `AD-1, AD-2, AD-5, AD-9, AD-11`.

### 4.4 Requirements — `planning-artifacts/epics.md`

**FR2**

OLD: `FR2: Results contain every directory centre within the radius, by straight-line distance from the centre's coordinates, each appearing exactly once as a result card (one per current date), a no-dates card, or an uncovered card. (CAP-1, CAP-4, CAP-10)`

NEW: `FR2: Results contain one result card for every current date whose test-address coordinates are within the radius, plus one no-dates or uncovered card for every centre without current dates whose own coordinates are within it; distance is straight-line. A date uses its centre's coordinates only when it has no test address or the address cannot be located. A covered centre whose current dates all lie outside the radius does not appear. (CAP-1, CAP-4, CAP-10)`

**FR4**

OLD: `FR4: Each card shows its distance in km and a "Map ↗" link …`
NEW: `FR4: Each card shows its distance in km (to the test address on result cards, to the centre on other cards) and a "Map ↗" link …`

**New FR36 (after FR35)**

`FR36: Each test date's address is geocoded by the pipeline with Nominatim (structured search, ≤ 1 req/s, only addresses not yet cached, capped per run); hits and misses are cached in bot-owned state; a date whose address is missing or cannot be located takes its centre's coordinates and is marked \`location: centre\`. A lookup failure never fails the run. (CAP-1, CAP-2)`

**Additional Requirements**

- OLD: `- Search state in URL fragment; distance via haversine from centre coordinates in the browser (AD-2).`
  NEW: `- Search state in URL fragment; distance via haversine in the browser, from each listing's coordinates for result cards and from centre coordinates otherwise (AD-2).`
- OLD: `- Single polite HTTP path (AD-5) in \`pipeline/fetch\`, also used by \`tools/\`; …`
  NEW: `- Single polite HTTP path (AD-5) in \`pipeline/fetch\`, also used by \`tools/\`; Nominatim allowed only from \`tools/geocode\` (centres, manual) and \`pipeline/stages/locate\` (new test addresses, cached, capped); …`

**FR Coverage Map: add** `FR36: Epic 2 - Test-address coordinates`. Change FR2 to `Epic 1 (all centres as cards) + Epic 2 (result and no-dates cards, per-date location)`.

**Epic 2 list entry:** add FR36 to "FRs covered" and append to Notes: `Stories 2.10–2.11 (added 2026-10-30, sprint change proposal) locate each date by its own test address and make search and distance use it; build 2.10 before 2.11. 2.9 sorts by each card's distance and can land before or after them.`

### 4.5 New stories — `planning-artifacts/epics.md` (append after Story 2.9)

```
### Story 2.10: Locate each test date

As a user,
I want each test date placed at the address where the test happens,
So that distance and the radius reflect where I actually have to go.

**Acceptance Criteria:**

**Given** the Nominatim lookup in `tools/geocode.ts`
**When** this story is done
**Then** the structured `/search` request, the `NominatimHit` parsing and the acceptance rules (street-level, inside Bavaria, matching postcode) live in `pipeline/fetch/nominatim.ts`, `tools/geocode.ts` uses them unchanged in behaviour, and its tests still pass

**Given** normalised listings in a run
**When** the new stage `pipeline/stages/locate` runs (after normalise, before merge)
**Then** each listing gets `lat`, `lon` and `location`:
- a provider address that matches its centre's formatted address (after the shared address normaliser: case, "Str." / "Straße", whitespace) takes the centre's coordinates with `location: venue`, no request;
- an address found in `data/state/venues.json` uses the cached result, no request;
- otherwise an address of the form "street, NNNNN city" is looked up once via Nominatim; an accepted hit gives `location: venue`
(FR36)

**Given** a listing whose address came from the centre fallback, does not parse as "street, NNNNN city", or has no accepted Nominatim hit
**When** locate runs
**Then** it takes its centre's `lat`/`lon` (which may be `null`) with `location: centre`; nothing is guessed, and the run log lists each such address once with its reason

**Given** Nominatim lookups in a run
**When** locate sends them
**Then** they go through `pipeline/fetch` with the Nominatim exemption only, serially, ≥ 1 s apart, at most `LOCATE_MAX_LOOKUPS_PER_RUN` (in `pipeline/config.ts`, default 50); addresses beyond the cap fall back to the centre this run and are tried next run
**And** a timeout, non-2xx or invalid response caches nothing, falls back to the centre, and never fails the run or a centre (AD-5)

**Given** this run's lookups
**When** merge runs
**Then** it writes them to `data/state/venues.json` (keyed by the normalised address; hit or miss with `fetched_at`), validated by its own schema; a cached miss is retried after 30 days; locate never writes state (AD-6)

**Given** publish
**When** it writes `snapshot.json`
**Then** every listing carries `lat`, `lon` and `location`, `schemaVersion` becomes 3, and `web/` is updated in the same commit to accept it (it may keep measuring from the centre until Story 2.11) (AD-9)

**Given** the current snapshot's addresses
**When** tests run
**Then** fixtures cover: same-as-centre address (no request), cached hit, new hit, rejected hit (wrong postcode), unparseable address, Nominatim down, cap reached, centre without coordinates

### Story 2.11: Search by test location

As a person searching near my town,
I want dates to count as nearby when the test is held nearby,
So that I find dates held in my town by a centre based elsewhere, and don't see faraway dates as close.

**Acceptance Criteria:**

**Given** a search with place and radius
**When** results are selected
**Then** each current listing of a covered centre is a result card if its own `lat`/`lon` lie within the radius, with Distance measured from them; a centre without current listings is selected by its own coordinates as today (FR2, AD-2, AD-8)

**Given** a covered centre whose own address is in range but whose current dates are all at addresses outside the radius
**When** results render
**Then** the centre does not appear (no result, no-dates or uncovered card)

**Given** a covered centre whose own address is outside the radius but which has a date at an address inside it (e.g. VHS Starnberger See's Herrsching dates for a search from Herrsching, 10 km)
**When** results render
**Then** that date appears as a result card with its distance to the Herrsching address

**Given** a listing with `lat`/`lon` `null` (neither venue nor centre located)
**When** results are selected
**Then** it follows Story 1.12's rule for its centre (shown with Distance "unknown" when the centre's postcode or city matches the place), so it never disappears silently (NFR5)

**Given** the count line, the "No test centres within R km" state and the date notices
**When** they compute
**Then** they count the cards actually selected (dates in range plus centres without dates in range)

**Given** the result card's "Map ↗"
**When** tapped
**Then** it still opens the listing's `address` (unchanged); the About page "How it works" text says, in DE and EN, that distance is measured to the address where the test takes place
```

### 4.6 UX — `EXPERIENCE.md` and `DESIGN.md`

**EXPERIENCE.md, Voice and Tone line**

OLD: `Key-facts values: Distance "24 km"; …`
NEW: `Key-facts values: Distance "24 km" (straight line to the test address; for no-dates and uncovered cards, to the centre); …`

**DESIGN.md, Key-facts row**

OLD: `**Distance** (km),`
NEW: `**Distance** (km, to the test address),`

No layout, component or flow change. The card doesn't flag a placeholder location, because the address line already shows which address is used.

### 4.7 Derived artifacts

- `implementation-artifacts/epic-2-context.md`: add Stories 2.10–2.11 to the list and update the build-order bullet. Regenerate it fully at the next `bmad-build` run.

## 5. Implementation Handoff

- **Scope:** Moderate. Backlog grows by two stories and the architecture gains one AD-5 exemption. No replan is needed.
- **Developer agent (now, this workflow):** apply edits 4.1–4.7 to the planning docs.
- **Developer agent (`bmad-build`):** implement Story 2.10, then Story 2.11. Story 2.9 can go before or after.
- **Operator:** none required. Optional: look at the run log's list of unlocated test addresses after the first run.

**Success criteria**

- After 2.10, each listing in `snapshot.json` has `location`. Fewer than 10 % of current listings fall back to `centre` for a reason other than having no provider address.
- After 2.11, a search from Herrsching (10 km) shows VHS Starnberger See's Herrsching dates, and a search from Starnberg (5 km) doesn't.
- A rerun with an unchanged snapshot sends no Nominatim requests.
- `npm test` and CI pass. Snapshot `schemaVersion` is 3.
