---
review: adversarial
target: ../ARCHITECTURE-SPINE.md
context: [../../../../specs/spec-einbuergerungstest-search/SPEC.md, ../../../../specs/spec-einbuergerungstest-search/data-sources.md]
date: '2026-10-26'
method: 'Build pairs of units one level below the spine. Each unit obeys every AD as written, and the pair still does not fit together. Each such pair is a hole, and each hole gets a proposed rule.'
---

# Adversarial review: bgtsearch architecture spine

## Verdict

**Not ready to build from. It needs one revision pass.** The paradigm is right: a pure-reader pipeline, a static snapshot, and git as the store. The ADs close the obvious failures, but they leave the **seams between stages** unspecified:

- `RawListing` has no shape.
- Nobody owns `link_ok`, year inference, or which address a test is at.
- No rule says what a *skipped* centre is.
- Nothing makes "commit, then deploy" atomic.

Two teams could each follow AD-1 to AD-12 to the letter and still produce a pipeline that shows an opted-out centre's old dates as live results, or shows a never-checked centre as "No dates listed". Those two cases break the SPEC's core promise that a gap never reads as nothing available. The findings below have 4 Critical, 8 High, 9 Medium and 5 Low holes. Each one has a proposed rule.

Each hole has: **Pair** (the two units that clash), **How both comply yet clash**, **Impact**, and **Proposed rule**. New rule ids are given as `AD-n′` (tightening an existing AD) or `AD-13+` (new).

---

## Critical

### C1. A skipped centre (opted out or reader `none`) keeps its listings and publishes them as live result cards

- **Pair:** `pipeline/fetch` (AD-5) vs `stages/merge` (AD-4/AD-6) vs `web` card derivation (AD-8).
- **How both comply yet clash:**
  - AD-5: fetch skips `opted_out` centres before any request. There is then no `ReaderResult`, which is neither `ok` nor `failed`.
  - Merge A treats "no result" like `failed`. It keeps the previous listings, as AD-4 requires for `failed`.
  - Publish follows AD-8: the centre gets `coverage: not_checked` and its listings are carried along.
  - The web follows AD-8's first clause: "dated listings → result cards". The centre that just opted out keeps appearing with its old dates as bookable-looking cards, until those dates pass. That breaks CAP-8: "shows as not checked automatically".
  - Merge B instead drops the listings and sets `last_checked_at`, since AD-6 says it is "always set". The UI then says "last checked 5 min ago" for a site nobody contacted.
  - The same thing happens when an operator flips a centre's `reader` from `kuferweb` to `none` because the site was rebuilt.
- **Impact:** wrong public data about a provider who asked to be removed. This also has legal and reputational weight.
- **Proposed rule, AD-8′:** The per-centre run outcome is `ok | failed | skipped`.
  - `skipped` applies when `coverage = not_checked`. It sets neither `last_checked_at` nor `last_success_at`.
  - Publish emits **zero listings** for any `not_checked` centre, whatever is in state.
  - Card type is derived from `coverage` **first**, then from the listings.

### C2. A covered centre that has never succeeded, or is failing with no prior listings, renders as "No dates listed"

- **Pair:** `stages/merge` (AD-4) vs `web` card derivation (AD-8).
- **How both comply yet clash:**
  - A newly added KuferWeb centre returns `failed` on its first run because the structure check misses. AD-4 is obeyed: merge keeps the previous listings, which here means none, and does not set `last_success_at`.
  - AD-8 is also obeyed: a `covered` centre with no current listings gets the no-dates card. The user reads "No dates listed", which is exactly the gap-as-nothing that the SPEC forbids.
  - The same happens to a long-failing centre whose kept listings have all passed and been dropped at publish (AD-11).
- **Impact:** directly violates CAP-5, CAP-10 and the SPEC constraint that a gap never reads as nothing available.
- **Proposed rule, AD-8′:** The snapshot centre record carries `last_result: ok|failed|skipped|null`, `last_checked_at` and `last_success_at`. The cards are:

  | Card | When |
  | --- | --- |
  | Result cards | dated listings exist |
  | No-dates card | **only** when `last_result = ok` and there are no current listings |
  | New "couldn't check" card | `covered` and (`last_result ≠ ok` or `last_success_at = null`) with no current listings. It links to `test_page_url`. |

  EXPERIENCE.md needs a matching state for the new card.

### C3. `RawListing` has no contract, so normalisation, status mapping and id-making are done twice or not at all

- **Pair:** `readers/kuferweb` vs `readers/itemkg`, and either reader vs `stages/normalise`.
- **How both comply yet clash:**
  - AD-3 names `RawListing` but never defines it. AD-9 defines only the *snapshot* schema.
  - The KuferWeb reader returns `status: 'booked_out'` because it maps traffic lights itself. The ITEM KG reader returns `bookable: false` and expects normalise to map it.
  - Normalise, written against the KuferWeb reader, passes `status` through. The ITEM KG listings then fail snapshot validation, so the **whole publish fails** (AD-9) and every centre goes stale.
  - The same split exists for:
    - `starts_at`: a German "Mi., 09.12.2026, 10:00 Uhr" string, or ISO?
    - `address`: does the reader apply the centre-address fallback, or does normalise?
    - `deadline`: the `'unknown'` string, or `null`?
    - `registration_method`: one value, or several (e.g. "online or by email")?
    - The listing id: computed by the reader, by normalise, or by merge?
- **Impact:** any pair of readers is incompatible by default, and the first mismatch takes down all output.
- **Proposed rule, AD-3′:** `RawListing` is a zod schema in `shared/`, validated per reader result. If a result fails validation, that centre becomes `failed('schema')`; the run continues. Readers emit:
  - `date: YYYY-MM-DD` and `time: HH:mm`, as Berlin wall-clock time;
  - `status` as a **code**, mapped in the reader through a shared `mapStatus(signals)` with fixed precedence `waitlist > booked_out > free > unknown`;
  - `registration_methods: code[]`, which may be empty;
  - `deadline_date: YYYY-MM-DD | null`;
  - `address: string | null`;
  - `place: string | null`;
  - `source_url`.

  Normalise is the **only** place that:
  - converts to offset ISO,
  - applies the address fallback,
  - computes the listing id.

  Absent values are `null` in JSON. `'unknown'` is a UI word, never a data value, except as the `status` code.

### C4. Rebase-and-retry publishes state computed against a directory or code that is no longer on `main`, and deploy can diverge from the commit

- **Pair:** `pipeline.yml` bot commit vs a human directory edit (AD-7) or a code push (AD-12).
- **How both comply yet clash:**
  - A run starts at 11:17 with centres.json v1. At 11:20 the operator pushes v2, which opts out `vhs-x` and adds `vhs-y`.
  - The bot's push is rejected. As AD-12 says, it rebases and retries. The rebase has no conflicts because the files are different, so it pushes a snapshot that:
    - shows `vhs-x` as `covered`, breaking CAP-8;
    - omits `vhs-y`, breaking AD-8 ("every directory centre exactly once") against the directory now on `main`.
  - Separately, "commits state, builds site, deploys" has no order rule:
    - If deploy runs before a push that then fails all retries, the live site shows listings whose `first_seen_at` was never persisted. The next run re-inserts them with new `first_seen_at`, so a spurious "new" badge appears and CAP-6 history is lost.
    - If the job is killed between writing per-centre state files and committing them, a dirty workspace is harmless on ephemeral runners. On the self-hosted runner fallback, the next run starts from half-written files.
- **Impact:** wrong coverage, a broken AD-8 invariant, and corrupted history.
- **Proposed rule, AD-12′:**
  1. State and snapshot go in **one** commit.
  2. Files are written to temp files and renamed into place only after the snapshot validates.
  3. A rejected push triggers rebase-and-retry **only** if upstream changed nothing outside `data/state/` and `data/public/`. Otherwise the bot re-runs **merge and publish** (not fetch) against the new HEAD, then pushes.
  4. Deploy builds from the exact pushed SHA, and runs only after the push succeeds.
  5. The workflow concurrency group uses `cancel-in-progress: false`.
  6. The self-hosted runner starts each run with `git reset --hard origin/main && git clean -fdx data/`.

---

## High

### H1. Listing id collides for one centre with two tests in the same minute at different addresses

- **Pair:** a KuferWeb reader on a Landkreis VHS with branch sites (Außenstellen) vs `stages/merge` (AD-6).
- **How both comply yet clash:**
  - The Landkreis VHS runs a test at its main site and one at a branch, both at 10:00. Both get the id `vhs-landkreis@2026-12-09T10:00`.
  - Merge A keeps the first one in page order. Merge B keeps the last. Either way a real date disappears, or flips between addresses from run to run as page order changes, while `first_seen_at` stays put.
  - The same id collision occurs when one reader parses the same course twice, once from a category page and once from its detail page.
- **Proposed rule, AD-6′:** The listing id is `<centre_id>@<YYYY-MM-DDTHH:mm>` plus `#<n>` only when needed. Normalise sorts same-minute listings by `(source_url, address)` and numbers them from 1. Exact duplicates, with the same minute and the same `source_url`, are collapsed before numbering. A reader test asserts that its ids are unique.

### H2. Year inference and the "no clock" rule conflict

- **Pair:** `readers/kuferweb` vs `readers/itemkg` under AD-3 ("reads no clock").
- **How both comply yet clash:**
  - Many listings print "Mi., 09.12." with no year.
  - Reader A guesses the year from the page footer's copyright year. That is pure, but wrong in December for January dates.
  - Reader B returns `failed`, so the whole centre is stale permanently.
  - The id embeds the year, so the two readers produce different ids for the same date.
- **Proposed rule, AD-3′:** `parse(pages, centre, ctx)` receives `ctx.runAt`, the single run clock injected by the stage runner. It is the only time source in the pipeline. A missing year resolves to the earliest year such that the date is ≥ `runAt − 1 day`. This is one function in `shared/`, tested over a year boundary.

### H3. Multi-page crawl cannot be expressed: "exports which URLs it needs" is a static list

- **Pair:** a reader whose status or deadline lives on per-course detail pages linked from a listing page, vs `pipeline/fetch`.
- **How both comply yet clash:**
  - AD-3 lets a reader export only a fixed URL list derived from `Centre`, but the detail URLs are known only after parsing the listing page.
  - Implementer A hard-codes a second fetch round for ITEM KG inside the stages. Implementer B leaves the fields `unknown`.
  - A third reader for a paginated list has no way in at all.
- **Proposed rule, AD-3′:** The reader interface is:
  - `plan(centre) → URL[]`
  - `next(pages, centre) → URL[]`, for at most 2 follow-up rounds, with a hard cap of N pages per centre per run in `config.ts`
  - `parse(...)`

  Fetch is **GET-only, with no cookies and no query forms**. A system that needs more is `reader: none`.

### H4. A partial fetch makes an `ok` result with missing dates, and AD-6 deletes them

- **Pair:** `pipeline/fetch` (timeout per request, AD-5) vs a reader (AD-4) vs merge (AD-6).
- **How both comply yet clash:**
  - Page 1 of 2 loads and page 2 times out. Fetch passes on what it got.
  - The reader finds its structure on page 1 and returns `ok`, which is valid under AD-4.
  - Merge then removes every page-2 date as "missing from an ok result" (AD-6). Those dates come back next run with new `first_seen_at`, so "new" badges churn.
- **Proposed rule, AD-4′:** If any planned or follow-up URL for a centre is not a 2xx response, the stage sets the result to `failed('fetch:<status>')` **without calling the reader**. Readers only ever see a complete page set. Robots-disallowed counts as `failed('robots')`, and robots.txt errors follow RFC 9309: a 4xx means allow, a 5xx or unreachable robots.txt means disallow.

### H5. Nobody owns `link_ok`

- **Pair:** `pipeline/fetch` (AD-5 "the link check uses the same path") vs readers (pure) vs merge (the only state writer).
- **How both comply yet clash:**
  - Nobody computes `link_ok`. Fetch can check links, but nothing says which URLs are checked, when, or where the result goes.
  - Team A adds a link-check pass after merge that HEADs every `source_url`. With ~50 dates per site, 4 runs a day, and serial requests with a delay, that blows the "≤ 4 checks per site per day" budget and the run duration.
  - Team B sets `link_ok` from whether the reader saw the URL. It is then always true.
  - On `failed`, nobody says whether the stored `link_ok` is kept or reset.
- **Proposed rule, AD-5′:** `link_ok` is set in normalise from **this run's** fetch outcomes. It is true if `source_url` was among the fetched pages and returned 2xx. If `source_url` was not fetched, it inherits the `link_ok` of the page the listing was parsed from. No standalone link-check requests. On `failed`, merge keeps the stored value.

### H6. Code CI ignores `data/**`, so human directory edits are never validated, and "bot owns data/" contradicts AD-7

- **Pair:** AD-12 ("the pipeline commits only under `data/`", "code CI ignores `data/**`") vs AD-7 (the directory is human-owned and lives in `data/directory/`).
- **How both comply yet clash:**
  - A hand edit leaves a typo in `reader: "kuferweb "` or a duplicate `centre_id`. CI skips it.
  - The next pipeline run fails directory parsing. Every run fails, the site freezes on the last good snapshot, and nobody is alerted (the alert covers only reader systems).
  - Meanwhile, nothing stops a bot commit that touches `data/directory/`.
  - A directory schema is never defined: AD-9 covers only the snapshot.
- **Proposed rule, AD-7′:**
  - The directory has a zod schema in `shared/`. Required checks: unique `centre_id`, unique `test_page_url`, and a valid `reader` enum value.
  - CI ignores only `data/state/**` and `data/public/**`, and validates `data/directory/**` on every push.
  - The bot may commit only `data/state/` and `data/public/snapshot.json`. A pre-commit check in the workflow enforces this.
  - A pipeline run that cannot load the directory opens a GitHub issue.

### H7. A `schemaVersion` bump vs a cached old app, and a code deploy vs the committed snapshot

- **Pair:** `web/` (new build) vs `data/public/snapshot.json` (AD-9) vs browser/CDN cache.
- **How both comply yet clash:**
  - The breaking change lands in one commit, as AD-9 says. But the committed `snapshot.json` was produced by the *old* publish. Any deploy before the next scheduled run ships new web + old snapshot.
  - Users with a cached `index.html` or JS (Pages sends `max-age=600`) load the old app against the new snapshot at the fixed URL `snapshot.json`. Both are "valid". Neither handles the other.
  - A second deploy path (on code push) can race the pipeline's deploy, and the older build can win.
- **Proposed rule, AD-9′:**
  1. **One deploy workflow**, in the pipeline's concurrency group. Before building, it always runs `publish` (a pure function of state, directory and `runAt`, with no fetch).
  2. The snapshot is emitted as `snapshot.v<schemaVersion>.json`, and the web build references that exact name.
  3. The web checks `schemaVersion` at load. On a mismatch it shows a localised "please reload" notice, never a crash or an empty result.

### H8. "Past" has three definitions and three owners

- **Pair:** `stages/publish` ("drops past dates") vs `stages/merge` vs `web` (`starts_at < now`), and readers, which cannot know "now".
- **How both comply yet clash:**
  - Publish A compares the *date* (`starts_at < today`). Publish B compares the instant. A 14:00 test at an 11:17 run is kept by A and B, but B drops a 10:00 test from a 23:17 UTC run on the same calendar day earlier than A does.
  - Merge C prunes past listings from state, so the history needed for v2 is lost. Merge D keeps them forever, so state grows without bound.
  - "Current listings" is undefined: does it include past ones?
- **Proposed rule, AD-11′:** "Past" means `starts_at` (an instant) `≤ runAt` at publish, and `≤ now` in the web, compared as instants. Readers never filter by date. Merge never deletes: a listing has `removed_at`, set when it is missing from an `ok` result. State keeps past and removed listings as history. "Current" means `removed_at = null` and the listing is not past.

---

## Medium

### M1. Reappearance and `first_seen_at`

- **Pair:** merge A (hard-deletes removed listings) vs merge B (tombstones them).
- **How both comply yet clash:** A provider unlists a date for an hour, or a page is briefly mis-ordered, and it comes back. Under A it is "inserted" again, gets a new `first_seen_at`, and shows a false "new". Under B it keeps the original.
- **Proposed rule, AD-6′:** Ids are never deleted from state. Reappearance clears `removed_at` and keeps `first_seen_at`. A rescheduled date (10:00 → 10:30) is a *new* id by design, and is documented as such.

### M2. DST and the local minute

- **Pair:** normalise (attaches the offset) vs the id (a local minute with no offset).
- **How both comply yet clash:** On 2026-10-25, the local times 02:00–02:59 happen twice, and in March they don't exist. Tests at that hour are unrealistic. The real risk is two implementations computing the offset differently, one with `Intl` and one hard-coding `+01:00`, so the summer dates get the wrong instant and "past" or "Passed" are off by an hour.
- **Proposed rule, AD-11′:** The offset comes only from the IANA `Europe/Berlin` zone, via one `shared/time.ts` helper. Ambiguous local times resolve to the earlier offset, and nonexistent ones fail the listing (`failed('time')`). The id uses wall-clock time, never UTC.

### M3. `deadline` as an offset timestamp vs a date-only source

- **Pair:** the reader (sees "Anmeldeschluss: 15.11.") vs AD-11 ("deadline is ISO 8601 with offset").
- **How both comply yet clash:** Reader A emits `T00:00+01:00`, so "Passed" shows on the morning of the 15th. Reader B emits `T23:59`, so it shows on the 16th.
- **Proposed rule, AD-11′:** `deadline` is a date (`YYYY-MM-DD`). It passes at the end of that Berlin day.

### M4. Tests at a non-centre address vs distance and the Maps link

- **Pair:** a reader (emits a branch `address`, per data-sources) vs `web` (distance from centre coordinates) vs `tools/geocode` (centres only).
- **How both comply yet clash:**
  - A Landkreis VHS lists a test at a branch 30 km away. The card shows the branch address, but the km figure and radius filter use the head office.
  - One web implementation links Maps to the listing address, another to the centre.
  - This breaks CAP-1's success line: "each result shows its km value and a Google Maps link to its address".
- **Proposed rule, AD-2′:** The directory may hold `locations[]` (an id, an address and coordinates, geocoded by `tools/geocode`). The reader emits `location_id` when it can match a listing to one. Distance and Maps use the listing's location if set, else the centre. An unmatched branch address is shown with a "location approximate" marker, never with silently wrong km.

### M5. `tools/geocode` vs a concurrent manual directory edit

- **Pair:** `tools/geocode` (AD-7 "fills only missing or changed coordinates") vs a human editing `centres.json`.
- **How both comply yet clash:**
  - Geocode reads the file, spends 2 minutes at 1 req/s, then rewrites the whole file with its own key order and formatting. That clobbers a hand edit made meanwhile, or produces a giant diff that hides it.
  - Geocode can't tell a "changed" address without remembering which address it geocoded.
  - A hand-corrected coordinate (Nominatim placed the pin wrong) is overwritten when the address text is touched.
- **Proposed rule, AD-7′:**
  - The directory has one canonical serializer in `shared/` (stable key order, sorted by `centre_id`). CI rejects non-canonical files.
  - Tools re-read the file and apply changes as per-entry patches immediately before writing, and abort if the file changed since start.
  - Each entry stores `geocoded_address` and `coords_source: nominatim|manual`. Geocode never touches `manual`, and re-geocodes only when `address ≠ geocoded_address`.

### M6. `places.json` has two writers

- **Pair:** `tools/build-places` (operator) vs `stages/publish` (bot), both writing into `data/public/` (source tree).
- **How both comply yet clash:** AD-12 says the bot owns `data/`. AD-7 says tools are run by people. A bot step that clears `data/public/` before publishing deletes the places table.
- **Proposed rule:** `places.json` lives at `data/places/places.json` and is operator-owned like the directory. The bot writes only `data/public/snapshot*.json`.

### M7. `last_checked_at`: per listing (data-sources) vs per centre (AD-6)

- **Pair:** merge (per centre, "always set") vs web ("Each listing shows 'last checked'", CAP-5).
- **How both comply yet clash:** On `failed`, merge advances `last_checked_at`, and the web shows it on each kept listing: "last checked 3 min ago" on data that was not confirmed.
- **Proposed rule, AD-11′:** Listings carry no own check timestamp. The listing's "last checked" shown in the UI is the centre's `last_success_at`. `last_checked_at` is shown only in the stale or failing notice ("tried 3 min ago, couldn't read").

### M8. Run deadline and timeouts

- **Pair:** the job time limit vs serial fetching per host with a delay (AD-5).
- **How both comply yet clash:** Fetching is slow, and nothing bounds a run. If the GitHub job is killed at its time limit (or by a self-imposed one), nothing is committed, so every centre goes stale. A partial alternative leaves unreached centres "always" stamped with `last_checked_at`.
- **Proposed rule, AD-5′:** `config.ts` sets a run budget, which must be shorter than the job timeout. Centres not reached when the budget is spent get `failed('budget')`. Merge, publish and commit always run after the budget expires.

### M9. Politeness budget vs retries and manual runs

- **Pair:** fetch ("≤ 4 checks per site per day", SPEC) vs `workflow_dispatch` / re-runs / the C4 retry.
- **How both comply yet clash:** Fetch enforces a delay and serial order, but not a daily count. A manual re-run after a failure makes a fifth check. Several centres on one host (a shared ITEM KG host, or a city VHS with multiple directory entries) each count as one site, but they hit one server.
- **Proposed rule, AD-5′:** Merge records the fetch start time per host in state. Fetch reads it and skips any host with ≥ 4 runs in the past 24 h, giving `failed('budget')`. The budget is counted **per host**, not per centre.

---

## Low

### L1. Two directory centres share one test page

Two centres pointing at the same page (a VHS and its BAMF-listed branch) publish the same dates twice. This is covered by the H6 `test_page_url` uniqueness check, or by an explicit `shares_page_with` field.

### L2. Renamed or removed centre

`centre_id` is "stable forever" but derived from the domain, and VHS merges change domains. If a centre leaves the directory, merge keeps orphan state, and publish might emit it.

**Proposed rule:** The snapshot contains *exactly* the directory centres. A rename uses a `previous_ids[]` field in the directory, and merge migrates the history.

### L3. Reader-system status and alerting are undefined

"Reader system failing > 24 h" leaves open what counts as failing: all centres on the system, or any one. It also doesn't say whether an issue is opened on every run.

**Proposed rule:** A system is failing when ≥ 50 % of its covered centres have `last_success_at` older than 24 h. The alert keeps one open issue per system, which is updated and auto-closed on recovery. The workflow needs `issues: write`.

### L4. Third-reader registration

AD-3 says "add a folder", but the `reader` enum lives in `shared/` (AD-10), and nothing ties folders to enum values.

**Proposed rule:** `pipeline/readers/index.ts` is a registry typed as `Record<Exclude<ReaderCode,'none'>, Reader>`, so the compiler rejects an enum value with no reader. CI also requires every reader folder to have a "structure missing" fixture.

### L5. State layout and noise

Nothing says whether state is one file or many, or what the key order is. Two merge implementations produce different diffs, and an unchanged run still commits, because `last_checked_at` changes every time.

**Proposed rule:** State is stored as `data/state/<centre_id>.json`, written by the canonical serializer with listings sorted by id. Run timestamps live in a single `data/state/runs.json`.
