---
reviews: ../ARCHITECTURE-SPINE.md
lens: rubric (spine consistency contract)
date: 2026-10-26
inputs: ARCHITECTURE-SPINE.md, .memlog.md, SPEC.md, data-sources.md, EXPERIENCE.md
---

# Rubric review — bgtsearch architecture spine

## Verdict

A tight, well-shaped spine. The paradigm, the dependency rules and most ADs are enforceable, and it covers all ten capabilities. It is not ready to hand to stories yet. One rule lets a failing reader show as "No dates listed", which is the one thing the spec forbids (SPEC: "a gap must never read as nothing available"). The `?q=` URL sends the user's town to the host, against the spec's location constraint. The data contract that pipeline and web share is only half fixed. The operational envelope has no answer for pipeline-level failure, recovery or self-hosted-runner safety.

## Checklist scorecard

| Criterion | Result | Notes |
| --- | --- | --- |
| Fixes the real divergence points | Partial | Gaps in the snapshot and state shape, the directory schema, multi-page readers, `unknown` representation and listing-id collisions (C1, H3, H4, H5, M1) |
| Every Rule enforceable and prevents its divergence | Partial | AD-8 does not prevent its stated divergence when combined with AD-4 and AD-11 (C1). AD-2 does not prevent the place reaching a server (H1). AD-5 conflicts with the import graph for `tools/` (M6) |
| Deferred can't cause divergence | Mostly | The places dataset is deferred but its schema is not fixed (M4) |
| Covers all spec capabilities | Yes, with defects | CAP-5 and CAP-10 are mapped but broken by C1. CAP-6 first-ingest behaviour is undefined (M3) |
| Operational envelope decided, deferred or open | Partial | Deploy, environments, provider, schedule and cost are decided. Pipeline-failure monitoring, backups and recovery, runner security, workflow permissions and several legal items are missing (H2, H6, M7, M8) |
| No bloat | Good | Minor items only (L1–L4) |

---

## Critical

### C1 — A failed reader with no retained listings renders as "No dates listed"

**Where:** AD-8 card derivation, together with AD-4 and AD-11.

AD-8 says "`covered` with no current listings → no-dates card". AD-4 keeps previous listings on `failed` so that they show as stale. But in these cases there is nothing to keep:

- a newly covered centre whose first run fails;
- a centre whose retained listings have all passed: publish drops past dates (AD-11), so a reader that has been broken for a few weeks ends up with zero listings;
- a centre whose retained listings were all in the past already.

Each of these produces a "No dates listed" card for a centre that is actually failing. That breaks the SPEC constraint, CAP-5 ("flagged stale rather than shown as current or empty") and the stated aim of AD-4. Card type is also the most likely place for publish and web to diverge, because the inputs to the decision are not in the contract.

**Fix:** Amend AD-8:

- The snapshot carries, per centre, `last_checked_at`, `last_success_at` (nullable) and `last_result: ok | failed`.
- The web derives the card in this order:
  1. `not_checked` → uncovered card.
  2. Dated listings → result cards, flagged stale per AD-11.
  3. `covered` with no listings, `last_result = ok`, and `last_success_at` within 12 h → no-dates card.
  4. `covered` with no listings otherwise (failed, never succeeded, or stale) → a "couldn't check, see website" card that has a link and last-checked time and never says "No dates listed".
- Add a reader-independent test fixture for case 4 to the conventions.
- Raise this with UX, because EXPERIENCE.md has no state for case 4.

---

## High

### H1 — `?q=<town>` sends the user's location to GitHub Pages

**Where:** AD-2, and EXPERIENCE.md's URL format.

The SPEC constraint is "The user's location never leaves the browser". AD-2 allows `q` in the URL. The query string is part of the HTTP request line, so every shared or reloaded results link sends the town (or, after "use my location", the nearest town) to GitHub's servers, which log IPs (memlog). That is coarse location joined to an IP. AD-2 claims to bind the constraint but does not meet it.

**Fix:** Pick one and record it as an AD-2 amendment:

- (a) Keep state in the fragment (`#q=Neu-Ulm&r=40&sort=soonest&lang=en`). The fragment is never sent to the server. Ask UX to update EXPERIENCE.md. This is the recommended option.
- (b) Accept the leak explicitly, change the SPEC constraint's wording, and disclose it in the privacy policy.

Do not leave it implicit.

### H2 — No monitoring for whole-pipeline failure and no dead-man check

**Where:** Deployment seed and the Errors convention.

The only alert is a GitHub issue when a reader *system* has failed for more than 24 h. These cases go unnoticed:

- the run fails because the snapshot is invalid ("last good site stays deployed", silently and indefinitely);
- the push fails after its retries;
- the deploy step fails;
- the schedule silently stops running, either through the 60-day auto-disable or because GitHub drops cron runs. The memlog relies on bot commits counting as activity, which is unverified.
- a single centre fails while the rest of its system works.

Workflow-failure emails go only to the user who last edited the cron line, which is an implicit and fragile arrangement.

**Fix:** Add an Operations block or an AD:

- Any failed pipeline run opens or updates a "pipeline failing" issue through an `if: failure()` step.
- A dead-man check: the web, or a second cheap scheduled workflow, raises an issue when `generated_at` is more than 13 h old. Use an external free uptime or cron ping as a backstop that does not depend on GitHub's scheduler.
- A per-centre failure older than 24 h is listed in the same issue.
- Record "bot commits keep the schedule alive" as an assumption to verify, with `workflow_dispatch` plus a keep-alive as the fallback.

### H3 — The public data contract is only half fixed

**Where:** AD-9 and AD-11, against the memlog.

AD-9 fixes *where* the schema lives but not *what is in it*. Stories for publish, the About page and cards will each invent:

- **Top-level shape.** The memlog lists `centres`, `listings`, reader-system status and `generated_at`. The spine lists none of them.
- **Where freshness lives.** data-sources.md puts `last_checked_at` on each listing. AD-6 puts it on each centre. These need to be reconciled.
- **Reader-system status.** The About page shows a row per system with "Working" / "Not updated since Tue 14:00". Nothing defines how that is derived: from the last run with any `ok`, all `ok`, or a majority? Is it computed in publish or in the browser? It also has to line up with the 12 h stale rule and the 24 h issue rule.
- **Representing "unknown".** For `status`, `deadline` and `registration_method`, is it the string `'unknown'`, `null`, or an absent key? CAP-2 depends on this being uniform.
- **`data/state/` format.** State has no version, so a merge change can silently misread old state.

**Fix:**

- Extend AD-9 with the top-level field list and per-centre run fields (see C1).
- Make one decision on freshness: per-centre only, and drop `last_checked_at` from the listing fields with a note back to the spec.
- Write a one-line system-status rule, for example: system `last_success_at` = max over its centres; "Working" when ≥ 1 centre succeeded within 12 h, otherwise "Not updated since …".
- Add a convention: "unknown is `null` in JSON; the UI renders it as unknown". Enum `status` keeps its own `unknown` code per data-sources.md.
- Give `data/state/` its own zod schema and `stateVersion`, with merge refusing an unknown version.

### H4 — The reader interface cannot express multi-step fetches or fetch failures

**Where:** AD-3.

"It also exports which URLs it needs fetched for a centre" assumes the URL list is known before any fetch. Both systems are list → detail. KuferWeb course detail pages carry the deadline and registration method, and ITEM KG uses `/p/<slug>-<NNN>-...` detail URLs found on the category page. Readers will either do their own HTTP (breaking AD-3 and AD-5) or each invent a discovery protocol.

Two further gaps:

- Nothing says who turns a 404, timeout or robots-disallow on one page into `failed`.
- Nothing says what a reader needs from the directory to know its URLs: `test_page_url`, or a per-system category id. Each reader will add its own directory field.

**Fix:**

- Change the contract to a bounded crawl: `plan(centre) → url[]`, then optionally `next(pages) → url[]` with a fixed maximum number of rounds and pages. The orchestration loop lives in `stages` and the HTTP in `fetch`.
- `FetchedPage` carries `{url, status, body | error}`, and a reader must return `failed` if any page it requires is not a 2xx.
- Readers derive URLs only from `centre.test_page_url` plus an optional typed `reader_config` whose schema is owned by that reader and validated in `shared/`.

### H5 — The listing id can collide

**Where:** AD-6.

`<centre_id>@<starts_at local minute>` breaks when one centre runs two sessions at the same start time, for example at different rooms or sites. Large VHS such as mvhs do this. Merge will then silently drop one listing or flip between the two from run to run, and `first_seen_at` becomes wrong for one of them. The local-minute key is also ambiguous during the DST fall-back hour, though that is minor.

**Fix:**

- Define the id as `<centre_id>@<starts_at with offset>[#<n>]`, where `n` is assigned deterministically by sorting same-minute listings on normalised `place` and then `source_url`. Alternatively, add a short stable hash of the normalised place.
- State the collision rule in AD-6 and require a merge test for it.

### H6 — CI skips directory validation, and run, commit and deploy ordering is undefined

**Where:** AD-12 and the Errors convention.

- `ci.yml (code, ignores data/**)` also ignores `data/directory/**`, which people edit by hand. A malformed `centres.json` is caught only by the next scheduled run, which then fails, so the site goes stale. This also feeds H2.
- The spine does not say whether state is committed before or after publish validation and deploy. If state is committed and then publish fails or the deploy fails, the repo and the site diverge. If the deploy succeeds and the push fails after retries, the site shows data whose `first_seen_at` history was never saved, and the next run treats those listings as new again.

**Fix:**

- CI ignores only `data/state/**` and `data/public/**`, and validates `data/directory/**` against its zod schema. The directory schema lives in `shared/`, alongside H4's `reader_config`.
- Add an ordering rule: merge → validate snapshot → commit and push `data/` (rebase and retry) → build and deploy *from the pushed commit*. Abort before deploying if the push fails.

---

## Medium

### M1 — Normalise has no rule, so the boundary between reader and normalise will drift

The spine names normalise but gives it no rule. It does not say who applies the data-sources.md status mapping, the address fallback to the centre address, the Europe/Berlin offset, or the stripping of personal data.

**Fix:** Add one line to AD-3 or a new AD:

- Readers emit `RawListing` with codes already mapped, because the mapping is per system.
- Normalise owns only cross-system rules: address fallback, timezone and ISO formatting, whitelisting fields to the AD-9 schema (which also enforces "no personal data"), and dropping past dates.

### M2 — Ownership and politeness budget of `link_ok` are unclear

AD-5 says the link check uses the fetch path. It does not say which stage owns it, whether it is a GET or a HEAD, whether it reuses pages the reader already fetched, or whether it counts toward "≤ 4 checks per site per day". A separate HEAD for each date's URL multiplies requests per site.

**Fix:**

- `link_ok` is set in normalise. It is true if that `source_url` was fetched with a 2xx in this run's crawl, or else checked once by a HEAD through `fetch`.
- All requests to one host within a run count as one "check".
- Opted-out and `not_checked` centres are never link-checked.

### M3 — The first ingest of a centre floods "new" badges

When a centre or a whole reader system goes live, every date on it gets `first_seen_at = now` and shows "new" for 24 h. That misrepresents CAP-6 ("appeared recently").

**Fix:** Add to AD-6: listings inserted on a centre's first successful run are stored with `first_seen_at` set and a `baseline: true` flag, or the snapshot carries a centre `covered_since`. The web shows "new" only when `first_seen_at` is later than the end of that baseline run.

### M4 — The places table is used under AD-1 and AD-2 but has no schema

The dataset choice is fairly deferred, but the shape is not fixed. The web's matching, "Did you mean", the "outside Bavaria" error and "use my location → nearest town" all depend on it. EXPERIENCE's "Place outside Bavaria" message for a *typed* place is impossible if the table holds only Bavarian places.

**Fix:**

- Add `places.json` to the AD-9 contract: name, postcode(s), lat/lon, optional disambiguator (Landkreis), plus either a small set of non-Bavarian names or a Bavaria boundary polygon or bbox for the outside-Bavaria check.
- State that `tools/build-places` writes it and the pipeline only copies it. This also settles ownership under AD-12's "bot owns `data/`" rule: `data/public/places.json` is tool-owned.

### M5 — Opted-out and robots-disallowed centres

- AD-8 makes an opted-out centre `not_checked`, but nothing says publish drops its retained listings from state.
- A robots.txt disallow is not mapped to any outcome. Under the current rules it becomes `failed`, so the centre would show as stale forever and keep the system issue open.

**Fix:**

- Publish emits no listings for `not_checked` centres.
- A robots disallow is a distinct result, `blocked`, that publishes as `not_checked`.
- A robots fetch that fails defaults to *not* fetching that host this run.

### M6 — AD-5 contradicts the import graph

AD-5 says "All outbound HTTP goes through `pipeline/fetch`", but `tools/` may import only `shared/`. That means `tools/geocode` (Nominatim) and `tools/directory-diff` (rtpartner) must use their own HTTP code.

**Fix:** Either allow `tools → pipeline/fetch` in the graph, or move the polite client to `shared/http`. Alternatively, scope AD-5 to "all requests to centre sites", and add a one-line rule that tools rate-limit and identify themselves the same way.

### M7 — Backups, recovery and the security envelope are not stated

- **Backups.** "Git is the database" implies GitHub is the only copy of the history. Nothing says how to recover from a bad merge that wipes `first_seen_at`.
- **Self-hosted runner.** The fallback is a self-hosted runner on a *public* repo, which GitHub warns against because fork PRs can run code on it.
- **Workflow permissions** are unstated: `contents: write`, `pages: write`, `id-token: write`, `issues: write`. The interaction with branch protection on `main`, which would block the bot's push, is also unstated.
- **"No secrets"** should be stated as a rule, not left as a remark in Config.

**Fix:** Add an Operations section:

- Recovery means reverting the bad `data/` commits, and merge must be idempotent when re-run from a reverted state. Keep an optional periodic mirror or clone as a backup.
- `pipeline.yml` triggers only on `schedule` and `workflow_dispatch`, and the self-hosted runner is never used for `pull_request` jobs.
- List the workflow `permissions:` explicitly.
- `main` protection allows the Actions bot to push to `data/**`, or the bot pushes through a ruleset bypass.

### M8 — Legal and privacy items missing from Deferred and Open Questions

The spine names Impressum and the privacy policy for GitHub Pages logs. These are missing:

- the rtpartner seed's reuse licence is unclear (data-sources.md);
- database-right and copyright exposure from republishing providers' schedules (§87b UrhG);
- Nominatim usage-policy compliance;
- that "private beta" on a public Pages URL in a public repo is publicly reachable and indexable;
- the opt-out intake channel and how fast it is honoured (the About page needs a contact address, and the UA points to it).

**Fix:**

- Add to Deferred or Open Questions: the seed licence (replace with BAMF data per data-sources.md), a provider-data legal check before public launch, and the opt-out contact and SLA.
- Add a rule: the beta ships `noindex` (meta tag and `robots.txt`) until public launch.

---

## Low

### L1 — The companion file does not exist

Frontmatter lists `companions: hosting-options.html`, but there is no such file in the folder. **Fix:** Add it, or remove the reference.

### L2 — Stack versions not verified

The memlog verified Node, TypeScript, Vite, cheerio and zod. It did not verify Preact 11.0, @preact/preset-vite 2.10 or Vitest 5.0. Also check that TypeScript 7 (the native compiler) works with the Vite 8 and Vitest toolchain. **Fix:** Verify these and log them in the memlog, or pin to the latest verified versions.

### L3 — The ER diagram introduces an undefined entity

`CENTRE_RUN` appears nowhere else, and `READER_SYSTEM` status is undefined (see H3). **Fix:** Either replace the diagram with the AD-9 field list or make the two agree. Drop the diagram if it only duplicates the field list.

### L4 — `centre_id` derivation is ambiguous

The id is "slug from domain or name". Several test sites can share one domain, and names change. **Fix:** "Assigned once when the centre is added to the directory and never re-derived. Uniqueness is checked by the directory schema."

### L5 — Small bloat

"(off the hour to avoid queue delays)" and the "Cost" line are rationale. They are fine at this size, but belong in the memlog if the spine needs trimming. The paradigm layer table and the source tree overlap. Keep one or the other if space matters.
