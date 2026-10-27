---
title: 'Story 1.6: Publish a snapshot of all centres'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 2
baseline_commit: '43ef2f0204895f3c20924dfc1ddd008d1358f6cd'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      No test executes the `npm run pipeline` entry point (`pipeline/stages/run.ts`) or checks its exit code.
    evidence: |-
      tests call runPublish directly; dropping the process.exitCode assignment would pass every test. Same untested-CLI pattern as tools/*.ts; a spawn test needs path overrides. Review pass 2026-10-27 (verification-gap layer).
    location: >-
      pipeline/stages/run.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** The site needs one published data file listing every centre (AD-1, AD-9), but there is no snapshot schema, no publish stage, no `npm run pipeline`, and `pipeline.yml` only builds and deploys the code. The JSON files in `data/public/` are not even copied into the deployed site.

**Approach:** Add the `snapshot.json` zod contract in `shared/snapshot.ts`. Add a publish stage in `pipeline/stages/` that turns the directory into a validated snapshot and writes it atomically, plus a `pipeline/stages/run.ts` entry (`npm run pipeline`). Serve `data/public/` as Vite's public dir. Change `pipeline.yml` to: test → run the pipeline → commit `data/public/` once if changed → push → build and deploy that pushed SHA.

## Boundaries & Constraints

**Always:**
- Snapshot shape (strict objects): `{ schemaVersion: 1, generated_at, systems: [], centres: [], listings: [] }`. `generated_at` is the run time as UTC ISO 8601 with `Z`. `listings` must be empty in schema version 1 (entries come in Epic 2, which bumps to 2). `systems` uses the AD-9 system shape (`reader`, `centres_covered`, `centres_ok`, `centres_failed`, `last_success_at`), and publish emits `[]` in this story.
- Each snapshot centre = every directory field as in `centres.json`, then `coverage`, `last_result`, `last_checked_at`, `last_success_at`. Codes: `coverage` ∈ `covered`/`not_checked`, `last_result` ∈ `ok`/`failed`/`null`, and the two timestamps are a UTC datetime or `null`. The schema rejects `covered` for a centre that is opted out or has reader `none`, and rejects duplicate `centre_id`s. It keeps the directory's own centre checks (coords pair, Bavaria box, `reader_config` null for `none`).
- In this story every centre is `coverage: "not_checked"`, `last_result: null`, `last_checked_at: null`, `last_success_at: null`, because no readers exist yet. Every directory centre appears exactly once (including ungeocoded and unverified ones), sorted by `centre_id`.
- Publish reads `data/directory/centres.json` with `node:fs` and validates it with `directorySchema`. It validates the snapshot with `snapshotSchema` before writing. Any failure means nothing is written, the error is printed, and the process exits 1.
- Writes are atomic: a temp file in `data/public/`, then rename. The output is minified JSON with a trailing newline.
- If the existing `snapshot.json` is valid and equal to the new one apart from `generated_at`, the file is left untouched, so an unchanged directory produces no commit.
- `pipeline.yml`:
  - Runs only for `refs/heads/main`.
  - The publish job alone gets `contents: write`. Checkout uses `persist-credentials: false`.
  - Steps run in order: `npm ci`, typecheck, test, `npm run pipeline`, then `.github/scripts/commit-public.sh`.
  - The script stages only `data/public/`, commits once with the bot identity only if it changed, and pushes to `main`. It passes the token to `git push`/`git fetch` only (no credential on disk, hooks disabled), and outputs `sha=` for the pushed (or unchanged) HEAD.
  - On a rejected push: fetch, reset to `origin/main`, re-run the publish command, commit if changed, and retry, with 3 attempts in total. Then it fails.
  - The build job checks out that `sha`, builds, and fails unless `dist/` has both pages, `snapshot.json` and `places.json`. Deploy needs build. Any failed step means no commit (if before the commit), no deploy, and the live site stays.

**Never:**
- No readers, merge, `data/state/` writes or schedule trigger (Epic 2). No `web/` changes that read the snapshot (Story 1.8). No new dependencies, no TypeScript-only syntax (stages run with plain `node`), and no network calls in publish.
- Publish never writes `data/directory/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal run | 119 valid centres, no snapshot yet | `snapshot.json` with 119 `not_checked` centres, nulls, `systems: []`, `listings: []` | N/A |
| Opted out | centre with `opted_out: true`, reader `kuferweb` | published once, `coverage: "not_checked"` | N/A |
| Ungeocoded | `lat: null, lon: null` | published with null coords | N/A |
| Unchanged rerun | same directory, valid existing snapshot | file bytes unchanged; log says unchanged | N/A |
| Directory changed | one centre renamed | file rewritten with new `generated_at` | N/A |
| Invalid directory | schema error, or not JSON | nothing written; existing snapshot untouched | exit 1, names the issue |
| Invalid snapshot | `writeSnapshot` given a snapshot failing the schema (e.g. `covered` + opted out, or a listing) | nothing written | throws; `run` exits 1 |
| Corrupt existing snapshot | existing file not valid JSON | overwritten with the new snapshot | N/A |
| Push, no change | `data/public/` unchanged | no commit; `sha` = HEAD | N/A |
| Push rejected | `main` moved upstream | reset to upstream, re-publish, commit if changed, push | after 3 attempts exit 1, no deploy |

</intent-contract>

## Code Map

- `shared/directory.ts` -- `centreSchema` is a `strictObject(...).superRefine(...)`. In zod 4, `.extend()` on a refined schema throws, so split out `centreFieldsSchema` (the strict object) and a `checkCentre(centre, ctx)` refinement. `centreSchema` stays behaviour-identical. Also has `sortDirectory` and `READERS`.
- `shared/snapshot.ts` -- new: `SNAPSHOT_SCHEMA_VERSION`, `COVERAGE`, `LAST_RESULTS`, `snapshotCentreSchema`, `systemSchema`, `snapshotSchema`, and the types. Imports only `zod` and `./directory.ts` (shared imports nothing project-internal outside itself).
- `pipeline/stages/` -- currently only `.gitkeep` (remove it). New `paths.ts` (`DIRECTORY_PATH`, `PUBLIC_DIR`, `SNAPSHOT_PATH` via `new URL(..., import.meta.url)`; stages cannot import `tools/paths.ts`). New `publish.ts`: pure `buildSnapshot(centres, runAt)`, `writeSnapshot(snapshot, path)` (validate, unchanged check, atomic write), and `runPublish({ directoryPath?, snapshotPath?, now?, log?, error? })` → exit code. New `run.ts`: the CLI (`if (import.meta.main)`), which calls `runPublish` and sets `process.exitCode`.
- `tests/import-rules.test.ts` -- `pipeline/stages` → `shared`, `pipeline/config.ts` allowed; `data/` imports are forbidden, so read JSON with `node:fs`. No change.
- `tools/build-places.ts:830`, `tools/check-directory.ts` -- patterns: minified+newline output, `import.meta.main` CLI, injectable `log`/`error`.
- `package.json` -- add `"pipeline": "node pipeline/stages/run.ts"`.
- `vite.config.ts` -- add `publicDir: fromRoot('./data/public')` so `snapshot.json`/`places.json` land at `dist/` root (served at `/testplatz/snapshot.json`). Delete `data/public/.gitkeep` so it is not deployed.
- `.github/workflows/pipeline.yml` -- restructure into `publish` → `build` → `deploy` (see constraints). The existing comment "Story 1.6 adds …" is replaced. Pushes made with the workflow token do not trigger new workflow runs, so there is no loop.
- `.github/scripts/commit-public.sh` -- new bash script. Env: `PUBLISH_CMD` (default `npm run pipeline`), `GIT_AUTH_HEADER` (optional, used only on fetch/push as `-c http.extraheader=…` with `-c core.hooksPath=/dev/null`, and removed from `PUBLISH_CMD`'s env), `REMOTE` (default `origin`), `BRANCH` (default `main`), and `GITHUB_OUTPUT` (optional). Bot identity: `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com`.
- `tests/workflows.test.ts` -- update the pipeline.yml tests: ordering now lives in the publish job, build checks out `needs.publish.outputs.sha`, and the permission test allows `contents: write` on publish only.
- `deferred-work.md` -- its item (a non-main dispatch could deploy) is resolved by the `refs/heads/main` guard. Remove the entry.

## Tasks & Acceptance

**Execution:**
- [ ] `shared/directory.ts` -- extract `centreFieldsSchema` + `checkCentre`; `centreSchema` unchanged in behaviour -- reuse in the snapshot schema.
- [ ] `shared/snapshot.ts` -- snapshot contract (AD-9) -- one zod contract for pipeline and web.
- [ ] `pipeline/stages/paths.ts`, `publish.ts`, `run.ts`; remove `pipeline/stages/.gitkeep` -- the publish stage and `npm run pipeline`.
- [ ] `package.json`, `vite.config.ts`, remove `data/public/.gitkeep` -- script and serving of public data.
- [ ] `.github/scripts/commit-public.sh` (executable), `.github/workflows/pipeline.yml` -- one commit if changed, push with retry, deploy the pushed SHA. The commit step sets `PUBLISH_CMD: npm run typecheck && npm test && npm run pipeline`, so a retry after a reset onto a moved upstream type-checks and tests that upstream code before publishing it. It must NOT run `npm ci`: that step holds the push credential (in the step's and the script's initial process environment, readable through `/proc/<pid>/environ` by any child), and install scripts must never run there. The retry reuses the `node_modules` from the earlier `npm ci` step; if upstream changed dependencies, the tests fail, the run fails without deploying, and the queued run for that upstream push publishes instead. Say this in the workflow comment.
- [ ] `tests/snapshot.test.ts` -- schema accept/reject (version, extra key, listing present, `covered` + opted out / reader none, duplicate id, non-Z timestamp); every publish matrix row with temp dirs; the atomic write leaves no temp file; and a committed-data test: `data/public/snapshot.json` parses with `snapshotSchema`, is all `not_checked` with null run fields, and has empty `systems` and `listings`. It must NOT compare the committed snapshot's `centre_id`s with the directory: `npm test` runs before `npm run pipeline`, and the pipeline is what reconciles a changed directory.
- [ ] `tests/commit-public.test.ts` -- run the script against temp git repos (a bare "remote" + clone) with a fake `PUBLISH_CMD`. Put a logging `git` wrapper first on `PATH` and assert that `push` and `fetch` get `http.extraheader=<GIT_AUTH_HEADER>` while `add`/`commit`/`reset` do not. Cases: no change → no commit; change → exactly one commit touching only `data/public/`, pushed, `sha` output equals the remote head; upstream moved → reset, re-publish, push succeeds on top of the upstream commit; and an always-rejected push → exit non-zero after 3 attempts (simulate with a `pre-receive` hook on the bare remote).
- [ ] `tests/workflows.test.ts` -- updated assertions for the new job layout, the main guard, `persist-credentials: false`, the dist file checks and the commit step's `PUBLISH_CMD`.
- [ ] `tests/site-config.test.ts` -- assert `viteConfig.publicDir` equals `PUBLIC_DIR` from `pipeline/stages/paths.ts`, so a mis-pointed public dir fails at PR time.
- [ ] `shared/snapshot.ts` doc comments -- describe only what exists now (e.g. the app *will* embed `SNAPSHOT_SCHEMA_VERSION`, Story 1.8), never behaviour `web/` does not have yet.
- [ ] `vite build` check -- `dist/snapshot.json`, `dist/places.json` exist; `dist/.gitkeep` does not.
- [ ] Generate and commit `data/public/snapshot.json` with `npm run pipeline`; remove the resolved `deferred-work.md` entry.

**Acceptance Criteria:**
- Given the committed directory, when `npm run pipeline` runs, then `data/public/snapshot.json` is valid against `snapshotSchema`, holds each of the directory's centres once, all with `coverage: "not_checked"` and null run fields, `systems: []` and `listings: []`, and a second run leaves the file byte-identical.
- Given a centre with `opted_out: true`, when published, then its coverage is `not_checked` (FR22).
- Given `npm run build`, when it finishes, then `dist/snapshot.json` and `dist/places.json` exist.
- Given `pipeline.yml`, when it runs on `main`, then the build job deploys the SHA output by the commit step, which runs only after tests and a successful `npm run pipeline`.

## Spec Change Log

### 2026-10-27 — Review loop 1: committed-data test and retry publish command
- **Trigger:** review found (1) the committed-data test compared the committed snapshot's ids with the directory, and `npm test` runs before `npm run pipeline` in the publish job, so any directory edit that adds or removes a centre fails CI and blocks the pipeline from regenerating the snapshot itself; (2) after a rejected push the script resets onto upstream code and re-publishes with code that this job never installed, type-checked or tested, then deploys it.
- **Amended (Tasks only, outside the intent contract):** the committed-data test checks validity and the Epic 1 shape only, never id equality with the directory; the commit step's `PUBLISH_CMD` re-runs `npm ci`, typecheck and tests before `npm run pipeline`; added tests for the auth header reaching fetch/push only and for `publicDir`; doc comments must not describe behaviour that does not exist yet.
- **Avoids:** a pipeline that can never publish a directory change by itself; deploying untested upstream code from the retry path.
- **KEEP:** everything else in attempt 1 (`_bmad-output/implementation-artifacts/spec-1-6-attempt-1.patch`, applies cleanly with `git apply` on the baseline): `shared/directory.ts` split into `centreFieldsSchema` + `checkCentre`; `shared/snapshot.ts` schema and its rules; `pipeline/stages/{paths,publish,run}.ts` (whole-second `generated_at`, unchanged-skip, atomic write, injectable options); `commit-public.sh` (credential read into a local and unset, `-c http.extraheader` on fetch/push only, hooks off, `env` never carries the credential to the publish command, 3 attempts); the `publish → build → deploy` layout with the main guard, `persist-credentials: false` and the masked basic header; `vite.config.ts` `publicDir`; removing both `.gitkeep` files; the existing tests in `tests/snapshot.test.ts`, `tests/commit-public.test.ts`, `tests/workflows.test.ts`; emptying `deferred-work.md`; the generated `data/public/snapshot.json`. Reuse the patch and apply only the amendments above.

### 2026-10-27 — Review loop 2: no install scripts in the credential step
- **Trigger:** review pass 2 found that the loop-1 `PUBLISH_CMD` runs `npm ci` inside the commit step. The token sits in that step's (and `commit-public.sh`'s) initial environment, which `unset` does not clear from `/proc/<pid>/environ`, so third-party install scripts could read the `contents: write` credential.
- **Amended (Tasks only):** `PUBLISH_CMD` is `npm run typecheck && npm test && npm run pipeline`, with no `npm ci`; the workflow comment explains why; the workflow test asserts the exact value and that it has no `npm ci`.
- **Avoids:** install scripts running with the push credential reachable.
- **KEEP:** everything in attempt 2 (`_bmad-output/implementation-artifacts/spec-1-6-attempt-2.patch`, applies cleanly with `git apply` on the baseline, includes the generated `snapshot.json`), including the loop-1 amendments: the committed-data test without id equality, the logging-git auth-header test, the `publicDir` test with `PUBLIC_DIR` lacking a trailing slash, and the reworded `SNAPSHOT_SCHEMA_VERSION` comment. Apply the patch, then change only `PUBLISH_CMD`, its comment and its test.


## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 28 findings — high 0, medium 4, low 15, false 8, maybe-false 1
- findings:
  - `[false]` `[reject]` Nothing in `web/` reads the snapshot (IA) — the page consuming it is Story 1.8; this story's ACs end at the published, deployed file, which `publicDir` puts in `dist/`.
  - `[false]` `[reject]` AC2 ("live site stays") is not exercised by a real workflow run (IA) — a failed `npm run pipeline` step stops the job before the commit step, and build/deploy `needs` it; that is Actions semantics, not code under test.
  - `[low]` `[bad_spec]` No local check that `publicDir` puts both files in `dist/` (IA) — grouped with the VG `publicDir` row; spec now adds a `site-config.test.ts` assertion.
  - `[false]` `[reject]` No schedule, no `data/state/`, simplified retry vs full AD-12 (IA) — Story 2.6 adds the schedule, state and saved-result re-merge; Epic 1 has no readers.
  - `[false]` `[reject]` Additions not named in the story (schema split, extra rules, credential handling) (IA) — all are in the spec and support the ACs; no harm named.
  - `[low]` `[bad_spec]` The auth header reaching `git push`/`fetch` is never verified (VG, pre-verified) — spec now requires a logging git wrapper test.
  - `[low]` `[defer]` `run.ts` entry point is never executed by a test (VG, pre-verified) — same untested-CLI pattern as every `tools/*.ts`; a spawn test needs path overrides (new surface). Deferred.
  - `[low]` `[bad_spec]` `publicDir` copy checked only post-merge in `pipeline.yml` (VG, pre-verified) — spec now adds the `site-config.test.ts` assertion.
  - `[medium]` `[bad_spec]` Committed-data test blocks the pipeline from reconciling a directory change (VG other) — confirmed: `npm test` precedes `npm run pipeline` in the publish job and the test compares ids; spec amended to drop id equality.
  - `[medium]` `[bad_spec]` Committed-data test stops the pipeline fixing drift (BH) — same root cause as the row above; same amendment.
  - `[low]` `[reject]` Script retries every push failure, not just non-fast-forward (BH) — git's own stderr (403, protection) is still printed in the log, and the run still fails; classifying stderr adds branches for a first-setup case.
  - `[medium]` `[bad_spec]` After the reset, the retry publishes and deploys upstream code that was never installed, type-checked or tested (BH) — confirmed: build does not test, so a broken upstream could deploy before its own queued run fails; spec now sets `PUBLISH_CMD` to install, typecheck and test first.
  - `[low]` `[reject]` Snapshot schema lacks run-field cross rules and system count/duplicate rules (BH) — no producer emits these fields yet; AD-6 keeps old timestamps on `skipped`, so "not_checked ⇒ null run fields" would be wrong; the real invariants belong with merge in Story 2.5/2.6.
  - `[false]` `[reject]` Publish job does not run `check:directory` (BH) — `runPublish` validates the directory with `directorySchema` and fails the run; canonical form is enforced by `ci.yml`, which runs on directory pushes; no bad deploy follows.
  - `[low]` `[reject]` `publicDir` ships stray files such as a killed run's `.snapshot.json.<pid>.tmp` (BH) — needs a kill between write and rename and then a manual commit; CI runs are fresh checkouts; fix adds an allow-list.
  - `[low]` `[bad_spec]` `SNAPSHOT_SCHEMA_VERSION` comment claims the app reloads on mismatch (BH) — confirmed nothing in `web/` does; spec now says comments describe only current behaviour.
  - `[false]` `[reject]` Credential visible in the process list via `-c` (BH) — the job VM is ephemeral and single-tenant; nothing else runs during fetch/push; the comment claims only that it is kept out of other commands' environment, which is true.
  - `[low]` `[reject]` Assorted test gaps: `writeSnapshot` catch branch, `GITHUB_OUTPUT` unset, publish command failing mid-retry (BH) — rare paths that fail loudly; the auth-header and `run.ts` gaps are handled in their own rows.
  - `[low]` `[reject]` A manual dispatch on a non-main branch skips every job and looks green (BH) — Actions shows each job as "skipped", not deployed; the guard is the intended fix for the deferred non-main deploy risk.
  - `[medium]` `[bad_spec]` Retry publishes untested upstream code with stale `node_modules` (ECH) — same root cause and amendment as the BH row.
  - `[low]` `[reject]` Non-rejection push failures trigger hard resets and a misleading message (ECH) — same as the BH retry row.
  - `[low]` `[reject]` A transient fetch failure aborts the retry under `set -e` (ECH) — the run fails loudly and nothing deploys; the next push or dispatch retries.
  - `[low]` `[reject]` Stray files in `data/public/` get committed (ECH) — same as the BH stray-file row.
  - `[maybe-false]` `[reject]` A valid but non-canonical existing snapshot is kept as "unchanged" (ECH) — only a hand-edited file could be pretty-printed; would need checking whether anyone edits `data/public/` by hand (AD-12 says only the bot writes it); would only be low.
  - `[false]` `[reject]` `not_checked` with non-null run fields passes the schema (ECH) — AD-6: `skipped` sets no timestamps but does not clear them, so an opted-out centre may legitimately keep earlier run fields.
  - `[low]` `[reject]` `last_result`/`last_checked_at` pairing and `ok` ⇒ `last_success_at` not enforced (ECH) — same as the BH schema row; belongs with merge in Epic 2.
  - `[low]` `[reject]` System counts and duplicate readers not enforced (ECH) — same as the BH schema row.
  - `[false]` `[reject]` Non-main dispatch silently green (ECH) — jobs show "skipped", and nothing deploys, which is the guard's purpose.

### 2026-10-27 — Review pass (loop 1 re-derivation)
- verdicts: 26 findings — high 0, medium 1, low 14, false 11, maybe-false 0
- findings:
  - `[false]` `[reject]` `web/` does not read the snapshot (IA) — carried: Story 1.8 consumes it; this story ends at the deployed file.
  - `[low]` `[defer]` `run.ts` / `process.exitCode` never executed (IA) — carried: already in `deferred`.
  - `[false]` `[reject]` `data/public/snapshot.json` is not in the reviewed diff (IA) — the review diff left it out on purpose (one 59 KB line); it is staged, checked by the committed-data test, and two `npm run pipeline` runs leave it unchanged.
  - `[low]` `[reject]` "Every directory centre once" shown only on the fixture, not on the real 119 centres (IA) — the loop-1 amendment removed id equality on purpose; `buildSnapshot` maps every directory centre and the schema rejects duplicates; a full-data check would reintroduce the drift block.
  - `[false]` `[reject]` `generated_at` can be older than the latest run (IA) — the specified design (Design Notes): unchanged content keeps the file; freshness is per centre (AD-11).
  - `[false]` `[reject]` AC2 is not exercised by a real workflow run (IA) — carried: Actions stops the job at the failed step; build/deploy `needs` it.
  - `[false]` `[reject]` AC3 deploy checks are YAML-text only (IA) — the commit script is tested against real repos; the remaining parts are Actions config, checked in-workflow by the `dist/` existence step.
  - `[false]` `[reject]` Additions beyond the epics ACs (IA) — carried: specified, no harm named.
  - `[false]` `[reject]` `deferred-work.md` and the epic context are absent from the reviewed diff (IA) — the review diff excluded `_bmad-output/`; `deferred-work.md` is staged; the epic context is this run's planning refresh, committed at finalize.
  - `[low]` `[defer]` `npm run pipeline` entry point never executed by a test (VG, pre-verified) — carried: already in `deferred`.
  - `[low]` `[reject]` Snapshot schema lacks run-field cross rules (BH) — carried: belongs with merge in Epic 2; AD-6 keeps timestamps on `skipped`.
  - `[low]` `[reject]` `systemSchema` lacks count and duplicate checks (BH) — carried: no producer yet; Epic 2.
  - `[false]` `[reject]` "Whole seconds" format is not enforced by the schema (BH) — the contract only requires UTC ISO 8601 with `Z`; whole seconds is the producer's choice, and no consumer relies on precision.
  - `[low]` `[reject]` Every failed push is treated as a rejection (BH) — carried: git's own error is in the log and the run fails; classifying stderr adds branches.
  - `[low]` `[reject]` No check that `dist/.gitkeep` is absent, and no vitest build test (BH) — `.gitkeep` is deleted and harmless if it ever came back; `publicDir` is now asserted in `site-config.test.ts`; a build inside vitest would slow every run.
  - `[low]` `[reject]` `writeSnapshot` rename-failure path untested (BH) — carried: rare path that fails loudly.
  - `[low]` `[reject]` A corrupt existing snapshot is replaced without a log line (BH) — only a hand edit could corrupt it (AD-12: bot-written); the new file is valid either way; adding warnings adds a branch.
  - `[low]` `[reject]` New tests leave temp dirs behind (BH) — matches the existing `tmp()` pattern in `tests/geocode.test.ts` and `tests/build-places.test.ts`; the OS clears `$TMPDIR`.
  - `[false]` `[reject]` Review content leaves out staged files (BH) — same as the IA rows: excluded on purpose, verified separately.
  - `[medium]` `[bad_spec]` Retry `PUBLISH_CMD` runs `npm ci` where the credential is readable from `/proc/<pid>/environ` (ECH) — confirmed: `GH_TOKEN` (step env) and `GIT_AUTH_HEADER` (script env prefix) stay in those processes' initial environment after `unset`, and `npm ci` install scripts are their descendants; loop-2 amendment drops `npm ci` from the retry.
  - `[low]` `[reject]` A failed fetch aborts the retry under `set -e` (ECH) — carried: fails loudly, nothing deploys.
  - `[false]` `[reject]` An empty directory `[]` publishes an empty snapshot (ECH) — `tests/directory.test.ts:190` asserts the committed directory has 119 entries, and `npm test` runs before `npm run pipeline` in both the publish step and the retry.
  - `[low]` `[reject]` A killed run's `.tmp` file gets committed and served (ECH) — carried: needs a kill between write and rename plus a manual commit.
  - `[false]` `[reject]` `not_checked` with non-null run fields passes (ECH) — carried: AD-6 allows old timestamps on a skipped centre.
  - `[low]` `[reject]` Duplicate or impossible `systems` entries pass (ECH) — carried: Epic 2.
  - `[low]` `[reject]` Workflow does not assert `dist/.gitkeep` is absent (ECH) — same as the BH `.gitkeep` row.

### 2026-10-28 — Review pass (loop 2 re-derivation)
- verdicts: 33 findings — high 0, medium 0, low 21, false 11, maybe-false 1
- findings:
  - `[low]` `[defer]` `npm run pipeline` / `run.ts` exit code never executed (IA) — carried: already in `deferred`.
  - `[low]` `[reject]` "Every real centre once" shown only on the fixture (IA) — carried: id equality was removed on purpose in loop 1.
  - `[low]` `[reject]` `runPublish`'s snapshot-schema failure branch is untested (IA) — `writeSnapshot` throwing is tested; `buildSnapshot` cannot produce an invalid snapshot from a valid directory without an injected builder (new surface).
  - `[false]` `[reject]` AC2 is not exercised by a real workflow run (IA) — carried: Actions stops the job at the failed step.
  - `[false]` `[reject]` AC3 wiring and `dist/` content are YAML/config checks only (IA) — carried: the script is tested on real repos; `publicDir` is asserted; the in-workflow step checks `dist/`.
  - `[false]` `[reject]` `places.json` is not produced by the pipeline (IA) — the AC only requires deploying it; Story 1.5's tool produces it and the build fails if it is missing.
  - `[false]` `[reject]` Retry differs from AD-12's saved-results re-merge (IA) — carried: no readers in Epic 1; Story 2.6 adds that.
  - `[false]` `[reject]` `web/` does not read the snapshot (IA) — carried: Story 1.8.
  - `[false]` `[reject]` Additions beyond the AC text (IA) — carried: specified, no harm named.
  - `[false]` `[reject]` `snapshot.json` is outside the reviewed diff (IA) — carried: excluded on purpose, verified separately.
  - `[low]` `[patch]` A failing re-publish on the retry path is untested (VG, pre-verified) — added "fails without pushing or outputting a sha when the re-publish after a reset fails" to `tests/commit-public.test.ts` (status ≠ 0, no `sha`, remote still at upstream).
  - `[low]` `[reject]` `PUBLIC_DIR` is defined twice (tools and stages) (VG other) — both resolve `data/public`; stages may not import `tools/` (import rules); a moved tools path would fail the in-workflow `dist/places.json` check.
  - `[low]` `[reject]` Test code and runtime deps run on retry while the token is readable through `/proc/<ppid>/environ` (ECH) — confirmed, but these are the same already-installed packages that build the deployed site in this job; install scripts no longer run there (loop 2); closing it fully needs an fd/credential-helper channel (new machinery). Recorded under residual risks.
  - `[low]` `[reject]` Non-fast-forward vs other push failures not told apart (ECH) — carried.
  - `[low]` `[reject]` A failed fetch aborts the retry under `set -e` (ECH) — carried.
  - `[maybe-false]` `[reject]` A valid non-canonical existing snapshot is kept (ECH) — carried: only a hand edit could cause it; would only be low.
  - `[false]` `[reject]` A non-`Error` throw logs `undefined` (ECH) — every throw reachable here (`node:fs`, `writeSnapshot`) is an `Error`.
  - `[low]` `[reject]` Run-field cross rules missing (ECH) — carried: Epic 2.
  - `[low]` `[reject]` Duplicate `systems` readers accepted (ECH) — carried: Epic 2.
  - `[low]` `[reject]` Untracked files in `data/public/` survive `reset --hard` (ECH) — same as the carried stray-`.tmp` row; a republish rewrites `snapshot.json` anyway.
  - `[low]` `[reject]` Run-field cross rules missing (BH) — carried: Epic 2.
  - `[low]` `[reject]` `systems` has no cross-entry or cross-centre checks (BH) — carried: Epic 2.
  - `[low]` `[reject]` A leftover `.tmp` would be committed and deployed (BH) — carried.
  - `[false]` `[reject]` Credential visible in argv / `ps` (BH) — carried: the job VM runs only this job's processes.
  - `[low]` `[patch]` The auth header is not scoped to one host (BH) — `remote_git` now uses `http.https://github.com/.extraheader`; the auth-header test expects that exact key.
  - `[low]` `[patch]` The test overclaims that the publish command "never sees" the credential (BH) — reworded to say its environment does not contain it.
  - `[low]` `[reject]` `writeSnapshot` failure path untested (BH) — carried.
  - `[false]` `[reject]` `generated_at` whole seconds not enforced (BH) — carried: the contract requires UTC with `Z` only.
  - `[low]` `[reject]` Committed-data test does not check sort order or minified format (BH) — the bot is the only writer (AD-12) and rewrites a non-matching file on the next run; adds checks for a hand-edit case.
  - `[false]` `[reject]` Non-main dispatch silently does nothing (BH) — carried: jobs show "skipped".
  - `[low]` `[reject]` Branch protection rejections retried and misreported (BH) — same as the carried push-classification row; git's own error is in the log.
  - `[low]` `[patch]` Two `runPublish` tests ignore the exit code (BH) — the opted-out and ungeocoded tests now assert `code === 0` and no errors.
  - `[low]` `[reject]` Build job does not validate the deployed snapshot (BH) — Vite copies `publicDir` byte for byte, there is no `web/public/`, and the snapshot was validated before it was written.

## Design Notes

**Why keep `generated_at` when nothing changed:** every push to `main` runs the pipeline. If the timestamp always changed, each code push would create a data commit that holds only a new time. Freshness shown to users is per centre (`last_success_at`, AD-11), not `generated_at`, so keeping the old file loses nothing. Epic 2 runs will change centre fields anyway.

**Push flow sketch** (`commit-public.sh`):

```bash
for attempt in 1 2 3; do
  git add -- data/public
  git diff --cached --quiet || git -c user.name=… -c user.email=… commit -m "data: publish snapshot"
  if remote_git push "$REMOTE" "HEAD:$BRANCH"; then echo "sha=$(git rev-parse HEAD)" >> "${GITHUB_OUTPUT:-/dev/null}"; exit 0; fi
  remote_git fetch "$REMOTE" "$BRANCH" && git reset --hard FETCH_HEAD && env -u GIT_AUTH_HEADER sh -c "$PUBLISH_CMD"
done
exit 1
```

When nothing changed, the push is a no-op and succeeds, provided `HEAD` is still at or behind the remote.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run check:directory && npm run build` -- expected: all exit 0.
- `npm run pipeline && npm run pipeline && git status --short data/public` -- expected: after the committed snapshot, no output.
- `ls dist/snapshot.json dist/places.json && test ! -e dist/.gitkeep` -- expected: exit 0.

## Auto Run Result

- **Summary:** `npm run pipeline` now publishes `data/public/snapshot.json`: 119 centres, each `not_checked` with null run fields, plus `systems: []` and `listings: []`. Validation is a new zod contract in `shared/snapshot.ts`, the write is atomic, and the file is left untouched when only `generated_at` would change. `pipeline.yml` is now publish → build → deploy. Publish runs on `main` only, runs the tests, then the pipeline, then commits `data/public/` once if it changed and pushes with a scoped token (3 attempts, re-testing after a reset). Build and deploy use exactly the pushed SHA. Vite serves `data/public/` as its public dir, so `snapshot.json` and `places.json` ship at the site root.
- **Files changed:**
  - `shared/directory.ts`: split into `centreFieldsSchema` and `checkCentre`, with unchanged behaviour.
  - `shared/snapshot.ts`: the snapshot contract (version 1, coverage and last-result codes, system shape, strict, no listings).
  - `pipeline/stages/paths.ts`, `publish.ts`, `run.ts`: the publish stage and the `npm run pipeline` entry point.
  - `package.json`: the `pipeline` script.
  - `vite.config.ts`: `publicDir` is `data/public`.
  - `.github/scripts/commit-public.sh`: commit once if changed, push with a github.com-scoped header, hooks off, and reset/re-publish on a rejected push.
  - `.github/workflows/pipeline.yml`: the publish/build/deploy jobs, the main guard, `persist-credentials: false`, the retry `PUBLISH_CMD` without `npm ci`, and the `dist/` data-file checks.
  - `tests/snapshot.test.ts`, `tests/commit-public.test.ts`: new. `tests/workflows.test.ts`, `tests/site-config.test.ts`: updated.
  - `data/public/snapshot.json`: the generated snapshot.
  - `data/public/.gitkeep`, `pipeline/stages/.gitkeep`: removed.
  - `deferred-work.md`: the non-main deploy item is resolved by the main guard.
  - `epic-1-context.md`: recompiled, since the cached copy was older than `epics.md` and the spine.
- **Review:** 3 passes and 2 spec loopbacks, 87 findings in total (high 0, medium 5, low 50, false 30, maybe-false 2).
  - **Loop 1 (spec amended):**
    - The committed-data test no longer compares ids with the directory. Before, a directory edit blocked the pipeline from publishing it.
    - The retry tests upstream code before publishing it.
    - Added tests for the auth header and for `publicDir`.
    - The schema comment was reworded.
  - **Loop 2 (spec amended):** no `npm ci` in the step that holds the credential.
  - **Pass 3, patched (4, all low):**
    - a test for a failing re-publish on retry;
    - the header scoped to `https://github.com/`;
    - the test wording;
    - exit-code asserts in two publish tests.
  - **Deferred:** the `run.ts` entry point is never executed by a test.
  - **Rejected:** every other finding, each with its reason in the Review Triage Log. The main groups are:
    - run-field and system cross-checks: Epic 2, with merge;
    - push-failure classification;
    - the stray `.tmp` file;
    - the non-main dispatch showing as skipped;
    - argv visibility on a single-tenant runner.
- **Follow-up review recommended:** false. The last pass patched high 0, medium 0, low 4.
- **Verification:**
  - `npm run typecheck`, `npm run check:directory` (119 centres OK) and `npm run build` all exit 0.
  - `npm test`: 430 passed, 1 skipped (the Story 1.5 boundary test, until Story 1.11).
  - Two `npm run pipeline` runs leave `snapshot.json` unchanged.
  - `dist/snapshot.json` and `dist/places.json` exist, and `dist/.gitkeep` does not.
  - Every I/O-matrix row has a passing test.
- **Residual risks:**
  - The workflow has never run on GitHub. It still needs to show that the `x-access-token` basic header pushes to `main` with `contents: write`, that branch protection allows the bot, and that Pages accepts the pushed SHA.
  - On the retry path, test code and installed dependencies run while the push token is readable from the step's `/proc/<pid>/environ`.
  - The `generated_at` of an unchanged snapshot stays at the last content change, not the latest run.
  - Run-field and system invariants are not enforced in the schema yet (Epic 2).
