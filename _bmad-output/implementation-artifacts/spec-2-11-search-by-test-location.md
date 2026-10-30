---
title: 'Story 2.11: Search by test location'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_revision: '348e6f1b65942408542fd22f432daa448563bb1f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      In the committed snapshot the Herrsching dates of VHS Starnberger See (and 14 other listings at a different postcode from their centre) still carry location centre, so the story's Herrsching 10 km example is not visible on the live site yet.
    evidence: |-
      Story 2.10 moved the committed snapshot to v3 offline with no geocoding (53 venue / 47 centre). The 2.11 selection uses whatever coordinates the listing carries. Settle by checking data/public/snapshot.json after the next scheduled pipeline run: the Jahnstraße 10, 82211 Herrsching listings should have location venue and Herrsching coordinates.
    location: >-
      data/public/snapshot.json
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Since Story 2.10 every snapshot listing carries its own `lat`/`lon`, but the web app still selects centres by the centre's coordinates and measures every date from the centre. Dates held in the user's town by a centre based elsewhere are missed, and faraway dates of a nearby centre look close.

**Approach:** Selection moves from "centres in range, then their dates" to "dates in range by their own position, plus centres without current dates by the centre's position". `runSearch` takes the listings and the clock and returns the selected cards directly, so the count line, the no-centres state and the notices count exactly what is shown. The About "How it works" text says distance is measured to the test address.

## Boundaries & Constraints

**Always:**
- A listing is *current* when `Date.parse(starts_at) >= now` (the `now` read once per search, as today).
- Each current listing gets one position: its own `lat`/`lon` when both are numbers; otherwise its centre's when the centre is located; otherwise none.
  - With a position: a result card when the straight-line distance to the searched place is `<= r`, with that distance.
  - Without a position: a result card with Distance `null` ("unknown") when its centre matches the place by Story 1.12's rule (centre postcode among the place's postcodes, or normalised city equal to the place name); otherwise not shown.
- A centre with no current listing (any coverage) is selected by its own coordinates exactly as today: in range → undated card with distance; unlocated and matching the place → undated card with `null`. Undated order stays: in-range nearest first (name, id ties), then place matches by name, id.
- A centre with current listings never gets an undated card, even when none of its listings is selected (it then does not appear at all).
- Dated order stays: start, then distance (unknown last), then listing id. `sortedCards` is unchanged.
- `no_centres` exactly when no dated and no undated card is selected. `hiddenUnlocated` keeps its meaning: centres without coordinates whose address does not match the place.
- Count line, `results.notice_no_dates`, `results.notice_all_booked` keep reading the selected cards (no new logic there).
- "Map ↗" keeps opening `listing.address`. No card markup changes.
- About `about.how.body` in DE and EN keeps its current first sentence and adds that distance is measured in a straight line to the address where the test takes place (same meaning in both languages, no exclamation marks).

**Never:**
- No pipeline, schema or snapshot change. No new dependency. No change to sort, fragment, card components or the 2.7 layout.
- Never guess a position from the place or anything else; never drop a listing without coordinates silently.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Date in town, centre far | Search Herrsching 10 km; centre Starnberg (>10 km) has a listing at Herrsching coords | Result card, distance to the listing (~0 km); no undated card for the centre | — |
| Centre near, dates far | Search Starnberg 5 km; centre in Starnberg, its only current listing at Herrsching | Centre absent (no result, no-dates, uncovered card); if nothing else → `no_centres` | — |
| Mixed dates | Centre in range, one listing in range, one outside | One result card (the one in range) | — |
| No current dates | Covered `ok` centre in range, only past listings | No-dates card by centre distance | — |
| Uncovered centre | `not_checked` centre in range, no listings | Uncovered card by centre distance (unchanged) | — |
| Listing null, centre located | Listing `lat/lon` null, centre located in range | Result card with distance to the centre | — |
| Listing and centre null, place match | Listing null, centre unlocated, centre postcode in the place's postcodes | Result card, Distance unknown | — |
| Listing and centre null, no match | as above, different town | Not shown; centre counts in `hiddenUnlocated` | — |
| Boundary | Listing exactly `r` km away | Shown | — |
| Count | 2 dates in range + 1 uncovered centre in range | "2 dates and 1 unchecked centre within R km" | — |

</intent-contract>

## Code Map

- `web/src/search/search.ts:306-400` -- `CentreInRange`, `centresInRange`, `unlocatedInPlace` (keep, reuse for undated selection), `Outcome`, `runSearch`. New `selectCards(centres, listings, place, radiusKm, now) → Results` lives here; search.ts imports only types from `results.ts` (results.ts already imports only types from search.ts, so there is no runtime cycle). `runSearch(search, places, centres, listings, now, others = [])`; the results outcome becomes `{ kind: 'results', search, dated, undated, hiddenUnlocated }` and `no_centres` becomes `{ kind: 'no_centres', search, hiddenUnlocated }` (the always-empty `unlocated: []` field is dropped).
- `web/src/search/results.ts:1-65` -- `DatedResult`, `UndatedResult`, `Results`, `undatedKind` stay. `datedResults` is replaced by `selectCards` (remove it). `sortedCards`, `allBookedOut` unchanged.
- `web/src/search/search-page.tsx:37-67,202-229,365-376` -- `show()` reads `clock()` before `runSearch` and passes `ready.snapshot.listings` and `now`; `Shown` = `{ dated, undated, now }` from the outcome. `CountLine` and notices keep using `shown`.
- `web/src/data/snapshot.ts:23` -- `isUnlocated(centre)`; reuse.
- `shared/geo.ts` -- `haversineKm(lat1, lon1, lat2, lon2)`.
- `web/src/i18n/en.json:7`, `web/src/i18n/de.json:7` -- `about.how.body`.
- `tests/about.test.tsx:106,115-116` -- exact EN text assertion at 106 must be updated; prefix assertions keep passing.
- `tests/results.test.ts` -- rewrite the `datedResults` suite against `selectCards` (fixtures: `snapshotCentre`, `coveredCentre`, `snapshotListing` in `tests/fixtures/snapshot.ts`; listings default to Munich `48.137, 11.575`, same as the centre default).
- `tests/search.test.ts:443-515,684-690` -- `runSearch` calls gain `listings, now` args; assertions on `items`/`unlocated` move to `undated`/`dated`. The snapshot-wide test at 684-690 checks every centre of the committed snapshot is found from its own postcode; adapt it to the new outcome (a centre counts as shown when it has a dated or undated card).
- `tests/search-page.test.tsx` -- page tests; where a test moves a centre's coordinates, its listings must carry matching coordinates (or the expectation changes). Add page-level tests for the Herrsching/Starnberg rows.

## Tasks & Acceptance

**Execution:**
- `web/src/search/search.ts` -- add `selectCards`, change `runSearch` signature and results outcome -- FR2, AD-2, AD-8.
- `web/src/search/results.ts` -- remove `datedResults`; keep types -- single selection path.
- `web/src/search/search-page.tsx` -- pass listings and `now` into `runSearch`; build `Shown` from the outcome -- counts follow selection.
- `web/src/i18n/en.json`, `web/src/i18n/de.json` -- extend `about.how.body` -- About AC.
- `tests/results.test.ts`, `tests/search.test.ts` -- every matrix row as unit tests on `selectCards`/`runSearch`; adapt existing tests.
- `tests/search-page.test.tsx` -- adapt; add rendered tests: date-in-town-centre-far shows a result card with its distance and no other card for that centre; centre-near-dates-far shows "No test centres within R km"; count line counts selected cards.
- `tests/about.test.tsx` -- update the exact EN text.

**Acceptance Criteria:**
- Given the search page with a snapshot where a centre 15 km from Herrsching has a date at Herrsching coordinates, when the user searches Herrsching at 10 km, then a result card for that date shows Distance "0 km" and the count line reads one date.
- Given the same snapshot, when the user searches the centre's town at 5 km and the centre has no other date, then the page shows "No test centres within 5 km" and no card for that centre.
- Given the About page in DE and EN, when it renders, then "How it works" says distance is measured to the address where the test takes place.
- Given the whole repo, when `npm run typecheck`, `npm test` and `npm run build` run, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-30 — Review pass
- verdicts: 21 findings — high 0, medium 2, low 12, false 7, maybe-false 0
- findings:
  - `medium` `defer` Intent: on the real snapshot the Herrsching dates carry Starnberg's coordinates (`location: centre`), so the AC example is not met live — upstream data from Story 2.10's offline v3 move; the next scheduled run geocodes them. Deferred with how to settle it.
  - `low` `reject` Edge: an unlocated centre outside the place whose dates are shown in range is still counted in the "may be nearby" notice — the spec keeps `hiddenUnlocated`'s meaning; only 3 covered unlocated centres exist, and the fix adds a filter on shown cards. Listed under residual risks.
  - `false` `reject` Edge: an unlocated centre in the place whose dates all lie outside the radius disappears silently — this is the AC 2 behaviour; its dates are placed elsewhere, so nothing is lost silently.
  - `false` `reject` Edge: an unparsable `starts_at` (NaN) drops a date — the snapshot schema validates `starts_at` as a Berlin-offset datetime, and an invalid snapshot is rejected at load.
  - `low` `patch` Edge: the committed-data test would fail once an unlocated centre's dates are geocoded outside the searched radius — the test now also accepts a centre whose current listings all carry their own coordinates.
  - `false` `reject` Edge: the spec claims notices count exactly what is shown, but `hiddenUnlocated` does not — the spec claims this only for the count line and the two date notices, not the unlocated notice.
  - `low` `reject` Edge: the AC's 5 km radius doesn't exist in the UI — the fix would edit this build's spec; the unit test covers 5 km and the page test uses 10 km.
  - `medium` `patch` VG: no test covers an unlocated centre with a listing that has its own coordinates — added a `selectCards` test (`lost` with a listing at 2 km → one dated card at ~2 km, no undated card).
  - `low` `reject` Blind: the "may be nearby" notice counts centres already on screen — same as the Edge row above.
  - `low` `reject` Blind: the About text says distance is measured to the test address, but the code falls back to the centre — the AC requires this wording; the fallback is the exception, the address line shows the address used, and the UX chose not to flag it.
  - `low` `reject` Blind: a nearby centre whose dates are all far away vanishes and the page says "No test centres within R km" — AC 2 and AC 5 require exactly this.
  - `low` `patch` Blind: the committed-data test is fragile (and partly tautological; `now = generated_at` is unenforced) — fragility fixed as in the Edge row; publish drops `starts_at ≤ runAt`, so `now = generated_at` holds; the sum check still pins `runSearch`'s output.
  - `low` `reject` Blind: `unlocatedInPlace` runs three times per search — about 100 centres, negligible; the fix adds a parameter.
  - `false` `reject` Blind: a duplicate comparator (`byText` vs `byId`) can drift — both are the plain string comparison; no caller can diverge.
  - `false` `reject` Blind: six positional arguments make `listings`/`others` easy to swap — TypeScript rejects the swap (`SnapshotListing[]` vs `OtherPlace[]`).
  - `false` `reject` Blind: a bad `starts_at` silently drops a date — same refutation as the Edge row.
  - `low` `patch` Blind: a test's Starnberg place kept Herrsching's key — now built with `placeRow('09188139', 'Starnberg', …)`.
  - `low` `reject` Blind: missing tests (a `not_checked` centre with listings, `r` passthrough, notices following selection) — publish drops `not_checked` listings; the runSearch tests already vary the radius; the notices read `shown.dated`, which the count tests cover.
  - `low` `reject` Blind: `Shown` duplicates `outcome.dated`/`undated` — it also carries `now`; a refactor with no user effect.
  - `false` `reject` Blind: the `sortedCards` doc's "outcome order" is stale — undated cards come from `outcome.undated`, so "outcome order" is accurate.
  - `low` `patch` Blind: the About German text is only checked by substring — the test now asserts the full German string.

## Design Notes

- **Listing null, centre located:** cannot happen from the pipeline today (the fallback copies the centre's coordinates), but stored listings from before a directory re-geocode could produce it. Using the centre's position keeps the listing visible and matches "a date uses its centre's coordinates when it can't be located".
- **`hiddenUnlocated` unchanged:** it feeds "N centres have no map position yet and may be nearby" and About's list, both about centres. Tying it to listings would make the notice disagree with About.
- **Why selection in `runSearch`:** `no_centres` now depends on listings, so the decision must see them; one function producing the cards keeps the count line, notices and empty state consistent by construction.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass
- `npm run build` -- expected: succeeds

## Auto Run Result

Status: done

**Summary:** Search now places each test date at its own address. `selectCards` (in `web/src/search/search.ts`) makes a result card for every current date within the radius, measured from its own `lat`/`lon` (or its centre's, when the date has none). A date with no position at all shows with Distance "unknown" when its centre matches the place (Story 1.12 rule). Centres with no current date are still selected by their own coordinates. A centre whose dates all lie outside the radius no longer appears. `runSearch` takes the listings and the clock and returns the cards, so the count line, the "No test centres within R km" state and the date notices count exactly what is shown. The About "How it works" text says, in DE and EN, that distance is measured in a straight line to the test address.

**Files changed:**
- `web/src/search/search.ts` -- new `selectCards`; `runSearch(search, places, centres, listings, now, others)`; results outcome `{ dated, undated, hiddenUnlocated }`.
- `web/src/search/results.ts` -- `datedResults` removed; types unchanged.
- `web/src/search/search-page.tsx` -- reads the clock once per search and passes listings to `runSearch`.
- `web/src/i18n/en.json`, `web/src/i18n/de.json` -- distance sentence in `about.how.body`.
- `tests/results.test.ts`, `tests/search.test.ts`, `tests/search-page.test.tsx`, `tests/about.test.tsx` -- `selectCards` suite covering every matrix row, runSearch and page tests (Herrsching/Starnberg), committed-data test adapted, About copy.

**Review findings:** 21 findings (high 0, medium 2, low 12, false 7). Patched 4 entries (1 medium, 3 low; 5 rows): new test for an unlocated centre with a located date, a more robust committed-data test, the Starnberg place key, and the full German About string. Deferred 1 medium entry: the live snapshot's Herrsching dates still carry centre coordinates until the next pipeline run. Rejected 9 low and 7 false rows, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false. Patched entries: 0 high, 1 medium, 3 low.

**Verification:**
- `npm run typecheck` -- clean.
- `npm test` -- 34 files, 1251 passed, 1 skipped (already skipped before this story).
- `npm run build` -- succeeds.
- Matrix audit: every I/O row has a passing test in `tests/results.test.ts`; the count row and the Herrsching/Starnberg rows are also covered in `tests/search.test.ts` and `tests/search-page.test.tsx`.

**Residual risks:**
- The story's Herrsching example only shows on the live site once the pipeline geocodes those addresses (deferred item).
- Once dates of the 3 covered centres without coordinates are geocoded, such a centre can show a result card and still be counted in "N centres have no map position yet and may be nearby" (rejected low finding).
- The AC's 5 km radius isn't offered in the UI (smallest is 10 km); the page test uses 10 km.
