---
title: 'Story 3.8: Same-minute dates keep their history'
type: 'bugfix'
created: '2026-10-31'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Normalise numbers same-minute sessions `#2`, `#3` by their position in this run (`pipeline/stages/normalise.ts` `buildListings`), and merge keys `first_seen_at`, `baseline` and tombstones by id. When a same-minute sibling appears or disappears, a surviving date takes another date's id and inherits its history, and the wrong id is tombstoned (Epic 2 retrospective F7). Story 3.1's "New" badge reads that history, so this must be fixed first.

**Approach:** Give normalise the centre's stored listings (live and tombstoned) and, per minute, match this run's listings to stored ones before numbering: first by equal `source_url` and `place`, then by `source_url`, then by non-null `place`; each stored listing matches at most once. A matched listing keeps the stored id. An unmatched listing takes the lowest `#n` not held by any stored listing of that minute or by another listing this run (the unsuffixed id counts as `#1`). With no stored listings the result is exactly today's `sameMinuteOrder` numbering. Merge is unchanged: it keeps `first_seen_at`/`baseline` by id and tombstones only the ids not seen. AD-7's rule text in the architecture spine is updated to describe this.

Acceptance (from `epics.md` Story 3.8): a still-listed date keeps its stored id, `first_seen_at` and `baseline`; only the date that is really gone gets `removed_at`; a new id never reuses one held by a tombstone in state; `tests/normalise.test.ts` and `tests/merge.test.ts` cover sibling removed, sibling added before an existing one, two siblings swapping places, and a same-minute date that disappears and returns.

</frozen-after-approval>

## Implementation Notes

- `pipeline/stages/normalise.ts`: new `PriorListing` type, `priorByMinute` (groups stored ids by minute and `#n`, ignoring other centres and malformed ids) and `numberMinute` (three matching passes, then lowest free `#n`). `normaliseCentre` and `normaliseOutcome` take an optional `previous` (default `[]`), so callers without state keep today's numbering.
- `pipeline/stages/run.ts`: passes `state.centres[id]?.listings` to `normaliseOutcome`; the replay path uses the same state, so a `--from-collect` run numbers the same way.
- Merge is unchanged: it already keeps `first_seen_at`/`baseline` by id and tombstones unseen ids.
- `tests/merge.test.ts`: the old end-to-end test asserted the positional bug ("only B is left, so it takes the unsuffixed id"); replaced by four Story 3.8 cases (removed, added before, swapped/relabelled, disappears and returns). `tests/normalise.test.ts`: six unit cases for the matching passes, null place, lowest free `#n`, one match per stored listing, other minutes/centres.
- Decisions: when a stored listing matches only by `source_url` (several sessions share one URL), the strongest-match pass runs over all sessions first, so a session with URL and place matching is never displaced by a URL-only one. A `null` place never matches by place.
- `ARCHITECTURE-SPINE.md` AD-7: amendment appended under the rule (spec reconciliation).
- No `stateVersion` change: stored ids keep their format; existing state is valid input.
- Prettier is not set up in the project (no config; touched files were not Prettier-clean at HEAD), so its warnings are not a gate. `npm test` (1,260 passed, 1 skipped) and `npm run typecheck` pass.
- Review patches: the URL-only match now applies only when that `source_url` belongs to exactly one session in this run and one stored listing of the minute; stored listings are tried live before tombstoned (`PriorListing` gained optional `removed_at`); `previous` is required on `normaliseOutcome` (kept optional on the test-facing `normaliseCentre`). New tests: shared-URL new session, URL and place both changed, shared-URL null-place sessions, live vs tombstoned, malformed ids, and a `tests/run.test.ts` replay case that fails if `run.ts` stops passing state (checked by removing the argument). AD-7 rule rewritten in place; epic-3-context line aligned. `npm test` 1,264 passed, 1 skipped; typecheck clean.

## Review Triage Log

- `medium` URL-only pass gives a gone session's history to a new session sharing its URL — real: ITEM KG rows can share one detail page (`itemkg/index.ts:347,380`). Patched (URL must be unique on both sides); the old test that locked the behaviour in was rewritten.
- `low` Tombstoned stored listings not ranked after live ones — real but needs two stored listings with the same match. Patched (simple sort).
- `low` `previous` defaulting to `[]` lets a caller silently lose stable ids — patched for `normaliseOutcome`, the pipeline entry point.
- `medium` `run.ts` wiring untested — real verification gap. Patched with a replay test; mutation-checked.
- `low` AD-7 rule line contradicted its amendment; epic context omitted the first pass — patched (docs).
- `low` Missing edge-case tests — patched (five cases).
- `false` Existing state already corrupted by old numbering — the only same-minute ids in `data/state/state.json` are three VHS Coburg pairs with distinct URLs, identical `first_seen_at`/`baseline` and no tombstones; nothing to repair.
- `false` Spec status out of date during review — finalize sets `done`; not a defect.
