---
title: 'Story 2.2: Polite collection rules'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: '606ed1e3775684e55a4321a04cab3599990626b4'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-shared-listing-shape-and-reader-contract.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The polite HTTP client exists (`pipeline/fetch`), but nothing turns a reader's `ReaderPlan` into fetched pages per centre, skips opted-out / reader-`none` / robots-blocked centres, or enforces the 4-visits-per-host-per-24-h budget from a visit log, so a run could burden or ignore a centre site.

**Approach:** Add a per-centre collection step in `pipeline/fetch` that executes a `ReaderPlan` (list pages first, then capped detail pages) through the existing client, plus a visit-log reader and budget check; add a stage function that, for one run over the directory, decides each centre's outcome (`skipped` with reason, `failed`, or fetched pages passed to `parseCentre`) and returns this run's visits.

## Boundaries & Constraints

**Always:**
- All requests go through one `createFetchClient` per run (robots.txt once per origin per run, serial per host with delay and timeout, identified UA — already implemented; reuse, do not duplicate).
- `opted_out: true` or `reader: 'none'` → outcome `skipped` (`opted-out` / `no-reader`) with zero requests, checked before any other rule.
- Budget: a host with ≥ `VISIT_LIMIT_PER_HOST` (4) visits in the log within `VISIT_WINDOW_MS` (24 h) before `runAt` is not contacted at all (not even robots.txt); a centre whose list-page host is over budget → `skipped` (`budget`). Applies to every run, manual or local.
- A visit = one host contacted in this run (any request, robots.txt included), recorded once per host per run as `{host, at: runAt as UTC ISO}`; the budget is computed from the log as read at run start.
- Fetch reads the visit log (`data/state/visits.json`; missing file → empty log) and never writes it; an invalid log file throws (fail the run rather than ignore the budget).
- List page disallowed by robots (including robots.txt unavailable, which the client treats as disallow-all) → `skipped` (`robots`). Non-2xx, timeout or network error on any list page → `failed` (`list-page`) and `parse` is never called (AD-4).
- Detail URLs come from `plan.selectDetailUrls(listPages)`, de-duplicated in first-seen order, capped at `maxDetailPages` — one shared helper used by both fetch and the fixture runner. A failed detail page is still passed to `parse` as a `FetchedPage` with its HTTP status (or `null`) and `html: null`.
- Every `FetchedPage` carries its HTTP status.

**Never:**
- No writes to `data/state/` (merge, Story 2.5), no wiring into `pipeline/stages/run.ts` or the workflow (2.6), no real readers (2.3/2.4), no per-centre log lines (2.6).
- No second HTTP client or direct `fetch` calls; no `Date.now()` — `runAt` is the run's clock.
- Readers must not import fetch; fetch must not import readers or stages (import rules).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Opted out | `opted_out: true`, reader `kuferweb` | `skipped('opted-out')`, 0 requests | none |
| No reader | `reader: 'none'` | `skipped('no-reader')`, 0 requests | none |
| Robots disallow | robots.txt disallows the list path | `skipped('robots')`; robots.txt requested once even with 2 centres on that host | none |
| Over budget | log has 4 visits to host in last 24 h | `skipped('budget')`, 0 requests to that host | none |
| Old visits | log has 4 visits, all > 24 h before `runAt` | centre is fetched | none |
| List page 500 / timeout | list URL returns 500 or times out | `failed('list-page')`, `parse` not called | none |
| Happy path | 1 list page linking 3 details, cap 2 | `fetched`: list page then 2 detail pages, all with status; parsed via `parseCentre`; one visit for the host | none |
| Detail page 404 | one selected detail returns 404 | that page passed as `{status: 404, html: null}` | none |
| Missing / invalid log | no `visits.json` / malformed JSON | empty log / throws | run fails on invalid log |

</intent-contract>

## Code Map

- `pipeline/fetch/index.ts` -- `createFetchClient(options)`, `FetchClient.get` → `FetchResult` (`ok`, `reason`, `status`, `url` = final URL after redirects), `stats().rawRequests` keyed by every host actually requested (robots.txt and redirect hops included). Requests go through `attempt(url)` (one HTTP request) inside `request(url)`; redirects are followed in `get` and in `resolveRobots`. Extend with a host-block option (see Tasks); keep all existing behaviour and tests passing.
- `pipeline/config.ts` -- home for budget constants per conventions ("delays, timeouts, UA, budget in `pipeline/config.ts`"); add `VISIT_LIMIT_PER_HOST = 4`, `VISIT_WINDOW_MS = 24 h`.
- `shared/reader.ts` -- `ReaderPlan`, `FetchedPage`, `ParseContext`, `Reader`, `checkParseResult` (Story 2.1). Add the detail-URL helper and `FetchedPage.finalUrl` here.
- `pipeline/readers/fixture-runner.ts` -- currently de-dupes and caps inline; switch to the shared helper and set `finalUrl`.
- `pipeline/stages/parse.ts` -- `parseCentre(reader, centre, pages, ctx)`; the stage calls it for fetched centres.
- `pipeline/stages/paths.ts` -- stage file paths; may re-export the visit log path.
- `shared/directory.ts` -- `Centre`, `Reader` type (reader system names — alias one of the two `Reader` names on import). `directorySchema` already rejects duplicate `centre_id`s.
- `tests/fetch.test.ts` -- `fakeNetwork(routes)` pattern with recorded calls, `redirect(location)` helper and a stub `sleep`; copy the approach.
- `data/state/` -- holds only `.gitkeep`; no visit log exists yet.

## Tasks & Acceptance

**Execution:**
- `pipeline/config.ts` -- add `VISIT_LIMIT_PER_HOST` and `VISIT_WINDOW_MS` -- budget constants.
- `shared/visits.ts` -- `visitSchema` (strict `{host: non-empty string, at: UTC ISO datetime}`), `visitLogSchema` (array), `Visit` type, `visitsInWindow(log, host, runAt, windowMs)` (counts visits newer than `runAt - windowMs`) -- shared with merge in 2.5.
- `shared/reader.ts` -- add `finalUrl: string | null` to `FetchedPage` (URL after redirects; `null` when nothing was received); document on `ReaderPlan.selectDetailUrls` that it must return absolute http(s) URLs (resolve against the list page's `finalUrl`); add `selectDetailUrls(plan, listPages): string[]` (de-dupe first-seen, cap at `Math.floor(maxDetailPages)`, negative or non-finite → 0) -- one rule for fetch and fixtures.
- `pipeline/readers/fixture-runner.ts` -- use `selectDetailUrls`; set `finalUrl` (fixture may give `finalUrl`, default = the URL; `null` when `file` is null) -- removes the duplicate rule.
- `pipeline/fetch/index.ts` -- add option `isHostBlocked?: (host: string) => boolean`. Before sending any request (robots.txt, page, or any redirect hop, in both `get` and `resolveRobots`) to a blocked host, send nothing: `get` returns `{ok: false, reason: 'host-blocked', url, status: null}` (add `'host-blocked'` to `FetchFailureReason`); a robots.txt chain that reaches a blocked host makes the `get` that needed it return `host-blocked` too, and nothing is counted in `rawRequests` for the blocked host -- per-hop budget enforcement.
- `pipeline/fetch/visits.ts` -- `VISIT_LOG_PATH`, `readVisitLog(path)` (ENOENT → `[]`; any other read error, invalid JSON or schema failure → throw naming the path), `overBudget(log, host, runAt)` -- read-only access.
- `pipeline/fetch/centre.ts` -- `fetchCentre(client, plan, {log, runAt})` → `{kind:'skipped', reason:'robots'|'budget'} | {kind:'failed', reason:'list-page'|'reader-error'} | {kind:'fetched', pages}`. Empty `listUrls` → `failed('reader-error')` with no request. Any list-page host over budget → `skipped('budget')` before any request. List pages in order: `host-blocked` → `skipped('budget')`, `robots-disallowed` → `skipped('robots')`, other failure → `failed('list-page')`. A throwing `selectDetailUrls` → `failed('reader-error')`. Detail pages: an unparseable URL is not requested; it and any failed or `host-blocked` page are returned as `{status (or null), html: null, finalUrl: null}`; successes carry `finalUrl = result.url`. Client errors are not caught here -- the plan executor.
- `pipeline/stages/collect.ts` -- `collectRun(centres, readers: Partial<Record<'kuferweb'|'itemkg', Reader>>, {log, runAt, clientOptions?})` creates the run's one client itself with `isHostBlocked: host => overBudget(log, host, runAt)` plus `clientOptions` (tests pass `fetchImpl`, `sleep`, `delayMs`, `timeoutMs`), and returns `{outcomes: Record<centre_id, CentreOutcome>, visits: Visit[]}`. Order per centre: opt-out → `skipped('opted-out')`; reader `none` or unregistered → `skipped('no-reader')`; `reader.plan(centre)` (only this call is wrapped: a throw → `failed('reader-error')`); `fetchCentre`; `parseCentre` for fetched pages. Centres run concurrently. Visits: one per host in the client's `rawRequests`, `at = runAt.toISOString()`, sorted by host -- the run-level surface.
- `tests/fetch.test.ts` -- `isHostBlocked`: a blocked host gets no request; a page redirecting to a blocked host and a robots.txt redirecting to one both return `host-blocked`; unblocked behaviour unchanged.
- `tests/visits.test.ts` -- schema cases, window edge (exactly 24 h old does not count), `readVisitLog` missing / valid / malformed JSON / bad entry / a directory as path (EISDIR → throws naming the path).
- `tests/collect.test.ts` -- every matrix row through `collectRun` with a fake network and stub readers, asserting outcomes, request order and counts, robots.txt once per host, and visits; plus: list URL redirecting to an over-budget host → `skipped('budget')` and no request to it; detail redirecting to an over-budget host → page with `status: null`; a cross-host redirect within budget → both hosts in `visits`; detail `finalUrl` after a redirect; two list URLs with only the second over budget → `skipped('budget')`, zero requests; two list URLs with the second returning 404 → `failed('list-page')`, parse not called; empty `listUrls` → `failed('reader-error')`; throwing `plan`, throwing `selectDetailUrls`, throwing `parse` and a schema-invalid listing each fail only their centre while a sibling centre is `ok`; `data/state/` contents byte-identical before and after; `selectDetailUrls` cases (dupes, cap 0, negative, NaN, Infinity, fractional).

**Acceptance Criteria:**
- Given an opted-out or reader-`none` centre, when `collectRun` runs, then the fake network records no request for its host and its outcome is `skipped` with that reason.
- Given a host with 4 visits in the log in the last 24 h, when any run starts, then no request reaches that host — directly, via robots.txt, or via a redirect from another host — and centres whose list pages need it are `skipped('budget')`.
- Given a run over several centres, when it ends, then the returned visits list each host that received a request exactly once with `at` = `runAt`, and `data/state/` is unchanged.
- Given the whole repo, when `npm run typecheck` and `npm test` run, then both pass, including import rules.

## Spec Change Log

### 2026-10-28 — Review loop 1 (bad_spec)
- **Trigger:** review found that the budget was checked only on planned URL hosts, while `client.get` follows redirects (pages and robots.txt) to any host, so an over-budget host could still be contacted (violates the Always rule "not contacted at all"). The original Code Map said to change the client "only if needed", leaving per-hop enforcement unspecified.
- **Amended:** Code Map (client internals, `finalUrl`, duplicate-id note); Tasks: new `isHostBlocked` client option enforced per hop, `collectRun` now builds its own client (so visits are exactly this run's requests), `FetchedPage.finalUrl`, absolute-URL rule for `selectDetailUrls`, empty `listUrls` → `failed('reader-error')`, only reader code wrapped as `reader-error`, `Partial` reader registry, and the added tests; AC 2 and 3 sharpened.
- **Known-bad state avoided:** a redirect or robots.txt redirect reaching an over-budget host; visits missing redirect targets or including requests from before the run; fetch-layer bugs reported as reader errors; a plan with no list pages parsed as `ok` with zero listings; readers resolving relative links against the pre-redirect URL.
- **KEEP:** the first attempt's structure worked and should survive: `shared/visits.ts` schema and `visitsInWindow` (window open at the far edge, future entries count); `readVisitLog` error messages naming the path; `fetchCentre` checking all list-page hosts against the budget before any request; detail pages failing soft with `html: null`; skip order opted-out → no-reader → fetch → parse; visits sorted by host with `at = runAt.toISOString()`; the `fakeNetwork` test style with a stub `sleep` and short `timeoutMs`; the `selectDetailUrls` edge-case tests.

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 36 findings — high 6, medium 5, low 19, false 6, maybe-false 0
- findings:
  - `[high]` `[bad_spec]` (edge) List/detail page redirecting to an over-budget host is still contacted — amendment: `isHostBlocked` client option checked on every hop.
  - `[high]` `[bad_spec]` (edge) robots.txt redirect to an over-budget host is contacted — same amendment (robots chain checked too).
  - `[low]` `[reject]` (edge) Invalid `runAt` (NaN) silently disables the budget — `runAt` comes from the run entry's clock; guard not worth adding.
  - `[low]` `[reject]` (edge) Invalid `runAt` makes `toISOString` throw after fetching — same; unreachable in practice.
  - `[low]` `[reject]` (edge) Far-future log entry blocks a host indefinitely — merge writes `at = runAt`; only hand edits could cause it.
  - `[false]` `[reject]` (edge) Duplicate `centre_id` overwrites an outcome — `directorySchema` already rejects duplicate ids before any run.
  - `[low]` `[bad_spec]` (edge) Client reused across runs inflates visits — amendment: `collectRun` builds its own client.
  - `[medium]` `[bad_spec]` (edge) Catch-all around `fetchCentre` reports client bugs as `reader-error` — amendment: wrap only `reader.plan` and `selectDetailUrls`.
  - `[medium]` `[bad_spec]` (edge) Empty `listUrls` parses zero pages, likely `ok` with no listings — amendment: `failed('reader-error')`.
  - `[false]` `[reject]` (edge) Infinity cap now selects zero — spec-defined; no reader exists that uses Infinity.
  - `[high]` `[bad_spec]` (edge, claim) "No request reaches that host" not true under redirects — grouped with redirect amendment.
  - `[low]` `[bad_spec]` (edge, claim) Visits include requests made before `collectRun` — grouped with own-client amendment.
  - `[high]` `[bad_spec]` (blind) Redirects bypass the visit budget — grouped with redirect amendment.
  - `[medium]` `[bad_spec]` (blind) `FetchedPage.url` keeps the requested URL, losing the final one — amendment: add `finalUrl`.
  - `[low]` `[bad_spec]` (blind) Unparseable/relative detail URLs skip the budget and look like timeouts — amendment: not requested; absolute-URL rule documented.
  - `[medium]` `[bad_spec]` (blind) Catch-all hides fetch-layer bugs — grouped with wrapping amendment.
  - `[medium]` `[bad_spec]` (blind) Plan with no list URLs not handled — grouped with empty-list amendment.
  - `[low]` `[reject]` (blind) robots block on the second list page discards fetched pages as `skipped('robots')` — acceptable: the visit is still recorded and skipped keeps prior state; no named harm.
  - `[false]` `[reject]` (blind) Duplicate `centre_id` overwrite — `directorySchema` rejects duplicates.
  - `[low]` `[reject]` (blind) `failed.reason` typed as plain `string` — no consumer yet; 2.5 can narrow it.
  - `[low]` `[bad_spec]` (blind) Visits from whole-client counters — grouped with own-client amendment.
  - `[low]` `[bad_spec]` (blind) "data/state unchanged" test compares names only — amendment: byte-identical contents.
  - `[low]` `[bad_spec]` (blind) Missing tests (throwing `selectDetailUrls`/`parse`, schema failure, 404 list page, non-ENOENT read error, cross-host visit) — added to the test tasks.
  - `[low]` `[reject]` (blind) Budget keyed by host, not site (www vs bare domain) — each centre reads one host; no demonstrated split.
  - `[low]` `[reject]` (blind) Unbounded concurrency across centres — about 55 covered centres; negligible.
  - `[low]` `[reject]` (blind) Spec file absent from diff; `Partial` registry not recorded — the spec is the claims file by design; the registry is now recorded in the amendment.
  - `[false]` `[reject]` (intent) No production caller (`run.ts`) — wiring is Story 2.6 by the epic's build order.
  - `[false]` `[reject]` (intent) Visit-log file not connected to a run — same: the run entry (2.6) calls `readVisitLog`.
  - `[low]` `[bad_spec]` (intent) Stage, not fetch, returns visits — grouped with own-client amendment (visits are exactly the run client's requests).
  - `[false]` `[reject]` (intent) Delay between requests not exercised — covered by the client's own tests in `tests/fetch.test.ts`.
  - `[low]` `[bad_spec]` (verification) Visits from redirect targets not pinned by a test — test added to tasks.
  - `[low]` `[bad_spec]` (verification) Throwing `selectDetailUrls` → `reader-error` untested — test added to tasks.
  - `[low]` `[bad_spec]` (verification) Plans with several list URLs unexercised — tests added to tasks.
  - `[low]` `[bad_spec]` (verification) `readVisitLog` non-ENOENT errors untested — EISDIR test added to tasks.
  - `[high]` `[bad_spec]` (verification, other) Redirects reach over-budget hosts — grouped with redirect amendment.
  - `[high]` `[bad_spec]` (verification, other) Budget checked against the redirect source only — grouped with redirect amendment.

### 2026-10-28 — Review pass (loop 1)
- verdicts: 24 findings — high 0, medium 1, low 20, false 3, maybe-false 0
- findings:
  - `[low]` `[patch]` (verification) Redirected list page's `finalUrl` never reaches parse in a test — added same-host list redirect test resolving a relative detail link against `finalUrl`.
  - `[low]` `[patch]` (verification) `collectRun` passing `runAt` to `parse` unchecked — stub records `ctx`; test asserts the same `RUN_AT`.
  - `[false]` `[reject]` (intent) No production caller (`run.ts`) — carried: wiring is Story 2.6 by the epic's build order.
  - `[false]` `[reject]` (intent) Visit-log file not linked to a run — carried: the run entry (2.6) calls `readVisitLog`.
  - `[low]` `[reject]` (intent) Visits returned by the stage, not fetch — carried: addressed in loop 1 (the run's own client); no further action.
  - `[false]` `[reject]` (intent) Serial order and delay not shown by 2.2 tests — carried: covered by the client's tests in `tests/fetch.test.ts`.
  - `[low]` `[reject]` (edge) Malformed plan (non-array `listUrls`) throws and fails the run — `Reader.plan` is typed; only untyped code could do it, and a loud run failure is acceptable.
  - `[low]` `[reject]` (edge) Visits lost when `collectRun` rejects — a failed run commits nothing (AD-12), so returning visits would not persist them.
  - `[low]` `[reject]` (edge) Invalid `runAt` disables the budget — carried: `runAt` comes from the run entry's clock.
  - `[low]` `[reject]` (edge) Log hosts differing by case or trailing dot never match — merge writes `URL.host` values; only hand edits could differ.
  - `[low]` `[patch]` (edge) Duplicate `listUrls` fetched and parsed twice — list URLs de-duplicated before the budget check and fetching; test added.
  - `[low]` `[patch]` (edge) Detail URLs differing only by `#fragment` fetched twice — `dedupeUrls` ignores the hash; test added.
  - `[low]` `[patch]` (edge, claim) "Never half-fetched" comment overstated — comment reworded.
  - `[low]` `[reject]` (blind) Malformed plan crashes the run — same as edge finding; rejected.
  - `[low]` `[reject]` (blind) Visits lost on rejection — same as edge finding; rejected.
  - `[low]` `[reject]` (blind) Host strings in the log not normalised — same as edge finding; rejected.
  - `[low]` `[patch]` (blind) Failed detail page with a response gets `finalUrl: null` — now `result.url` when a status arrived; test adjusted.
  - `[low]` `[reject]` (blind) No failure reason on `FetchedPage` — new surface with no consumer yet.
  - `[low]` `[reject]` (blind) No diagnostics (URL, status) for `failed('list-page')` — new surface; noted as a residual risk for Story 2.6 logging.
  - `[medium]` `[patch]` (blind) Fixture runner throws on non-http detail URLs while live fetch skips them — runner now mirrors fetch via shared `isFetchableUrl`; test added.
  - `[low]` `[patch]` (blind) "Never half-fetched" comment — same as edge claim; reworded.
  - `[low]` `[reject]` (blind) "data/state byte-identical" test cannot fail — harmless guard; `collectRun` has no write path to test against.
  - `[low]` `[patch]` (blind) Missing tests (robots-disallowed detail page, list redirect to a disallowed path, list `finalUrl`, empty `visits.json`) — all added.
  - `[low]` `[reject]` (blind) `VISIT_LOG_PATH` defined in fetch and re-exported by stages — allowed by import rules (stages → fetch); no breakage named.

## Design Notes

- One visit per host per run, not per page: NFR3 limits "visits per site", and a run that reads a list page plus detail pages is one visit. Multiple centres on one host in one run also count once.
- robots.txt unavailable (5xx/timeout) already means disallow-all in the client; mapping that to `skipped('robots')` keeps the centre's previous state untouched (skipped sets no timestamps) instead of marking it failed for a site outage of robots.txt.
- Budget is decided from the log at run start, so concurrent centres cannot race each other into a fifth visit.
- The block is enforced inside the client because only the client sees redirect hops; `fetchCentre`'s up-front list-host check stays so a centre is never half-fetched.
- `collectRun` owns its client so `stats().rawRequests` is exactly this run's contacts; blocked hosts are never requested, so they never appear in visits.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all suites pass, including new `visits`, `collect` and extended `fetch` tests and `import-rules`

## Auto Run Result

Status: done

**Summary:** Added the polite collection rules for Epic 2. `collectRun` takes the directory, the reader registry, the visit log and the run clock, and decides each centre's outcome: opted-out and reader-`none` centres are skipped with no request; hosts with 4 visits in the last 24 h are never contacted (the fetch client now blocks them on every hop, robots.txt and redirects included); robots-disallowed list pages skip the centre; failed list pages fail it without parsing; other centres are fetched list-first with capped, de-duplicated detail pages and parsed through `parseCentre`. It returns one visit per contacted host for merge (2.5) to record and writes nothing.

**Files changed:**
- `pipeline/config.ts` — `VISIT_LIMIT_PER_HOST`, `VISIT_WINDOW_MS`.
- `pipeline/fetch/index.ts` — `isHostBlocked` option and `host-blocked` reason, checked on every request hop.
- `pipeline/fetch/visits.ts` — `VISIT_LOG_PATH`, `readVisitLog`, `overBudget`.
- `pipeline/fetch/centre.ts` — `fetchCentre`, the plan executor.
- `pipeline/stages/collect.ts` — `collectRun`, the run-level surface.
- `pipeline/stages/paths.ts` — re-exports the visit log path.
- `shared/visits.ts` — visit schema and window count.
- `shared/reader.ts` — `FetchedPage.finalUrl`, `isFetchableUrl`, `dedupeUrls`, `selectDetailUrls`.
- `pipeline/readers/fixture-runner.ts` — uses the shared detail-URL rules; sets `finalUrl`.
- `tests/collect.test.ts`, `tests/visits.test.ts` (new); `tests/fetch.test.ts`, `tests/reader-contract.test.ts` (extended).

**Review:** two passes. Pass 1 (36 findings: 6 high, 5 medium, 19 low, 6 false) found that redirects could reach an over-budget host; routed bad_spec, code reverted, spec amended (loop 1) and re-implemented. Pass 2 (24 findings: 1 medium, 20 low, 3 false; 5 carried): 9 patch entries applied (1 medium, 8 low), nothing deferred; rejected findings and reasons are in the triage log.

**Follow-up review recommended:** false. Pass 2 patched one medium and no high finding; all patches have passing tests.

**Verification:** `npm run typecheck` — clean. `npm test` — 24 files, 820 passed, 1 skipped (pre-existing).

**Residual risks:**
- Schedule vs budget: with 4 scheduled runs a day and a cap of 4 visits per 24 h, a run starting a few minutes earlier than the same run the day before finds 4 visits in the window and skips that host. Story 2.6 should decide on slack (shorter window, rounding, or 3 runs a day).
- Nothing calls `collectRun` or `readVisitLog` yet; Story 2.6 wires them into `run.ts`, and merge (2.5) must persist the returned visits.
- `failed('list-page')` carries no URL or HTTP status, so 2.6 log lines will have only the reason unless that is added.
- Budget is keyed by `URL.host`; `www.` and bare-domain variants of one site count separately.

