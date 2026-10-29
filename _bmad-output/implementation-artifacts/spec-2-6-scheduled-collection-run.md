---
title: 'Story 2.6: Scheduled collection run'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '481ec028c76d7e71b45961bbc4e1279327aa72b2'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-29.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Every push to main now runs a full collection (readers are registered), so code or directory pushes use one of each site's 4 daily visits and a site can be read more than once on a day, while the About copy says "once a day".
    evidence: |-
      pipeline.yml keeps the push and dispatch triggers (AD-12, spec Boundaries); before this story a push run fetched nothing. The 4-per-24 h budget bounds it, but the intent "run once per day" may mean collection only on the schedule. Needs an operator decision: keep, or make push/dispatch runs publish-only (replay/no fetch).
    location: >-
      .github/workflows/pipeline.yml on.push
    severity: medium
  - summary: >-
      A run that fails after fetching (collect throws, or the replay file cannot be saved) never persists this run's visits, so the per-site budget under-counts them.
    evidence: |-
      The visit log persists only through the bot commit; a failed run commits nothing. Pre-existing design from Stories 2.2/2.5, not introduced here; fixing it needs a way to persist visits from a failed run.
    location: >-
      pipeline/stages/run.ts runPipeline; .github/scripts/commit-public.sh
    severity: low
---

<intent-contract>

## Intent

**Problem:** The stages from 2.2–2.5 (collect, normalise, merge) exist but nothing calls them: `npm run pipeline` only republishes the directory as snapshot v1 with every centre `not_checked`, `pipeline.yml` has no schedule, and a rejected push re-runs the whole pipeline (refetching provider sites).

**Approach:** Make `npm run pipeline` run fetch → parse → normalise → merge → publish, publish snapshot `schemaVersion` 2 (coverage, run fields, `systems[]`, listings) from merged state, run it once a day at 05:17 UTC (operator decision 2026-10-29, see the sprint change proposal), commit `data/state/` + `data/public/` together, and on a rejected push rebase or replay merge+publish from this run's saved reader results without refetching.

## Boundaries & Constraints

**Always:**
- Run order: read directory (`DIRECTORY_PATH`), `readVisitLog`, `readState` → `collectRun` with readers `{ kuferweb: kuferwebReader, itemkg: itemkgReader }` → `normaliseOutcome` per centre → `mergeRun` → `writeMergeResult` → publish. One `runAt` for the whole run. A bad directory, state or visit log exits 1 and writes nothing.
- Log one line per centre, sorted by `centre_id`: `centre_id`, reader, outcome (`ok` / `failed:<reason>` / `skipped:<reason>`), listing count (normalised count for `ok`, else 0), duration in ms. Never page content or URLs. Then one summary line.
- `--save-collect <file>` writes this run's replay input after collect: `{ runAt, outcomes, visits, pages }` (JSON; `pages` keys sorted). `--from-collect <file>` skips fetch entirely and runs normalise → merge → publish from that file with its saved `runAt`, re-reading directory/state/log from disk. Both flags validate their file shape with zod; an invalid replay file exits 1, writing nothing.
- Snapshot v2 (`SNAPSHOT_SCHEMA_VERSION = 2`), built from directory + merged state + this run's outcomes:
  - Centre `coverage`: `not_checked` if opted out, reader `none`, no registered reader, or this run's outcome is `skipped:robots`; otherwise `covered` (budget skips and centres with no state yet stay `covered`). Run fields come from state for `covered` centres, `null` for `not_checked`.
  - `systems[]`: one entry per registered reader system (sorted), `centres_covered` = covered centres with that reader, `centres_ok` / `centres_failed` = those whose state `last_result` is `ok` / `failed`, `last_success_at` = latest `last_success_at` among them or `null`.
  - `listings[]`: stored listings of `covered` centres with `removed_at === null` and `starts_at` after `runAt`, minus `removed_at`, sorted by `id`. Fields: the normalised `Listing` fields plus `first_seen_at` and `baseline`.
  - Validated before writing (schema refuses listings of unknown or `not_checked` centres); invalid → exit 1, last good file untouched.
- `shared/` gets `FRESHNESS_MS = 36 h` (AD-11 as amended); the 24 h constants are unchanged.
- `pipeline.yml`: `schedule: cron '17 5 * * *'` plus the existing push-to-main and dispatch triggers, same concurrency group, no cancel-in-progress. The publish job runs `npm run pipeline -- --save-collect "$RUNNER_TEMP/collect.json"` and passes `PUBLISH_CMD` = typecheck + test + `npm run pipeline -- --from-collect "$RUNNER_TEMP/collect.json"` to the commit script.
- `commit-public.sh` commits `data/state` and `data/public` in one commit (bot identity). On a rejected push: fetch; if the upstream commits since the merge base touch only `data/state/` / `data/public/`, `git rebase FETCH_HEAD` and push; if that rebase conflicts, abort it and fall through. Otherwise (or after an aborted rebase) reset hard to `FETCH_HEAD`, run `PUBLISH_CMD`, commit if changed, push. 3 attempts in all, no deploy unless pushed.
- About copy `about.how.body` says once a day in both languages (en: "We read the centres' websites once a day. …", de: "Wir lesen die Websites der Testzentren einmal am Tag. …").
- `docs/operations.md` documents the home-machine fallback: the same two commands with a fine-grained token in `GIT_AUTH_HEADER`, after which GitHub's push-triggered run deploys.

**Never:**
- No change to readers, fetch politeness, `RawListing`, normalise/merge semantics or state schema. No new dependencies.
- No result cards, freshness UI, sort or notices (Stories 2.7–2.9); `web/` only adapts to schema v2 (the search page keeps its current cards).
- `--from-collect` never contacts the network; no stage other than merge writes `data/state/`.
- No page content, URLs or personal data in logs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ok centre | kuferweb centre parses 2 dates | `covered`, run fields from state, 2 listings, log `ok 2` | — |
| Failed after success | itemkg centre failed, had listings | `covered`, `last_result: failed`, old listings still published | — |
| Opted out / reader none | directory flags | `not_checked`, run fields `null`, no listings, no request | — |
| Robots skip | outcome `skipped:robots` | `not_checked`, its stored listings excluded | — |
| Budget skip | outcome `skipped:budget` | `covered`, state untouched, listings still published | — |
| Never run | covered, no state entry | `covered`, run fields `null`, no listings | — |
| Past / removed listing | `starts_at ≤ runAt` or `removed_at` set | excluded from snapshot | — |
| Replay | `--from-collect` valid file | same state + snapshot as the original run on the same inputs; no fetch | — |
| Bad replay file | invalid JSON or shape | exit 1, nothing written | names the file |
| Push rejected, bot-only upstream | upstream changed only `data/state/` | rebase onto it, push | conflict → reset + replay |
| Push rejected, other upstream | upstream changed `data/directory/` | reset, replay, commit, push on top | replay fails → exit 1, no sha |

</intent-contract>

## Code Map

- `pipeline/stages/run.ts` -- entry point; today only `runPublish()`. Becomes the orchestrator (`runPipeline(options)` with injectable paths, clock, readers, `clientOptions`, log/error for tests; CLI flag parsing under `import.meta.main`).
- `pipeline/stages/collect.ts` -- `collectRun(centres, readers, { log, runAt, clientOptions })` → `{ outcomes, visits, pages }`; `CentreOutcome`, `SkipReason`, `ReaderRegistry`. Add per-centre `durations` (ms) via an injectable clock; update `tests/collect.test.ts`.
- `pipeline/stages/normalise.ts:137` -- `normaliseOutcome(centre, outcome, pages)`; `pages` required (use `[]` only for centres absent from `pages`, i.e. never parsed).
- `pipeline/stages/merge.ts` -- `mergeRun`, `readState`, `writeMergeResult` (visit log then state). Also closes 2.5's deferred `writeAtomic` cleanup test via the run tests.
- `pipeline/fetch/visits.ts` -- `readVisitLog`, `VISIT_LOG_PATH`.
- `pipeline/stages/publish.ts` -- `buildSnapshot(centres, runAt)` (v1, all `not_checked`), `writeSnapshot` (validate, unchanged-detection, atomic), `runPublish`. Extend `buildSnapshot` to take state + outcomes + reader set; keep `writeSnapshot`.
- `pipeline/stages/paths.ts` -- `DIRECTORY_PATH`, `SNAPSHOT_PATH`, `STATE_PATH`, `VISIT_LOG_PATH`.
- `pipeline/readers/{kuferweb,itemkg}/index.ts` -- `kuferwebReader`, `itemkgReader`.
- `shared/snapshot.ts` -- `SNAPSHOT_SCHEMA_VERSION = 1`, `listings` forced empty; add `snapshotListingSchema` (from `listingFieldsSchema` + `first_seen_at`, `baseline`, `checkListing`), cross-checks (listing `centre_id` exists and is `covered`, unique sorted ids), `FRESHNESS_MS`.
- `shared/state.ts` -- `storedListingSchema` pattern to mirror; `shared/listing.ts` -- `listingFieldsSchema`, `checkListing`.
- `web/src/data/snapshot.ts` -- loader uses the shared schema/version (no logic change expected); `uncheckedCentres` already treats non-`ok` as unchecked.
- `tests/fixtures/snapshot.ts`, `tests/snapshot-loader.test.ts`, `tests/search-page.test.tsx`, `tests/places.test.ts`, `tests/snapshot.test.ts` -- reference v1; update to v2.
- `data/public/snapshot.json` -- committed v1; regenerate as v2 without network by running `npm run pipeline -- --from-collect <tmp>` with the replay file `{ runAt: <now>, outcomes: {}, visits: [], pages: {} }`, so committed-data tests pass (covered centres get `null` run fields; state stays empty and is not written as a change).
- `.github/workflows/pipeline.yml` -- add schedule, `--save-collect`, replay `PUBLISH_CMD`. `tests/workflows.test.ts` asserts triggers, order, retry command.
- `.github/scripts/commit-public.sh` -- commits `data/public` only, retries by reset + full `PUBLISH_CMD`. `tests/commit-public.test.ts` uses temp bare repos; extend for state+public commit, bot-only rebase, rebase-conflict fallback.
- `web/src/i18n/{de,en}.json:7` -- `about.how.body`.
- `tests/import-rules.test.ts`, `tests/state-writers.test.ts` -- layer and "only merge writes state" guards; new code must pass.

## Tasks & Acceptance

**Execution:**
- `shared/snapshot.ts` -- v2 schema with listings, cross-checks, `FRESHNESS_MS` -- AD-9, AD-11.
- `pipeline/stages/collect.ts` -- per-centre durations with injectable clock -- log line.
- `pipeline/stages/publish.ts` -- v2 `buildSnapshot` from directory, state, outcomes, readers -- AD-8/AD-9.
- `pipeline/stages/run.ts` -- orchestrator, per-centre log, `--save-collect` / `--from-collect` with zod-validated replay file -- story AC 1, rejected-push replay.
- `.github/scripts/commit-public.sh` -- state+public commit, bot-only rebase, reset+replay fallback -- AD-12.
- `.github/workflows/pipeline.yml` -- daily `17 5 * * *`, save/replay commands -- FR9.
- `web/src/i18n/{de,en}.json` -- once-a-day copy -- FR33.
- `docs/operations.md` -- home-machine fallback steps -- architecture fallback.
- `data/public/snapshot.json` -- regenerate as v2 offline.
- `tests/run.test.ts` -- end to end with fake fetch serving reader fixtures in temp dirs: matrix rows (ok, failed-after-success, opted out, reader none, robots, budget, never run, past/removed), log lines (no HTML/URLs), save → replay equality with no fetch calls, bad replay/state file writes nothing, invalid snapshot leaves the old file.
- `tests/snapshot.test.ts`, `tests/fixtures/snapshot.ts`, `tests/snapshot-loader.test.ts`, `tests/search-page.test.tsx`, `tests/places.test.ts`, `tests/collect.test.ts` -- v2 and durations.
- `tests/commit-public.test.ts`, `tests/workflows.test.ts` -- rebase/replay paths, single commit of both folders, schedule and commands.

**Acceptance Criteria:**
- Given `pipeline.yml`, when parsed, then its only schedule is `17 5 * * *`, it still triggers on push to main and dispatch in one non-cancelling concurrency group, and publish → build → deploy deploys only the pushed SHA.
- Given the About page in DE and EN, when rendered, then "How it works" says the websites are read once a day.
- Given the committed `data/public/snapshot.json`, when tests run, then it validates as `schemaVersion` 2.
- Given the whole repo, when `npm run typecheck` and `npm test` run, then both pass, including import rules and the state-writer guard.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 33 findings — high 0, medium 1, low 19, false 13, maybe-false 0
- findings:
  - `low` `reject` Blind: clean rebase onto a data-only upstream can push a snapshot inconsistent with textually merged state — two runs both rewrite every covered centre's `last_checked_at` in state.json and the one-line snapshot.json, so their hunks overlap and the rebase conflicts (→ reset + replay); a clean textual merge needs disjoint data edits, unlikely in practice, and a post-rebase validation adds a new branch.
  - `low` `patch` Blind: `upstream_is_data_only` misses non-data edits made in merge commits or renames — switched to `git diff --no-renames --name-only base FETCH_HEAD`; test added.
  - `low` `reject` Blind: replay of an older `runAt` can roll back newer upstream state — needs a concurrent run on another runner; the pipeline concurrency group serialises GitHub runs, only an overlapping home-fallback run reaches it, and the guard adds a new rule.
  - `low` `patch` Blind: home-fallback doc commands not chained, fixed `/tmp` replay file, "two commands" wording — chained with `&&`, `mktemp` file removed after, wording fixed.
  - `medium` `defer` Blind: every push to main now fetches every site, undercutting "once a day" — real; spec keeps the push trigger (AD-12) and the budget bounds it, but whether push runs should collect is an operator decision; deferred.
  - `false` `reject` Blind: `FRESHNESS_MS` has no consumer, so the UI keeps an old threshold — no web code applies any freshness threshold yet (only i18n strings); the UI that reads it is Story 2.7.
  - `low` `patch` Blind: exhausted-retries test no longer covers the reset path — added a 3-rejections test with upstream moving outside data/.
  - `low` `reject` Blind: snapshot schema doesn't cross-check `systems[]` counts or sort/uniqueness — buildSnapshot is the only producer and its tests check the counts; extra schema refinements add complexity for an unlikely case.
  - `false` `reject` Blind: a robots blip hides a centre — robots skip → `not_checked` is the epic's rule (AD-8, story AC "skipped for opt-out, reader none or robots are published as not_checked"), not a defect of this change.
  - `false` `reject` Blind: a never-collected centre reads as covered with null fields and the UI may misrender it — AD-8 card rules (Story 2.8) render covered + never run as "Not checked right now"; today `uncheckedCentres` already treats non-`ok` as unchecked.
  - `low` `reject` Blind: replay doesn't detect a reader/opt-out change between runs — needs a directory edit to that centre during one run's push window; the snapshot already publishes such a centre per its current directory entry; the guard adds a new rule.
  - `false` `reject` Blind: per-centre durations include queueing — the field is documented as wall time "from its first rule to its outcome", which is what the log line promises.
  - `false` `reject` Blind: diff omits the spec and snapshot.json — excluded on purpose (spec reviewed separately by the edge layer; snapshot.json is generated data checked by tests).
  - `false` `reject` Blind: missing-replay-file test lacks message asserts — the table test for bad replay files asserts the file name, no fetch and an unchanged tree.
  - `low` `reject` Blind: `pageSummarySchema` accepts any URL string — the file is written by the same run; normalise compares strings only.
  - `false` `reject` Blind: docs don't say where the CI replay file lives — operations.md names `$RUNNER_TEMP/collect.json`.
  - `low` `reject` Blind: GitHub disables schedules in inactive repos — daily bot data commits keep the repo active.
  - `low` `reject` Edge: clean textual rebase of state/visits — same as the Blind rebase row.
  - `low` `patch` Edge: merge commit / rename hides non-data change — same fix as the Blind row.
  - `low` `reject` Edge: older replay over newer state — same as the Blind row.
  - `low` `reject` Edge: replay after opt-out/reader change — same as the Blind row.
  - `low` `defer` Edge: visits lost when `saveReplay` fails after fetch — the visit log persists only through the bot commit, which a failed run never makes; pre-existing (2.2/2.5 design).
  - `low` `defer` Edge: visits lost when collect throws mid-run — same root cause as the row above.
  - `low` `reject` Edge: queued scheduled run checks out a stale `visits.json` — needs a run queued behind a push run on the same day; with one daily run the budget keeps 2+ visits of slack, and changing the checkout ref affects the tested-commit guarantee.
  - `low` `patch` Edge: fallback doc continues after a failed step with an old `/tmp` file — same fix as the Blind doc row.
  - `false` `reject` Edge: non-atomic `saveReplay` leaves truncated JSON — only on a killed process, which fails the job anyway; nothing is pushed.
  - `false` `reject` Edge (claim): "bot-only rebase" overwrites a human data fix — a clean rebase keeps both commits' edits; a conflicting one aborts to reset + replay on top of the human's commit.
  - `false` `reject` Edge (claim): `FRESHNESS_MS` unused by web — same as the Blind row.
  - `low` `patch` VG: failed `--save-collect` write untested — added an unwritable-path test (exit 1, file named, tree unchanged).
  - `low` `patch` VG: replay onto a directory with an added centre untested — added a test for the `- 0 -` log line, tally, covered with null fields, no state entry.
  - `false` `reject` Intent (R2): push and dispatch triggers kept, so not "exactly once" — same root as the deferred push-fetch row; logged there.
  - `false` `reject` Intent: tests use fixtures, not live GitHub runs — live runs are out of reach of `npm test`; the workflow is checked by YAML parsing.
  - `false` `reject` Intent: scope beyond the narrow reading (schema v2, replay, state commit) — matches Story 2.6 as written (reading R5), which the diff implements.

## Design Notes

- Robots skips become `not_checked` because the centre told us not to read it; budget skips stay `covered` so a busy day doesn't flip cards to "not checked" while prior data is still shown with its age.
- Replay re-reads directory and state from the new upstream, so a directory edit pushed mid-run is respected and merge applies this run's outcomes on top of the newest state. The visit log dedupes exact `(host, at)` entries, so replay never double-charges.
- Push-triggered runs also fetch; the 4-per-24 h budget bounds them. A home-fallback push triggers one more run within budget.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all tests pass
- `npm run build` -- expected: succeeds with the v2 snapshot

## Auto Run Result

Status: done

**Summary:** `npm run pipeline` now runs the whole chain (fetch → parse → normalise → merge → publish) with one `runAt`, logs one line per centre (id, reader, outcome, count, duration; no page content or URLs) plus a summary, and publishes snapshot `schemaVersion` 2 (coverage, run fields, `systems[]`, upcoming listings). `pipeline.yml` runs it once a day at 05:17 UTC (`17 5 * * *`), on push to main and on dispatch. The bot commits `data/state/` and `data/public/` together. On a rejected push it rebases onto a data-only upstream, or otherwise resets and replays merge + publish from this run's saved reader results (`--save-collect` / `--from-collect`), never refetching. `FRESHNESS_MS` (36 h) is in `shared/`, the About copy says "once a day", and `docs/operations.md` documents the home-machine fallback.

**Files changed:**
- `pipeline/stages/run.ts` -- the orchestrator, run log, CLI flags.
- `pipeline/stages/replay.ts` -- new: zod-validated replay file (save/load).
- `pipeline/stages/publish.ts` -- v2 `buildSnapshot` (coverage, systems, listings); `runPublish` removed.
- `pipeline/stages/collect.ts` -- per-centre durations with an injectable clock.
- `shared/snapshot.ts` -- schema v2 with listings and cross-checks; `FRESHNESS_MS`.
- `.github/scripts/commit-public.sh` -- commits both data folders; data-only rebase (tree-diff check); reset + replay fallback.
- `.github/workflows/pipeline.yml` -- daily schedule, save/replay commands.
- `web/src/i18n/{de,en}.json` -- "once a day" About copy.
- `docs/operations.md` -- new: schedule and home fallback.
- `data/public/snapshot.json` -- regenerated as v2 offline (no listings yet).
- Tests: new `tests/run.test.ts`; updated `snapshot`, `collect`, `commit-public`, `workflows`, `about`, `snapshot-loader`, `search-page`.

**Review findings:** 33 findings. 5 low entries patched: tree-diff data-only check, chained fallback doc, and three tests (exhausted retries with a real upstream move, unwritable `--save-collect`, replay with an added centre). Deferred 2: every push to main also collects (medium, operator decision), and visits from a failed run are not persisted (low, pre-existing). Every other row was rejected, with its reason recorded in the Review Triage Log.

**Follow-up review recommended:** false. 0 high and 0 medium entries were patched (5 low).

**Verification:**
- `npm run typecheck` -- clean.
- `npm test` -- 30 files, 1081 passed, 1 skipped (that test was skipped before this change).
- `npm run build` -- succeeds with the v2 snapshot.
- Matrix audit: every I/O row has a passing test (run matrix test, the replay tests, the bad replay-file table, and the commit-public rebase/replay tests).

**Residual risks:**
- Not yet run against the live provider sites or in a real GitHub Actions run.
- Push-triggered runs also fetch (deferred).
- An overlapping home-fallback run could replay an older `runAt` on top of newer state.
