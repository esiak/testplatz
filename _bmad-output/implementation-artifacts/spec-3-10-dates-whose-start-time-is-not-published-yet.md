---
title: 'Story 3.10: Dates whose start time is not published yet'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '7728a72c11553be8a0be08555ce8504c81e092c0'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** MVHS (München, the biggest centre) lists each test with a date only and emails times 10 days before. `RawListing.time` is required, so the ITEM KG reader fails MVHS with `date-unparseable` on every run and "München", 10 km shows 0 dates.

**Approach:** Let a raw listing carry `time: null` when the page states a date with no time. Normalise gives it `starts_at` at 00:00 Europe/Berlin, `time_known: false` and a date-only id; it stays current until the end of its Berlin day everywhere; the snapshot moves to `schemaVersion` 4; cards say "Time not published yet". ITEM KG (MVHS) and CMX emit untimed dates instead of failing.

## Boundaries & Constraints

**Always:** A reader never invents a time; `null` only when a date is stated and no time is (ITEM KG's `00:00 - 23:59` placeholder counts as none). Untimed id `<centre_id>@<YYYY-MM-DD>`, numbered `#2`, `#3` with Story 3.8's matching. `web/` accepts v4 in the same commit, and the committed `data/public/snapshot.json` is moved to v4 offline (every listing `time_known: true`) so a push deploy keeps working. Card copy: en "Time not published yet", de "Uhrzeit noch nicht veröffentlicht".

**Never:** No `stateVersion` bump (stored listings without `time_known` read as `true`). No network requests. KuferWeb stays as is. A malformed time text stays `date-unparseable`, not untimed.

**Decision (human, 2026-11-01):** When a stored date gets its time later (untimed → timed), or loses it (timed → untimed), it keeps its history: the new listing takes its own id but carries the matched stored listing's `first_seen_at` and `baseline` (no "New" badge), and the old id is dropped, not tombstoned. Matching: same centre and date, the other timedness, live before tombstoned, each stored listing at most once, by `source_url` + `place`, then a `source_url` unique on both sides, then non-null `place` (Story 3.8's passes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| MVHS fixtures | `itemkg/fixtures/mvhs/` list + 2 details | `ok`, 2 listings `time: null` (2026-12-04, 2027-01-22); prep course not a listing | N/A |
| Untimed normalise | `{date:'2026-12-04', time:null}` | `starts_at '2026-12-04T00:00:00+01:00'`, `time_known:false`, id `c@2026-12-04` | N/A |
| Two untimed same day | 2 rows, same date | `c@2026-12-04`, `c@2026-12-04#2` | N/A |
| Untimed + timed same day | date-only and 10:00 | `c@2026-12-04` and `c@2026-12-04T10:00` coexist; Soonest: untimed first | N/A |
| Day passes | untimed 2026-12-04, now 2026-12-04T15:00+01:00 | still published, on cards, kept in state | N/A |
| Day over | now 2026-12-05T00:00+01:00 | dropped by publish, merge, browser | N/A |
| DST end day | untimed 2026-10-25 | current until 2026-10-26T00:00+01:00 (25 h day) | N/A |
| Bad id | `time_known:false`, id with `T…` or `starts_at` not 00:00 | schema refuses | publish refuses |
| CMX blank time | teaser `.UhrzeitBeginn` empty, date present | `time: null` listing | garbled time → `date-unparseable` |
| Time appears | stored `c@2026-12-04` (first_seen D1); run lists 2026-12-04 09:00, same URL and place | `c@2026-12-04T09:00`, `first_seen_at` D1, baseline kept; `c@2026-12-04` gone, no tombstone | N/A |
| Time disappears | stored `c@2026-12-04T09:00`; run lists 2026-12-04 untimed, same URL | `c@2026-12-04` with the stored history; timed id gone | N/A |
| No match | stored untimed 2026-12-04 URL A; run lists 09:00 URL B, other place | new listing, untimed tombstoned (today's rules) | N/A |

</frozen-after-approval>

## Code Map

- `shared/listing.ts` -- `rawListingSchema.time` (:47), `LISTING_ID_PATTERN` (:63, accept `@YYYY-MM-DD`), `listingFieldsSchema` (add `time_known: z.boolean()`), `checkListing` (:93, date-only compare + 00:00 when untimed). Add shared `listingEndsAt(listing): number` (timed → `starts_at`; untimed → next Berlin midnight).
- `pipeline/stages/normalise.ts` -- `berlinOffset`/`startsAt` (:37–53): move to `shared/` (web needs the next-midnight offset); `contentKey` (:76) add `time_known`; `buildListings` (:190–225) key = `date` when untimed; `priorByMinute` (:107) groups by the id's key — date-only keys work unchanged.
- `pipeline/stages/merge.ts:125`, `publish.ts:96`, `report.ts:68` -- replace inline `Date.parse(starts_at)` expiry with `listingEndsAt`.
- `shared/state.ts:22` -- `storedListingSchema`: `time_known` defaults to `true` on read.
- `shared/snapshot.ts:6` -- `SNAPSHOT_SCHEMA_VERSION` 4; comment at :59.
- `web/src/search/search.ts:375,391` -- `selectCards`: current until `listingEndsAt`; equal start → untimed first.
- `web/src/search/format.ts:73,89`, `result-card.tsx:89,100` -- meta time and link `{date}` use the new key when untimed; `web/src/i18n/{en,de}.json` add `card.time_unknown`.
- `pipeline/readers/itemkg/index.ts:390–392` -- `time` may be null when `row.date` is set and neither row nor `Start` block has a time. `cmx/index.ts:104–106` -- blank `.UhrzeitBeginn` → null; non-blank unparseable → failure.
- History carry-over (Decision): normalise already gets `previous` (stored listings); after key-based numbering, match each listing whose id has no stored listing to stored listings of the same date with the other timedness. `NormalisedOutcome` ok already carries side data (`centreAddressIds`); add `carriedFrom: Record<newId, oldId>` and pass it through `pipeline/stages/locate.ts` to `merge.ts` `applyOk` (:49–62), which takes history from `stored.get(carriedFrom[id])` and treats that old id as seen (dropped, not tombstoned). `pipeline/stages/run.ts:216,234` wires it, including the replay path.
- ITEM KG time rules (from review): a non-blank row `.start-time` (or the row's text after the date) holding no readable `H:MM` is `MALFORMED` → `date-unparseable`, as is a time-shaped non-time (`25:00`) in row or `Start` block; a `Start` block naming a different date than the row → `date-unparseable` (keep the existing failing test). Only "no time stated" (blank, or the `00:00` placeholder) is untimed. Newer-theme cards follow the same rule.
- Tests pinning v3 / id / time string: `tests/fixtures/snapshot.ts`, `snapshot*.test.ts`, `search-page`, `about`, `normalise`, `merge`, `run`, `alerts`, `results`, `listing`, `format`, `reader-contract`, reader tests. `itemkg.test.ts:258` expects MVHS failure → flip.

## Tasks & Acceptance

**Execution:**
- [x] `shared/listing.ts`, `shared/time.ts` (new, Berlin offset moved from normalise), `shared/state.ts`, `shared/snapshot.ts` -- contract, id, `listingEndsAt`, v4 -- one contract for pipeline and web
- [x] `pipeline/stages/{normalise,merge,publish,report}.ts` -- untimed id/starts_at, end-of-day expiry
- [x] `pipeline/readers/itemkg/index.ts`, `cmx/index.ts` + tests -- emit untimed dates; MVHS fixture test → `ok`
- [x] `web/src/search/{search,format,result-card}`, i18n -- copy, aria name, Soonest tie, browser expiry
- [x] `data/public/snapshot.json` -- offline move to v4 (`time_known: true` on every listing)
- [x] `pipeline/stages/{normalise,locate,merge,run}.ts` -- history carry-over per Decision
- [x] tests for every matrix row; update pinned fixtures. Also: a Nearest tie test where the untimed id sorts after the timed one (two centres, same distance); a malformed `Start`-block time test; a newer-theme card with blank time; `nextDate` tests under their own describe
- [x] `ARCHITECTURE-SPINE.md` AD-3/AD-7/AD-9 amendments (AD-7 includes the carry-over); `data/directory/itemkg-note.md`, `coverage-note.md` MVHS lines (keep the dated coverage tables as recorded; add a separate "since Story 3.10" note, never two results in one cell)

**Acceptance Criteria:**
- Given a `time_known:false` listing, when its card renders, then the meta line reads the time-unknown copy in place of the time and the link name has it right after the date.
- Given the committed data after this change, when `npm run build` and the search page tests run, then v4 loads with no reload loop.
- Given the cached live MVHS pages, when `npm run coverage` parses offline, then MVHS is `parsed` with its dates.

## Design Notes

End of an untimed day = `startsAt(nextDate, '00:00')` (handles 23/25 h days), never `+24 h`. Default-on-read for `time_known` in state follows Story 2.10's optional `lat`/`lon` precedent, so `state.json` needs no migration.

## Verification

**Commands:**
- `npm run typecheck && npm test` -- expected: pass
- `npm run build && npm run check:directory` -- expected: pass
- `node pipeline/stages/coverage-script.ts | grep muenchner` -- expected: `parsed`, not `date-unparseable`

## Implementation Notes

- Loop 1: pass 1 was reverted for the history carry-over decision; its notes follow for reference.

- Loop 1, pass 2 (2026-11-01): re-derived per KEEP, plus the carry-over and review patches. Normalise's `carryOver` matches each listing whose id no stored listing holds to stored listings of the same date and other timedness (ids this run does not produce), live before tombstoned, each once, with 3.8's passes; `carriedFrom` rides on the `ok` outcome through locate to merge's `applyOk`, which takes that stored history and drops the old id. ITEM KG: `rowTime` makes a non-blank row time text with no `H:MM` `MALFORMED`; `startTime` returns `MALFORMED` for a `25:00` on the row's date, or when `Start` blocks name only other dates (the failing test kept). No `run.ts` change needed: replay goes through the same normalise → locate → merge path (run test added). Verified: typecheck, `npm test` (1,648 passed, 1 skipped), build, check:directory; offline coverage: MVHS `parsed`, 1 listing.

- `shared/time.ts` (new): Berlin offset moved from normalise (`berlinOffset`, `startsAt`, re-exported by normalise), plus `nextDate`, `berlinDayEnd`. `shared/listing.ts`: `time` nullable, id pattern accepts `@YYYY-MM-DD`, required `time_known`, `checkListing` untimed rules, `listingEndsAt`. `shared/state.ts`: `time_known` defaults to `true` on read. Snapshot v4.
- Pipeline: normalise keys untimed ids by date (3.8 numbering unchanged); merge, publish and report expire with `listingEndsAt`.
- ITEM KG: `findTime` returns `MALFORMED` for time-shaped non-times (`25:00`) so they stay `date-unparseable`; no time (or the 00:00 placeholder) → `time: null`. Behaviour change: a row whose detail `Start` block names another date, with no row time, is now untimed on the row's date instead of failing. CMX: blank or missing `.UhrzeitBeginn` → `null`; other unreadable text fails.
- Web: `selectCards` keeps untimed dates until their Berlin day ends; `untimedFirst` tie-break in Soonest and Nearest; card meta and link name use `card.time_unknown` (meta part may wrap).
- `data/public/snapshot.json` moved to v4 offline (99 listings, `time_known: true`). AD-3/7/9 amended; MVHS notes updated.
- Verified: typecheck, `npm test` (1,635 passed, 1 skipped), build, check:directory. Offline coverage: MVHS `parsed`, 1 listing (cached live page lists one test date, 22.01.2027; the other two dates are the prep course).

## Spec Change Log

### 2026-11-01 — loop 1

- Trigger: review finding (intent_gap) — a date whose time appears later got a new id, a fresh `first_seen_at` and a false "New" badge. Human decided: keep its history (frozen Decision + three matrix rows).
- Amended: Code Map (carry-over path, ITEM KG time rules from review), Tasks (carry-over task; review test gaps), docs task (coverage note shape).
- Known-bad states avoided: false "New" on retimed dates; ITEM KG publishing a stated-but-unreadable time, or a row/detail date conflict, as untimed; tie-break tests that pass without the rule.
- KEEP (pass 1 worked; re-derive the same way): `shared/time.ts` holding the moved Berlin offset code with `nextDate`/`berlinDayEnd`, normalise re-exporting `berlinOffset`/`startsAt`; `listingEndsAt` in `shared/listing.ts` used by merge, publish, report and `selectCards`; `checkListing` untimed rules; `storedListingSchema` `time_known: z.boolean().default(true)` (no stateVersion bump); `untimedFirst` tie-break in `selectCards` and `sortedCards`; `card.time_unknown` meta part (may wrap) and `cardDate(..., timeText)` for the link name; CMX blank/missing `.UhrzeitBeginn` → null, other text fails; offline snapshot move to v4 inserting `time_known: true` after `starts_at`, staying minified. Do not rewrite `epic-3-context.md`.

## Review Triage Log

### 2026-11-01 — Review pass

- `medium` (blind, edge ×2) ITEM KG reads any stated row time that is not `H:MM` (e.g. "9.30 Uhr", "vormittags") as untimed — real: `findTime` returns null without a colon match and `parse` treats null as untimed, contradicting "a malformed time text stays `date-unparseable`". Route: patch (non-blank `.start-time` with no readable time → `MALFORMED`).
- `medium` (blind) A row whose detail `Start` block names another date now publishes untimed on the row's date instead of failing — real: `startTime` returns null on a date mismatch; the old code failed and the test was rewritten. Conflicting dates are not "a date with no time". Route: patch (mismatch → `MALFORMED`, restore the failing test).
- `medium` (blind, edge) A date that gets its time later (`c@2026-12-04` → `c@2026-12-04T09:00`) is tombstoned and re-added with a fresh `first_seen_at`, so it shows "New" for a test that is not new — real: 3.8 matching only runs within one id key; merge keys history by id. The spec does not say what should happen. Route: intent_gap.
- `false` (blind) `shared/time.ts` builds an `Intl` `longOffset` formatter in the browser, breaking old Safari — Vite's default build target (baseline widely available, Safari 16.4+) already excludes browsers without `longOffset` (Safari 15.4+).
- `low` (blind, edge) Expiry boundary differs by one instant between report (`>=`) and merge/publish (`>`) — real only at the exact end millisecond; report used `>=` for timed dates before this change. Route: defer.
- `false` (blind) Spec tasks unticked; no end-to-end untimed run test — tasks are ticked; each link (reader, normalise, merge incl. state read-back default, publish, browser) has its own test. Rejected.
- `low` (blind) Newer-theme ITEM KG card with blank time is untested — real gap, cheap to close. Route: patch (add a card test).
- `medium` (blind) The regenerated `epic-3-context.md` dropped content other Epic 3 work uses (3.13 address decisions, stretched-link rule, "New" badge colour, About table, mockup path) — real: diff removes them; the old file already recorded the untimed-date rules. Route: patch (restore the baseline file).
- `low` (blind, verification) `coverage-note.md` summary row states two results in one cell — real. Route: patch.
- `false` (blind) Spec numbers disagree (2 fixture listings vs 1 live) — the fixture has two test rows, the live page today one; consistent. Fix would edit the spec. Rejected.
- `low` (blind) "crosses month and year ends" sits under `describe('listingEndsAt')` but tests `nextDate`; no `tests/time.test.ts` — misfile real, cosmetic; `berlinOffset`/`startsAt` keep their normalise tests. Route: patch (own describe); separate file rejected.
- `low` (blind) No reflow test for the long German meta text — the test environment (happy-dom) has no layout; the part wraps like `card.deadline_unknown` already does. Rejected.
- `medium` (verification, pre-verified) Nearest `untimedFirst` test passes even without the rule (id order already agrees). Route: patch (two centres, untimed id sorts after timed).
- `medium` (verification, pre-verified) Malformed `Start`-block time (`25:00`) staying `date-unparseable` is untested. Route: patch.

### 2026-11-01 — Review pass (loop 1)

- `medium` (blind, edge) ITEM KG `rowTime` marks any non-blank, non-`H:MM` row text (a date range, "2 Termine") `MALFORMED`, so the `Start`-block fallback never runs and the centre fails — real: `row.time ?? startTime(...)` only falls back on null; the baseline returned null there and fell back. Route: patch (`MALFORMED` only for time-shaped text such as `9.30`, `9 Uhr`, `25:00`; other text → null, the `Start` block decides; a time word like "vormittags" then reads as untimed when the `Start` block has nothing).
- `maybe-false` (edge ×2) A dateless `Start` block with a time ("Start 09:00 Uhr") is skipped, so the listing becomes untimed — no fixture or cached page shows a `Start` label without a date in the following block; would be `medium` if real. Route: defer.
- `maybe-false` (edge) CMX time outside `.UhrzeitBeginn` read as untimed — all 23 fixture teasers and 15 cached CMX pages carry `.UhrzeitBeginn` inside `.Uhrzeit`; a missing element is untimed by spec. Rejected (would only be `low`).
- `medium` (verification, pre-verified) Run report "dates disappeared" has no untimed prior-listing test. Route: patch.
- `low` (blind) Same session listed twice, once timed and once untimed, gives two cards — needs a provider to print one session both ways on one page; fix needs cross-key dedup rules. Rejected.
- `false` (blind) Carry-over from old tombstones hides "New" for a re-announced date — tombstones are dropped once their day passes, so only a same-day reappearance matches; Story 3.8 keeps history on reappearance the same way.
- `low` (blind) One untimed date becoming two timed sessions: one inherits, one is "New" — the second session is new to users. Rejected.
- `low` carried (blind) Report `>=` vs merge/publish `>` boundary — deferred in the first pass; unchanged.
- `low` (blind) `data-sources.md` field table lacks `time_known` and the untimed `starts_at` rule, while AD-9 points to it — real doc drift; direct fix. Route: patch.
- `false` (blind) Diff omits `snapshot.json` and the spec — deliberate: the snapshot is one minified line, checked separately (v4, 99 listings, all `time_known: true`).
- `low` (blind) `coverage-note.md` gives 1 MVHS listing without saying why the fixture has 2 — direct fix. Route: patch.
- `low` (blind) `untimedFirst` rarely applies; untimed-before-all-timed-that-day is undocumented — that order is the acceptance criterion ("before timed dates of the same day") and follows from 00:00. Rejected.
- `low` (blind) English link name reads "Fri 4 Dec, Time not published yet, …" with a mid-sentence capital — screen readers ignore case; AC asks for the same words. Rejected.
- `false` (blind) `cardDate(..., timeText)` API, normalise re-export — no named harm; both are KEEP items.
- `low` carried (blind) No `tests/time.test.ts` — rejected in the first pass; unchanged.
- `low` (blind) End-to-end run test covers only untimed → timed — merge tests cover the other direction and the tombstoned source; publish keeps `first_seen_at`/`baseline` via existing tests. Rejected.
