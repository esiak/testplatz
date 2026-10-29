---
title: 'Story 2.5: Normalise and merge with history'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '9b7dcad971a64f1db793e62103a2a2841114e062'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Same-minute ids are positional (AD-7 "#2, #3 in order of place"), so when a same-minute sibling appears or disappears a session can take another session's id and inherit its first_seen_at/baseline, and a tombstone can hold a live session's data.
    evidence: |-
      tests/merge.test.ts "same-minute ids end to end" records it: A and B at 10:00, A disappears, B takes the bare id with A's history and "#2" is tombstoned. A new session sorting before B would take the bare id (not shown "new") and push B to a fresh "#2" (falsely "new"). The fix (matching same-minute groups to stored listings by content before numbering) changes the adopted AD-7 rule and the story AC wording, so it needs an architecture decision before the "New" badge (Epic 3).
    location: >-
      pipeline/stages/normalise.ts normaliseCentre; pipeline/stages/merge.ts applyOk
    severity: medium
  - summary: >-
      The temp-file cleanup and partial-failure paths of writeAtomic in merge are untested.
    evidence: |-
      No test makes writeFileSync/renameSync fail; removing rmSync(temp) would leave a stray .state.json.*.tmp that the bot could commit. Mirrors publish.ts; close when merge is wired into npm run pipeline (Story 2.6).
    location: >-
      pipeline/stages/merge.ts writeAtomic
    severity: low
---

<intent-contract>

## Intent

**Problem:** Readers emit `RawListing`s with local wall-clock date/time and no identity, and nothing stores them across runs. Without ids, offsets and history, a glitchy run would wipe dates and "new" could never mean new; the visit log is also never persisted, so the 4-visits budget does not survive between runs.

**Approach:** Add a pure normalise stage (offset, address fallback, AD-7 id, `link_ok` from this run's detail pages) and a merge stage, the only writer of `data/state/`, that applies centre outcomes (ok/failed/skipped) to a versioned state file with tombstones, `first_seen_at`, `baseline`, and persists this run's visits. Collect additionally returns per-centre page summaries so normalise can compute `link_ok`. Not wired into `npm run pipeline` yet (Story 2.6).

## Boundaries & Constraints

**Always:**
- Normalised listing fields: `id`, `centre_id`, `starts_at`, `place`, `address`, `status`, `deadline`, `registration_method`, `source_url`, `link_ok`, `eligibility`. Stored listing adds `first_seen_at` (UTC `Z`), `removed_at` (UTC `Z` or `null`), `baseline` (boolean). All are zod strict schemas in `shared/`.
- `starts_at` = `<date>T<time>:00` plus the Europe/Berlin offset in force (`+01:00` / `+02:00`), computed with `Intl` (no new dependency). Fall-back hour (ambiguous) → the earlier occurrence (`+02:00`); spring-gap time (nonexistent) → the pre-gap offset (`+01:00`).
- Address fallback: raw `address` `null` → the centre address as `street, postcode city` (move `formatAddress` to `shared/directory.ts`; `web/src/search/search.ts` imports it from there).
- Id `<centre_id>@<date>T<time>`. Same-minute group: exact duplicates (all normalised fields equal) collapse to one; the rest sort by `place` (`null` last), then `source_url`, then `address`; first gets no suffix, then `#2`, `#3`. Never uses the URL in the id itself.
- `link_ok` true iff a page with `role: 'detail'` and 2xx `status` this run has `url` or `finalUrl` equal to `source_url` (ignoring `#fragment`); otherwise false.
- Merge, per centre outcome: `ok` sets `last_checked_at = last_success_at = runAt`, `last_result = 'ok'`, upserts this run's listings and tombstones the rest; `failed` sets `last_checked_at = runAt`, `last_result = 'failed'`, listings untouched; `skipped` changes nothing (no entry is created for an unseen centre). Centres without an outcome are untouched; merge never deletes a centre entry.
- Upsert keeps stored `first_seen_at` and `baseline`, clears `removed_at`, and takes every other field from this run. New ids get `first_seen_at = runAt`, `baseline = (centre had no previous last_success_at)`. Already-tombstoned listings keep their original `removed_at`.
- After applying outcomes, every listing (any centre, any outcome) with `starts_at` ≤ `runAt` (as instants) is dropped from state.
- Visit log: previous log + this run's visits, keeping only entries with `at` > `runAt − VISIT_WINDOW_MS`, sorted by `at` then `host`.
- State file `data/state/state.json`: `{ stateVersion: 1, centres: { [centre_id]: { last_result, last_checked_at, last_success_at, listings[] } } }`, centre keys and listings (by `id`) sorted, `JSON.stringify(…, null, '\t')` + newline. Missing file → empty state; unreadable, invalid JSON, schema failure or other `stateVersion` → throw naming the path.
- Writes: validate state and visit log first (throw, writing nothing, if either is invalid), then write each via temp file + rename in the same directory (reuse the pattern in `pipeline/stages/publish.ts`).

**Never:**
- No other module writes `data/state/`; normalise, collect and fetch stay pure / read-only.
- No change to `RawListing` (unknown start time for MVHS stays out of scope), readers, the snapshot schema/`schemaVersion`, publish, `run.ts` or workflows.
- No new dependencies; no per-listing `last_checked_at`; no personal-data fields.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Summer offset | `2026-07-14` `10:00` | `starts_at` `2026-07-14T10:00:00+02:00` | — |
| Winter offset | `2026-12-01` `09:30` | `2026-12-01T09:30:00+01:00` | — |
| DST edges | `2026-10-25` `02:30`; `2026-03-29` `02:30` | `+02:00`; `+01:00` | — |
| Same minute | 3 raw at 10:00, places `B`, `A`, `null` | ids `c@…T10:00` (A), `#2` (B), `#3` (null) | — |
| Exact duplicate | 2 identical raw listings | one listing, no `#2` | — |
| Detail page 404 / source = list page | `source_url` matches only a non-2xx detail or a list page | `link_ok: false` | — |
| First ok run | no prior `last_success_at` | listings `baseline: true`, `first_seen_at = runAt` | — |
| Later ok, new date | prior success | new id `baseline: false` | — |
| Disappears then returns | ok run without id X, later ok run with X | X gets `removed_at`; later `removed_at: null`, original `first_seen_at`/`baseline` | — |
| Failed run | centre had listings | listings identical, `last_success_at` unchanged | — |
| Skipped | any | state for that centre byte-identical | — |
| Past date | stored listing `starts_at` ≤ runAt | removed from state | — |
| Bad state file | `stateVersion: 2` or invalid JSON | — | throws naming path; nothing written |

</intent-contract>

## Code Map

- `shared/listing.ts` -- `rawListingSchema`/`RawListing`, `STATUS_CODES`, `REGISTRATION_METHODS`, `isLocalDate`; add the normalised `listingSchema` here (reuse field schemas).
- `shared/visits.ts` -- `visitSchema`, `visitLogSchema`; reuse for the merged log.
- `shared/snapshot.ts` -- `LAST_RESULTS`, utc datetime convention (`z.iso.datetime()`); reuse for state centre fields.
- `shared/directory.ts:32` -- `addressSchema` (street/postcode/city); `Centre`. Add `formatAddress` here.
- `web/src/search/search.ts:401` -- current `formatAddress`; replace with an import/re-export from shared (callers: `uncovered-card.tsx`).
- `shared/reader.ts` -- `FetchedPage` (`url`, `role`, `status`, `finalUrl`, `html`), `dedupeUrls` fragment rule.
- `pipeline/stages/collect.ts` -- `collectRun`, `CentreOutcome`, `CollectResult`; add `pages: Record<centre_id, PageSummary[]>` (no `html`) for every centre that reached parse.
- `pipeline/fetch/centre.ts` -- produces the pages (list then detail); detail failures keep `status`.
- `pipeline/fetch/visits.ts` -- `VISIT_LOG_PATH`, `readVisitLog` (read-only; reuse in merge).
- `pipeline/config.ts` -- `VISIT_WINDOW_MS`.
- `pipeline/stages/publish.ts:55-73` -- atomic write pattern (temp + rename + cleanup) to mirror.
- `pipeline/stages/paths.ts` -- add `STATE_PATH` (`data/state/state.json`).
- Readers set `source_url = finalUrl ?? url` of the page a listing was parsed from (`pipeline/readers/*/index.ts`); an ok centre already failed if any detail page failed.
- `tests/collect.test.ts` -- asserts whole `CollectResult` with `toEqual`; update for `pages`.
- `tests/import-rules.test.ts` -- layer allowlist; new stage files must pass.

## Tasks & Acceptance

**Execution:**
- `shared/listing.ts` -- add `listingSchema`/`Listing` (normalised fields, `starts_at` ISO with `+01:00`/`+02:00`, `id` pattern) -- one shared shape for state and the later snapshot.
- `shared/state.ts` -- `STATE_VERSION = 1`, `storedListingSchema`, `centreStateSchema`, `stateSchema` (unique sorted ids per centre, listing `centre_id` equals its key), `emptyState()` -- merge's own versioned schema.
- `shared/directory.ts`, `web/src/search/search.ts` -- move `formatAddress` to shared -- one address format for fallback and UI.
- `pipeline/stages/collect.ts` -- return `pages` summaries -- input for `link_ok`.
- `pipeline/stages/normalise.ts` -- pure `berlinOffset`/`startsAt`, `normaliseCentre(centre, raw, pages): Listing[]` (ordered by id), and `normaliseOutcome` passing failed/skipped through -- AD-7 / FR8.
- `pipeline/stages/merge.ts` -- pure `mergeRun({ state, log, outcomes, visits, runAt })` → `{ state, log }`; `readState(path)`; `writeMergeResult(result, { statePath, visitLogPath })` atomic -- AD-6, AD-5 persistence.
- `pipeline/stages/paths.ts` -- `STATE_PATH`.
- `tests/normalise.test.ts` -- matrix rows for offsets, DST edges, fallback, ids, duplicates, `link_ok`.
- `tests/merge.test.ts` -- tombstones, reappearance, baseline, same-minute ids end to end through normalise+merge, failed-run retention, skipped no-op, past pruning, visit-log append/24 h drop, read/write round-trip in a temp dir, invalid state and invalid output write nothing.
- `tests/state-writers.test.ts` -- scans `pipeline/`, `tools/`, `shared/`, `web/` sources: only `pipeline/stages/merge.ts` references `STATE_PATH`/`VISIT_LOG_PATH` together with an fs write call -- "only merge writes state".
- `tests/collect.test.ts` -- update expectations for `pages`.

**Acceptance Criteria:**
- Given the KuferWeb and ITEM KG fixture results via `runReaderOnFixtures`, when normalised with their fixture pages, then every listing passes `listingSchema`, ids are unique per centre, and `link_ok` is true for each.
- Given two consecutive `mergeRun` results, when each is written with `writeMergeResult` to a temp dir and read back with `readState`/`readVisitLog`, then the round-tripped state equals the in-memory result and validates against `stateSchema` with `stateVersion: 1`.
- Given the whole repo, when `npm run typecheck` and `npm test` run, then both pass, including import rules.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 33 findings — high 0, medium 6, low 17, false 10, maybe-false 0
- findings:
  - `medium` `defer` Blind: same-minute ids are positional, so history attaches to the wrong session — real (test records it), but AD-7 and the story AC prescribe numbering by place; a content-matching fix changes the architecture rule. Deferred for an AD-7 decision before Epic 3's "New" badge.
  - `medium` `patch` Blind: `normaliseOutcome` defaults `pages = []`, silently giving `link_ok: false` if 2.6 forgets pages — made `pages` required.
  - `low` `reject` Blind: `contentKey` lists fields by hand — a future field would be ignored only for duplicate collapse/tie-break; unlikely in everyday use and the guard is more than a direct fix.
  - `low` `reject` Blind: schema failure in `normaliseOutcome` drops the zod reason — same `failed('schema')` convention as `checkParseResult`; logging belongs to Story 2.6.
  - `low` `patch` Blind: `offsetMinutesAt` returns 0 on an unparseable offset name — now throws naming the value.
  - `medium` `patch` Blind: two separate atomic writes; state can advance while visits are lost (budget under-count) — visit log now written first, docstring states the order.
  - `low` `patch` Blind: merged visit log never de-duplicates, so a re-run double-charges — `mergeRun` drops exact `(host, at)` duplicates; test added.
  - `low` `reject` Blind: state-writers guard has gaps (indirection, scanned dirs, regex) — a text heuristic by design; stronger import-graph checking adds complexity for an unlikely case.
  - `low` `patch` Blind: `NormalisedOutcome` re-declared, widening `failed.reason` — now derived from `CentreOutcome`.
  - `low` `patch` Blind: path constants imported from mixed modules — both from `./paths.ts` now.
  - `low` `patch` Blind: missing `readState` strict-rejection tests — added a stored listing with an extra field.
  - `low` `reject` Blind: `mergeRun` accepts an ok listing with a foreign `centre_id`, failing only at write — normalise always sets `centre_id` from the centre; write-time validation catches it loudly.
  - `false` `reject` Blind: `link_ok` with trailing-slash/case differences — readers set `source_url` to the fetched page's own `finalUrl ?? url`, so it matches exactly.
  - `false` `reject` Blind: 1947 double-summer-time test breaks on small ICU — Node ships full ICU (the repo's pinned Node); it passed in this run.
  - `false` `reject` Blind: spec does not say how `data/state/` persists between CI runs — AD-12 already commits `data/state/` once per run (Story 2.6).
  - `low` `patch` Blind: collect header overlong line and redundant `pagesById` — rewrapped, `pages` returned directly.
  - `false` `reject` Intent (a): not wired into the real run — Story 2.6 owns fetch → … → publish; the story ACs are stage-level.
  - `false` `reject` Intent (b): same-minute positional ids — duplicate of the deferred Blind row (same root cause; logged there).
  - `low` `reject` Intent (c): past-date pruning also touches failed/skipped centres — AD-6 "unchanged"/"sets nothing" concern run fields and listing replacement; publish drops past listings anyway, so no visible change.
  - `false` `reject` Intent (d): `link_ok` only exercised via unit tests and fixture pages — collect now returns real fetch summaries and its tests cover them; end-to-end flow is 2.6.
  - `false` `reject` Intent (e): guard is a heuristic; visits.json unversioned — spec Design Notes choose this; fetch reads the array format.
  - `false` `reject` Intent (f): AC elements met with no divergence — descriptive, no defect.
  - `medium` `patch` Edge: state renamed before visit log — same root cause as the Blind two-writes row; fixed by writing the visit log first.
  - `low` `reject` Edge: invalid `runAt` — callers pass the run clock; never shown reachable, and `toISOString` already fails loudly.
  - `low` `patch` Edge: unrecognised Intl offset name gives `+00:00` — same fix as the Blind offset row (throws).
  - `medium` `patch` Edge: `pages` default `[]` — same fix as the Blind pages row.
  - `low` `reject` Edge: `stripComments` mis-handles `/*` inside strings — heuristic test helper; no such source exists and a tokenizer adds complexity.
  - `low` `reject` Edge: writer building the path without the names passes the guard — same heuristic limitation as the Blind guard row.
  - `false` `reject` Edge: pruning breaks skipped byte-identical — the spec matrix row is about outcome fields; pruning is specified for every centre in Boundaries, and the test uses future dates as intended.
  - `false` `reject` Edge: `withoutFragment` WHATWG-normalises URLs — normalised URLs denote the same resource fetch requests; that is equality, not a looser rule.
  - `low` `patch` VG: cross-field id/centre-key checks untested separately — added three single-rule rejection cases and one accept case.
  - `low` `defer` VG: `writeAtomic` cleanup/partial-failure untested — filed as defer; deferred to Story 2.6 wiring.
  - `medium` `patch` VG other: state written before visit log — same root cause as the Blind two-writes row; fixed.

## Design Notes

- Detail-page proof for `link_ok`: readers fail a centre when any detail page fails, so on `ok` runs detail-sourced listings are true; a listing whose `source_url` is a list page stays false and the UI falls back to `test_page_url`, which is the conservative reading of "link_ok comes only from detail-page fetches".
- Pruning past listings regardless of outcome keeps state bounded; publish drops them anyway (AD-11), so a failed centre's visible set is unchanged.
- Visit log stays in its own `visits.json` array file because fetch already reads that format; `stateVersion` lives in `state.json`.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all tests pass

## Auto Run Result

Status: done

**Summary:** Added a pure normalise stage (Europe/Berlin offset via `Intl`, centre-address fallback, AD-7 ids with `#2`/`#3`, `link_ok` from this run's 2xx detail pages) and a merge stage, the only writer of `data/state/`: ok/failed/skipped semantics, tombstones with kept `first_seen_at`, `baseline` on a centre's first ok run, past-date pruning, a versioned `state.json` (`stateVersion: 1`) and the persisted 24 h visit log. Collect now also returns per-centre page summaries. Not wired into `npm run pipeline` (Story 2.6).

**Files changed:**
- `shared/listing.ts` -- normalised `listingSchema`/`Listing`, id pattern and cross-field `checkListing`.
- `shared/state.ts` -- new: `STATE_VERSION`, stored-listing, centre-state and state schemas, `emptyState`, `sortListings`.
- `shared/directory.ts` -- `formatAddress` moved here.
- `shared/reader.ts` -- `PageSummary`, `summarisePage`.
- `web/src/search/search.ts` -- re-exports `formatAddress` from shared.
- `pipeline/stages/collect.ts` -- returns `pages` per parsed centre.
- `pipeline/stages/normalise.ts` -- new normalise stage.
- `pipeline/stages/merge.ts` -- new merge stage with `mergeRun`, `readState`, `writeMergeResult` (visit log first, then state).
- `pipeline/stages/paths.ts` -- `STATE_PATH`.
- `pipeline/readers/fixture-runner.ts` -- `loadFixturePages` extracted (behaviour unchanged).
- `tests/normalise.test.ts`, `tests/merge.test.ts`, `tests/state-writers.test.ts` -- new; `tests/collect.test.ts` -- updated for `pages`.

**Review findings:** 33 findings. Patches applied for 9 entries (2 medium: two-file write order, required `pages`; 7 low: offset-name throw, visit dedupe, derived outcome type, path imports, collect tidy-up, cross-field tests, strict-read test). Deferred 2: positional same-minute ids (medium, needs an AD-7 decision) and untested `writeAtomic` cleanup (low). Rejected: every other row with its reason in the Review Triage Log above.

**Follow-up review recommended:** true. Patched by verdict: medium 2 entries (write order, required `pages`), low 7 entries. Specific unverified risk: the write order (visits first) plus `(host, at)` dedupe is only proven by unit tests; how Story 2.6's rerun-on-rejected-push path interacts with it is unverified.

**Verification:** `npm run typecheck` -- clean. `npm test` -- 29 files, 1047 passed, 1 skipped. Matrix audit: every I/O row has a passing test (offset/DST table, same-minute, duplicates, `link_ok` table, merge outcome, pruning, bad-state rows).

**Residual risks:** same-minute id positional behaviour (deferred); `collect` `pages` key order follows completion order (not deterministic if serialised in 2.6); nothing calls the new stages yet.

