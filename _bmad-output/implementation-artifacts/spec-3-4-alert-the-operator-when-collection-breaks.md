---
title: 'Story 3.4: Alert the operator when collection breaks'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_revision: '7f1da29657d9703a53e2dcda7a889c10a4e35aef'
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

**Problem:** When `pipeline.yml` fails or stops running, nobody is told. A reader can break (every centre `failed`, or a redesigned page that reads as `ok` with no dates) and stale data stays up unnoticed. The operator needs GitHub issues (which email them) and an outside dead-man check.

**Approach:** `run.ts` writes a small run report (failure stage, "every fetched centre failed", per-system health and "dates disappeared" centres). A new `monitor` job at the end of `pipeline.yml` reads the publish job's outputs and the other jobs' results. It opens or comments on a "Pipeline failed: <stage>" issue, opens/updates/closes one issue per reader system, and pings the dead-man check (healthchecks.io) after a fully successful run. A run where every fetched centre failed still commits its data, then fails the publish job. Operator notes in `docs/operations.md` cover setup, the 60-day schedule disable and the home-machine fallback.

## Boundaries & Constraints

**Always:**
- Failure issue title: `Pipeline failed: <stage>`, where stage is one of `setup`, `tests`, `input`, `fetch`, `every fetched centre failed`, `state write`, `publish validation`, `push`, `build`, `deploy`. If an open issue has exactly that title, comment on it (run URL, event, time); else create it. Failure issues are never closed automatically.
- System issue title: `Reader <reader>: needs attention`. A system has a problem when (a) it covers ≥ 1 centre, `centres_ok = 0`, and its `last_success_at` is `null` or more than `SYSTEM_DOWN_MS` (24 h, new constant in `pipeline/config.ts`) before `runAt`; or (b) ≥ 1 of its centres "disappeared": `ok` this run with zero listings, while the state before merge held ≥ 1 listing for it with `removed_at === null` and `starts_at` at or after `runAt`. Problem → comment on the open issue, or create it. The body lists each problem; disappeared centres read `<name> (<centre_id>): dates disappeared, check the page`. No problem → close the open issue with a "Recovered in run <url>" comment (operator decision 2026-11-01: disappeared-only issues close the same way). Systems are only evaluated when the run report exists.
- "Every fetched centre failed": ≥ 1 centre `failed` and 0 `ok` (`skipped` does not count as fetched). `run.ts` still writes state and snapshot and returns 0; the commit step still commits and pushes (so `visits.json` is kept); a step after the commit then fails the publish job, so build/deploy are skipped and the stage is `every fetched centre failed`.
- Dead-man ping: only when publish, build and deploy all succeeded, on any trigger (schedule, push, dispatch). `curl -fsS -m 10 --retry 3 "$DEADMAN_PING_URL"`, URL from repository secret `DEADMAN_PING_URL`. Secret unset → a `::warning::`, not a failure. A failed ping is a warning, never a failure issue.
- Provider (recorded here): **healthchecks.io**, free Hobbyist plan; check with period 1 day and grace 12 h, so it emails after 36 h without a ping (operator decision 2026-11-01).
- `monitor` job: `needs: [publish, build, deploy]`, `if: always() && github.ref == 'refs/heads/main'`, `permissions: issues: write` plus `contents: read`; checkout with `persist-credentials: false`; `actions/setup-node` from `.nvmrc` without npm cache and **no `npm ci`** (no install scripts next to a write token). Its script imports only Node built-ins and project files without npm dependencies, and calls GitHub through the preinstalled `gh` CLI with `GH_TOKEN: ${{ github.token }}`.
- The monitor job fails (red) only when its own GitHub calls fail; it never turns a successful pipeline run red otherwise.

**Never:** No change to the schedule, triggers, concurrency or collection rules (Story 3.11 owns push-triggered collection). No new snapshot or state fields, no `stateVersion`/`schemaVersion` bump. No labels (they must exist before `gh issue create --label`); match issues by exact title. No third-party GitHub actions beyond the ones already used. No issue on the dead-man provider's side; the provider emails the operator itself.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| All green | publish/build/deploy success, report: no problems, open `Reader kuferweb: needs attention` exists | Ping sent; that issue closed with "Recovered" comment; no failure issue | No error expected |
| Test fails | `test` step failed, report absent | Failure issue `Pipeline failed: tests` created (or commented); no system issues; no ping | No error expected |
| Collect throws | pipeline step failed, report `stage: 'fetch'` | `Pipeline failed: fetch` | No error expected |
| Snapshot invalid | pipeline step failed, report `stage: 'publish'` | `Pipeline failed: publish validation` | No error expected |
| Pipeline step failed, no report | pipeline step failed, report file missing (e.g. bad CLI arguments) | `Pipeline failed: input` | No error expected |
| Every fetched centre failed | tally ok 0, failed 3, skipped 1 | State/snapshot written, commit pushed, then publish job fails; `Pipeline failed: every fetched centre failed`; build/deploy skipped; no ping | No error expected |
| Only skipped | tally ok 0, failed 0, skipped 4 | Not "every fetched centre failed"; run succeeds | No error expected |
| Push rejected 3× | commit step failed | `Pipeline failed: push` | No error expected |
| Deploy fails | publish, build success; deploy failure | `Pipeline failed: deploy`; system issues still evaluated from the report; no ping | No error expected |
| Same failure again | open `Pipeline failed: push` exists | Comment on it, no second issue | No error expected |
| System down > 24 h | itemkg covered 3, ok 0, `last_success_at` 30 h before runAt | `Reader itemkg: needs attention` created/commented: "No centre read successfully since <time>" | No error expected |
| System down < 24 h | ok 0, `last_success_at` 10 h before | No problem (a) for that system | No error expected |
| Never succeeded | ok 0, `last_success_at: null`, covered ≥ 1 | Problem (a): "No centre read successfully yet" | No error expected |
| Dates disappeared | centre ok with 0 listings; prior state had a live listing starting after runAt; other centres fine | System issue names `<name> (<id>): dates disappeared, check the page` | No error expected |
| Only past dates before | centre ok with 0 listings; prior live listings all start before runAt | Not disappeared | No error expected |
| Ping secret unset | all green, `DEADMAN_PING_URL` empty | `::warning::` line, job succeeds | No error expected |

</intent-contract>

## Code Map

- `pipeline/stages/run.ts` -- `runPipeline(options)`: every `return 1` path (bad input ~line 117, collect throw ~132, save-collect ~140, state write ~180, publish ~193) and the success path. Add option `reportPath?: string` and CLI flag `--report <file>` (`parseCliArgs`, ~210). Write the report on every return path once the flag is set (input errors before the directory is read included). `tally` (~158) gives ok/failed/skipped; `state` (pre-merge, ~108) gives prior listings; `located.outcomes` gives this run's ok listings; `buildSnapshot(...)` result's `systems` gives `centres_covered`, `centres_ok`, `last_success_at`; `directory` gives centre names.
- `pipeline/stages/` -- new `report.ts` (pure): `RunReport` type and `buildRunReport({ runAt, tally, systems, directory, priorState, outcomes })` plus `failedReport(stage)` (a `--save-collect` write failure reports `fetch`); `writeReport(path, report)` (JSON, one line). Report shape: `{ stage: null | 'input' | 'fetch' | 'state write' | 'publish validation', runAt: string | null, all_fetched_failed: boolean, systems: { reader, problem_down: { since: string | null } | null, disappeared: { centre_id, name }[] }[] }`.
- `pipeline/config.ts:56` -- next to `VISIT_WINDOW_MS`, add `SYSTEM_DOWN_MS = 24 * 60 * 60 * 1000` with a comment (Story 3.4).
- `pipeline/stages/publish.ts:52-98` -- read-only: how `systems[]` is computed (`centres_ok` counts `last_result === 'ok'`, `last_success_at` is the newest centre success).
- `.github/workflows/pipeline.yml` -- publish job: give the setup/typecheck/test/pipeline steps ids; pipeline step adds `--report "$RUNNER_TEMP/report.json"`; after `commit`, a step "Fail when every fetched centre failed" (reads the report with `node -e` or `jq`, exits 1 when `all_fetched_failed`); a final `id: stage` step with `if: always()` that writes `stage=<…>` and `report=<compact JSON or empty>` to `$GITHUB_OUTPUT`; job `outputs` gain `stage` and `report`. Add the `monitor` job per Boundaries.
- `.github/scripts/` -- `commit-public.sh` read-only (its exit status marks the `push` stage).
- `tools/` -- new `alerts.ts`: pure `planAlerts({ stage, report, jobs: { publish, build, deploy }, openIssues: { number, title }[], runUrl, event, now }) → { actions: ({ kind: 'create', title, body } | { kind: 'comment', number, body } | { kind: 'close', number, comment })[], ping: boolean }` and a CLI (`import.meta.main`) that reads env (`STAGE`, `REPORT`, `PUBLISH_RESULT`, `BUILD_RESULT`, `DEPLOY_RESULT`, `RUN_URL`, `EVENT`), lists open issues with `gh issue list --state open --json number,title --limit 200`, applies the actions with `gh issue create/comment/close` via `execFileSync` (arguments as an array, never a shell string), and writes `ping=true|false` to `$GITHUB_OUTPUT`. Stage resolution when `STAGE` is empty: publish failed → `setup`; build failed → `build`; deploy failed → `deploy`. Only Node built-ins imported.
- `tests/import-rules.test.ts:51` -- tools may import `pipeline/fetch`, `shared`, `pipeline/config.ts`; `tools/alerts.ts` needs none of them.
- `tests/workflows.test.ts` -- `job()` helper; "never leaves a credential on disk" expects exactly 2 checkouts (update to 3); "grants contents: write to publish only…" (extend for `monitor`: `issues: write`, no `contents: write`).
- `tests/run.test.ts` -- existing `runPipeline` tests with fake readers/clock; add report cases here.
- `docs/operations.md` -- add an "Alerts" section; extend "Home-machine fallback" with when to switch (sites block GitHub's IP ranges: many `failed:http-403`/timeouts on every centre of a site).
- `_bmad-output/planning-artifacts/architecture/architecture-bgtsearch-2026-10-25/ARCHITECTURE-SPINE.md:249` -- "alerts if no ping arrives for 13 h" → 36 h (operator decision 2026-11-01); `:306` provider line → healthchecks.io.

## Tasks & Acceptance

**Execution:**
- `pipeline/config.ts` -- add `SYSTEM_DOWN_MS`.
- `pipeline/stages/report.ts` -- report type, builder, failure helper, writer.
- `pipeline/stages/run.ts` -- `reportPath` option and `--report` flag; write the report on every exit path; doc comment lists the flag.
- `tools/alerts.ts` -- `planAlerts` and the `gh`-based CLI.
- `.github/workflows/pipeline.yml` -- step ids, `--report`, all-failed step after commit, stage/report outputs, `monitor` job with issue handling and dead-man ping step (`if: steps.alerts.outputs.ping == 'true'`, secret via `env:`).
- `tests/report.test.ts` -- `buildRunReport`: all-fetched-failed vs only-skipped; down > 24 h, < 24 h, never succeeded, not covered; disappeared vs only past prior dates vs tombstoned prior dates.
- `tests/run.test.ts` -- `--report` written on success, on collect throw (`fetch`), on invalid input (`input`), on publish failure (`publish validation`); every-centre-failed run returns 0, writes state, and reports `all_fetched_failed: true`.
- `tests/alerts.test.ts` -- every I/O-matrix row that reaches `planAlerts` (stage mapping, comment vs create, system create/comment/close, ping decision).
- `tests/workflows.test.ts` -- monitor job needs/if/permissions/no `npm ci`/checkout without credentials; ping only on `ping == 'true'` and reads `secrets.DEADMAN_PING_URL` via env; all-failed step comes after `- id: commit`; pipeline step passes `--report`; checkout count 3.
- `docs/operations.md` -- Alerts section: the two issue kinds and when they open/close; healthchecks.io setup (create check, period 1 day, grace 12 h, email integration, add the ping URL as secret `DEADMAN_PING_URL`); re-enabling the schedule after GitHub's 60-day inactivity disable (Actions tab → pipeline → "Enable workflow", then "Run workflow" / `workflow_dispatch`); switching to the home-machine fallback when sites block GitHub's IPs.
- `ARCHITECTURE-SPINE.md` -- the 13 h → 36 h and provider amendments.

**Acceptance Criteria:**
- Given a `pipeline.yml` run whose tests, pipeline, push, build or deploy fails, when the `monitor` job runs, then an open issue titled `Pipeline failed: <stage>` gets a comment with the run URL, or one is created.
- Given a run where every fetched centre ended `failed`, when the publish job finishes, then the data commit was pushed, the job is failed, and the monitor job files `Pipeline failed: every fetched centre failed`.
- Given a reader system with `centres_ok = 0` and no success for more than 24 h, or with a centre whose dates disappeared, when the run finishes, then `Reader <reader>: needs attention` is created or commented, naming disappeared centres as "dates disappeared, check the page"; given the next run where that system has no problem, then the issue is closed.
- Given a run where publish, build and deploy succeeded, when the monitor job runs, then it pings `DEADMAN_PING_URL` (or warns when the secret is unset), and never pings after a failed run.
- Given `docs/operations.md`, when read, then it records healthchecks.io with a 1-day period and 12 h grace (36 h), the `DEADMAN_PING_URL` secret, re-enabling the schedule after the 60-day disable, and when to switch to the home-machine fallback.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 37 findings — high 0, medium 2, low 23, false 12, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) Issues matched by title only; in a public repo a stranger's same-titled issue is commented on or closed by the bot — patched: `gh issue list --app github-actions`.
  - `[false]` `[reject]` (blind) Overlapping runs race and create duplicate issues — `pipeline.yml` has a workflow-level `concurrency: group: pipeline, cancel-in-progress: false`, so runs (and their monitor jobs) never overlap.
  - `[low]` `[reject]` (blind) An uncaught throw in normalise/locate/merge writes no report and is filed as `input` — unexpected crashes are rare, the issue links the run log, and a catch-all branch with a new stage name adds complexity.
  - `[low]` `[reject]` (blind) A job timeout or cancelled step is filed as `setup` — no `timeout-minutes` is set (default 6 h, never reached); cancelled publish jobs file nothing (`resolveStage` only reacts to `failure`).
  - `[false]` `[reject]` (blind) A malformed report makes `planAlerts` throw before filing the failure issue — the report is only ever written by `report.ts` with the full shape and schema-validated dates; drift is now caught by the cross-module test (verification-gap patch).
  - `[false]` `[reject]` (blind) The 24 h down threshold flaps with the daily schedule — once over 24 h, `last_success_at` only ages until the next success, so it never flaps; only whether the first or second failed run opens the issue varies, and 24 h is the AC's own figure.
  - `[low]` `[patch]` (blind) Push-triggered pings hide a dead schedule while people push — every successful run pinging is the operator's decision 2026-11-01; patched the docs to state the gap.
  - `[low]` `[patch]` (blind) Home-machine fallback runs never ping and never update reader issues — patched docs: optional ping after a successful fallback run, and the issue behaviour.
  - `[low]` `[patch]` (blind) Docs assume GitHub emails the operator without saying to watch the repo — patched docs: setup step to watch Issues.
  - `[low]` `[reject]` (blind) Failure issue body has no per-centre diagnostics — enhancement; the run URL leads to the per-centre log lines, and adding them needs a larger report.
  - `[medium]` `[patch]` (blind) `tools/alerts.ts` CLI untested — grouped with the verification-gap finding below.
  - `[low]` `[patch]` (blind) Report from the first pass after a rejected push; a replay failure reads `push` — patched: `PUBLISH_CMD` passes `--report`, and the `stage` step uses the replay's report stage when the commit step failed; replay type-check/test failures still read `push` (documented).
  - `[medium]` `[patch]` (verification-gap) `import.meta.main` block of `tools/alerts.ts` never run — patched: spawn test with a fake `gh` (ping written first, argv of create/comment/close, list failure exits 1, partial failure exits 1).
  - `[low]` `[patch]` (verification-gap) Report contract duplicated between `report.ts` and `alerts.ts`, never checked together — patched: test pipes `buildRunReport`/`failedReport` JSON through `parseReport` and `planAlerts`.
  - `[low]` `[patch]` (verification-gap) `state write`, `--save-collect` write failure and combined-flags stages unasserted — patched: report assertions added to those `run.test.ts` cases.
  - `[low]` `[patch]` (verification-gap) Report write failure untested — patched: unwritable `reportPath` case (exit 0, snapshot written, error logged).
  - `[low]` `[patch]` (verification-gap, other) Replay failure labelled `push` — grouped with the blind replay finding.
  - `[low]` `[patch]` (verification-gap, other) Successful-replay report is stale — grouped with the blind replay finding.
  - `[low]` `[reject]` (edge) Uncaught throw in `run()` → no report → `input` — grouped with the blind crash finding.
  - `[false]` `[reject]` (edge) `buildRunReport` throws after data is written — it is a pure function over the schema-validated snapshot systems and state; no throwing path.
  - `[low]` `[reject]` (edge) Cancelled step outcome → `setup` — grouped with the blind timeout finding.
  - `[low]` `[reject]` (edge) Report write failed plus a real failure → `input` — grouped with the blind crash finding; `$RUNNER_TEMP` is always writable on hosted runners.
  - `[low]` `[patch]` (edge) Replay failure filed as `push` — grouped with the blind replay finding.
  - `[low]` `[reject]` (edge) Pipeline succeeded but report missing → an all-failed run deploys and pings — needs `$RUNNER_TEMP` to be unwritable; the warning line shows in the run.
  - `[low]` `[patch]` (edge) Replay runs without `--report` — grouped with the blind replay finding.
  - `[false]` `[reject]` (edge) Malformed `REPORT` system entries crash `planAlerts` — same refutation as the blind malformed-report finding.
  - `[false]` `[reject]` (edge) Unparseable `since` crashes `formatUtc` — `since` is `last_success_at`, a schema-validated UTC datetime.
  - `[low]` `[reject]` (edge) More than 200 open issues hide the alert issue — the list is now limited to the bot's own issues (`--app github-actions`), which stay far below 200.
  - `[false]` `[reject]` (edge) Unparseable `last_success_at` never reports down — the snapshot schema validates it before `buildRunReport` sees it.
  - `[false]` `[reject]` (edge) Unparseable prior `starts_at` misses a disappearance — `readState` validates state listings against the schema.
  - `[low]` `[reject]` (edge) Claim "report on every exit path" — the returned exits all write one; a `parseCliArgs` failure correctly reads `input`; uncaught throws are the rejected crash finding.
  - `[low]` `[reject]` (intent) GitHub-side behaviour (outputs, `gh` auth, emails, healthchecks.io) is not exercised by tests — only a real Actions run can show it; recorded as residual risk.
  - `[false]` `[reject]` (intent) System issue closes after a run whose pipeline step completed, even if deploy failed — the AC's "its next successful run" is the system's reading success, which the report measures.
  - `[low]` `[reject]` (intent) A never-succeeded system is flagged at once — documented in Design Notes; a "down since" field would need a state change the story excludes.
  - `[false]` `[reject]` (intent) "Expected structure" not checked separately — readers return `failed('structure-missing')` when the list structure is absent, so an `ok` outcome already means the structure matched.
  - `[false]` `[reject]` (intent) More stages than the AC lists and failure issues never auto-close — a superset of the AC's examples; the AC states no closing rule for failure issues.
  - `[false]` `[reject]` (intent) Monitor only on `main`, no `npm ci`, spine updated — constraints recorded in the spec's Boundaries, not divergences from the intent.

## Design Notes

- Why a report file and job outputs: the failing stage of `run.ts` is only known inside it, and the monitor job must not install dependencies. The publish job's final `if: always()` step turns the report and step outcomes into two outputs; the monitor job reads `needs.*.result` for build and deploy.
- Stage resolution in the publish job's `stage` step: first failed of `setup` (checkout/setup-node/npm ci) → `setup`; `typecheck`/`test` → `tests`; `pipeline` → the report's `stage`, or `input` when the report is missing; `commit` → `push`; the all-failed step → `every fetched centre failed`. Empty when the job succeeded.
- On a rejected push the replay recomputes merge and publish on a newer upstream; the report still comes from the first pass. Differences are rare (another run's data in between) and only affect the system issues for one run.
- A system that has never succeeded counts as down at once: there is no stored "down since" time, and adding one would need a state change this story excludes.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including report, alerts, run and workflow tests.
- `npm run typecheck` -- expected: no errors.

**Manual checks (if no CLI):**
- `.github/workflows/pipeline.yml` parses as YAML (covered by `tests/workflows.test.ts` using `yaml`), and the `monitor` job has no `npm ci` step.

## Auto Run Result

**Summary:** `pipeline.yml` now alerts the operator. `run.ts --report` writes a run report (failed stage, "every fetched centre failed", per-system health and disappeared dates). The publish job names the failed stage and fails after committing when every fetched centre failed. A new `monitor` job opens or comments on `Pipeline failed: <stage>`, opens/comments/closes `Reader <reader>: needs attention`, and pings healthchecks.io (`DEADMAN_PING_URL`, 1-day period + 12 h grace = 36 h) after a fully successful run.

**Files changed:**
- `pipeline/config.ts` -- `SYSTEM_DOWN_MS` (24 h).
- `pipeline/stages/report.ts` -- new: report type, `buildRunReport`, `failedReport`, `writeReport`.
- `pipeline/stages/run.ts` -- `reportPath` / `--report`; report on every returned exit; all-failed runs log and still exit 0.
- `tools/alerts.ts` -- new: pure `planAlerts` and the `gh` CLI (bot-authored issues only, `ping=` written first).
- `.github/workflows/pipeline.yml` -- step ids, `--report` on the run and the replay, all-failed step after commit, `stage` step and outputs, `monitor` job with the ping step.
- `docs/operations.md` -- Alerts section (issues, watching the repo, healthchecks.io setup, 60-day re-enable, fallback switch and ping).
- `ARCHITECTURE-SPINE.md` -- dead-man 13 h → 36 h, provider healthchecks.io.
- `tests/report.test.ts`, `tests/alerts.test.ts`, `tests/workflow-scripts.test.ts` (new); `tests/run.test.ts`, `tests/workflows.test.ts` (extended).

**Review:** 37 findings. Patched: 6 entries (1 medium: alerts CLI spawn test; 5 low: report-contract test, run-report stage tests, bot-only issue matching, replay `--report` + stage, operator-notes gaps). Deferred: none. Rejected: 12 false and 13 low, each with its reason in the Review Triage Log. Design-note change from the patch: when the commit step fails and the replay wrote a report stage, that stage is filed instead of `push`.

**Follow-up review recommended:** false — patched counts: high 0, medium 1, low 5.

**Verification:** `npm test` 1,376 passed, 1 skipped (37 files); `npm run typecheck` clean, after the review patches. Every I/O matrix row has a passing test; the workflow's bash steps are executed in tests with a fake `GITHUB_OUTPUT`, `curl` and `gh`.

**Residual risks:** Not run on GitHub Actions yet: job outputs, `needs.*.result`, `gh` auth with `GH_TOKEN`/`GH_REPO` and `--app github-actions` matching are only tested locally. The operator must create the healthchecks.io check, add the `DEADMAN_PING_URL` secret and watch the repo's issues (steps in `docs/operations.md`); until the secret exists every green run logs a warning.
