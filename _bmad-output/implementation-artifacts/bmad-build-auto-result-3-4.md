---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: intent gap — Story 3.4 (Alert the operator when collection breaks).

The invocation was `story 3,4`, read as Story 3.4.

## Unanswered questions

1. **Dead-man silence threshold.** The story AC (`epics.md` Story 3.4) and the architecture spine (`ARCHITECTURE-SPINE.md:249`) say the dead-man check alerts "if no ping arrives for 13 h". Since the operator decision of 2026-10-29, collection runs once a day at 05:17 UTC (`.github/workflows/pipeline.yml`, freshness threshold 36 h), and Story 3.11 removes collection from pushes. With one successful run per ~24 h, a 13 h threshold alerts every day. Which should it be?
   - (a) Keep 13 h literally (daily false alarms), or
   - (b) Match the daily schedule, e.g. a 24 h period with a 12 h grace (alert after ~36 h of silence, same as the freshness threshold), or another value.
   Also: should runs triggered by a push to `main` ping too, or only scheduled/dispatched runs?

2. **When a "dates disappeared" system issue closes.** The AC says a system issue for `centres_ok = 0` for more than 24 h is "closed automatically after its next successful run". The retrospective AC adds that the same system issue names a centre whose dates disappeared (`ok` with zero listings after it had current listings). On the next run that centre is no longer "disappeared" (its previous state is already empty), so a uniform rule would close the issue a day later even if the page is still broken. Should a "dates disappeared" issue
   - (a) close after the system's next successful run like the `centres_ok = 0` one, or
   - (b) stay open until the operator closes it?

## Evidence gathered

- `.github/workflows/pipeline.yml`: one `publish → build → deploy` chain; schedule `17 5 * * *`, also on push to `main` and `workflow_dispatch`; no alerting steps yet.
- `pipeline/stages/run.ts`: returns 0 even when every fetched centre failed; per-system data (`systems[]` with `centres_ok`, `last_success_at`) is in the published snapshot, so "`centres_ok = 0` for more than 24 h" can be computed from `last_success_at` without new state.
- No sprint change proposal, retrospective or architecture amendment revisits the 13 h figure after the move to daily collection.

## To continue

Answer the questions (for example by editing the Story 3.4 ACs in `epics.md`, or via correct-course), then re-run `/bmad-build-auto story 3.4`.
