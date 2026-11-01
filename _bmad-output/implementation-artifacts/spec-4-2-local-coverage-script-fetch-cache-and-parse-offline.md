---
title: 'Story 4.2: Local coverage script: fetch, cache and parse offline'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_revision: '091407712e3cc50140b0f115475edf68eeb45a92'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/specs/spec-einbuergerungstest-search/parse-coverage.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-1-parse-statistics-in-every-run.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** To raise parse coverage the operator must try readers against every centre's test page many times, but each daily-run style fetch costs one of a host's 4 daily visits, and centres with reader `none` are never fetched or tried at all.

**Approach:** A local, operator-run CLI (`npm run coverage`). `--fetch` fetches each centre's pages once, politely, into a gitignored cache and records its visits; without `--fetch` it parses only the cache, with no network, classifies every centre with Story 4.1's `classifyCentre`/`buildCoverage`, and tries every existing reader on every reader-`none` centre, writing the readers that parse as proposals for operator review.

## Boundaries & Constraints

**Always:**
- All requests go through `createFetchClient` (`pipeline/fetch`): bot user agent, robots.txt, per-host serial requests with delay, timeout. One client per `--fetch` run, with `isHostBlocked` = `overBudget(visitLog, host, runAt)`.
- A host already at 4 visits in 24 h is never contacted; its centres are `budget`. After `--fetch`, every host the client contacted (`client.stats().rawRequests`) is added to `data/state/visits.json` with merge's `mergeVisitLog` + `writeVisitLog`, `at` = the run's `runAt`. The operator commits that file.
- A URL already in the cache is not requested again unless `--refresh`; a cached `budget` entry is always retried by `--fetch`.
- Without `--fetch` the script creates no fetch client and sends no request (enforced: no client is constructed on that path).
- The cache lives in `data/coverage/cache/` (gitignored with the rest of `data/coverage/`); one JSON file per URL keyed by a hash of the URL, holding `url`, `fetched_at`, `result` (`ok` / `unreachable` / `robots` / `budget`), `status`, `final_url`, `html` (null unless `ok`).
- Classification and totals come only from `shared/coverage.ts` (Story 4.1); the script maps cache facts to its outcome shape.
- Reader-`none` centres are tried against every reader in `READER_REGISTRY`; a reader "matches" a test page when its `parse` on the list page alone does not return `failed:structure-missing`. Only matching readers' detail pages are fetched.
- Proposals (readers returning `ok`, i.e. `parsed` or `parsed-empty`) are written to `data/coverage/reader-proposals.json`; `data/directory/centres.json` is never written.

**Never:**
- No run in CI or on a schedule: no workflow references the script.
- No change to the daily pipeline's behaviour, `snapshot.json`, state files other than `visits.json`, readers' parsing logic, or the reader contract.
- No headless browser, no PDF handling, no test-page discovery (Story 4.3).
- No page bodies in committed files or in the `--json` report.

## I/O & Edge-Case Matrix

Offline parse, per centre (outcome fed to `classifyCentre`):

| Scenario | Cache state | Expected outcome → category |
|----------|-------------|-----------------------------|
| opted out | any | not looked at → `opted-out` |
| pdf only | any | → `pdf-only` |
| reader `none`, no `test_page_url` | — | → `no-test-page` |
| reader set, list page `ok`, reader parses | list + details cached | reader result via `parseCentre` → `parsed` / `parsed-empty` / `failed:<reason>` |
| reader set, detail page missing from cache | list cached, a detail not | detail passed as `status: null, html: null` (reader decides, e.g. `failed:detail-page`) |
| list page unreachable | `result: unreachable` | `failed:list-page` → `unreachable` |
| robots / budget | `result: robots` / `budget` | `skipped:robots` / `skipped:budget` |
| page never fetched | no cache entry for the list URL | `failed:not-fetched` → `failed` |
| reader `none`, test page `ok` | test page cached | `skipped:no-reader` → `no-reader`; each registered reader tried; `ok` results become proposals |
| reader `none`, test page not `ok` | unreachable/robots/budget/missing | as the rows above, no candidates tried |

Fetch (`--fetch`):

| Scenario | Expected | Error handling |
|----------|----------|----------------|
| host over budget at start | nothing sent to it; cache entry `budget` | — |
| robots disallow / `host-blocked` | cache entry `robots` / `budget` | — |
| non-2xx, timeout, network error | cache entry `unreachable` with status | — |
| visit log unreadable or invalid | exit 1 before any request | message names the file |

</intent-contract>

## Code Map

- `shared/coverage.ts` -- `classifyCentre`, `buildCoverage`, `formatCoverageLine`, `CoverageOutcome` (Story 4.1); reuse as-is.
- `pipeline/fetch/index.ts:104` -- `createFetchClient({ isHostBlocked })`; `get()` returns `FetchFailure.reason` `robots-disallowed` / `host-blocked` / `timeout` / `network-error` / `http-error` / `too-many-redirects`; `stats().rawRequests` = hosts contacted.
- `pipeline/fetch/visits.ts` -- `readVisitLog`, `overBudget`, `VISIT_LOG_PATH`.
- `pipeline/fetch/centre.ts:24-60` -- how the daily run maps fetch failures to outcomes; mirror the mapping (http-error/timeout/network/too-many-redirects → `list-page`).
- `pipeline/stages/merge.ts:68,284` -- `mergeVisitLog`, `writeVisitLog` for recording visits.
- `pipeline/stages/parse.ts` -- `parseCentre` (never throws; `reader-error` / `schema`).
- `shared/reader.ts:64` -- `selectDetailUrls(plan, listPages)` (dedupe + cap) for detail URLs, as fetch and `pipeline/readers/fixture-runner.ts:37` do.
- `pipeline/stages/run.ts:53` -- `READER_REGISTRY` (import it; `run.ts` only runs under `import.meta.main`).
- `pipeline/readers/{kuferweb,itemkg}/index.ts` -- `plan` uses `reader_config.list_url ?? test_page_url`; `parse` returns `failed('structure-missing')` first when the list container is absent (the "matches" test).
- `pipeline/stages/paths.ts` -- path constants; add the coverage paths here.
- `tests/import-rules.test.ts:50` -- `pipeline/stages` may import shared, readers, fetch, config: the script lives in `pipeline/stages/` (tools may not import readers).
- `docs/operations.md:98` -- existing "Parse coverage" section to extend.

## Tasks & Acceptance

**Execution:**
- `pipeline/stages/paths.ts` -- add `COVERAGE_DIR`, `COVERAGE_CACHE_DIR`, `READER_PROPOSALS_PATH`.
- `.gitignore` -- add `data/coverage/`.
- `pipeline/stages/coverage-cache.ts` (new) -- read/write one cache entry per URL (zod-validated, atomic write), URL → filename by SHA-256.
- `pipeline/stages/coverage-script.ts` (new) -- `fetchCoverage(options)` and `parseCoverage(options)` with injectable paths, clock, `clientOptions` and `readers` (tests pass a fake `fetchImpl`); CLI `--fetch`, `--refresh` (only with `--fetch`), `--json <file>`; prints a per-centre table (centre, category, reason, listings, reader), a "Reader `none` centres" section (centre, reader, outcome, reason), the `formatCoverageLine` total, and the proposals count; writes `reader-proposals.json` (`[{centre_id, reader, outcome: 'parsed'|'parsed-empty', listings}]`, sorted). `--fetch` runs fetch then the offline parse.
- `package.json` -- `"coverage": "node pipeline/stages/coverage-script.ts"`.
- `docs/operations.md` -- extend "Parse coverage": how to run, cache location, commit `data/state/visits.json` after `--fetch`, never in CI, how to apply proposals.
- `tests/coverage-script.test.ts` (new) -- every matrix row with a fake transport and temp dirs; zero requests without `--fetch` (fake `fetchImpl` never called); cache reuse and `--refresh`; budget host never contacted; visits written once per contacted host; proposals file content; `centres.json` untouched.

**Acceptance Criteria:**
- Given a temp directory, cache and visit log and a fake transport, when `fetchCoverage` runs twice without `refresh`, then the second run sends no request for URLs cached as `ok`, `unreachable` or `robots`.
- Given a host with 4 visits in the last 24 h, when `--fetch` runs, then no request (robots.txt included) reaches that host and its centres report `budget`.
- Given any directory and cache, when `npm run coverage` runs without `--fetch`, then the per-centre categories, `by_category` and the coverage line equal `buildCoverage` over the outcomes the cache implies, and `by_category` sums to the directory size.
- Given `.github/workflows/`, when searched, then no workflow runs `coverage-script` or `npm run coverage`.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 30 findings — high 0, medium 3, low 19, false 8, maybe-false 0
- findings:
  - `[low]` `[reject]` Intent: no real `--fetch` was run against the live directory — running it is an operator action with side effects on third-party hosts; Story 4.4 starts with it.
  - `[low]` `[reject]` Intent: "coverage rises after proposals are applied" has no test — `parseCoverage` re-reads the directory each run; no user harm.
  - `[false]` `[reject]` Intent: `centres.json` changed outside the diff — external operator edits, not part of this story, not committed.
  - `[false]` `[reject]` Intent: `readDirectory` exported from `run.ts` — no behaviour change; needed for reuse.
  - `[low]` `[patch]` Verification gap: no test that a non-matching reader's detail pages are not fetched — added test with a linked page lacking the reader's list container.
  - `[medium]` `[patch]` Verification gap: visits-on-failure path untested — grouped with the Promise.all finding below; test added that fails on the old code.
  - `[medium]` `[patch]` Blind: `Promise.all` rejects early so `finally` records visits before in-flight requests finish — switched to `Promise.allSettled`, visits written after all settle, first error rethrown.
  - `[medium]` `[patch]` Blind: `--fetch --refresh` overwrites a cached `ok` page with `budget` — cached `ok` entry kept when the host is over budget; test added.
  - `[low]` `[patch]` Blind: local `visits.json` may be stale vs CI — runbook now says `git pull` before `--fetch`.
  - `[low]` `[reject]` Blind: every parse overwrites `reader-proposals.json` — by design the file reflects the current cache.
  - `[low]` `[patch]` Blind: `fetched` counts budget-blocked URLs — counts only sent requests now.
  - `[low]` `[patch]` Blind: reader-none table lacks listings — `listings` column added.
  - `[low]` `[patch]` Blind: `--json report.json` example writes into the repo root — example now `data/coverage/report.json`.
  - `[low]` `[reject]` Blind: duplicate atomic writer vs `merge.ts` — no named harm; refactor touches merge.
  - `[false]` `[reject]` Blind: script belongs in `tools/` — `tools/` may not import readers (`tests/import-rules.test.ts:51`).
  - `[low]` `[reject]` Blind: tests leak temp dirs — same pattern as the existing suite; OS temp.
  - `[low]` `[reject]` Blind: buildCoverage equality test is partly self-referential — it also asserts fixed numbers independently.
  - `[low]` `[reject]` Blind: "creates no client" not literally asserted — the no-request assertions (fake transport and global fetch spy) cover the user-visible guarantee.
  - `[low]` `[reject]` Blind: no tests for multi-list plans or cross-host redirects — both readers plan one list URL; redirect hops are counted by the client's `rawRequests`.
  - `[low]` `[reject]` Blind: untested guards (URL mismatch, invalid JSON, `--json` without value, throwing plan) — defensive paths, no user impact.
  - `[low]` `[reject]` Blind: `matches` treats `reader-error` as a match — a throw on a list-only parse is rare; worst case a few extra polite requests.
  - `[low]` `[reject]` Blind: robots/budget candidates shown as `failed` — reason column shows `robots`/`budget`; cosmetic.
  - `[false]` `[reject]` Blind: `centres.json` and spec not in the patch — external edit; spec is intentionally excluded from the review diff.
  - `[medium]` `[patch]` Edge: same as the Promise.all finding — same fix.
  - `[low]` `[reject]` Edge: `writeVisitLog` error in finally hides the fetch error — structure changed; a failing visit-log write now surfaces itself.
  - `[low]` `[patch]` Edge: operator not told to commit visits after a failed fetch — `runCoverage` now prints the commit reminder on fetch failure.
  - `[low]` `[reject]` Edge: URLs differing only by `#fragment` requested twice — rare; one extra request within the same visit.
  - `[low]` `[patch]` Edge: summary counts unsent requests — same as the `fetched` finding.
  - `[false]` `[reject]` Edge: unregistered reader → `reader-error` vs daily `no-reader` — every non-`none` reader is in `READER_REGISTRY`; unreachable.
  - `[false]` `[reject]` Edge: unreachable reader-none test page leaves the denominator — `parse-coverage.md` defines `unreachable` as outside it.

## Design Notes

The matches test reuses each reader's own structure check instead of a new contract method: both readers return `failed('structure-missing')` before reading detail pages when their list container is missing (`kuferweb/index.ts:464-466`, `itemkg/index.ts:331-333`). For a reader-`none` centre the candidate plan is `reader.plan({ ...centre, reader, reader_config: null })`, so `listUrls = [test_page_url]`.

`not-fetched` keeps an incomplete cache visible: such centres sit in the denominator as `failed`, so coverage cannot look better than what was actually read.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass, including `tests/coverage-script.test.ts` and `tests/import-rules.test.ts`
- `npm run coverage` -- expected: exits 0 with an empty cache, every centre `failed:not-fetched` or outside the denominator, and no network request

## Auto Run Result

Status: done

**Summary:** `npm run coverage` is a local, operator-only script. `--fetch` fetches each centre's list and detail pages (reader-`none` centres: test page plus detail pages of matching readers) through the polite client into `data/coverage/cache/` (gitignored), respects and records the per-host visit budget in `data/state/visits.json`, and reuses cached pages unless `--refresh`. Without `--fetch` it parses the cache offline with no network, classifies every centre with Story 4.1's `shared/coverage.ts`, tries every reader on every reader-`none` centre and writes proposals to `data/coverage/reader-proposals.json`. `centres.json` is never written.

**Files changed:**
- `pipeline/stages/coverage-script.ts` (new) -- fetch, offline parse, report, CLI.
- `pipeline/stages/coverage-cache.ts` (new) -- one validated JSON file per URL, atomic writes.
- `pipeline/stages/paths.ts` -- coverage paths.
- `pipeline/stages/run.ts` -- exports `readDirectory`.
- `package.json` -- `coverage` script. `.gitignore` -- `data/coverage/`.
- `docs/operations.md` -- coverage script section.
- `tests/coverage-script.test.ts` (new) -- matrix, budget, cache, visits, proposals, no-network, workflows.

**Review:** 30 findings. Patched 10 rows in 7 fixes (3 medium: visits written before in-flight requests finished, refresh overwriting cached pages, untested failure path; 7 low). Deferred 0. Rejected 20 (8 false, 12 low), reasons in the triage log.

**Follow-up review recommended:** false -- three medium rows share two fixes, each covered by a test confirmed to fail on the old code (visits) or asserting the kept entry (refresh); no unverified risk named.

**Verification:** `npm run typecheck` clean. `npm test`: 1521 passed, 1 failed -- `tests/directory.test.ts` "holds every snapshot centre", failing since commit 0914077 because `data/public/snapshot.json` still lists the 8 centres removed from the directory; unrelated to this story, clears on the next pipeline run. `npm run coverage` with an empty cache exits 0 with no request.

**Residual risks:**
- No real `--fetch` has been run yet; first live run is the operator's (Story 4.4 starts there).
- `data/directory/centres.json` has uncommitted operator edits (websites and two test pages) not included in this commit.
