---
title: 'Story 3.11: Collect only once a day'
type: 'bugfix'
created: '2026-11-01'
status: 'done'
baseline_revision: '937bd68f6b8542ab412d4581e378b7a2f3773bdf'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/operations.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** `pipeline.yml` collects on every push to `main`, so each code change uses one of each site's 4 visits per 24 h (every host was at 4/4 after 10/29–10/30). The collecting job checks out `${{ github.sha }}`, so a run queued behind another reads a visit log without that run's visits. A run that fails after contacting sites never commits its visits, so the budget under-counts.

**Approach:** Only `schedule` and `workflow_dispatch` collect. A push builds and deploys the pushed SHA from committed data. The collecting job checks out the current tip of `main`. `run.ts --save-visits <file>` writes this run's visits as soon as collect returns (or throws). When the publish job fails, a new step resets to the newest `main`, adds those visits to `data/state/visits.json`, and commits and pushes only that file.

## Boundaries & Constraints

**Always:**
- `publish` (the collecting job) runs only when `github.ref == 'refs/heads/main' && github.event_name != 'push'`. Its checkout uses `ref: refs/heads/main` (not `github.sha`), still `persist-credentials: false`.
- On a push to `main`: `publish` is skipped; `build` checks out `github.sha`, runs `npm run typecheck` and `npm test` (nothing else tested this SHA) and then `npm run build`; `deploy` deploys it. No provider site and no Nominatim request is sent (no `npm run pipeline`).
- On schedule/dispatch: `build` checks out `needs.publish.outputs.sha` and skips the tests (publish ran them), exactly as today. `build` runs only when `publish` succeeded, or was skipped on a push; `deploy` only when `build` succeeded (use `always() && …` conditions, since a skipped `publish` would otherwise skip both).
- `run.ts --save-visits <file>`: after collect (not on `--from-collect`), write this run's visits as a JSON array, also when collect throws (collect must expose the visits made before the throw) and before any later step can fail. No flag → no file.
- Visits-on-failure step in `publish`: `if: failure()`, after `all-failed` and before `stage`. If `$RUNNER_TEMP/visits.json` is missing or `[]`, it logs that there is nothing to record and exits 0. Otherwise `.github/scripts/commit-visits.sh`: fetch `main`, `reset --hard FETCH_HEAD`, run `RECORD_CMD` (`node pipeline/stages/record-visits.ts "$RUNNER_TEMP/visits.json"`), commit only `data/state/visits.json` as `data: record visits from a failed run` if it changed, push; on a rejected push repeat fetch/reset/record, 3 attempts. Same credential handling as `commit-public.sh` (header only on fetch/push, hooks off, bot identity). Idempotent: visits already on `main` change nothing.
- `record-visits.ts` merges with the same rule as merge (dedupe by host + `at`, drop visits older than `VISIT_WINDOW_MS` before now, sorted), validates against `visitLogSchema`, writes atomically, and touches no other file.
- The 3.4 monitor keeps working: on a push run `publish` is `skipped`, which is neither a failure nor a blocker for the ping; the ping fires when `publish` is `success` or `skipped` and `build` and `deploy` succeeded. Reader issues are not evaluated on push runs (no report).
- `tests/workflows.test.ts` asserts the collecting triggers, the collecting job's checkout ref and the visits-on-failure step. The About page "How it works" text still says the websites are read once a day (DE "einmal am Tag", EN "once a day"); a test asserts both.

**Never:** No change to the 05:17 UTC schedule, the concurrency group, the visit budget (4 per rolling 24 h) or `commit-public.sh`'s retry logic. No `npm ci` inside a step that holds the push credential. Nothing but `data/state/visits.json` is committed from a failed run. No change to `ci.yml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Push to main | `event_name: push` | publish skipped; build tests + builds `github.sha`; deploy; no pipeline run | No error expected |
| Schedule | `event_name: schedule` | publish checks out `refs/heads/main`, collects, commits; build uses `publish.outputs.sha` | No error expected |
| Dispatch | `event_name: workflow_dispatch` on main | Same as schedule | No error expected |
| Publish fails after collect | snapshot invalid, pipeline step exits 1, visits.json has 3 visits | Step resets to newest main, appends the 3 visits, commits only `visits.json`, pushes | 3 push attempts, then the step fails |
| Collect throws | collect throws after 2 hosts were contacted | visits.json holds those 2 visits; they reach `main` | No error expected |
| Tests fail before collect | `test` step failed | No visits.json; the step logs "nothing to record", exits 0 | No error expected |
| Push rejected for good | `commit` step failed after 3 attempts | Step records the run's visits on the newest main | 3 attempts |
| Visits already on main | all-failed step failed after a successful commit | Merge changes nothing; no commit; exit 0 | No error expected |
| Old visits | a visit older than 24 h before now in the file | Dropped, like merge does | No error expected |
| Duplicate visit | upstream already has the same host + `at` | Kept once | No error expected |
| Invalid visits file | not a visit array | `record-visits.ts` exits 1 naming the file; nothing written | Step fails |
| Monitor on push | publish skipped, build and deploy success | ping; no failure issue; no reader issues touched | No error expected |

</intent-contract>

## Code Map

- `.github/workflows/pipeline.yml` -- `on:` (keep schedule/push/dispatch); `publish` job `if:` (~line 24) and checkout `ref: ${{ github.sha }}` (~line 37); `pipeline` step (add `--save-visits "$RUNNER_TEMP/visits.json"`); `commit` step (credential pattern to copy); `all-failed` and `stage` steps (Story 3.4; new step goes between them); `build` job (`needs: publish`, checkout `needs.publish.outputs.sha`); `deploy` job; `monitor` job.
- `.github/scripts/commit-public.sh` -- read-only model for the new `commit-visits.sh`: `local_git`/`remote_git` helpers, bot identity, `GIT_AUTH_HEADER` scoping, `ATTEMPTS=3`, `$GITHUB_OUTPUT`.
- `pipeline/stages/collect.ts:43-77` -- `collectRun`: visits come from `client.stats().rawRequests` at the end; a throw inside `Promise.all` loses them. Wrap so a throw is re-thrown as an error carrying `visits` (e.g. exported `CollectError` with `visits: Visit[]`).
- `pipeline/stages/run.ts` -- collect block (~150-170) and `parseCliArgs`; add `saveVisits?: string` / `--save-visits`; write on success and on the collect throw. Story 3.4's `--report` handling stays as it is.
- `pipeline/stages/merge.ts:90-100` -- the visit-log merge (dedupe by host + `at`, window prune, sort) and `serializeVisitLog` (~188). Extract the merge into an exported `mergeVisitLog(log, visits, now)` that `mergeRun` and `record-visits.ts` share.
- `pipeline/fetch/visits.ts` -- `readVisitLog(path)`, `VISIT_LOG_PATH`.
- `pipeline/stages/` -- new `record-visits.ts` CLI (`import.meta.main`): `node pipeline/stages/record-visits.ts <visits-file>`; reads and validates both files, writes `visits.json` atomically (reuse merge's atomic write if exported, else temp file + rename).
- `pipeline/config.ts:56` -- `VISIT_WINDOW_MS`.
- `tools/alerts.ts` -- `shouldPing` (publish must be `success`) → also accept `skipped`; `resolveStage` unchanged.
- `tests/workflows.test.ts` -- triggers test (~line 55), "builds and deploys exactly the SHA the publish job pushed" (must change: build uses `needs.publish.outputs.sha || github.sha` or equivalent), checkout-count test, publish step order test; add the new assertions.
- `tests/workflow-scripts.test.ts` -- runs workflow bash with fake env; add the visits-on-failure step cases (no file, `[]`).
- `tests/commit-public.test.ts` -- how the commit script is tested against a local bare repo; mirror it for `commit-visits.sh`.
- `tests/run.test.ts`, `tests/collect.test.ts`, `tests/merge.test.ts`, `tests/alerts.test.ts` -- extend.
- `web/src/i18n/en.json:7`, `de.json:7` -- `about.how.body` already says "once a day" / "einmal am Tag"; `tests/about.test.tsx` -- add the assertion if missing.
- `docs/operations.md` -- "Scheduled collection run" section says it runs "on every push to `main`".

## Tasks & Acceptance

**Execution:**
- `pipeline/stages/merge.ts` -- export `mergeVisitLog`; `mergeRun` uses it (behaviour unchanged).
- `pipeline/stages/collect.ts` -- keep visits on a throw (`CollectError`).
- `pipeline/stages/run.ts` -- `--save-visits` flag and writes.
- `pipeline/stages/record-visits.ts` -- new CLI.
- `.github/scripts/commit-visits.sh` -- new, executable, modelled on `commit-public.sh`.
- `.github/workflows/pipeline.yml` -- publish `if:` and checkout ref, `--save-visits`, visits-on-failure step, build/deploy conditions, build checkout ref and push-only test steps.
- `tools/alerts.ts` -- ping on `skipped` publish.
- `docs/operations.md` -- which events collect, push → deploy only, visits from failed runs, home-machine fallback note (a personal-token push now only deploys, it no longer collects).
- `tests/merge.test.ts` -- `mergeVisitLog`: dedupe, prune, sort.
- `tests/collect.test.ts` -- a throw after contacting hosts carries their visits.
- `tests/run.test.ts` -- `--save-visits` written on success, on collect throw, and before a publish failure; not written on `--from-collect`; flag parsing.
- `tests/record-visits.test.ts` -- new: appends, dedupes, prunes, leaves other files alone, rejects an invalid file without writing.
- `tests/commit-visits.test.ts` -- new: against a local bare remote, commits only `visits.json`; nothing to commit when already present; retries after a rejected push.
- `tests/workflows.test.ts`, `tests/workflow-scripts.test.ts` -- triggers that collect, checkout ref, visits-on-failure step position/condition and its no-file/`[]` behaviour, build/deploy conditions and refs, push-only tests in build.
- `tests/alerts.test.ts` -- ping when publish is `skipped`.
- `tests/about.test.tsx` -- once a day in DE and EN.

**Acceptance Criteria:**
- Given a push to `main`, when `pipeline.yml` runs, then no pipeline (fetch or Nominatim) step runs and the pushed SHA is tested, built and deployed with the committed data.
- Given the schedule or a dispatch, when the run collects, then it first checks out `refs/heads/main`.
- Given a collecting run that fails after contacting any site (collect throws, publish fails, tests fail in the replay, push rejected for good), when the job ends, then that run's visits are on `main` in `data/state/visits.json` and nothing else from the run is committed.
- Given `tests/workflows.test.ts`, when it runs, then it asserts the collecting triggers, the collecting job's checkout ref and the visits-on-failure step.
- Given the About page, when rendered in DE and EN, then "How it works" says the websites are read once a day.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 25 findings — high 0, medium 3, low 16, false 6, maybe-false 0
- findings:
  - `[false]` `[reject]` (blind) Push runs ping the dead-man check and mask a dead schedule — operator decision 2026-11-01 ("Any successful run"), taken knowing that 3.11 stops push runs from collecting; the gap is in `docs/operations.md`.
  - `[medium]` `[patch]` (blind) A cancelled or timed-out publish job loses its visits (`if: failure()`) — patched: `if: failure() || cancelled()`, test and docs updated.
  - `[low]` `[reject]` (blind) Process killed mid-collect writes no visits file — needs an OOM/SIGKILL during collect (fetches time out after 20 s); a pessimistic pre-write of every planned host adds a planning pass to collect.
  - `[low]` `[reject]` (blind) A failed `--save-visits` write looks like "nothing to record" — needs `$RUNNER_TEMP` to be unwritable on a hosted runner; the error line is in the log.
  - `[low]` `[reject]` (blind) A failed record-visits step raises no separate alert — the run is already failed and its failure issue filed; the step's error is in the linked log.
  - `[low]` `[patch]` (blind) Collection gated by a deny-list, so a future trigger would collect — patched: allow-list `schedule || workflow_dispatch`.
  - `[low]` `[reject]` (blind) A queued run's workflow YAML and checked-out code can come from different commits — needs a workflow-changing push while a run is queued; the next run uses matching files.
  - `[low]` `[reject]` (blind) `record-visits.ts` runs from the newest main, not the commit that wrote the file — same rare window; the visit file format has not changed since Story 2.5.
  - `[low]` `[reject]` (blind) `allSettled` reports only the first rejection — same as the previous `Promise.all`; per-centre failures are already logged as outcomes.
  - `[low]` `[patch]` (blind) `run.ts` helper `recordVisits` clashes with `record-visits.ts`'s export — patched: renamed `saveRunVisits`. (The non-`CollectError` branch is covered by the "throw before any request" case.)
  - `[low]` `[reject]` (blind) Spec not in the diff; push retries have no backoff — the spec is excluded from the review diff by design; `commit-public.sh` retries the same way and has not needed a delay.
  - `[medium]` `[patch]` (verification-gap, other) Cancelled run skips the record-visits step — grouped with the blind cancellation finding.
  - `[low]` `[patch]` (edge) A push queued while a run is in progress cancels a pending scheduled run, and push runs no longer collect — fixing it needs a concurrency change this spec's Never excludes; needs a run in progress at 05:17 UTC plus a second queued run. Patched docs: check for a cancelled scheduled run and dispatch one. Flagged to the operator.
  - `[medium]` `[patch]` (edge) Cancelled publish job → visits lost — grouped with the blind cancellation finding.
  - `[low]` `[reject]` (edge) Save-visits write failure loses visits silently — grouped with the blind save-failure finding.
  - `[low]` `[reject]` (edge) Newer `main` with changed dependencies breaks the recorder — grouped with the blind cross-commit finding.
  - `[low]` `[reject]` (edge) Claim: visits lost on cancel, save failure or commit-visits failure — cancel patched; the other two are the rejected rare cases above.
  - `[low]` `[patch]` (edge) `commit-visits.sh` comment says reset drops leftovers, but untracked files stay — patched: comment now says only `visits.json` is added.
  - `[low]` `[reject]` (intent) AC1/AC2 runtime behaviour asserted only on YAML text — Actions expressions cannot run locally; residual risk until the first push and scheduled runs.
  - `[low]` `[reject]` (intent) AC3 chain tested in parts, not end to end — each link is tested against real git repos or executed bash; the full chain needs a real Actions run.
  - `[false]` `[reject]` (intent) Collect itself changed (`allSettled`) — needed for AC3's "collect throws" case: visits made before a throw were otherwise lost.
  - `[false]` `[reject]` (intent) Triggers that collect expressed through the job `if:` — the `push` trigger must stay for deploys; the job condition is what decides collection, and the test asserts it.
  - `[false]` `[reject]` (intent) Manual dispatch can collect more than once a day — pre-existing; the per-site budget (4 per 24 h) still caps visits, and the About text describes the schedule.
  - `[false]` `[reject]` (intent) Push runs pinging was not asked for by 3.11 — required to keep the 3.4 operator decision true once publish is skipped on pushes.
  - `[false]` `[reject]` (intent) Nothing committed, status `in-review` — finalize commits and sets `done`; not a defect.

## Design Notes

- Visits go through a separate file, not `--save-collect`: the replay file is written only after collect succeeds, and the visits must survive a collect throw.
- The failure step reads this run's visits from `$RUNNER_TEMP`, not from the working tree, because the tree may hold a failed merge or a replay on another upstream; resetting to the newest `main` guarantees that nothing else from the run is committed.
- A push-triggered deploy shows committed data only: a directory edit appears on the site after the next scheduled run.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including the new workflow, script, record-visits and commit-visits tests.
- `npm run typecheck` -- expected: no errors.

## Auto Run Result

**Summary:** Only the 05:17 UTC schedule and `workflow_dispatch` collect now (allow-list on the `publish` job), from `refs/heads/main`. A push to `main` type-checks, tests, builds and deploys the pushed SHA from committed data, contacting no provider site and no Nominatim. `run.ts --save-visits` writes the run's visits right after collect (also when collect throws); when the publish job fails or is cancelled, a step resets to the newest `main` and commits only `data/state/visits.json` with those visits.

**Files changed:**
- `.github/workflows/pipeline.yml` -- publish allow-list and checkout ref, `--save-visits`, `record-visits` step (`failure() || cancelled()`), build/deploy `always()` conditions, build checkout ref and push-only tests.
- `.github/scripts/commit-visits.sh` -- new: fetch, reset, record, commit only `visits.json`, push, 3 attempts.
- `pipeline/stages/record-visits.ts` -- new CLI: merge a run's visits into the log.
- `pipeline/stages/merge.ts` -- exported `mergeVisitLog` and `writeVisitLog`, used by `mergeRun`.
- `pipeline/stages/collect.ts` -- `allSettled`; a throw becomes `CollectError` carrying the visits.
- `pipeline/stages/run.ts`, `replay.ts` -- `--save-visits` flag and writer (`saveRunVisits`).
- `tools/alerts.ts` -- ping when publish was skipped on a push.
- `docs/operations.md` -- which events collect, push deploys only, visits from failed/cancelled runs, the pending-run cancellation note, fallback.
- Tests: new `record-visits`, `commit-visits`; extended `merge`, `collect`, `run`, `alerts`, `workflows`, `workflow-scripts`.

**Review:** 25 findings. Patched: 5 entries (1 medium: record visits on cancelled runs; 4 low: collect allow-list, helper rename, script comment, pending-run cancellation doc note). Deferred: none. Rejected: 6 false and 11 low, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false — patched counts: high 0, medium 1, low 4.

**Verification:** `npm test` 1,422 passed, 1 skipped (39 files); `npm run typecheck` clean, after the review patches. Every I/O matrix row has a passing test; `commit-visits.sh` is tested against a local bare remote, and the workflow's bash steps are executed in tests.

**Residual risks:** GitHub Actions expressions (job conditions with a skipped `publish`, the build checkout ref) are only asserted as text; check the first push and scheduled runs. A push queued while a run is in progress cancels a pending scheduled run (GitHub keeps one pending run per group), and push runs no longer collect to make up for it; fixing it needs a concurrency change this story excluded (documented workaround: dispatch a run). A process killed mid-collect writes no visits file.
