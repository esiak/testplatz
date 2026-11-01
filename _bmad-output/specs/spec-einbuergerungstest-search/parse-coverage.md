# Parse coverage

Definitions shared by the coverage script (CAP-12), the 90% target (CAP-13) and the run statistics (CAP-14). One classification, used by both script and pipeline.

## Baseline (2026-11-01 snapshot)

119 centres: 34 with a reader (21 ITEM KG, 13 KuferWeb), of which 27 `ok`, 2 `failed`, 5 never ran; 85 with reader `none`; 43 without `test_page_url`.

## Outcome categories

Every directory centre lands in exactly one category per run.

| Category | Meaning | In denominator |
|---|---|---|
| `parsed` | reader returned `ok` with listings valid against `RawListing` | yes |
| `parsed-empty` | reader returned `ok` with zero listings and its structure check proved the page lists none (AD-4) | yes |
| `failed` | reader returned `failed`, with its reason code | yes |
| `no-reader` | test page reachable, no reader assigned or none matched | yes |
| `unreachable` | test page answered non-2xx, timed out, or failed to decode | no |
| `no-test-page` | no `test_page_url`, and discovery found none | no |
| `pdf-only` | the test page publishes its dates only in PDF files (set by the operator in the reader config; no PDF parsing) | no |
| `robots` | robots.txt disallows the test page | no |
| `opted-out` | centre opted out (CAP-8) | no |
| `budget` | host's visit budget used up this run | no for the script; daily run reports it separately |

Coverage = (`parsed` + `parsed-empty`) / (`parsed` + `parsed-empty` + `failed` + `no-reader`). Target ≥ 90%. `pdf-only` centres stay "not checked automatically" on the site.

## Coverage script

Local, operator-run, one-off; never in CI or on a schedule.

1. **Find test pages.** For centres without `test_page_url`, look for the Einbürgerungstest page on the centre's site (at most a few requests per host: e.g. sitemap, homepage, one search or programme page). Proposals go to a review file; the operator applies them to `centres.json`.
2. **Fetch.** For each centre in reach, fetch the test page and the detail pages its reader plans, through `pipeline/fetch`, into the local cache keyed by URL. A centre without a reader gets its test page plus the detail pages of every existing reader whose structure check matches that page. Respects robots, delay, timeout and the per-host visit budget; records visits. A cached page is not fetched again unless the operator asks.
3. **Parse.** Run the assigned reader against the cached pages, offline. Report per centre: category, reason, listing count, reader; then totals and the coverage percentage.
4. **Try existing readers first.** Run every existing reader (KuferWeb, ITEM KG, and any added later) against each centre without a reader. A reader that returns `parsed` or `parsed-empty` becomes a proposed assignment for operator review; once applied, the centre counts under that reader. Only centres that no existing reader parses go on to step 5.
5. **Iterate.** Change existing readers or add new ones for the remaining centres, re-running steps 3–4, until coverage ≥ 90%. Pages used to build a reader become trimmed, committed fixtures.

## Run statistics

Written by every daily run, operator-only: one summary line in the run log and a `coverage` object in the run report.

| Field | Notes |
|---|---|
| `by_category` | count per outcome category above; sums to the directory size |
| `by_reason` | `failed` count per reason code |
| `by_reader` | per reader: centres assigned, `parsed`, `parsed-empty`, `failed`, skipped |
| `coverage` | the percentage above, plus numerator and denominator |
