# Epic 4 Context: Parse more centres

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Most of the 119 directory centres still show "Not checked automatically" (baseline 2026-11-01: 27 `ok`, 2 `failed`, 5 never ran, 85 with reader `none`, 43 without a `test_page_url`). This epic gives the operator a local, offline-repeatable way to measure and raise parse coverage: every daily run reports parse statistics, a one-off script fetches every centre's test page once into a local cache and re-parses it as often as needed, missing test pages are discovered, existing readers are tried and widened first, then new readers are added until at least 90% of centres with a reachable test page parse. The new readers then ship into the daily run, so users near those centres see real dates instead of a link.

## Stories

- Story 4.1: Parse statistics in every run
- Story 4.2: Local coverage script: fetch, cache and parse offline
- Story 4.3: Find missing test pages
- Story 4.4: Readers for the uncovered centres, to 90%
- Story 4.5: Coverage holds in the daily run

## Requirements & Constraints

- **One classification, shared by pipeline and script.** Every directory centre lands in exactly one category per run: `parsed`, `parsed-empty`, `failed`, `no-reader`, `unreachable`, `no-test-page`, `pdf-only`, `robots`, `opted-out`, `budget`.
  - `parsed`: reader `ok` with listings valid against `RawListing`. `parsed-empty`: `ok` with zero listings proven by the reader's structure check. `failed`: reader `failed` with its reason code. `no-reader`: test page reachable, no reader assigned or none matched.
  - Outside the denominator: `unreachable` (non-2xx, timeout, decode failure), `no-test-page`, `pdf-only` (operator-set in reader config; PDFs are never parsed), `robots`, `opted-out`, `budget` (excluded in the script; the daily run reports it separately and counts it as neither success nor failure).
- **Coverage** = (`parsed` + `parsed-empty`) / (`parsed` + `parsed-empty` + `failed` + `no-reader`). Target ≥ 90%, first against the cache, then confirmed by the first daily run after the new readers land.
- **Run statistics (operator-only):** one summary line in the run log (counts per category, coverage with numerator and denominator) and a `coverage` object in the run report with `by_category` (sums to directory size), `by_reason` (failed count per reason code), `by_reader` (per reader: assigned, parsed, parsed-empty, failed, skipped) and `coverage` (percentage, numerator, denominator).
- **Nothing public changes from statistics:** `snapshot.json`, its schema and the About page stay unchanged by the stats work; no public coverage numbers anywhere.
- **Coverage script is local and manual:** never in CI or on a schedule. Re-running the parse without `--fetch` sends zero requests; cached URLs are not refetched unless `--refresh`. Raw cache is gitignored; only trimmed pages chosen as fixtures are committed.
- **Politeness still binds the script:** all requests through `pipeline/fetch` (bot UA, robots.txt, serial per host, delay, timeout), at most 4 visits per host per rolling 24 h; hosts over budget are skipped as `budget`. Visits are written to `data/state/visits.json` for the operator to commit so the next daily run respects them. Discovery uses at most 3 page requests per host.
- **Operator review gates the directory:** discovered test page URLs, proposed reader assignments and `pdf-only` marks go to review files; nothing writes `centres.json` automatically. `centre_id`s never change. `npm run check:directory` must still pass after applying proposals.
- **No headless browser:** a site that needs JavaScript to show its dates counts as not parsed. No new listing fields to fit what new sites publish.
- **Unparsed centres are documented:** groups by page shape, sizes and chosen order, plus each centre still not parsed and why, live in `data/directory/coverage-note.md`.
- `docs/operations.md` must explain running the script, cache location, committing visits after a fetch, and that the script never runs in CI.

## Technical Decisions

- **Reader contract:** each reader exports `plan(centre)` and a pure `parse(pages, centre, ctx)` returning `{kind:'ok', listings}` or `{kind:'failed', reason}`. No I/O, no state, only `ctx.runAt` as clock; cheerio `load()` only; `null` for absent fields; status via shared `mapStatus` (waitlist > booked_out > free > unknown); eligibility text extracted verbatim. Schema-invalid output fails only that centre (`failed('schema')`). A new booking system is a new folder under `pipeline/readers/`.
- **Zero-dates proof:** `ok` with zero listings only when the reader's expected structure is found. Every new or changed reader has trimmed committed fixtures (from two centres where the group has two) plus a "structure missing" fixture that returns `failed`; existing reader tests must keep passing.
- **Existing readers first:** every reader-`none` centre is tried against every existing reader (KuferWeb, ITEM KG, and any added later); for those the script fetches the test page plus detail pages of every reader whose structure check matches. Near-misses are fixed by changing the existing reader with a new fixture before writing any new reader. New readers are prioritised by largest page-shape group first.
- **Fetch path:** `pipeline/fetch` is the only HTTP client and normally skips reader-`none` and opted-out centres before any request; the script's fetching of reader-`none` test pages must still go through it with full robots and budget rules. Fetch only reads the visit log; in the pipeline only merge writes `data/state/`.
- **Run outcomes vs categories:** pipeline outcomes stay `ok` / `failed` / `skipped` (skip reasons `robots`, `budget`, `opted-out`, `no-reader`); the coverage categories are a finer classification layered on top, not a replacement of state semantics.
- **Directory entries** carry `reader` and an optional per-reader typed `reader_config`; `pdf-only` is recorded in the directory entry, and such centres publish as `not_checked`.

## UX & Interaction Patterns

- Newly parsed centres show result or no-dates cards instead of "Not checked automatically"; `pdf-only` and still-unparsed centres keep the uncovered card.
- Each new reader appears as its own row in the About page "Booking systems" section with centres covered and status, in DE and EN (all strings via translation files).

## Cross-Story Dependencies

- Strict order: 4.1 → 4.2 → 4.3 → 4.4 → 4.5.
- 4.2 reuses 4.1's classification function; 4.3 extends the 4.2 script (`--discover`); 4.4 needs the cache and existing-reader proposals from 4.2 and the discovered pages from 4.3, and may split into one story per new reader; 4.5 verifies on live pages using 4.1's run report.
- Builds on the existing run log and run report, Epic 3's skip recording (Story 3.12) and once-a-day collection (Story 3.11); the visit budget is shared between the script and the daily run.
