---
title: 'Story 3.12: Every covered centre gets checked'
type: 'bugfix'
created: '2026-11-01'
status: 'done'
baseline_revision: '11cf27a04caaf012137fbfe6d9db9a31cf844add'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      No operator alert when robots.txt keeps covered centres out for a long time; with the sticky not_checked rule they also leave centres_covered, so a fully robots-blocked system never trips the "system down" check.
    evidence: |-
      Pre-existing gap: Story 3.4's alerts never looked at robots skips, which is how the five ITEM KG centres went unnoticed for days. Story 3.12 makes them visible on the site and in the run log (one line per unusable robots.txt), but files no issue. Fix would add an alert condition in pipeline/stages/report.ts / tools/alerts.ts, e.g. last_robots_skip_at newer than last_checked_at for longer than SYSTEM_DOWN_MS.
    location: >-
      pipeline/stages/report.ts, tools/alerts.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Five ITEM KG centres (Würzburg, Erding, Cham, Straubing, Kelheim) have never been read: every run on 2026-10-29 → 2026-11-01 logged them `skipped:robots` (3–7 s each), then `skipped:budget` once their hosts were at 4/4. Their robots.txt files allow us (three 200 with rules that allow the list pages, two 404 = allow all), and Node's `fetch` gets them fine from outside GitHub. They are exactly the five alphabetically last ITEM KG centres, and ITEM KG sites share a few servers (84.246.120.147/150/151). Collect starts all ~80 centres at once, so ~20 robots.txt requests hit those servers together. The likely cause is that the last ones get a 5xx or a refused connection, which the client turns into "disallow all" (`resolveRobots`). The reason is not logged, and merge stores nothing for a `skipped` outcome, so the cause was only guessable.

**Approach:** (1) Record the cause and evidence in `data/directory/itemkg-note.md`, and fix it: collect runs at most `MAX_PARALLEL_CENTRES_PER_READER` (2, in `pipeline/config.ts`) centres of the same reader system at a time. The run log gets one line per origin whose robots.txt was unusable, so the next run confirms or refutes the cause. (2) Merge records each skip (`last_skip_reason`, `last_skip_at`, and `last_robots_skip_at`) without touching listings or `last_result`; state becomes `stateVersion` 2 (AD-6 amended). (3) Publish keeps a centre `not_checked` while its newest robots skip is newer than its last check, even when the current run skipped it for budget or did not reach it.

## Boundaries & Constraints

**Always:**
- State v2, `centreStateSchema`: `last_result` and `last_checked_at` become nullable (a centre that was only ever skipped has an entry with both `null`, `last_success_at: null`, `listings: []`). New fields: `last_skip_reason: 'robots' | 'budget' | 'opted-out' | 'no-reader' | null`, `last_skip_at: utc | null`, `last_robots_skip_at: utc | null`. `STATE_VERSION = 2`.
- `readState` accepts v2, and v1 with an explicit in-memory upgrade (each centre gains the three new fields as `null`), logged once as `state v1 upgraded to v2`. Any other version is still refused. The next write is v2. `data/state/state.json` is not hand-edited.
- Merge, `skipped` outcome: set `last_skip_reason` and `last_skip_at = runAt`; for `robots` also `last_robots_skip_at = runAt`; create the entry if missing; never change `last_result`, `last_checked_at`, `last_success_at` or listings. `ok`/`failed`: unchanged behaviour, and the skip fields are kept (history).
- Publish `coverageOf`: `not_checked` when opted out, reader `none` or unregistered (unchanged); when this run's outcome is a robots skip (unchanged); and new: when this run's outcome is absent or a non-robots skip and the stored entry has `last_robots_skip_at !== null` and (`last_checked_at === null` or `last_robots_skip_at > last_checked_at`). Otherwise `covered`.
- System line: for every system, `centres_covered = centres_ok + centres_failed + (covered centres with last_result null)`. No snapshot schema change, no new snapshot field.
- Collect: at most 2 centres per reader system in flight; centres of different systems still run in parallel; per-host delay and visit budget unchanged.
- Run log: after the per-centre lines, one line per origin in the client's `robotsUnavailable`: `robots <host>: unusable (<reason>), treated as disallow all`. Host only, no path.
- `data/directory/itemkg-note.md` records: the five centres, the log evidence (dates, outcomes, durations), the robots.txt check, the shared-server observation, the cause (stated as the likely cause until a run log shows the reason), the fix, and what the first daily run after the fix must show. No centre is set to `reader: none` by this story.
- AD-6 in `ARCHITECTURE-SPINE.md` amended: state v2 skip fields, the v1 upgrade, and the robots rule for coverage.

**Never:** No snapshot `schemaVersion` change and no `web/` change. No retry of robots.txt and no change to the robots rules (5xx/network → disallow all stays, RFC 9309). No change to the visit budget, schedule or workflows. No hand edit of `data/state/*`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First robots skip | no state entry; outcome `skipped:robots` | entry: `last_result null`, `last_checked_at null`, `listings []`, `last_skip_reason robots`, `last_skip_at = last_robots_skip_at = runAt`; published `not_checked` | No error expected |
| Robots then budget | stored robots skip at T1, no check; this run `skipped:budget` at T2 | `last_skip_reason budget`, `last_skip_at T2`, `last_robots_skip_at T1` kept; published `not_checked` | No error expected |
| Robots then no outcome | stored robots skip; centre has no outcome this run (replay after directory edit) | published `not_checked` | No error expected |
| Robots then ok | stored robots skip at T1; this run `ok` at T2 | `last_result ok`, `last_checked_at T2`, skip fields kept; published `covered` | No error expected |
| Ok then robots then budget | check T1, robots skip T2 > T1, budget skip T3 | `not_checked` | No error expected |
| Robots then later check, then budget | robots T1, ok T2 > T1, budget T3 | `covered` with T2's result | No error expected |
| Budget skip with history | stored ok entry with listings; `skipped:budget` | `last_result`, listings unchanged; skip fields set; `covered` | No error expected |
| Budget skip, never checked | no entry; `skipped:budget` | entry with nulls, reason `budget`; `covered` with `last_result null`; counts as skipped in the system sum | No error expected |
| Opted out / no reader | `skipped:opted-out` / `skipped:no-reader` | reason recorded; `not_checked` (directory rule) | No error expected |
| v1 state on disk | `stateVersion: 1` file | read and upgraded, one log line; next write is v2 | v3 or garbage still refused |
| System sum | itemkg: 15 ok, 0 failed, 2 budget-never-checked covered, 5 robots → not_checked | `centres_covered 17 = 15 + 0 + 2` | No error expected |
| Parallel limit | 6 itemkg + 3 kuferweb centres | never more than 2 itemkg (and 2 kuferweb) centres in flight at once | No error expected |
| Robots unusable | client reports `robotsUnavailable["https://www.vhs-cham.de"] = "HTTP 503"` | log line `robots www.vhs-cham.de: unusable (HTTP 503), treated as disallow all` | No error expected |

</intent-contract>

## Code Map

- `shared/state.ts` -- `STATE_VERSION` (1), `centreStateSchema` (strict; `last_result`, `last_checked_at` required), `stateSchema` (`z.literal(STATE_VERSION)`), `emptyState`. Header comment: entries exist "once the centre has had an `ok` or `failed` run" → update.
- `pipeline/stages/merge.ts` -- `readState` (find it; validates with `stateSchema`); `mergeRun` (~84+): per-outcome handling, `skipped` "changes nothing" (doc comment ~78); `serializeState`; `writeMergeResult`.
- `pipeline/stages/publish.ts:30-45` -- `coverageOf(centre, readers, outcome)`; called in `buildSnapshot` (~66) with this run's outcome. Needs the stored entry too (pass `state.centres[id]`). Systems loop (~75-85) already counts ok/failed from `history.last_result`.
- `pipeline/stages/collect.ts` -- `collectRun`: `Promise.allSettled(centres.map(...))` (Story 3.11, keep its `CollectError` visits). Add a per-reader limiter (simple semaphore keyed by `centre.reader`). Return `robotsUnavailable` from `client.stats()` in `CollectResult` (and in `CollectError` if cheap; not required).
- `pipeline/fetch/index.ts:74-75,205-235` -- `robotsUnavailable` per origin; `resolveRobots` rules (read-only).
- `pipeline/stages/run.ts` -- per-centre log loop (~170); add the robots lines after it from the collect result (not on replay: the replay file has no such data; that is fine).
- `pipeline/config.ts` -- add `MAX_PARALLEL_CENTRES_PER_READER = 2` with a comment pointing at `data/directory/itemkg-note.md`.
- `pipeline/stages/report.ts` (Story 3.4) -- reads snapshot systems; unchanged, but its tests must still pass with nullable `last_result` in state.
- `tests/state-writers.test.ts` -- only merge writes `data/state/`; keep it true (no tool writes state).
- `tests/merge.test.ts`, `tests/publish.test.ts` (or wherever `buildSnapshot`/`coverageOf` are tested — `tests/snapshot.test.ts`), `tests/collect.test.ts`, `tests/run.test.ts`, `tests/report.test.ts` -- extend.
- `data/directory/` -- new `itemkg-note.md`. Evidence: GitHub Actions runs 40867599295 … 41303596263 (2026-10-29 11:43 UTC to 2026-11-01 11:49 UTC); per centre 6× `skipped:robots` (3.2–7.4 s) and 2× `skipped:budget`; robots.txt on 2026-11-01: Würzburg, Cham, Kelheim 200 (rules only disallow `/typo3*`, `/*?id=*`, `/*&type=98`), Erding and Straubing 404; DNS: 84.246.120.147/150/151, shared with working ITEM KG sites (e.g. Bamberg, Coburg on .150).
- `_bmad-output/planning-artifacts/architecture/architecture-bgtsearch-2026-10-25/ARCHITECTURE-SPINE.md` -- AD-6 (state file) amendment.

## Tasks & Acceptance

**Execution:**
- `shared/state.ts` -- v2 schema and the v1 upgrade helper (`upgradeState(data): State | null` or similar, used by `readState`).
- `pipeline/stages/merge.ts` -- `readState` v1 upgrade + log; skip recording in `mergeRun`; doc comments.
- `pipeline/stages/publish.ts` -- `coverageOf` takes the stored entry; robots rule; doc comment.
- `pipeline/config.ts` -- `MAX_PARALLEL_CENTRES_PER_READER`.
- `pipeline/stages/collect.ts` -- per-reader limiter; `robotsUnavailable` in the result.
- `pipeline/stages/run.ts` -- robots log lines; pass the v1-upgrade log line through `log`.
- `data/directory/itemkg-note.md` -- the record described in Boundaries.
- `ARCHITECTURE-SPINE.md` -- AD-6 amendment.
- Tests: every I/O-matrix row — merge (skip rows, v1 upgrade, refusal of other versions), publish (coverage rows, system sum), collect (limiter: max in flight per reader, other readers parallel; `robotsUnavailable` returned), run (robots log line; v1 file on disk runs and writes v2).

**Acceptance Criteria:**
- Given the CI logs of 2026-10-29/30, when read, then `data/directory/itemkg-note.md` records the five centres' outcomes, the cause and the fix.
- Given a run in which a covered centre is skipped, when merge writes state, then the centre has `last_skip_reason` and `last_skip_at` (and `last_robots_skip_at` for robots), its listings and `last_result` unchanged, in a `stateVersion: 2` file.
- Given a centre whose newest robots skip is newer than its last check, when a later run publishes without reaching it (budget skip or no outcome), then it is published `not_checked`.
- Given any built snapshot, when its systems are read, then `centres_ok + centres_failed + skipped (covered, never checked) = centres_covered` for each system.
- Given the next daily run, when its log is read, then every origin whose robots.txt was unusable has its own line with the reason.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 28 findings — high 0, medium 1, low 15, false 12, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) `robotsUnavailable` lost when collect throws — patched: carried on `CollectError` and logged in the collect-failure branch.
  - `[medium]` `[defer]` (blind) No alert for centres robots keeps out; a fully blocked system leaves `centres_covered` and never trips "system down" — pre-existing (3.4 never alerted on robots skips); recorded in `deferred`.
  - `[low]` `[reject]` (blind) State rewritten every run because opted-out/no-reader skips move `last_skip_at` — every real run already rewrites state (`ok` sets `last_checked_at = runAt`); the AC lists `opted-out` and `no-reader` as reasons to record.
  - `[false]` `[reject]` (blind) Idempotence test weakened — a later run now legitimately records new skip times; the same-`runAt` rerun (the replay case) is still asserted unchanged.
  - `[low]` `[patch]` (blind) No test that a sticky `not_checked` centre publishes no stored listings — patched: snapshot test added (code already `continue`s before listings).
  - `[low]` `[patch]` (blind) Queue wait excluded from durations is untested — patched: limiter + fake-clock duration test.
  - `[low]` `[patch]` (blind) Robots log test assumes fixed line positions — patched: asserts order relative to per-centre lines.
  - `[low]` `[reject]` (blind) `http` and `https` origins of one host print duplicate lines — needs both schemes' robots.txt to be unusable in one run; the directory uses https URLs.
  - `[low]` `[patch]` (blind) `CentreOutcome` doc says skips set nothing — patched.
  - `[low]` `[reject]` (blind) Run time with 2 per reader is unbounded/unmeasured — ~21 ITEM KG centres in pairs at a few seconds each is minutes, far from the 6 h job default; the first run's log shows the real time.
  - `[low]` `[patch]` (blind) `itemkg-note.md` says "every run" logged robots, then lists budget runs — patched wording.
  - `[false]` `[reject]` (blind) Per-reader limit may miss other systems on the shared servers — checked 2026-11-01: no kuferweb host resolves to 84.246.120.x; sentence added to the note.
  - `[medium]` `[patch]` (verification-gap) Duration excluding queue wait unverified — grouped with the blind duration finding (entry verdict medium).
  - `[false]` `[reject]` (edge) `maxPerReader: NaN` removes the limit — an internal option only tests pass; the run uses the config constant.
  - `[low]` `[patch]` (edge) Robots reasons lost on a collect throw — grouped with the blind finding.
  - `[low]` `[reject]` (edge) Duplicate host lines — grouped with the blind finding.
  - `[low]` `[reject]` (edge) State churn every run — grouped with the blind finding.
  - `[low]` `[reject]` (edge) Collect time grows ~10× — grouped with the blind run-time finding.
  - `[low]` `[patch]` (edge) Claim: robots lines missing on the throw path — grouped with the blind finding.
  - `[low]` `[reject]` (intent) AC4 / the outcome (the five centres read) only provable on a real run — residual risk; the note says what the first daily run must show.
  - `[false]` `[reject]` (intent) Reason logging only tested for HTTP 503 — the reasons (timeouts, network errors) come from `pipeline/fetch`'s `robotsUnavailable`, tested there and unchanged.
  - `[low]` `[reject]` (intent) Cause recorded as "likely", not confirmed — the logs never recorded the robots reason; confirmation needs the next run's new log line, which the note names.
  - `[false]` `[reject]` (intent) AC4's recorded reason is in state, not the snapshot — AC2 puts the reason in state; the spec forbids a snapshot change.
  - `[false]` `[reject]` (intent) Skips recorded for non-covered centres too — the AC's own reason list includes `opted-out` and `no-reader`, which only apply to non-covered centres.
  - `[false]` `[reject]` (intent) Idempotence re-scoped — same as the blind finding.
  - `[false]` `[reject]` (intent) "skipped" in the sum means covered-never-checked — a covered centre with history is counted by its `last_result`, so the sum is complete.
  - `[false]` `[reject]` (intent) AC3 "last outcome" vs "robots skip newer than last check" — equivalent for every sequence, and it survives the budget skips that follow a robots skip.
  - `[false]` `[reject]` (intent) `reader: none` alternative not taken — the AC allows either branch; the fix branch was taken.

## Design Notes

- Why `last_robots_skip_at` in addition to `last_skip_reason`: a robots skip still costs the host a visit (the robots.txt request), so a robots-blocked centre soon becomes budget-skipped (the logs show exactly this). Without the robots time, the budget skip would overwrite the reason and the centre would flip back to "covered with no result".
- Why a per-reader limit, not a per-IP one: resolving IPs needs DNS work outside `pipeline/fetch` and changes with hosting; the shared servers are per booking system, and 2 in flight keeps a run well under a few minutes.
- The cause stays "likely" in the note until a run log line shows the robots reason; Story 3.12's last AC (the first daily run) is the confirmation.

## Verification

**Commands:**
- `npm test` -- expected: all pass.
- `npm run typecheck` -- expected: no errors.

## Auto Run Result

**Summary:** The five never-read ITEM KG centres (Würzburg, Erding, Cham, Straubing, Kelheim) were `skipped:robots` in every run on 2026-10-29 → 11-01, then `skipped:budget`, although their robots.txt files allow us. They are the five alphabetically last ITEM KG centres, on servers shared with the other ITEM KG sites, so the likely cause is ~20 parallel robots.txt requests to those servers, with the last ones failing and read as "disallow all". Fix: collect runs at most 2 centres per reader system at a time, and the run log names every origin whose robots.txt was unusable and why. Merge now records every skip (`last_skip_reason`, `last_skip_at`, `last_robots_skip_at`) in state v2 (a v1 file is upgraded on read), and publish keeps a robots-blocked centre `not_checked` until a later run checks it.

**Files changed:**
- `shared/state.ts` -- state v2: nullable `last_result`/`last_checked_at`, three skip fields, `upgradeState` for v1.
- `pipeline/stages/merge.ts` -- `readState` v1 upgrade with one log line; skips recorded.
- `pipeline/stages/publish.ts` -- `coverageOf` robots rule from the stored entry.
- `pipeline/stages/collect.ts` -- per-reader limiter; `robotsUnavailable` in the result and on `CollectError`.
- `pipeline/stages/run.ts` -- `robots <host>: unusable (…)` lines on success and on a collect throw.
- `pipeline/config.ts` -- `MAX_PARALLEL_CENTRES_PER_READER = 2`.
- `data/directory/itemkg-note.md` -- the five centres: evidence, likely cause, fix, what the first daily run must show.
- `ARCHITECTURE-SPINE.md` -- AD-6 amended (AD-8 cross-reference).
- Tests: `collect`, `merge`, `run`, `snapshot` extended; `alerts`, `report` fixtures updated.

**Review:** 28 findings. Patched: 6 entries (1 medium: queue-wait duration test; 5 low: robots reasons on a collect throw, sticky `not_checked` listings test, robust log-order test, doc comment, note wording + DNS check). Deferred: 1 (no alert for long robots blocks, pre-existing). Rejected: 12 false and 9 low, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false — patched counts: high 0, medium 1, low 5.

**Verification:** `npm test` 1,454 passed, 1 skipped (39 files); `npm run typecheck` clean, after the review patches. Every I/O matrix row has a passing test. Evidence gathered: 13 `pipeline.yml` run logs (2026-10-29 → 11-01) via `gh run view --log`; the five robots.txt files fetched once each (curl and Node `fetch`); DNS of ITEM KG and kuferweb hosts.

**Residual risks:** The cause is likely, not proven: only the first scheduled run after this lands (it needs Story 3.11's once-a-day collection too) shows whether the five centres end `ok`/`failed`, or which robots error they get. The committed `data/state/state.json` is v1 and becomes v2 on that run (one large state diff). No alert yet when robots keeps centres out (deferred).
