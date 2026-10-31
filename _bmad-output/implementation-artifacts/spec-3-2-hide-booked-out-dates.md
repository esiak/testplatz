---
title: 'Story 3.2: Hide booked-out dates'
type: 'feature'
created: '2026-10-31'
status: 'done'
baseline_revision: '06dfd2a3f6cda2aedacee7c03370c38aa8a13037'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A user who only wants dates they can still book has to read past every "Booked out" card (FR29). There is no way to hide them.

**Approach:** Add a "Hide booked-out" native checkbox next to the sort control on the results page. When ticked, only `status: 'booked_out'` date cards are hidden; a "N booked-out dates hidden · Show" line, the live region and an everything-hidden notice keep the hidden dates discoverable (FR29, FR30, FR31, UX-DR7, UX-DR8, UX-DR24).

## Boundaries & Constraints

**Always:**
- Hide only dated cards whose listing `status` is `booked_out`. Waitlist (`waitlist`), unknown and free dates, no-dates cards and uncovered cards always stay.
- The count line keeps counting all dates, hidden ones included (unchanged `CountLine`).
- Focus stays on the checkbox when it changes; "Show" and "Show them" untick it and move focus to the checkbox.
- The single `role=status` region announces "N booked-out dates hidden" when ticked and "N booked-out dates shown" when unticked (N = booked-out dates in the current results).
- Sort control and toggle share one row and the toggle wraps below when they don't fit, with no horizontal scroll at 320 px and the longest German strings.
- All words come from `web/src/i18n/{en,de}.json`, same meaning in both, no exclamation marks.

**Never:**
- No new fragment parameter: the shareable fragment stays `#q&r&sort&lang` (`web/src/fragment.ts`). The toggle is page state; it stays as set across new searches until unticked or the page reloads.
- No re-search, clock read or fetch when toggling (same as sorting).
- No change to `runSearch`/`selectCards` selection.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tick with mixed dates | 2 booked_out, 1 waitlist, 1 free, 1 uncovered; tick | booked_out cards gone; waitlist, free, uncovered stay; "2 booked-out dates hidden · Show"; status "2 booked-out dates hidden"; count line unchanged | No error expected |
| Untick / Show | ticked as above; click "Show" | all cards back, checkbox unticked and focused, hidden line gone, status "2 booked-out dates shown" | No error expected |
| Everything hidden | 4 dates all booked_out plus undated cards; tick | no dated cards; notice "All 4 dates here are booked out and hidden." with "Show them" replaces the "All checked dates are booked out…" notice; undated cards stay | No error expected |
| Nothing to hide | no booked_out dates; tick | no card hidden; no hidden line; status "0 booked-out dates hidden" | No error expected |
| Nearest sort | ticked, choose Nearest | hidden cards stay hidden in the single list | No error expected |
| New search while ticked | ticked, search another place | toggle stays ticked; new results filtered; hidden line counts the new results | No error expected |

</intent-contract>

## Code Map

- `web/src/search/search-page.tsx` -- results body (`outcome.kind === 'results'` branch, ~line 377): renders `CountLine`, `SortControl`, the notices (`notice_no_dates`, `allBookedOut` → `notice_all_booked`), `HiddenUnlocatedNotice`, `SortedResults`. `chooseSort` is the pattern for a re-order with no search: sets state and calls `announce`. `Announcement` union + `AnnouncementText` drive the live region. `Shown` holds `dated`/`undated`/`now`.
- `web/src/search/results.ts` -- pure helpers: `DatedResult`, `sortedCards`, `allBookedOut` (booked_out or waitlist). Add pure helpers here (e.g. `bookedOutCount`, `withoutBookedOut`) so `sortedCards` receives already-filtered `dated`.
- `web/src/search/sort-control.tsx` -- `<fieldset class="sort-control">`; leave it unchanged and wrap it with the new toggle in a row container.
- `web/src/i18n/en.json`, `de.json` -- `results.*` keys (lines ~53–83). German "booked out" is "ausgebucht" (`status.booked`). A test fails on missing or extra keys between the two files.
- `web/src/styles/base.css` -- `.sort-control` (line ~396), `.notice-line` / `.notice-line__link` (44 px min target pattern). `web/src/styles/tokens.css` -- `--color-action`, `--font-meta`.
- `tests/search-page.test.tsx` -- `describe('sort by soonest or nearest')` (line ~861) and its `booked-out notice` block (~1039) show the helpers `showWith`, `choose`, `notices`, `statusText`; add a `describe('hide booked-out dates')` the same way. `tests/results.test.ts` -- unit tests for `results.ts`.

## Tasks & Acceptance

**Execution:**
- `web/src/search/results.ts` -- add `bookedOutCount(dated)` and `hideBookedOut(dated)` (filters `status === 'booked_out'`) -- pure, testable filtering kept out of the component.
- `web/src/search/hide-booked-out.tsx` -- new component: native checkbox labelled "Hide booked-out" and, when ticked with N > 0, the meta line "N booked-out dates hidden · Show" (Show = `<button type="button">` styled as a link, 44 px min target) -- one component for UX-DR8.
- `web/src/search/search-page.tsx` -- `hideBooked` state; wrap `SortControl` and the toggle in a `results-controls` row; pass filtered `dated` to `SortedResults`; add the `hidden` announcement kind; render the everything-hidden notice with "Show them" instead of `notice_all_booked` when every dated card is hidden; Show/Show them untick and focus the checkbox via a ref -- wires the feature.
- `web/src/i18n/en.json`, `de.json` -- keys: `results.hide_booked` ("Hide booked-out" / "Ausgebuchte ausblenden"), `results.hidden_count` / `_one` ("{count} booked-out dates hidden" / "{count} ausgebuchte Termine ausgeblendet", singular forms), `results.show` ("Show" / "Anzeigen"), `results.shown_count` / `_one` ("{count} booked-out dates shown" / "{count} ausgebuchte Termine eingeblendet"), `results.notice_all_hidden` / `_one` ("All {count} dates here are booked out and hidden." / "Alle {count} Termine hier sind ausgebucht und ausgeblendet."), `results.show_them` ("Show them" / "Anzeigen") -- copy for DE and EN.
- `web/src/styles/base.css` -- `.results-controls` (flex, wrap, gap), `.hide-booked` checkbox with `accent-color: var(--color-action)`, hidden line in `--font-meta`, link-styled button reusing the `.notice-line__link` target rule -- layout and reflow.
- `tests/results.test.ts` -- unit tests for the two helpers; `tests/search-page.test.tsx` -- one test per I/O matrix row plus focus and the 320 px wrap class check -- covers the matrix.

**Acceptance Criteria:**
- Given results, when they render, then the toggle appears unticked after the Soonest | Nearest control in the same `results-controls` row, and the page has no horizontal scroll at 320 px wide in German.
- Given the toggle is ticked or unticked by keyboard (Space) or click, when the list updates, then `document.activeElement` is the checkbox.
- Given the built site, when searching "Herrsching", 10 km and ticking the toggle, then the "Booked out" VHS Starnberger See date disappears, "1 booked-out date hidden · Show" shows, and the count line still reads "2 dates and 1 unchecked centre within 10 km".

## Spec Change Log

## Review Triage Log

### 2026-10-31 — Review pass
- verdicts: 24 findings — high 0, medium 3, low 15, false 6, maybe-false 0
- findings:
  - `[low]` `[patch]` (verification-gap) Singular "shown" announcement and singular everything-hidden notice never exercised — pre-verified gap; added EN tests for "1 booked-out date shown" and "1 date here is booked out and hidden. Show them", plus the German singular line and notice.
  - `[false]` `[reject]` (verification-gap, other) "No dates to show" heading shows above undated cards when every date is hidden — the heading is accurate in that state (no dates are shown) and matches Soonest's existing layout; nothing wrong is displayed.
  - `[medium]` `[patch]` (edge-case) A new search while ticked announces only the unfiltered count line — confirmed in `show()`; the outcome announcement now carries `hiddenCount` and reads "<count line>. N booked-out date(s) hidden" when the toggle is on and N > 0; asserted in the "stays ticked" test.
  - `[false]` `[reject]` (edge-case) `chooseHideBooked` reads `shown` from a stale closure — the handler runs from controls rendered with the current `shown`; nothing changes `shown` between that render and the click.
  - `[low]` `[patch]` (edge-case) `tests/results.test.ts` helper builds invalid dates from 10 cases — switched to `padStart(2, '0')` in the new helper.
  - `[low]` `[patch]` (edge-case) `.link-button` duplicates the `.notice-line__link` target rule instead of reusing it (spec Code Map) — `.link-button` reduced to button resets and link look; both buttons carry `notice-line__link`.
  - `[low]` `[reject]` (edge-case) No automated 320 px / German overflow check — jsdom cannot lay out; checked in the built site at 320 px DE: toggle wraps below the sort control, `scrollWidth` 320.
  - `[medium]` `[patch]` (blind) Checkbox and sort segments move when the hidden line appears — measured in the built site: checkbox up 23 px, segments down 22 px (`align-items: flex-end` with the line inside `.hide-booked`); line moved after the `.results-controls` row (`HiddenBookedLine`); re-measured: neither moves; test asserts the line is outside the row.
  - `[low]` `[patch]` (blind) Two "Show" buttons when everything is hidden, both "Anzeigen" in German — the hidden line is suppressed in that state; test asserts only "Show them" remains.
  - `[low]` `[patch]` (blind) "Show" / "Show them" have no context for screen readers — each has `aria-describedby` to the count text / notice sentence; asserted in tests.
  - `[medium]` `[patch]` (blind) A new search while ticked never announces the hidden dates — same root cause and fix as the edge-case row above.
  - `[low]` `[patch]` (blind) `.link-button` duplicates the target rule and lacks hover — duplication fixed with the edge-case row above; hover not added (links have no hover style elsewhere in `base.css`).
  - `[low]` `[patch]` (blind) Untested interactions (Nearest + everything hidden, no dated cards, surviving no_centres, German singulars, real Space key) — German singulars added; the rest rejected as low: they run the same filter and notice code paths already covered, and adding them would not change code.
  - `[low]` `[patch]` (blind) Test helper invalid past nine dates — same fix as the edge-case row.
  - `[false]` `[reject]` (blind) Count line overstates what is on screen while hiding — FR30 and the spec's Always rule require the count line to include hidden dates.
  - `[false]` `[reject]` (blind) Change set incomplete (`epic-3-context.md` not in the diff) — that file is the workflow's recompiled planning context, not part of the change; it is committed with the story.
  - `[false]` `[reject]` (blind) `chooseHideBooked` focuses before re-render — the checkbox is always mounted while results show and every caller is inside the results body; focus lands on it (asserted, including the new click-without-prefocus test).
  - `[low]` `[reject]` (intent) Reflow at 320 px / German exercised only by CSS, not tests — verified manually in the built site (see above).
  - `[low]` `[patch]` (intent) `tick()` focuses before clicking, so the focus assertion partly tests itself — added a test that clicks without focusing first and asserts the checkbox has focus.
  - `[low]` `[reject]` (intent) Live-region speech only checked as DOM text — jsdom limit; the single `role=status` region pattern is unchanged from Stories 2.9/1.x.
  - `[low]` `[reject]` (intent) `accent-color` and `meta` styling untested — CSS only; confirmed visually in the 320 px screenshot.
  - `[low]` `[reject]` (intent) Built-site AC (Herrsching) not exercised by tests — checked in the built site: the 15 Dec "Booked out" date hides, "1 booked-out date hidden · Show", count line unchanged "2 dates and 1 unchecked centre within 10 km", focus on the checkbox.
  - `[low]` `[reject]` (intent) "Status unknown" staying only unit-tested — `hideBookedOut` filters `status === 'booked_out'` only; the unit test covers unknown.
  - `[false]` `[reject]` (intent) Open-point choices go beyond the intent text — each is recorded in the spec's intent contract (Boundaries, I/O matrix, Design Notes), not a divergence.

## Design Notes

The everything-hidden notice replaces the all-booked notice because EXPERIENCE.md lists them as separate result states ("All dates booked out" vs "Everything hidden by toggle"); showing both would say the same thing twice. When some hidden dates are booked out and the rest are waitlist, nothing is "everything hidden" and the all-booked notice keeps showing as today.

## Verification

**Commands:**
- `npm test` -- expected: all tests pass, including the new hide-booked-out tests and the i18n key parity test.
- `npm run typecheck` -- expected: no errors.
- `npm run build` -- expected: build succeeds.

**Manual checks (if no CLI):**
- `vite preview`, "Herrsching", 10 km, EN and DE: tick, untick via "Show", check focus and the live region; resize to 320 px and confirm the toggle wraps without sideways scroll.

## Auto Run Result

**Summary:** A "Hide booked-out" checkbox now sits beside the Soonest | Nearest control. Ticking it hides only `booked_out` date cards; "N booked-out dates hidden · Show" appears below the row, the live region announces the hidden/shown count, and when every date is hidden the "All N dates here are booked out and hidden. Show them" notice replaces the all-booked notice. The count line still counts every date. The toggle is page state (not in the fragment) and stays on across searches, which then announce the hidden count too.

**Files changed:**
- `web/src/search/results.ts` -- `bookedOutCount` and `hideBookedOut` pure helpers.
- `web/src/search/hide-booked-out.tsx` -- new `HideBookedOut` checkbox and `HiddenBookedLine` ("N hidden · Show").
- `web/src/search/search-page.tsx` -- toggle state, controls row, filtered list, everything-hidden notice, announcements, focus handling.
- `web/src/i18n/en.json`, `de.json` -- nine new `results.*` keys with singular forms.
- `web/src/styles/base.css` -- `.results-controls` wrapping row, `.hide-booked*`, `.link-button`.
- `tests/results.test.ts`, `tests/search-page.test.tsx` -- helper unit tests and 15 page tests (every matrix row, focus, singulars, German, accessibility description, line outside the row).
- `_bmad-output/implementation-artifacts/epic-3-context.md` -- recompiled at step 1 (the architecture spine was newer).

**Review:** 24 findings. Patched: 2 medium entries (layout jump when the hidden line appears; no announcement of hidden dates after a new search) and 7 low entries (singular tests, duplicate "Show", button descriptions, CSS reuse, focus test, date helper, German singulars). Deferred: none. Rejected: 6 false and 7 low, each with its reason in the Review Triage Log.

**Follow-up review recommended:** true — two medium entries were patched after review (patched counts: high 0, medium 2, low 7). Unverified risk: the patched live-region text after a new search ("<count line>. N booked-out dates hidden") and the moved hidden line have had no fresh review pass, and the line's position is verified only by manual measurement.

**Verification:** `npm test` 1,280 passed, 1 skipped; `npm run typecheck` clean; `npm run build` succeeds. Built site (`vite preview`): Herrsching 10 km EN — ticking hides the "Booked out" date, line "1 booked-out date hidden · Show", status "1 booked-out date hidden", count line unchanged, focus on the checkbox, checkbox and segments do not move (281 px / 309 px before and after). 320 px DE — toggle wraps below the sort control, `scrollWidth` 320, no sideways scroll.

**Residual risks:** At 320 px in German "Anzeigen" wraps onto its own line under the hidden-count text (cosmetic). Real screen-reader speech and the real Space key were not tested (jsdom and scripted clicks only).
