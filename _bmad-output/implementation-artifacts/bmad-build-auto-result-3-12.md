---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: missing dependency — Story 3.12 (Every covered centre gets checked) is marked **"Build after Story 3.11"** in `_bmad-output/planning-artifacts/epics.md`, and Story 3.11 (Collect only once a day) is not built: there is no `spec-3-11-*.md`, and `.github/workflows/pipeline.yml` still collects on every push to `main` and checks out `${{ github.sha }}`.

## Why the order matters

- 3.11 changes which runs collect, the collecting job's checkout ref, and commits visits from failed runs. 3.12's check of "the first daily run after the fix" (each of the five ITEM KG centres `ok`, `failed` or `not_checked` with a reason, and the system line adding up) assumes visit budgets are no longer used up by push-triggered runs. The five hosts were at 4/4 visits on 2026-10-29/30, which is a likely cause of the `budget` skips 3.12 investigates.
- Both stories edit `pipeline.yml`, `pipeline/stages/run.ts` / `merge.ts` and `tests/workflows.test.ts`; building 3.12 first means 3.11 rewrites the same code.

## Also needed for 3.12 (not blocking on its own)

- AC1 asks the operator and dev to read the five centres' CI log lines from the 2026-10-29 and 2026-10-30 runs. Those logs can be fetched with `gh run view <run-id> --log` while GitHub still keeps them (90 days by default, so until about late January 2027).
- AC4 can only be confirmed on the first real daily run after the fix.

## To continue

Run `/bmad-build-auto story 3.11` first, then `/bmad-build-auto story 3.12`.
