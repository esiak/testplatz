---
title: 'Story 2.9: Sort by soonest or nearest'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_revision: '0500a290bebd127a5022d47348263dd465f69aa5'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Results always list dated cards by date and then every undated centre in one list. A user can't trade travel for an earlier test by sorting nearest first, the sort isn't in the shareable link, and an all-booked-out result gets no hint that other centres may still have seats.

**Approach:** Add a "Sort by" radio group (Soonest default | Nearest) under the count line. It re-orders the cards already shown. Soonest keeps dated cards first and puts undated cards under an h2 "No dates to show". Nearest merges all cards by distance. The choice lives in the URL fragment as `sort` and is announced. Also add the "all checked dates are booked out" notice.

## Boundaries & Constraints

**Always:**
- Fragment order `#q=…&r=…&sort=…&lang=…` (FR28, EXPERIENCE example). `sort` is always written when a search writes the fragment (`soonest` or `nearest`). A missing or unknown `sort` in a fragment reads as `soonest`. The language switch keeps `sort` (it already keeps every other param).
- Changing the sort re-orders the current cards only. It doesn't re-run the search, re-read the clock or re-fetch data (FR32). It persists across later searches and radius changes on the page.
- Soonest: dated cards by start, then distance (unknown last), then listing id (today's order). Then, only when at least one undated card exists, an h2 "No dates to show" (`section` typography) and the undated cards in the outcome's order (distance ascending, unknown last). Cards stay in `ul.results` lists; the h2 sits between two lists, never inside a `ul`.
- Nearest: one list, no heading. All cards by distance (unknown last), then dated before undated, then start, then listing id; undated ties keep the outcome's order.
- Sort control: `fieldset` with legend "Sort by", two native radio inputs styled as segments with the existing `--sort-control-*` tokens (border, selected fill `ink-primary`, ≥ 44 px min-height, visible focus ring). It applies on change. It is shown only when results (cards) are shown, placed after the count line and before the notices (EXPERIENCE: "Count line, sort and toggle, then cards").
- On change, the existing `role="status"` region announces "Sorted by soonest" / "Sorted by nearest" (not the count line).
- Booked-out notice: when there is at least one dated card and every dated card's status is `booked_out` or `waitlist`, show the notice line "All checked dates are booked out. Other centres may still have seats." The notice is independent of the sort.
- All words come from `web/src/i18n/{en,de}.json`, with new keys in both.

**Never:**
- No pipeline, schema or snapshot changes and no new dependencies. No hide-booked-out toggle (3.2) and no "New" badge (3.1). No per-listing distance (2.11): distance stays the card's existing `distanceKm`.
- No re-sorting or refreshing without a user action; no auto-scroll on sort change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | `#q=Ulm&r=40&lang=en`, dated + undated cards | Soonest checked; dated by date; h2 "No dates to show"; undated by distance; fragment rewritten to `#q=Ulm&r=40&sort=soonest&lang=en` | — |
| Only undated | 0 dated cards | Soonest: h2 then undated cards; no-dates notice as today | — |
| Only dated | no undated cards | Soonest: no h2 | — |
| Choose Nearest | dated 30 km + 10 km, undated 5 km + unlocated | order 5 km undated, 10 km dated, 30 km dated, unlocated; no h2; "Sorted by nearest" announced; fragment `sort=nearest` | — |
| Same distance | dated and undated card of one centre at 12 km | dated card(s) first, by start | — |
| Shared link | `#q=Ulm&r=40&sort=nearest&lang=de` | Nearest checked on load | — |
| Bad value | `sort=foo` or missing | Soonest | — |
| Back to Soonest | Nearest → Soonest | Soonest order, h2 back, "Sorted by soonest", `sort=soonest` | — |
| New search | Nearest chosen, then search another town | stays Nearest; fragment keeps `sort=nearest` | — |
| Language switch | Nearest, switch to DE | stays Nearest, fragment keeps `sort=nearest` | — |
| All booked out | dated statuses `booked_out` + `waitlist` | booked-out notice shown | — |
| Mixed status | one `free` or `unknown` dated card | no booked-out notice | — |
| No dated cards | only undated | no booked-out notice | — |

</intent-contract>

## Code Map

- `web/src/search/search.ts:39-48` -- `parseSearchFragment(hash) → { q, r }` and `searchFragment(q, r, lang)`. Add a `Sort` type (`'soonest' | 'nearest'`, `DEFAULT_SORT`), `parseSort(hash)`, and a `sort` argument to `searchFragment` written between `r` and `lang`. Callers: `search-page.tsx` (`show`, `requestSearch`) and tests (`tests/search.test.ts`, `tests/search-page.test.tsx`).
- `web/src/search/results.ts` -- `datedResults(outcome, listings, now) → { dated, undated }`; dated already in Soonest order, undated in outcome order. Add a pure `sortedCards(results, sort)` (or similar) returning the Soonest groups or one Nearest list, plus `allBookedOut(dated)`. Keep `datedResults` unchanged.
- `web/src/search/search-page.tsx` -- `SearchPage` state (`radius`, `shown`, `announcement`), `Announcement` union (add `{ kind: 'sorted'; sort }`), `AnnouncementText`, the `hash` effect (`parseSearchFragment`, `sameSearch`): a hash whose search equals the last one must still pick up its `sort`. Results body renders `shown.dated` then `shown.undated` by `undatedKind`: refactor so each card kind renders through one helper and both sort layouts reuse it.
- `web/src/search/sort-control.tsx` (new) -- the fieldset + radios.
- `web/src/fragment.ts` -- `withLang` keeps all params (no change needed); update the header comment to `#q=…&r=…&sort=…&lang=…`.
- `web/src/styles/base.css` -- `.notice-line` (~383), `:focus-visible` (26), `.about h2` (105) as h2 reference. Add `.sort-control` segment styles and a `.results-heading` h2 using `--font-section`. Tokens already exist in `web/src/styles/tokens.css:149-153`.
- `web/src/i18n/{en,de}.json` -- new keys: `results.sort_legend` "Sort by" / "Sortieren nach"; `results.sort_soonest` "Soonest" / "Früheste"; `results.sort_nearest` "Nearest" / "Nächste"; `results.sorted_soonest` "Sorted by soonest" / "Nach frühestem Termin sortiert"; `results.sorted_nearest` "Sorted by nearest" / "Nach Entfernung sortiert"; `results.no_dates_heading` "No dates to show" / "Keine Termine anzuzeigen"; `results.notice_all_booked` "All checked dates are booked out. Other centres may still have seats." / "Alle geprüften Termine sind ausgebucht. Andere Testzentren haben vielleicht noch Plätze." `tests/i18n.test.ts` checks key parity.
- `tests/search-page.test.tsx` -- `showWith(centres, listings, lang)`, `DEFAULT_NOW`, `cards()`, `cardNames()`, `statusText()`; existing fragment assertions (`#q=…&r=…&lang=…`) need `sort=soonest`. `tests/results.test.ts`, `tests/search.test.ts`, `tests/fixtures/snapshot.ts` (`coveredCentre`, `snapshotListing`).

## Tasks & Acceptance

**Execution:**
- `web/src/search/search.ts` -- `Sort`, `DEFAULT_SORT`, `parseSort`, `sort` in `searchFragment` -- FR28.
- `web/src/search/results.ts` -- pure Soonest/Nearest ordering and `allBookedOut` -- FR3, FR31.
- `web/src/search/sort-control.tsx` -- new fieldset/radio control -- UX-DR7.
- `web/src/search/search-page.tsx` -- sort state from the fragment, control under the count line, the two layouts with the h2, the "sorted" announcement, the booked-out notice, `sort` in every fragment write -- FR3, FR31, UX-DR18.
- `web/src/fragment.ts` -- comment update.
- `web/src/styles/base.css` -- segment and heading styles.
- `web/src/i18n/{en,de}.json` -- the keys above.
- `tests/results.test.ts`, `tests/search.test.ts` -- ordering, tie-breaks, `allBookedOut`, `parseSort`/`searchFragment`.
- `tests/search-page.test.tsx` -- every matrix row at page level; update existing fragment assertions.

**Acceptance Criteria:**
- Given results on first load, when they render, then a group named "Sort by" has Soonest checked and Nearest unchecked, both reachable by keyboard and at least 44 px high.
- Given I choose Nearest, when the order changes, then focus stays on the radio, the status region reads "Sorted by nearest", and the cards, count line and notices keep their content.
- Given the whole repo, when `npm run typecheck`, `npm test` and `npm run build` run, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-30 — Review pass
- verdicts: 21 findings — high 0, medium 1, low 13, false 7, maybe-false 0
- findings:
  - `low` `patch` VG: no test changes the sort through a hashchange after mount (the effect's `parseSort` lines could be deleted unnoticed) — added a page test: Soonest → same q/r with `sort=nearest` → Nearest checked, Nearest order, no extra fetch; then no `sort` → Soonest again.
  - `false` `reject` Intent: undated Soonest cards keep "outcome order", not "by distance" — the outcome is distance order: `centresInRange` sorts by distance (`web/src/search/search.ts:315`) and unlocated centres follow (unknown last).
  - `false` `reject` Intent: every fragment write now carries `sort`, beyond the AC — required by FR28 and EXPERIENCE's example `#q=Neu-Ulm&r=40&sort=soonest&lang=en`.
  - `false` `reject` Intent: booked-out notice counts waitlist, not unknown, and includes in-place unlocated dates — EXPERIENCE's all-booked-out flow has a waitlist card; unlocated in-place cards are part of the shown results.
  - `low` `reject` Intent: segment look, 44 px, focus ring and toggle row not exercised by tests — jsdom cannot measure layout; the implementer checked height, focus ring and keyboard in the built preview; the toggle (3.2) doesn't exist yet.
  - `false` `reject` Intent: per-date distance under Nearest not exercised — no per-listing distance exists until Story 2.11.
  - `low` `reject` Edge: a same-search hashchange without `sort` resets to Soonest but the URL isn't rewritten with `sort=soonest` — state and URL agree (missing reads as soonest); normalising adds a branch for a hand-edited URL.
  - `low` `reject` Edge: a hashchange that only changes `sort` re-orders without a "Sorted by …" announcement — only on back/forward or a hand edit; adds a guard and announcement path for a rare case.
  - `low` `patch` Edge: selected state and focus ring depend on `:has()` with an opacity-0 radio — segment box moved to the label span; checked and focus rules now key on `.sort-control__input:checked/:focus-visible + .sort-control__label`, no `:has()`.
  - `low` `patch` Blind: German "Nächste" reads as "next" beside "Früheste" — now "Nächstgelegene".
  - `low` `patch` Blind: no fallback without `:has()` — same root cause and fix as the Edge `:has()` row.
  - `medium` `patch` Blind: in forced-colors mode checked and unchecked segments look the same — added `@media (forced-colors: active)` with `Highlight` / `HighlightText` on the checked segment.
  - `low` `reject` Blind: the h2 "No dates to show" repeats the no-dates notice when nothing has dates — the matrix row "Only undated" requires the heading; the fix would edit this build's spec.
  - `low` `patch` Blind: no test that a hashchange changing only `sort` updates the page — same root cause and fix as the VG row.
  - `low` `patch` Blind: no test that the sort control is absent outside results — added assertions for the no-centres outcome and a field error.
  - `false` `reject` Blind: `chooseSort` may write a stale search while a newer one is pending — the control only renders for a results outcome; a pending search sets the outcome to null (control gone), and `show()` updates `lastSearch` whenever it rewrites `q`.
  - `low` `reject` Blind: `sortedCards` re-sorts on every render — at most a few hundred cards, a negligible cost; memoising adds code for no user-visible gain.
  - `false` `reject` Blind: sort state in three places, `sortRef` not synced in render — every write path sets both ref and state (`chooseSort`, the hash effect); no caller writes one without the other, so no stale fragment is written.
  - `low` `reject` Blind: the dated list has no heading and the undated list no `aria-labelledby` — UX-DR18 defines only the one h2; adding list labels is new design, not a direct correction.
  - `low` `reject` Blind: 44 px and focus ring not asserted — jsdom cannot measure; checked in the built preview.
  - `false` `reject` Blind: spec says undated "by distance" but code keeps "outcome order" — the outcome order is distance order (see the Intent row above).

## Design Notes

- `sort=soonest` is written explicitly (not omitted as the default), so a shared link matches EXPERIENCE's example `#q=Neu-Ulm&r=40&sort=soonest&lang=en`.
- A "waitlist" date counts as booked out for the notice: EXPERIENCE's "All dates booked out" flow has one card showing "Booked out · Waitlist". An `unknown` status doesn't count, since seats may be free.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all tests pass
- `npm run build` -- expected: succeeds

## Auto Run Result

Status: done

**Summary:** Results get a "Sort by" control (Soonest default | Nearest) under the count line. Soonest lists dated cards by date, then (when there are any) an h2 "No dates to show" and the centres without dates by distance. Nearest puts every card in one list by distance (unknown last), dated before undated at the same distance. Changing the sort only re-orders the shown cards (no new search, clock read or fetch), announces "Sorted by soonest/nearest", and writes `sort` into the fragment (`#q=…&r=…&sort=…&lang=…`). Every search keeps the current sort, as do the language switch and the "Did you mean" links. A new notice, "All checked dates are booked out. Other centres may still have seats.", shows when every dated card is booked out or waitlist only.

**Files changed:**
- `web/src/search/search.ts` -- `Sort`, `DEFAULT_SORT`, `parseSort`; `searchFragment` writes `sort`.
- `web/src/search/results.ts` -- `sortedCards` (Soonest groups / Nearest list) and `allBookedOut`.
- `web/src/search/sort-control.tsx` -- new fieldset with two radios styled as segments.
- `web/src/search/search-page.tsx` -- sort state from the fragment, control, both layouts with the h2, announcement, booked-out notice.
- `web/src/search/search-bar.tsx` -- "Did you mean" links carry the sort.
- `web/src/fragment.ts` -- comment.
- `web/src/styles/base.css` -- segment styles (no `:has()`), forced-colors rule, results heading.
- `web/src/i18n/{en,de}.json` -- 7 new keys.
- Tests: `tests/results.test.ts`, `tests/search.test.ts`, `tests/search-page.test.tsx` (sort block, fragment assertions), `tests/shell.test.tsx` (fragments with `sort=soonest`).

**Review findings:** 21 findings (high 0, medium 1, low 13, false 7). Patched 1 medium (forced-colors checked state) and 5 low (German "Nächstgelegene", segment states without `:has()` — 2 rows, hashchange sort test — 2 rows, control-absent test). Nothing deferred. Rejected 7 false and 7 low rows, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false. Patched entries: 0 high, 1 medium, 5 low.

**Verification:**
- `npm run typecheck` -- clean.
- `npm test` -- 32 files, 1153 passed, 1 skipped (skipped before). Run in a temporary worktree of HEAD plus this story's `web/` and `tests/` changes, because a parallel UX session had uncommitted edits to `DESIGN.md`/`EXPERIENCE.md` that make `tests/i18n.test.ts` and `tests/design-tokens.test.ts` fail in the main checkout. Those failures are not caused by this story.
- `npm run build` -- succeeds.
- Matrix audit: every I/O row has a passing page test in `tests/search-page.test.tsx` ("sort by soonest or nearest"), plus unit tests in `tests/results.test.ts` and `tests/search.test.ts`.

**Residual risks:**
- The CSS after the review patch (segment box on the label span, forced-colors rule) was not re-checked in a browser.
- The working tree still holds the parallel card-redesign session's uncommitted UX doc and mockup changes; they are left out of this commit.
