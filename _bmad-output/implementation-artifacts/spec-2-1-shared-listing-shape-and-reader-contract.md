---
title: 'Story 2.1: Shared listing shape and reader contract'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '6c627bfdfe97387b2b2dd3d4ce911468ed5d0283'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/specs/spec-einbuergerungstest-search/data-sources.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 2 adds two booking-system readers (KuferWeb, ITEM KG) and a fetch → parse → normalise → merge pipeline, but there is no shared listing shape, status mapping or reader interface yet, so each reader would invent its own fields, codes and "unknown".

**Approach:** Define in `shared/` the `RawListing` zod schema (including CAP-11 `eligibility`), the status and registration codes, `mapStatus`, the reader interface types and a result validator; add a pipeline parse step that runs one reader for one centre and turns invalid output into `failed('schema')`; add a no-network fixture runner for reader tests.

## Boundaries & Constraints

**Always:**
- `RawListing` is a strict zod object (unknown keys rejected, so no personal-data field can slip in) with: `date` (local `YYYY-MM-DD`), `time` (local `HH:mm`), `place` (string|null), `address` (string|null, free text as published), `status` (status code), `deadline` (local `YYYY-MM-DD`|null), `registration_method` (registration code|null), `eligibility` (string|null, ≤ `ELIGIBILITY_MAX_LENGTH`), `source_url` (http(s) URL via the existing `isHttpUrl`). Every optional field is present as `null` when absent, never omitted.
- Status codes `free`, `booked_out`, `waitlist`, `unknown`; registration codes `online`, `email`, `post`, `in_person`, exported as `as const` arrays plus types, like `READERS`.
- `mapStatus` precedence: `waitlist` > `booked_out` > `free` > `unknown`.
- Reader types and `mapStatus` live in `shared/` (readers and, in 2.2, fetch both import them; neither may import the other). Respect the import-rules allowlist in `tests/import-rules.test.ts`.
- Reader failures are values; the pipeline parse step never throws for one centre's bad output.
- Code style matches `shared/directory.ts` / `shared/snapshot.ts`: tabs, single quotes, `.ts` import suffixes, short doc comments.

**Never:**
- No real reader (KuferWeb/ITEM KG are Stories 2.3/2.4), no eligibility keyword matching, no fetch changes (2.2), no normalise/merge/listing ids, no snapshot `schemaVersion` bump, no web/UI changes.
- No `centre_id`, `starts_at`, `link_ok` or `first_seen_at` on `RawListing`; normalise/merge add those later.
- No `Date.now()`/`new Date()` inside parse paths; `ctx.runAt` is the only clock.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid listings | reader returns `ok` with schema-valid listings | parse step returns them unchanged as `ok` | none |
| Zero listings | reader returns `ok`, `[]` | `ok`, `[]` (proof of structure is the reader's job, AD-4) | none |
| Bad listing | one listing has `status: 'full'` or an extra `instructor` key or a missing `deadline` key | that centre → `{kind:'failed', reason:'schema'}` | other centres unaffected |
| Reader fails | reader returns `{kind:'failed', reason:'structure-missing'}` | passed through unchanged | none |
| Reader throws | `parse` throws | `{kind:'failed', reason:'reader-error'}` | caught, not rethrown |
| Signals | `{waitlist:true, bookedOut:true}` / `{bookedOut:true, free:true}` / `{free:true}` / `{}` | `waitlist` / `booked_out` / `free` / `unknown` | none |
| Long eligibility | 2 000-char paragraph with extra whitespace | `clampEligibility` collapses whitespace, cuts at a word boundary ≤ max with `…`; empty/blank → `null` | none |

</intent-contract>

## Code Map

- `shared/directory.ts` -- `isHttpUrl`, `READERS` style of `as const` code arrays, `Centre` type (reader input). Reuse; do not modify.
- `shared/snapshot.ts` -- schema style reference (strictObject, superRefine, doc comments). Read-only; listings stay `max(0)` until 2.6.
- `pipeline/fetch/index.ts` -- existing polite client; `FetchResult` has `status`, `url`, `text`. Read-only here; 2.2 will turn a `ReaderPlan` into `FetchedPage[]`.
- `pipeline/readers/.gitkeep` -- empty readers folder; new contract helpers sit beside future `<system>/` folders.
- `pipeline/stages/run.ts` -- entry point; not wired to readers in this story.
- `tests/import-rules.test.ts` -- allowlist: readers → shared only (test files under `pipeline/readers/` are scanned too), stages → readers/fetch/shared, fetch → shared.
- `tests/snapshot.test.ts` -- test style (vitest `describe/it/expect`, a `centre()` factory).

## Tasks & Acceptance

**Execution:**
- `shared/listing.ts` -- add `STATUS_CODES`, `REGISTRATION_METHODS`, their types, `ELIGIBILITY_MAX_LENGTH` (500), `rawListingSchema` + `RawListing` type, `StatusSignals` (`{waitlist?, bookedOut?, free?}` booleans) and `mapStatus(signals)`, and `clampEligibility(text)` -- one shape every reader emits.
- `shared/reader.ts` -- add `ReaderPlan` (`listUrls: string[]`, `selectDetailUrls(listPages): string[]` pure, `maxDetailPages: number`), `FetchedPage` (`url`, `role: 'list'|'detail'`, `status: number|null` — null on timeout/network failure, `html: string|null`), `ParseContext` (`{runAt: Date}`), `ParseResult` (`{kind:'ok', listings: RawListing[]} | {kind:'failed', reason: string}`), `Reader` (`plan(centre)`, `parse(pages, centre, ctx)`), and `checkParseResult(result: unknown): ParseResult` returning `failed('schema')` when output is not a valid `ParseResult` or any listing fails `rawListingSchema` -- shared contract for readers, fetch and stages.
- `pipeline/stages/parse.ts` -- add `parseCentre(reader, centre, pages, ctx): ParseResult`: calls `reader.parse`, catches a throw as `failed('reader-error')`, then `checkParseResult` -- the pipeline's per-centre check.
- `pipeline/readers/fixture-runner.ts` -- test-only helper `runReaderOnFixtures(reader, centre, fixtures, ctx)` where `fixtures` maps URL → `{file, status?}` (file path absolute or relative to a given `fixturesDir`): calls `plan`, loads list fixtures, applies `selectDetailUrls` capped at `maxDetailPages`, loads detail fixtures, then `parse` + `checkParseResult`. Any URL without a fixture throws (test error, not a network call). Uses only `node:fs`/`node:path` and shared.
- `tests/listing.test.ts` -- schema accept/reject cases (each code, null fields, missing key, unknown key, bad date/time/deadline formats, non-http URL, over-length eligibility), every matrix `mapStatus` row plus each data-sources.md mapping line expressed as signals, `clampEligibility` cases.
- `tests/reader-contract.test.ts` -- `checkParseResult` and `parseCentre` matrix rows with stub readers, including two centres where only the bad one fails; `runReaderOnFixtures` with a stub reader over two tiny HTML files in `tests/fixtures/reader-contract/` proving list → detail selection, cap, `ctx.runAt` passthrough, and a throw for a missing fixture; a guard that no `fetch` is called (stub `globalThis.fetch` to throw).

**Acceptance Criteria:**
- Given `shared/`, when a module imports the contract, then `rawListingSchema`, `STATUS_CODES`, `REGISTRATION_METHODS`, `mapStatus`, `Reader` and `checkParseResult` are exported and `npm run typecheck` passes.
- Given the data-sources.md status mapping, when each line is fed to `mapStatus` as signals, then the documented code is returned.
- Given two centres where one reader emits an invalid listing, when `parseCentre` runs for each, then only that centre's result is `failed('schema')`.
- Given a stub reader and committed HTML fixtures, when `runReaderOnFixtures` runs, then it returns the reader's validated result without any network request.
- Given the whole repo, when `npm test` runs, then import rules and all existing tests still pass.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 28 findings — high 0, medium 5, low 19, false 4, maybe-false 0
- findings:
  - `[false]` `[reject]` (intent) Criterion "pipeline marks only that centre failed('schema')" shown only via `parseCentre`, not wired into `run.ts` — the per-centre check is the pipeline's parse stage; a run loop needs fetch planning (2.2) and the scheduled run (2.6), and outcome recording is merge (2.5), so nothing in 2.1 can call it yet.
  - `[false]` `[reject]` (intent) Fixture runner lets a throwing `parse` propagate while `parseCentre` returns `reader-error` — deliberate: a throwing reader fails its test loudly either way; no wrong outcome.
  - `[low]` `[patch]` (intent) `ctx.runAt` as only clock is not enforced — grouped with Blind #1; patched (source-scan test).
  - `[false]` `[reject]` (intent) `mapStatus` tests use boolean signals, not page content — turning page content into signals is reader work (2.3/2.4); every data-sources.md line is covered as signals.
  - `[medium]` `[patch]` (edge) Blank `place`/`address` pass the schema, skipping normalise's null fallback — `notBlank` refine added, tests added.
  - `[low]` `[reject]` (edge) `deadline` later than `date` accepted — rare misparse; the fix adds a cross-field rule not asked for, unlikely in everyday use.
  - `[low]` `[patch]` (edge) `isLocalDate` maps years 0–99 to 1900+ — switched to `setUTCFullYear`; test for 0000-02-29.
  - `[medium]` `[patch]` (edge) Blank `eligibility` accepted — grouped with blank strings; patched.
  - `[low]` `[reject]` (edge) Hard cut can split a surrogate pair — only for a single 500-char token with an astral character at the cut; fix adds a guard, unlikely in practice.
  - `[low]` `[patch]` (edge) `reason` not checked as kebab-case — regex added to the result schema; tests added.
  - `[low]` `[reject]` (edge) Async reader or throwing getter — an async reader still ends as `failed`; throwing getters on plain parse output are unrealistic; fix adds branches.
  - `[false]` `[reject]` (edge) Fixture key `constructor` hits the prototype — fixture keys are http(s) URLs, which never equal prototype member names.
  - `[medium]` `[patch]` (edge) Fixtures cannot model a timed-out or bodiless page — `file: string|null`, `status?: number|null`; tests added.
  - `[low]` `[reject]` (edge) `maxDetailPages` NaN/Infinity — readers set a constant cap; extra guards not worth it.
  - `[low]` `[patch]` (edge) Duplicate detail URLs load twice and use up the cap — de-duplicated in first-seen order before the cap; test added.
  - `[low]` `[patch]` (edge) "ITEM KG in-person-only → unknown" tested as `{}` with no explanation — documented on `StatusSignals`/`mapStatus` that a reader passes no signal when the flag does not apply; test renamed.
  - `[low]` `[patch]` (blind) No check that readers avoid `Date.now()`/`new Date()` — source-scan test over `pipeline/readers/**` added, plus a pattern self-test.
  - `[low]` `[reject]` (blind) Failure diagnostics (zod issues, thrown error) are dropped — fix adds a result field; only matters when a reader is broken, and authors can call `rawListingSchema.safeParse` directly.
  - `[low]` `[patch]` (blind) `reason` untyped/free text — grouped with kebab-case regex; patched. Readers reusing `schema`/`reader-error` codes not addressed (low, no named harm yet).
  - `[medium]` `[patch]` (blind) Fixtures cannot model a failed fetch — grouped with edge finding; patched.
  - `[medium]` `[patch]` (blind) Blank strings pass; no length cap on `place`/`address` — blank rejection patched; length cap rejected (new constants, no demonstrated harm).
  - `[low]` `[reject]` (blind) No `deadline` ≤ `date` check — grouped with edge finding; rejected.
  - `[low]` `[patch]` (blind) `mapStatus` in-person case hides a gap — grouped with edge finding; documented.
  - `[low]` `[patch]` (blind) Fixture test cannot catch a URL/body mix-up — two distinct detail fixtures; each listing asserted against its own URL.
  - `[low]` `[patch]` (blind) Duplicate/invalid detail URLs; NaN cap — de-duplication patched; NaN rejected as above.
  - `[low]` `[patch]` (blind) Test helper default `fixturesDir = process.cwd()` — now required. Location under `pipeline/readers/` is forced by the import rules (reader tests may import only readers and shared).
  - `[low]` `[reject]` (blind) `clampEligibility` surrogate split and tiny head — rare inputs; fix adds guards.
  - `[low]` `[patch]` (blind) Misleading max-length test name — split into "accepts exactly the max" and "rejects over the max".

## Design Notes

- `address` is free text, not the directory's `{street, postcode, city}` object: provider pages print addresses in varied shapes, and normalise (2.5) falls back to the centre address when `null`.
- Date and time stay separate local wall-clock strings; normalise builds `starts_at` with the Europe/Berlin offset and the AD-7 id. Validate shape with regex plus a real-calendar check (`2026-02-30` rejected), `HH:mm` 00:00–23:59.
- `clampEligibility` is shared so both readers cap the same way; the schema's max length is the guard behind it.
- Failure `reason` is a short kebab-case code (`schema`, `reader-error`, `structure-missing`), matching `FetchFailureReason` style.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all suites pass, including new `listing` and `reader-contract` tests and `import-rules`

## Auto Run Result

Status: done

**Summary:** Added the shared listing shape and reader contract for Epic 2: the strict `RawListing` zod schema (with CAP-11 `eligibility`), status and registration codes, `mapStatus` (waitlist > booked_out > free > unknown), `clampEligibility`, the reader interface types and `checkParseResult`; a pipeline parse step that turns a throwing reader into `failed('reader-error')` and invalid output into `failed('schema')` for that centre only; and an offline fixture runner for reader tests.

**Files changed:**
- `shared/listing.ts` — `RawListing` schema, codes, `mapStatus`, `clampEligibility`, date/time checks.
- `shared/reader.ts` — `Reader`, `ReaderPlan`, `FetchedPage`, `ParseContext`, `ParseResult`, `checkParseResult`.
- `pipeline/stages/parse.ts` — `parseCentre`, the per-centre check.
- `pipeline/readers/fixture-runner.ts` — test-only `runReaderOnFixtures` (no network).
- `tests/listing.test.ts`, `tests/reader-contract.test.ts` — unit tests, including a scan that readers never read the clock.
- `tests/fixtures/reader-contract/{list,detail-1,detail-2}.html` — stub fixtures.

**Review:** 28 findings from 4 layers (verification-gap layer found none). 13 patch entries applied (5 medium, 8 low at row level; 2 medium groups: blank strings, failed-page fixtures). Nothing deferred. Rejected: 4 false (pipeline wiring belongs to 2.2/2.5/2.6; fixture-runner throw is deliberate; signals vs page content is reader work; prototype-key fixture lookup impossible) and 7 low (deadline ≤ date check, surrogate split, async/getter readers, NaN cap, failure diagnostics, place/address length cap, tiny-head clamp) — rare or needing extra surface.

**Follow-up review recommended:** false. Two medium groups were patched, but both are covered by new tests that pass; no specific unverified risk remains.

**Verification:** `npm run typecheck` — clean. `npm test` — 22 files, 758 passed, 1 skipped (pre-existing).

**Residual risks:**
- `Reader` (interface, `shared/reader.ts`) shares its name with the reader-system type in `shared/directory.ts`; a module importing both needs an alias.
- `parseCentre` is not wired into `run.ts` yet; Story 2.2/2.6 must call it for every centre.
- The clock-rule scan has nothing real to check until the first reader lands in 2.3.
- Rejecting blank strings means a reader that emits `''` fails its whole centre; 2.3/2.4 readers must emit `null`.
- `pipeline/readers/.gitkeep` is now redundant.
