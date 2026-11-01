---
title: 'Story 4.1: Parse statistics in every run'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_revision: '8ffc7834767badf2a807835ab97ad3ef032187be'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/specs/spec-einbuergerungstest-search/parse-coverage.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A daily run logs ok/failed/skipped per centre but never says how many centres parse, why the rest do not, or what the coverage percentage is, so the operator cannot measure Epic 4's 90% target.

**Approach:** A pure, shared classification puts every directory centre into exactly one coverage category (per `parse-coverage.md`); the run logs one coverage summary line and adds a `coverage` object to the run report. The coverage script (Story 4.2) will reuse the same function.

## Boundaries & Constraints

**Always:**
- Categories, in this fixed order: `parsed`, `parsed-empty`, `failed`, `no-reader`, `unreachable`, `no-test-page`, `pdf-only`, `robots`, `opted-out`, `budget`. Every directory centre lands in exactly one; `by_category` sums to the directory size.
- Coverage = (`parsed` + `parsed-empty`) / (`parsed` + `parsed-empty` + `failed` + `no-reader`); `percent` rounded to one decimal, `null` when the denominator is 0.
- The classifier lives in `shared/` (pure, no I/O) because `tools/` may import only `shared`, `pipeline/fetch` and `pipeline/config.ts` (`tests/import-rules.test.ts`).
- Classification uses the outcomes after normalise/locate (a `schema` failure from normalise is `failed`).
- PDF-only is an operator flag on the directory entry: optional `pdf_only: true`, allowed only with reader `none`.

**Never:**
- No change to `snapshot.json`, its schema, the About page, translation files or state semantics (`ok`/`failed`/`skipped` and Story 3.12 skip recording stay as they are).
- No new network requests; no change to what collect fetches.
- No change to alert behaviour (`tools/alerts.ts` keeps reading only `systems`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected category | Notes |
|----------|--------------|-------------------|-------|
| ok with dates | outcome `ok`, ≥ 1 listing | `parsed` | |
| ok, none listed | outcome `ok`, 0 listings | `parsed-empty` | readers return `ok`-empty only with structure proof (AD-4) |
| reader failure | `failed:structure-missing` / `detail-page` / `date-unparseable` / `schema` / `reader-error` | `failed`, reason counted in `by_reason` | |
| test page unreachable | `failed:list-page` | `unreachable` | not in `by_reason` |
| no reader, has test page | reader `none`, `test_page_url` set, `skipped:no-reader` | `no-reader` | |
| no reader, no test page | reader `none`, `test_page_url` null | `no-test-page` | |
| PDF only | `pdf_only: true` (reader `none`) | `pdf-only` | wins over `no-reader`/`no-test-page` |
| opted out | `opted_out: true` | `opted-out` | wins over everything |
| robots / budget | `skipped:robots` / `skipped:budget` | `robots` / `budget` | |
| no outcome | reader set, no outcome this run (replay after a directory edit) | `failed`, reason `not-run` | keeps the sum equal to directory size |
| empty denominator | all centres outside it | `percent: null` | log shows `-` |
| failed run | any `failedReport(stage)` | report `coverage: null`, no coverage log line | |

</intent-contract>

## Code Map

- `shared/directory.ts` -- `centreFieldsSchema` (strict) + `checkCentre`: add optional `pdf_only: z.literal(true)` and the check "pdf_only only with reader none".
- `shared/coverage.ts` (new) -- `COVERAGE_CATEGORIES`, `classifyCentre(centre, outcome | undefined)`, `buildCoverage(directory, outcomes)`, `formatCoverageLine(coverage)`. Outcome input is structural: `{kind:'ok'; listings: readonly unknown[]} | {kind:'failed'|'skipped'; reason: string}` so `LocatedOutcome` fits without importing stages.
- `pipeline/fetch/centre.ts:12-41` -- source of `failed:list-page` (list page not 2xx / timeout / decode) and `skipped:robots|budget`.
- `pipeline/stages/collect.ts:85-92` -- `skipped:opted-out`, `skipped:no-reader`, `failed:reader-error`.
- `pipeline/stages/normalise.ts:255` -- `failed:schema`.
- `pipeline/stages/report.ts` -- `RunReport`, `RunReportInput`, `buildRunReport`, `failedReport`: add `coverage: Coverage | null`.
- `pipeline/stages/run.ts` (~line 300, after the run summary `log(...)`) -- compute coverage from `directory` + `located.outcomes`, log `formatCoverageLine`, pass it to `buildRunReport`.
- `tools/alerts.ts:17-22` -- mirrored `Report` type; extra field is ignored (read-only evidence, no change needed).
- `tests/report.test.ts`, `tests/run.test.ts:310` -- existing report and run-summary assertions to extend.

## Tasks & Acceptance

**Execution:**
- `shared/directory.ts` -- add optional `pdf_only: z.literal(true)` and the reader-`none` check -- lets the operator mark PDF-only centres (Story 4.4 uses it).
- `shared/coverage.ts` -- implement categories, classifier, aggregation (`by_category` with all ten keys, `by_reason` sorted by reason, `by_reader` for each reader value except `none` present in the directory with `{assigned, parsed, parsed-empty, failed, unreachable, skipped}` where `skipped` = robots + budget + opted-out + pdf-only, and `coverage: {percent, numerator, denominator}`) and the log line -- one function shared by pipeline and Story 4.2.
- `pipeline/stages/report.ts` -- add `coverage` to the report; `failedReport` sets `null` -- run report carries the stats.
- `pipeline/stages/run.ts` -- log the coverage line after the run summary and pass coverage into the report; update the module comment -- operator sees it in the log.
- `tests/coverage.test.ts` (new) -- every matrix row, precedence, sum equals directory size, formula, `null` percent, line format.
- `tests/report.test.ts`, `tests/run.test.ts`, `tests/directory.test.ts` -- report shape incl. `coverage: null` on failure, run log includes the coverage line, `pdf_only` schema check.

**Acceptance Criteria:**
- Given a run that publishes, when it ends, then the log's last lines are the run summary followed by `coverage <num>/<den> (<percent>%): parsed N, parsed-empty N, failed N, no-reader N, unreachable N, no-test-page N, pdf-only N, robots N, opted-out N, budget N` (`-` instead of `<percent>%` when the denominator is 0).
- Given the same run with `--report <file>`, when the file is read, then it has `coverage.by_category`, `coverage.by_reason`, `coverage.by_reader`, `coverage.coverage`, and `by_category` values sum to the number of directory centres.
- Given the current committed directory, when `npm run check:directory` runs, then it passes unchanged (no entry needs `pdf_only`).
- Given this story is done, when `git diff` is read, then `shared/snapshot.ts`, `web/` and `data/public/` are untouched.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 21 findings — high 0, medium 1, low 13, false 5, maybe-false 0 (2 rows below are duplicates logged under their own layer)
- findings:
  - `[low]` `[reject]` Blind: `pdf-only` term in `by_reader.skipped` can never run (pdf_only requires reader `none`, which `by_reader` skips) — harmless dead branch the spec defines; no one meets it.
  - `[low]` `[reject]` Blind: `by_reader` buckets can sum below `assigned` for a reader set but unregistered — only reachable with a partial registry in tests; `READER_REGISTRY` registers every non-`none` reader; fix needs a new bucket.
  - `[low]` `[patch]` Blind: `docs/operations.md` does not mention the coverage line, report field or `pdf_only` flag — added a "Parse coverage" section.
  - `[false]` `[reject]` Blind: unrelated `centres.json` deletions in the working tree — not part of this diff; an external edit made during the run, left untouched and not committed.
  - `[low]` `[patch]` Blind: `CoverageCentre` re-declares `pdf_only` — now picked from `Centre`.
  - `[low]` `[patch]` Blind: unknown skip reason → `failed` fallback untested — added matrix row `skipped('mystery')`.
  - `[low]` `[patch]` Blind: stale run-log test title; `.at(-2)` asserts don't pin `.at(-1)` — title renamed; the other trailing-line assertions already pin the coverage line in the main test, so not widened.
  - `[low]` `[reject]` Blind: report test fixture's default coverage doesn't match its directory — test-only fixture; `buildRunReport` passes coverage through; no user or caller harm.
  - `[false]` `[reject]` Blind: alerts contract test doesn't check `parseReport` tolerates `coverage` — the test parses a report built with `coverage` and asserts it is not null, which is that check.
  - `[low]` `[reject]` Edge: same as row 2 (`by_reader` sum with an unregistered reader) — same refutation.
  - `[medium]` `[patch]` Verification gap: a `pdf_only` centre would be copied into `snapshot.json` via `...centre` in `buildSnapshot`, changing public data — `pdf_only` stripped in `pipeline/stages/publish.ts`, test in `tests/snapshot.test.ts`.
  - `[false]` `[reject]` Verification gap (other): `centres.json` working-tree change — same as row 4.
  - `[low]` `[reject]` Verification gap (other): unreachable `pdf-only` term — same as row 1.
  - `[low]` `[reject]` Intent: daily run counts reader-`none` centres with a `test_page_url` as `no-reader` without checking reachability — the daily run never fetches those pages (no new requests allowed); Story 4.2's script measures reachability.
  - `[low]` `[reject]` Intent: `unreachable` keyed to `failed:list-page` (the reader's list URL) rather than `test_page_url` — documented in Design Notes; the list page is the page the reader reads.
  - `[low]` `[patch]` Intent: `parse-coverage.md` says pdf-only is set "in the reader config", diff uses top-level `pdf_only` — companion wording corrected and decision logged in the spec memlog.
  - `[false]` `[reject]` Intent: `no-test-page` ignores discovery — discovery arrives in Story 4.3; until then `test_page_url === null` is the whole rule.
  - `[low]` `[reject]` Intent: reuse by the Story 4.2 script is untested — structural outcome type is in place; Story 4.2 tests it.
  - `[low]` `[reject]` Intent: fallback branches (`not-run`, unknown skip, unregistered reader, `by_reader.unreachable`) not in the source docs — `not-run` and `unreachable` are spec decisions; unknown skip now tested; unregistered reader as row 2.
  - `[low]` `[reject]` Intent: stats live only in the Actions log and transient report — matches the story ("run log and run report", operator-only); runbook now explains them.
  - `[false]` `[reject]` Intent: coverage line logged on replays and unchanged-snapshot runs — both publish, which is what the story asks for.

## Design Notes

`parse-coverage.md` says pdf-only is "set by the operator in the reader config", but `checkCentre` requires `reader_config` null for reader `none`; a top-level optional `pdf_only: true` keeps that rule and keeps unflagged entries byte-identical. The architecture describes `unreachable` as the test page failing; in the daily run the fetched list page (`reader_config.list_url`) is that page, so `failed:list-page` maps to it.

Example report fragment:

```json
"coverage": {"by_category": {"parsed": 20, "parsed-empty": 7, "failed": 2, "no-reader": 42, "unreachable": 0, "no-test-page": 43, "pdf-only": 0, "robots": 0, "opted-out": 0, "budget": 5},
  "by_reason": {"structure-missing": 2},
  "by_reader": {"itemkg": {"assigned": 21, "parsed": 12, "parsed-empty": 3, "failed": 1, "unreachable": 0, "skipped": 5}},
  "coverage": {"percent": 37.5, "numerator": 27, "denominator": 72}}
```

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass, including `tests/coverage.test.ts` and `tests/import-rules.test.ts`
- `npm run check:directory` -- expected: passes

## Auto Run Result

Status: done

**Summary:** Every daily run that publishes now classifies each directory centre into one of ten coverage categories, logs a `coverage <num>/<den> (<percent>%): …` line after the run summary, and adds a `coverage` object (`by_category`, `by_reason`, `by_reader`, `coverage`) to the run report (`null` on a failed run). The classifier is pure and lives in `shared/` so the Story 4.2 script can reuse it. Directory entries may carry `pdf_only: true` (reader `none` only); it never reaches `snapshot.json`.

**Files changed:**
- `shared/coverage.ts` -- new: categories, `classifyCentre`, `buildCoverage`, `formatCoverageLine`.
- `shared/directory.ts` -- optional `pdf_only: true`, allowed only with reader `none`.
- `pipeline/stages/report.ts` -- `coverage` field on the run report.
- `pipeline/stages/run.ts` -- computes and logs coverage, passes it to the report.
- `pipeline/stages/publish.ts` -- strips `pdf_only` from snapshot centres.
- `docs/operations.md` -- "Parse coverage" section.
- `tests/coverage.test.ts` (new), `tests/run.test.ts`, `tests/report.test.ts`, `tests/directory.test.ts`, `tests/alerts.test.ts`, `tests/snapshot.test.ts` -- matrix, report shape, log line, schema and snapshot checks.
- `_bmad-output/specs/spec-einbuergerungstest-search/parse-coverage.md` + `.memlog.md` -- pdf-only marking wording.

**Review:** 21 findings. Patched 6 (1 medium: `pdf_only` leaking into the snapshot; 5 low: runbook, type pick, unknown-skip test, test title, companion wording). Deferred 0. Rejected 15 (5 false, 10 low), each with its reason in the triage log.

**Follow-up review recommended:** false -- one medium and no high patched on a first pass; the medium fix is covered by a direct test.

**Verification:** `npm run typecheck` passes; `npm run check:directory` passes; `npm run build` passes. `npm test` in the working copy: 1493 passed, 1 failed -- `tests/directory.test.ts` "holds every snapshot centre", caused by uncommitted external edits to `data/directory/centres.json` (centres removed while still in `snapshot.json`). On a clean copy of HEAD plus this story's diff: 40 files, 1494 passed, 1 skipped.

**Residual risks:**
- `data/directory/centres.json` has uncommitted edits made outside this run (116 entries, was 119); they are not part of this commit and currently fail the committed-data test until the next pipeline run republishes the snapshot.
- In the daily run, `no-reader` counts a reader-`none` centre with a `test_page_url` whether or not the page answers; reachability is measured by the Story 4.2 script.
