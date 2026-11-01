# Operations

## Scheduled collection run

`.github/workflows/pipeline.yml` runs once a day at 05:17 UTC (`17 5 * * *`), on every push to
`main` and on manual dispatch, in one concurrency group that never cancels a run in progress.
**Only the schedule and a manual dispatch collect** (contact the provider sites and Nominatim). A
push to `main` only tests, builds and deploys the pushed commit with the data already committed,
so code changes use none of the sites' 4 visits per rolling 24 h (see [Push to main](#push-to-main-deploy-only)).

The `publish` job (schedule and dispatch only) checks out the current tip of `main` (not the commit
that started the run, so a run queued behind another sees that run's data and visits), then:

1. type-checks and tests that commit;
2. runs `npm run pipeline -- --save-collect "$RUNNER_TEMP/collect.json" --report
   "$RUNNER_TEMP/report.json" --save-visits "$RUNNER_TEMP/visits.json"`: fetch → parse → normalise
   → locate → merge → publish, saving this run's reader results (outcomes, visits, page summaries;
   no page bodies) for a retry, a run report for the alerts (see [Alerts](#alerts)), and this run's
   visits as soon as collect returns or throws (see [Visits from a failed run](#visits-from-a-failed-run));
3. runs `.github/scripts/commit-public.sh`, which commits `data/state/` and `data/public/` in one
   bot commit and pushes it. On a rejected push it rebases when the new upstream commits touch
   only `data/state/` or `data/public/`; otherwise (or when that rebase conflicts) it resets to the
   upstream and runs `PUBLISH_CMD` = type-check + test + `npm run pipeline -- --from-collect
   "$RUNNER_TEMP/collect.json" --report "$RUNNER_TEMP/report.json"`, which replays locate, merge and publish without fetching the
   provider sites again (test addresses not yet in the upstream `venues.json` may still be looked
   up on Nominatim, within the per-run cap). 3 push attempts in all.

4. fails the job when every fetched centre failed (≥ 1 `failed`, none `ok`; `skipped` does not
   count). This happens after the commit, so the run's visit log and data are kept, but nothing
   is deployed.

`build` and `deploy` then deploy exactly the pushed SHA. No push, no deploy. A final `monitor`
job files the alerts.

### Push to main: deploy only

On a push to `main` the `publish` job is skipped. `build` checks out the pushed SHA, type-checks
and tests it (nothing else has tested it: `ci.yml` skips data-only pushes), builds it, and
`deploy` deploys it. No provider site and no Nominatim request is contacted. The site shows the
committed data, so a directory edit appears on the site only after the next scheduled run (or a
manual dispatch: Actions tab → **pipeline** → **Run workflow**, which uses one of each site's 4
daily visits).

GitHub keeps only one pending run per concurrency group: a push queued while a run is in progress
cancels a pending scheduled run, and push runs no longer collect to make up for it. If a push lands
while the 05:17 UTC run is waiting, check in the Actions tab that the scheduled run was not
cancelled, and start one by `workflow_dispatch` if it was.

### Visits from a failed run

The visit log `data/state/visits.json` must count every visit, or the budget under-counts. A
collecting run that fails or is cancelled (or times out) after contacting sites (collect throws,
publish validation fails, the push is rejected for good, every fetched centre failed, the run is
cancelled, …) would otherwise lose its visits. When the `publish` job fails or is cancelled, a step after the all-failed check reads `$RUNNER_TEMP/visits.json`:

- missing or `[]` (e.g. the tests failed before collect): it logs "nothing to record" and passes;
- otherwise `.github/scripts/commit-visits.sh` fetches `main`, resets to it, runs `node
  pipeline/stages/record-visits.ts "$RUNNER_TEMP/visits.json"` (adds the visits with merge's rule:
  dedupe by host + time, drop visits older than 24 h, sorted), commits only `data/state/visits.json`
  as `data: record visits from a failed run` if it changed, and pushes it; on a rejected push it
  fetches, resets and records again, 3 attempts in all. Visits already on `main` (e.g. the commit
  succeeded and only the all-failed check failed) change nothing and make no commit. Nothing else
  from the failed run is committed. The credential is handled as in `commit-public.sh`.

The `monitor` job still files the original failure; a failure of this step only shows in the run log.

The run log has one line per centre: `<centre_id> <reader> <outcome> <listing count> <duration>`,
where the outcome is `ok`, `failed:<reason>` or `skipped:<reason>`, then a summary line.

### Test-date addresses (locate)

Each test date is placed at its own address. Locate takes the centre's coordinates when the
address equals the centre's, then looks in `data/state/venues.json`, then asks Nominatim
(structured search, one request per new address, ≥ 1 s apart, at most
`LOCATE_MAX_LOOKUPS_PER_RUN` = 50 per run, set in `pipeline/config.ts`). Merge adds the answers to
`venues.json` (keyed by the normalised address; a hit with coordinates, or a miss with its reason
that is retried after 30 days) and commits it with the rest of `data/state/`. A failed request
caches nothing and is retried on the next run. An invalid `venues.json` stops the run before
anything is written, like an invalid `state.json`; fix or delete it (a missing file is an empty
cache, and the next run looks the addresses up again).

A date that cannot be placed at its address takes its centre's coordinates and never fails the
run. The log has one line per centre and address that fell back, and one summary line before the
run summary:

```
locate <centre_id>: "<address>" at the centre (<reason>)
locate: <n> at venue, <m> at centre; <r> requests, <h> cache hits
```

Reasons: `no provider address`, `unparseable address` (not `street, NNNNN city`), `no match`,
`outside Bavaria`, `imprecise match (place_rank …)`, `postcode mismatch (…)`,
`lookup failed: …` (timeout, HTTP error or a bad body) and `lookup cap reached`. A recurring
`no match` or rejection for a real venue can be fixed by hand with a hit entry in `venues.json`
for its normalised address. An `unparseable address` cannot be fixed that way: it is checked
before the cache, so such an entry is never read.

### Parse coverage

Every run that publishes logs one coverage line right after the run summary (Story 4.1):

```
coverage <num>/<den> (<percent>%): parsed N, parsed-empty N, failed N, no-reader N, unreachable N, no-test-page N, pdf-only N, robots N, opted-out N, budget N
```

Each directory centre is counted in exactly one category. Coverage is (`parsed` + `parsed-empty`)
over (`parsed` + `parsed-empty` + `failed` + `no-reader`); `-` replaces the percentage when that
denominator is 0. The run report (`--report`) carries the same numbers as a `coverage` object
(`by_category`, `by_reason` per failure code, `by_reader`, `coverage`); it is `null` on a failed
run. A centre whose test page publishes its dates only as PDFs can be marked with `pdf_only: true`
in `data/directory/centres.json` (reader `none` only): it counts as `pdf-only`, outside the
denominator, and stays "not checked automatically" on the site.

#### Coverage script (local only)

`npm run coverage` measures and raises coverage on the operator's machine (Story 4.2). It **never
runs in CI or on a schedule**; no workflow references it.

```
npm run coverage                          # parse the cache offline: no network request at all
npm run coverage -- --fetch               # fetch pages not yet cached, then parse
npm run coverage -- --fetch --refresh     # refetch every page, then parse
npm run coverage -- --discover            # look for missing test pages, then parse
npm run coverage -- --json data/coverage/report.json   # … and also write the report as JSON (no page bodies)
```

- **Cache.** `--fetch` stores one JSON file per URL in `data/coverage/cache/` (gitignored with the
  rest of `data/coverage/`): `url`, `fetched_at`, `result` (`ok`, `unreachable`, `robots`,
  `budget`), `status`, `final_url` and `html` (only for `ok`). A cached URL is not requested again
  unless `--refresh`; a `budget` entry is retried by every `--fetch`. Delete the folder to start
  over. Without `--fetch` the script reads only this cache, so it can be re-run as often as needed.
- **What is fetched.** For each centre that is not opted out or `pdf_only`: the list pages its
  reader plans and their detail pages; for a reader-`none` centre its `test_page_url`, plus the
  detail pages of every existing reader whose structure check finds its list on that page. All
  requests go through `pipeline/fetch` (bot user agent, robots.txt, per-host delay, timeout).
- **Visit budget.** The budget is read from the local `data/state/visits.json`, which every daily
  run updates on `main`: **`git pull` before `--fetch`** so it is current. A host with 4 visits in
  the last 24 h is not contacted; its centres report `budget`. Every host contacted is added to
  `data/state/visits.json`. **Commit `data/state/visits.json` after every `--fetch`**, also one
  that failed, so the next daily run respects those visits.
- **Report.** One row per centre (category, failure reason, listings, reader), then a "Reader
  `none` centres" section with every existing reader tried on every reader-`none` centre whose
  test page is cached (outcome, reason, listings), then the coverage line (same format as above) and the number of proposals.
  A reader centre missing from the cache counts as `failed` with reason `not-fetched`, so an
  incomplete cache never makes coverage look better.
- **Proposals.** Readers that parse a reader-`none` centre (`parsed` or `parsed-empty`) are written
  to `data/coverage/reader-proposals.json` as `{centre_id, reader, outcome, listings}`. The script
  never edits `data/directory/centres.json`. To apply one: check the centre's page, set its
  `reader` in `centres.json` (add `reader_config.list_url` only when the list is not the
  `test_page_url`), run `npm run check:directory` and `npm test`, re-run `npm run coverage` to see
  it parse under the new reader, and commit the directory change.
- **Discovering test pages.** `--discover` (Story 4.3) looks for the Einbürgerungstest page of every
  centre without a `test_page_url` (not opted out, not `pdf_only`). Per centre it tries, stopping at
  the first match: the origin's `/sitemap.xml` (first `<loc>` naming the test), the `website` page
  (first link on the centre's own host or a subdomain whose text, title or href names it), then
  one follow-up page linked from the website (Programm, Kurse, Deutsch, Sprache, Integration,
  Prüfung) and the first matching link there. A link naming "Einbürgerungstest" wins over one
  that only names "Einbürgerung" or "Leben in Deutschland". It sends **at most 3 page requests per
  host** per run (robots.txt and redirects not counted), never follows links to other hosts and
  uses no search engine. Pages go through the same cache, polite client and visit budget as
  `--fetch` (cached pages cost no request; `--refresh` refetches them), so **commit
  `data/state/visits.json` afterwards**. `unreachable` and `robots` results are cached too and
  are retried only with `--refresh` or after deleting that page's cache file; `budget` results
  are retried by every run. Links to files (PDFs, office documents, images) and language
  switchers are skipped. It cannot be combined with `--fetch`.
- **Test page proposals.** `--discover` prints a table and a count line and writes
  `data/coverage/test-page-proposals.json` (gitignored, rewritten on every `--discover` run): one entry per scoped centre, `{centre_id, website,
  proposed_url, source, evidence}`, where `source` is `sitemap`, `website`, `follow-up` or `null`
  and `evidence` is the matched link text or sitemap URL, or why nothing was proposed (`no
  website`, `budget`, `robots`, `unreachable`, `not found`). `budget` means the host is over its
  visit budget or used its 3 requests this run: re-run later. The script never edits
  `centres.json`. To apply a proposal: open the page and check it really lists test dates (a
  general "Einbürgerung" page is not enough), set the centre's `test_page_url` in
  `data/directory/centres.json`, run `npm run check:directory`, then `npm run coverage -- --fetch`
  to fetch the new page and try the readers on it, and commit the directory change.

## Alerts

The `monitor` job runs after every `pipeline.yml` run on `main`, whatever the result. It holds only
`issues: write` (and `contents: read`), installs nothing, and calls GitHub through the `gh` CLI
(`tools/alerts.ts`). GitHub emails the operator about new issues and comments once the operator
**watches the repository** (Watch → All activity, or Custom → Issues); do this at setup. Only open
issues opened by the workflow bot (`github-actions`) are matched, by exact title, so an issue
someone else opens with the same title is never commented on or closed. No labels are used.

- **`Pipeline failed: <stage>`**: opened when a run fails, or commented on (run URL, event, time)
  when an open issue with that title exists. Stages: `setup` (checkout, Node, `npm ci`), `tests`
  (type-check or tests), `input` (bad directory, state, visit log, venue cache, replay file or CLI
  arguments), `fetch`, `every fetched centre failed`, `state write`, `publish validation`, `push`
  (3 rejected pushes, or a failed type-check or test during the replay after a rejected push),
  `build`, `deploy`. When the replay's pipeline run itself fails, its own stage (`input`, `state
  write`, `publish validation`) is filed instead of `push`. These issues are **never closed automatically**: close
  one once the cause is fixed.
- **`Reader <reader>: needs attention`**: one per reader system, evaluated on every run whose
  pipeline step wrote its report. The body lists each problem:
  - "No centre read successfully since <time>" / "… yet": the system covers ≥ 1 centre, none is
    `ok`, and its newest success is more than 24 h (`SYSTEM_DOWN_MS` in `pipeline/config.ts`)
    before the run, or it never succeeded;
  - "<name> (<centre_id>): dates disappeared, check the page": a centre read `ok` with zero dates
    while it still had upcoming dates stored. Often the page was redesigned and the reader no
    longer finds the dates; check the page and the reader's fixtures.

  A further run with the problem comments on the issue. The first run on which the system has no
  problem closes it with "Recovered in run <url>".

A failed issue call turns the `monitor` job red; nothing else in it does.

### Dead-man check (healthchecks.io)

After a run whose `build` and `deploy` jobs succeeded and whose `publish` job succeeded or was
skipped (a push to `main`), the `monitor` job pings a [healthchecks.io](https://healthchecks.io)
check. Reader issues are evaluated only on collecting runs (a push run writes no report). When no
ping arrives for 36 h, healthchecks.io emails the operator itself. This catches runs that never start
(scheduler outage, disabled workflow) and runs that keep failing. Because every successful run
pings, including push-triggered ones, a dead schedule is only caught while nobody pushes to `main`:
during active development, check the Actions tab for the daily scheduled run. Setup, once:

1. Create a free Hobbyist account on healthchecks.io and add a check named `bgtsearch pipeline`,
   schedule type **Simple**, **period 1 day**, **grace time 12 hours** (alert after 36 h without a
   ping, the same as the freshness threshold).
2. Under the check's integrations, keep (or add) **Email** to the operator's address.
3. Copy the check's ping URL (`https://hc-ping.com/<uuid>`) and add it in the repository under
   Settings → Secrets and variables → Actions as the repository secret **`DEADMAN_PING_URL`**.

Without the secret the ping step logs a warning and the run stays green. A failed ping
(`curl -fsS -m 10 --retry 3`) is also only a warning; if pings keep failing, healthchecks.io alerts
after 36 h.

### Re-enabling the schedule after 60 days

GitHub disables scheduled workflows in a public repository after 60 days without repository
activity, and emails a warning first. The dead-man check alerts 36 h after the last ping. To
re-enable: Actions tab → **pipeline** → **Enable workflow**, then **Run workflow** (a
`workflow_dispatch` run) to collect at once and ping the check again.

## Home-machine fallback

Switch to it when GitHub's scheduler is down or keeps starting runs late, or when the provider
sites block GitHub's IP ranges (HTTP 403 or timeouts from GitHub's runners): then run after run
every centre of a site (or of a whole reader system) ends `failed` in the log, typically
`failed:list-page`, while the same pages open fine from a home connection, usually with a
`Pipeline failed: every fetched centre failed` or `Reader <reader>: needs attention` issue. Run the publish job's steps from a clone of the repository on a home machine (cron or by hand), with Node from `.nvmrc`: test, run
the pipeline saving its reader results to a fresh temp file, then commit and push with the same
replay retry as CI. Every step is chained with `&&`, so a failed test or pipeline run never
reaches the commit script, and the temp file is removed afterwards:

```sh
collect="$(mktemp)" &&
git switch main && git pull --ff-only &&
npm ci &&
npm run typecheck && npm test &&
npm run pipeline -- --save-collect "$collect" &&
GIT_AUTH_HEADER="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')" \
PUBLISH_CMD="npm run typecheck && npm test && npm run pipeline -- --from-collect '$collect'" \
.github/scripts/commit-public.sh &&
{ [ -z "${DEADMAN_PING_URL:-}" ] || curl -fsS -m 10 --retry 3 "$DEADMAN_PING_URL" > /dev/null || echo 'dead-man ping failed' >&2; }
status=$?; rm -f "$collect"; exit $status
```

Run it as a script (for example `bash fallback.sh` from the clone's root), not pasted into an
interactive shell, because of the final `exit`.

- `TOKEN` is a **fine-grained personal access token** limited to this repository with
  **Contents: read and write** and nothing else. Keep it out of shell history and files in the
  clone (for example, read it from the system keychain into the variable).
- The script passes the header only to `git fetch` / `git push` for `https://github.com/`, so the
  clone's `origin` must be the HTTPS URL.
- The push is made with a personal token, so GitHub's push-triggered `pipeline.yml` run starts
  and deploys the new data. That run only tests, builds and deploys; it no longer collects, so it
  uses none of the sites' visits.
- Set `DEADMAN_PING_URL` (the check's ping URL, kept out of files like `TOKEN`) to ping
  healthchecks.io after a successful fallback run; without it, pause the check on healthchecks.io
  while the fallback runs, or it alerts after 36 h.
- A fallback run files no issues and does not update or close `Reader <reader>: needs attention`
  issues; only `pipeline.yml`'s `monitor` job does that, for its own collecting runs (the
  push-triggered run the fallback's push starts writes no report, so it touches no reader issue).
  Check the fallback's own log.
- The script above does not record the visits of a failed run (CI's visits-on-failure step does
  not run here): a fallback run that fails after contacting sites leaves them out of the visit
  log, so the next run may exceed a site's 4 visits per 24 h. Do not rerun the same day after
  such a failure.
- The visit log counts every run, manual and local ones included. A fallback run on a day the
  scheduled run already ran uses one more of each site's 4 daily visits.
