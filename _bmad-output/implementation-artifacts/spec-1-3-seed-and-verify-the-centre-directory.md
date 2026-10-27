---
title: 'Story 1.3: Seed and verify the centre directory'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'f9a84a900fc2e2836ec57449aeae27a59f59aa09'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/specs/spec-einbuergerungstest-search/data-sources.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The site has no list of test centres. Later stories (geocoding 1.4, snapshot 1.6, search 1.8) need a schema-checked, human-owned directory of every BAMF test centre in Bavaria, and every outbound request needs one polite HTTP client.

**Approach:** Define the directory zod schema in `shared/`. Build the shared HTTP client in `pipeline/fetch`. Add two operator tools: `tools/seed-directory` turns the rtpartner.de Bavaria table into `data/directory/centres.json`, and `tools/verify-directory` visits each centre's own website once, corrects what the site states, sets `verified_at` and `reader`, and writes a review note. Run both, commit the result, and make CI validate the file.

## Boundaries & Constraints

**Always:**
- Directory entry fields, all keys always present (missing = `null`): `centre_id` (lowercase slug `^[a-z0-9]+(-[a-z0-9]+)*$`, unique, stable), `name`, `address` `{ street, postcode (5 digits), city }`, `lat`, `lon` (numbers or both `null`), `website` (http(s) URL or `null`), `test_page_url` (http(s) URL or `null`), `reader` (`kuferweb` | `itemkg` | `none`), `reader_config` (`null`, or for `kuferweb`/`itemkg` a strict `{ list_url }`; must be `null` when reader is `none`), `opted_out` (boolean), `source` (`"rtpartner"`), `verified_at` (ISO 8601 UTC string or `null`). Unknown keys are rejected.
- The directory file is a JSON array sorted by `centre_id`, written with tab indentation and a trailing newline. Duplicate `centre_id`s fail validation and the error names the id.
- All HTTP in `tools/` goes through `pipeline/fetch`. The client sends `User-Agent` = `USER_AGENT` from `pipeline/config.ts`; runs requests to one host one at a time with a configurable delay between them and a per-request timeout; fetches and parses robots.txt once per host per client instance (one client = one run) and never requests a disallowed path; follows redirects itself (max 5) so every hop's host gets the same robots and queue rules; decodes bodies to text using the `Content-Type` charset, else an HTML `<meta charset>`/`http-equiv` in the first 1024 bytes, else UTF-8.
- robots.txt: groups for the `bgtsearch-bot` token win over `*`; longest-match `Allow`/`Disallow` with `*` and `$`; a 4xx robots.txt allows everything; a 5xx, timeout or network error disallows the whole host for that run.
- Fetch results are values, never thrown: `{ ok: true, status, url, contentType, text }` or `{ ok: false, reason: 'robots-disallowed' | 'timeout' | 'network-error' | 'http-error' | 'too-many-redirects', url, status }` (`status` `null` when none).
- Verification visits each distinct website host once per run: robots.txt, the homepage, and at most one candidate test page. Hosts shared by several centres (e.g. eso.de, bfz.de) are fetched once and the result reused.
- Every value the verify tool changes, and every entry left with `verified_at: null` (with its reason), is listed in `data/directory/review-note.md`. The tools only write `data/directory/`; the operator commits.
- The commit that adds the seeded directory records the entry count in its message (e.g. "120 centres").

**Never:**
- No visit budget / visit log in `data/state/`, no opted-out or reader-`none` skipping, no readers, no publish, no geocoding (Epic 2, Story 1.4, 1.6). Seeded `lat`/`lon` stay `null`.
- Never store phone numbers or e-mail addresses from the source table (no schema field for personal data).
- Never guess: a value is only changed when the site states it in the forms named in Design Notes. `reader` defaults to `none` when no fingerprint matches.
- No new runtime or dev dependencies. Tools run with plain `node` (Node 26 type stripping), so no TypeScript-only syntax (no enums, namespaces or parameter properties).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid directory | schema-valid array, unique ids | `npm run check:directory` exits 0 and prints the count | N/A |
| Duplicate id | two entries `vhs-fuerth` | check exits non-zero naming `vhs-fuerth` | fail |
| Bad entry | `reader: "foo"`, extra key, `reader:"none"` with a `reader_config`, or `lat` set and `lon` null | check exits non-zero naming the entry index and field | fail |
| Robots disallow | robots `Disallow: /kurse` | `get('/kurse/x')` returns `robots-disallowed`; no request to that path; robots fetched once for many gets | N/A |
| Robots unavailable | robots.txt 404 / 503 | 404 → allowed; 503 → every path on the host `robots-disallowed` | N/A |
| Same host, many gets | 3 parallel gets to one host, delay 1000 | requests never overlap, ≥ delay apart; different hosts may run in parallel | N/A |
| Slow server | no response within timeout | `{ ok:false, reason:'timeout' }` | aborted |
| Cross-host redirect | `a.de` → 301 → `b.de/p` | `b.de` robots checked, final `url` is `b.de/p` | redirect to a disallowed path → `robots-disallowed` |
| Latin-1 page | `Content-Type: text/html; charset=iso-8859-1`, body bytes `0xFC` | text contains `ü` | unknown label → UTF-8 |
| Seed table | rtpartner table rows | one entry per row, `source:"rtpartner"`, `verified_at:null`, `reader:"none"`, ids unique (collisions get `-<city>` then `-2`) | page without the table → tool exits non-zero, writes nothing |
| Verify confirmed | site reachable, an "Einbürgerungstest" link found and reachable, entry postcode appears on homepage or test page | `test_page_url` set, `verified_at` set, `reader` from fingerprint | N/A |
| Verify unconfirmed | site unreachable, robots-disallowed, no test link, or postcode absent | `verified_at` stays `null`, listed in review note with the reason | N/A |

</intent-contract>

## Code Map

- `pipeline/config.ts` -- exports `USER_AGENT` (`bgtsearch-bot/<version> (+…/about/)`) and `ABOUT_URL`. Reuse; add default fetch delay/timeout constants here if useful.
- `tests/import-rules.test.ts` -- enforces layers: `tools → pipeline/fetch, shared, pipeline/config.ts`; `pipeline/fetch → shared, pipeline/config.ts`; `shared → nothing`. Importing `data/**` from source is a violation, so tools read/write data files with `node:fs`.
- `tests/workflows.test.ts` -- asserts `ci.yml` steps; extend it for the new directory check step.
- `.github/workflows/ci.yml` -- `npm ci`, typecheck, test, build; `data/directory/**` is not ignored, so directory changes trigger CI.
- `tsconfig.json` -- `allowImportingTsExtensions`, `verbatimModuleSyntax`; imports use explicit `.ts` extensions, which plain `node` also needs.
- `vitest.config.ts` -- node environment, `**/*.test.{ts,tsx}`.
- `package.json` -- `cheerio ~1.2` and `zod ~4.6` already installed. Add scripts here.
- Source list: the live page `https://www.rtpartner.de/immigration/einbuergerungstest-pruefstellen-bayern/` currently renders a server error instead of its table ("Fehler beim Herunterladen der Datei"). The same page archived on 2026-04-16 has the full table (120 rows, "Quelle: BAMF"): `https://web.archive.org/web/20260416134258id_/https://www.rtpartner.de/immigration/einbuergerungstest-pruefstellen-bayern/`. Table `#myTable`, columns Einrichtung | Adresse ("Street Nr, PLZ City") | Telefon | E-Mail | Webseite (`<a href>`, 3 rows empty).
- Fingerprints (data-sources.md): KuferWeb `/fileadmin/kuferweb/webbasys/`; ITEM KG `typo3conf/ext/itemkg_` or links matching `/p/<slug>-<NNN>-CAT-KAT<n>`.

## Tasks & Acceptance

**Execution:**
- [x] `shared/directory.ts` -- zod `centreSchema`, `directorySchema` (array + duplicate-id refinement), `READERS`, inferred types, and `slugify()` (lowercase, ä→ae ö→oe ü→ue ß→ss, other accents stripped, non-alphanumerics → `-`, trimmed, max 60 chars cut at a `-`). URL fields also require a plausible hostname: only `[a-z0-9.-]`, at least one dot, a final label of 2+ letters (rejects `www.vhs-kisshab,de`, `www.vhs-eching-de`).
- [x] `pipeline/fetch/index.ts` (+ `robots.ts`, `decode.ts` as needed) -- `createFetchClient({ userAgent?, delayMs?, timeoutMs?, fetchImpl?, sleep? })` returning `{ get(url) }` per the Always rules; `fetchImpl`/`sleep` injectable for tests. robots.txt redirects that loop (A→B→A, self-redirect) or exceed 5 hops resolve to disallow-all and `get` returns `robots-disallowed`; `get` never hangs or rejects. The timeout also covers reading the body. Expose per-client stats (`robotsRequests`, page `get` calls and raw requests per host) so tools never count requests by URL path.
- [x] `tools/seed-directory.ts` -- `parseRtpartnerTable(html)` (cheerio) and a CLI `node tools/seed-directory.ts [--source <url>]` (default: the live URL). Builds entries per the Seed row, refuses to overwrite an existing non-empty `centres.json` unless `--force`, prints the count. A source website that fails the schema's URL rule is stored as `website: null` and listed in the review note as "source website invalid: <raw value>" (never auto-corrected). The review note's Source section says when the source is an archived copy and why (live page shows a server error instead of the table).
- [x] `tools/verify-directory.ts` -- pure `assessSite(entry, pages, context)` plus a CLI `node tools/verify-directory.ts [--all]` that loads `centres.json` (a missing or invalid file exits 1 with a message), selects entries per Design Notes, groups by website host, fetches per Design Notes (other hosts in parallel, max 4), applies results, validates with `directorySchema` before writing, and writes `centres.json` and `review-note.md`.
- [x] `tools/check-directory.ts` -- reads `data/directory/centres.json`, validates with `directorySchema`, and also fails when the text is not exactly the canonical serialisation (sorted, tabs, trailing newline); prints `<n> centres OK` or the issues (index, field, id) and exits 1. It imports only `shared/` and `node:` modules (no cheerio, no fetch client); shared file paths live in a small `tools/paths.ts`.
- [x] `package.json` -- scripts `seed:directory`, `verify:directory`, `check:directory`.
- [x] `.github/workflows/ci.yml`, `tests/workflows.test.ts` -- `run: npm run check:directory` step after typecheck; test asserts it.
- [x] `tests/directory.test.ts`, `tests/fetch.test.ts`, `tests/seed-verify.test.ts` (fixtures under `tests/fixtures/`) -- cover every matrix row, `slugify` cases (`Fürth`, `Straße`, collisions), and that the committed `centres.json` passes `directorySchema`. Also: robots redirect cycle, self-redirect and >5-hop chain (each resolves to `robots-disallowed` within a test timeout); a stalled response body times out; the bad hostnames above; and every Design Notes verify rule, including fixtures with a JSON-LD `Event`/`Place` venue sharing the postcode (no change applied), a street with a room/floor suffix, a nav-only "Einbürgerungstest" mention (not confirmed), a PDF test link, a shared host, an opted-out entry (no request), and a rerun that leaves verified entries untouched.
- [x] Run `npm run seed:directory -- --source <archived URL>`, then `npm run verify:directory` exactly once (each centre site was already visited twice on 2026-10-27; a third run stays within AD-5's 4 visits per 24 h, a fourth would not — do not rerun against live sites). Commit `data/directory/centres.json` and `review-note.md` with the count in the message. Remove `data/directory/.gitkeep`.

**Acceptance Criteria:**
- Given the committed `data/directory/centres.json`, when `npm run check:directory` runs, then it reports one entry per row of the source table (120) with `source: "rtpartner"`, and the commit message names that count.
- Given `data/directory/review-note.md`, when an operator opens it, then it states the source URL and its date, the run time, counts (verified / unverified / reader per type), every changed field with old → new value per centre, and every unverified centre with its reason.
- Given the verify run, when it finished, then no host received more than robots.txt plus two page requests, and every request carried the bot `User-Agent`.
- Given a push that changes `data/directory/**`, when CI runs, then the directory check step runs and fails on an invalid file.

## Spec Change Log

### 2026-10-27 — Loop 1 (bad_spec)
- **Trigger:** three review layers found that verify renamed centres to venue names taken from JSON-LD (`vhs-beilngries-e-v` → "Spielzeugmuseum 1. OG}" and still verified; also "Mittelschule", "Stadtmuseum", "vhs Rottenburg, Raum 209", "Stadt Lohr a.Main"), and applied such changes to unverified entries. The Design Notes rule ("name from the JSON-LD node holding a same-postcode address") allowed it.
- **Amended:** Design Notes rewritten (entry selection, fetching, organisation-type-only JSON-LD, value hygiene, shared hosts, nav-free test-page confirmation, HTML-only pages, changes applied only to verified entries, robots-unavailable reason). Tasks extended: hostname rule in the schema, robots redirect-cycle and body-timeout handling, per-client request stats, invalid source websites → `null` + note, archived-source note, canonical-form check, `tools/paths.ts`, verify exits 1 on a bad file, new tests, a single live verify run. Verification gained a bad-name grep.
- **Known-bad state avoided:** venue or room names stored as centre names; unverified entries silently rewritten; reruns overwriting operator fixes; `get` hanging on a robots.txt redirect loop (which stalls the whole verify run); typo'd websites passing CI; menus "confirming" a test page.
- **KEEP:** the attempt-1 code is saved at `spec-1-3-attempt-1.patch` (next to this spec). Reuse it as the starting point; most of it was good and should survive: the per-host promise-chain queue and manual redirect loop in `pipeline/fetch/index.ts`; `robots.ts` group parsing and longest-match with `*`/`$`; `decode.ts`; the strict zod schema with `superRefine` checks and duplicate-id issue paths; `slugify`, `sortDirectory`, `serializeDirectory`; `parseRtpartnerTable`, `parseAddress`, `parseSourceDate`, `buildEntries` and `--force` handling; `findTestLink`, `detectReader`, `jsonLdAddresses` traversal, `fetchSite`, `pool`; `check-directory` issue wording ("entry <i> (<id>) <field>: …"); the review note layout (Source, Verification run, Changes, Unverified, Not applied); the fake-network test helpers. The archived seed source URL is unchanged.

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 46 findings — high 6, medium 12, low 23, false 5, maybe-false 0
- findings:
  - `[high]` `[bad_spec]` robots.txt redirect cycle has no test and `get` hangs on it (VG gap) — probe confirmed: the per-href promise cache returns its own pending promise; amended task: cycles, self-redirects and >5 hops resolve to `robots-disallowed`, with tests.
  - `[low]` `[bad_spec]` Body-read part of the timeout is untested (VG gap) — the only timeout test aborts before a Response exists; amended tasks: a stalled-body timeout test.
  - `[high]` `[bad_spec]` robots self-redirect rejects with "Chaining cycle detected" and stalls or aborts verify (VG other) — same root cause and amendment as the first row.
  - `[false]` `[reject]` No user-facing surface reads the directory (IA) — by the epic's dependencies, Stories 1.6 and 1.8 publish and show it; this story is the data layer.
  - `[false]` `[reject]` 120 entries vs the epic's ~116 (IA) — "~116" is an estimate; the source table has 120 rows and one entry per row is the rule.
  - `[low]` `[reject]` 100 of 120 entries unverified (IA) — the AC allows unconfirmed entries listed for the operator; finding more test pages means crawling beyond the homepage, which adds requests per site against the politeness budget.
  - `[high]` `[bad_spec]` JSON-LD name corrections wrote venue names into the directory (IA) — confirmed in attempt 1's `centres.json` ("Spielzeugmuseum 1. OG}" etc.); Design Notes now accept only organisation-type nodes, reject room/floor/template values, and skip shared hosts.
  - `[medium]` `[bad_spec]` Corrections and readers land on unverified entries (IA) — confirmed (Lohr, Nördlingen); name/address/test page are now applied only to verified entries, otherwise listed as proposals; `reader` stays applied by design.
  - `[low]` `[reject]` Fewer readers detected than data-sources.md estimates (IA) — homepage-only fingerprinting by design; Epic 2 configures readers per centre.
  - `[low]` `[bad_spec]` Reported page count (3 for vhs-bamberg-land) and the tested limit count different things (IA) — amended: client-side stats, one page per `get`, hops reported separately.
  - `[low]` `[reject]` Workflow test checks only the step's position (IA) — the CLI's exit 1 is tested with `spawnSync` and the step runs on every push; running GitHub Actions locally is new infrastructure.
  - `[false]` `[reject]` `reader_config` is always null (IA) — it is optional per the epic, and Epic 2 readers fill it.
  - `[high]` `[bad_spec]` Verify overwrites names and addresses with venue data (BH) — same root cause and amendment as the JSON-LD name row.
  - `[medium]` `[bad_spec]` JSON-LD values written unnormalised ("Galgenbachweg  30", "…, 2. Stock") (BH) — confirmed; amended: whitespace collapsed, room/floor/comma streets rejected.
  - `[medium]` `[bad_spec]` Typo'd source URLs (`vhs-kisshab,de`, `vhs-eching-de`) pass the schema (BH) — confirmed; amended: hostname rule in the schema; seed stores `null` and lists the raw value.
  - `[low]` `[bad_spec]` Unreachable robots.txt reported as "robots-disallowed" (BH) — attempt 1 already appended the cause; amended: its own reason `robots.txt unavailable: <reason>`.
  - `[low]` `[bad_spec]` Verify does not skip opted-out entries (BH) — none is opted out today, but AD-5 forbids requesting them; amended: never fetched.
  - `[false]` `[reject]` Readers set without `reader_config` (BH) — the schema makes it optional; Epic 2 readers add it.
  - `[medium]` `[bad_spec]` Nav-menu text "confirms" any test page (BH) — confirmation used whole-page text; amended: title, h1–h3, or text without nav/header/footer.
  - `[medium]` `[bad_spec]` Shared hosts assessed from the first centre's page (BH) — confirmed for eso.de; amended: no corrections on shared hosts, confirmation per centre postcode.
  - `[low]` `[reject]` Only the homepage is searched for a test link (BH) — same reason as the unverified-count row.
  - `[medium]` `[bad_spec]` Unverified entries partly rewritten (BH) — same root cause and amendment as the IA unverified-corrections row.
  - `[medium]` `[bad_spec]` Rerunning verify undoes operator corrections and un-verifies entries (BH) — confirmed in code: every run reprocesses every entry; amended: default selects only `verified_at: null`, `--all` opt-in.
  - `[low]` `[bad_spec]` No size cap or content-type check (BH) — PDF test pages are decoded as HTML; amended: HTML-only pages; a byte cap is not adopted because the timeout bounds it and a new failure reason would change the intent's result type.
  - `[low]` `[reject]` robots.txt 429 treated as allow-all; a Sitemap line splits groups (BH) — 429 is a 4xx, which RFC 9309 and the intent treat as "unavailable, allow"; the group split is rare and adds parser state.
  - `[low]` `[bad_spec]` Smaller gaps: unguarded `JSON.parse`, double-slash URL, check importing cheerio, stale archive not explained (BH) — amended: exit 1 on a bad file, `tools/paths.ts`, archive note; the double slash is the site's own link and is kept.
  - `[high]` `[bad_spec]` Venue `PostalAddress` holder renames centres (ECH) — same root cause and amendment as the JSON-LD name row.
  - `[medium]` `[bad_spec]` Corrections applied before the checks fail (ECH) — same as the unverified-corrections row.
  - `[false]` `[reject]` Stale `reader_config` kept when the reader changes (ECH) — verify never writes a `reader_config` and all are `null`.
  - `[low]` `[reject]` Unconfirmed `test_page_url` kept on rerun (ECH) — changes now apply only to verified entries, and verified entries are skipped by default; a stored value is operator-owned.
  - `[medium]` `[bad_spec]` Centres sharing a host but with different paths are judged on another centre's page (ECH) — same root cause and amendment as the shared-host row.
  - `[low]` `[bad_spec]` A PDF test link is decoded and parsed as HTML (ECH) — same amendment as the content-type row.
  - `[low]` `[bad_spec]` Missing or invalid `centres.json` throws in verify (ECH) — amended: exit 1 with a message.
  - `[low]` `[bad_spec]` robots redirect hops miscounted as pages; failure keyed by the wrong origin (ECH) — same amendment as the request-accounting row.
  - `[medium]` `[bad_spec]` Malformed host from the source accepted by seed (ECH) — same root cause and amendment as the typo'd URL row.
  - `[medium]` `[bad_spec]` Schema accepts unusable hostnames (ECH) — same root cause and amendment as the typo'd URL row.
  - `[low]` `[reject]` A non-data `tbody` row aborts the seed (ECH) — fails loudly and writes nothing; the source has no such row.
  - `[low]` `[reject]` A name that slugifies to empty aborts the seed (ECH) — fails loudly; no such name exists in the source.
  - `[low]` `[reject]` Non-ASCII robots patterns are not percent-encoded (ECH) — rare in Bavarian VHS robots files; the fix adds encoding logic for a case not seen.
  - `[low]` `[reject]` A non-rule line between User-agent lines splits a group (ECH) — same reason as the robots 429 row.
  - `[low]` `[reject]` Unbounded body size (ECH) — same reason as the size-cap part of the content-type row.
  - `[low]` `[bad_spec]` Check does not enforce tabs and trailing newline despite claiming canonical form (ECH) — amended: compare against `serializeDirectory`.
  - `[low]` `[reject]` Workflow test's `paths-ignore` matching is naive (ECH) — `ci.yml` has no mid-path `**` pattern; the test would need a glob library.
  - `[medium]` `[bad_spec]` Claim "robots plus two pages per host" contradicted by the run's own stats (ECH claim) — same root cause and amendment as the request-accounting row.
  - `[high]` `[bad_spec]` Claim "corrects what the site states" contradicted by venue names (ECH claim) — same root cause and amendment as the JSON-LD name row.
  - `[low]` `[bad_spec]` Claim "visits each centre's own website" — only the first website per host is fetched (ECH claim) — same amendment as the shared-host row.

### 2026-10-27 — Review pass (loop 1)
- verdicts: 35 findings — high 0, medium 0, low 26, false 9, maybe-false 0
- findings:
  - `[low]` `[reject]` Only 19 of 120 verified; no name/address correction applied (IA) — carried: same claim as "100 of 120 entries unverified"; the AC allows listed unconfirmed entries, and proposals for unverified entries are listed under "Not applied".
  - `[low]` `[reject]` No test asserts verification coverage of the real data (IA) — coverage depends on live sites; the run's counts are recorded in the review note for the operator.
  - `[false]` `[reject]` Archived source and 120 vs ~116 (IA) — carried: "~116" is an estimate; the archive is disclosed with its reason in the review note.
  - `[low]` `[reject]` "One visit per site" read as robots + 2 page gets; up to 4 raw requests with hops (IA) — the spec counts one page per `get` and reports hops separately; max page gets per host is 2.
  - `[false]` `[reject]` `reader` applied to unverified entries (IA) — carried: the spec applies `reader` whenever the homepage was fetched, by design.
  - `[false]` `[reject]` Readers set without `reader_config` (BH) — carried: optional; Epic 2 readers fill it.
  - `[false]` `[reject]` Reader written even when unverified (BH) — carried: by design.
  - `[false]` `[reject]` Stale `reader_config` survives a reader change (BH) — carried: verify never writes `reader_config`; all are `null`.
  - `[low]` `[reject]` `--all` leaves a stale `test_page_url` (BH) — carried: same as "Unconfirmed `test_page_url` kept on rerun".
  - `[low]` `[reject]` `seed --force` erases opt-outs and curated fields (BH) — real but `--force` is the explicit start-over switch and no entry is opted out yet; a merge-by-id re-seed belongs to the monthly refresh process.
  - `[low]` `[reject]` Only the homepage is searched for a test link (BH) — carried: same as pass 1.
  - `[low]` `[reject]` No retries for brief network failures (BH) — failures are listed with reasons for the operator; retries add requests and state.
  - `[low]` `[reject]` No response size cap (BH) — carried: same as pass 1.
  - `[low]` `[reject]` Crawl-delay ignored, 429 allow-all, www/apex separate queues, https→http redirects (BH) — 429 carried false (RFC 9309 4xx = allow); the rest are refinements beyond AD-5 with a 2 s delay already in place.
  - `[low]` `[patch]` "Website hosts contacted" reports grouped website hosts (BH) — label renamed to "Website hosts checked" in code and in the committed note.
  - `[low]` `[reject]` Doubtful test pages accepted (`/test`, a category page) (BH) — they pass the spec's confirmation rule; the operator reviews every applied `test_page_url` in the Changes list.
  - `[low]` `[reject]` Loose `--source`/unknown-flag parsing (BH) — operator-only CLIs whose output is reviewed before commit; a bad flag fails or shows in the note's Mode line.
  - `[low]` `[reject]` One unparsable address aborts the seed (BH) — fails loudly and writes nothing; the source has none.
  - `[low]` `[reject]` No lat/lon range or length checks in the schema (BH) — coordinates arrive in Story 1.4, which adds the Bavaria check.
  - `[low]` `[patch]` Final-URL `test_page_url` after a redirect is untested (VG gap) — added an assessSite case with a redirecting test link.
  - `[low]` `[patch]` JSON-LD `address.city` correction never runs in a test (VG gap) — added confirmed (applied) and unverified (proposal only) cases.
  - `[low]` `[patch]` Header charset beating `<meta charset>` is untested (VG gap) — added a conflicting-charset decodeBody case.
  - `[low]` `[reject]` Seed/verify CLI flag parsing is untested (VG gap, filed `defer`) — operator-only CLIs; the effect of each run is visible in the review note before commit.
  - `[false]` `[reject]` robots.txt 429 treated as allow-all (ECH) — carried: RFC 9309 and the intent treat 4xx as allow.
  - `[low]` `[reject]` Unbounded body size (ECH) — carried: same as pass 1.
  - `[low]` `[reject]` Non-ASCII robots patterns (ECH) — carried: same as pass 1.
  - `[low]` `[reject]` BOM disagreeing with the header charset (ECH) — rare; adds sniffing logic for a case not seen.
  - `[low]` `[patch]` A heading inside nav/header/footer confirms a test page (ECH) — elements are now removed before the title/heading check; test added.
  - `[low]` `[reject]` Test link redirecting to a foreign host is stored (ECH) — rare; the fix is a new guard, and the operator reviews every applied `test_page_url`.
  - `[false]` `[reject]` Centres sharing a host with different website paths judged on the first page (ECH) — no corrections apply on shared hosts and each centre is confirmed on its own postcode; the amended rule holds.
  - `[low]` `[patch]` Same-postcode centres on one host are not treated as shared (ECH) — a host with more than one centre is now shared; test added.
  - `[false]` `[reject]` Stale `reader_config` on reader change (ECH) — carried: verify never writes one.
  - `[low]` `[reject]` CRLF review note loses the Source section (ECH) — the file is written with LF by the tool; Windows edits are not part of the workflow.
  - `[low]` `[reject]` Second write failing after the first in seed (ECH) — a disk error mid-seed is rare and visible; atomic two-file writes add machinery.
  - `[false]` `[reject]` Claim "no host received more than robots + 2 pages" (ECH claim) — under the spec's accounting (one page per `get`, hops reported separately) the run's max is 2 page gets.

## Design Notes

**Which entries verify touches:** by default only entries with `verified_at: null` and `opted_out: false`; `--all` also re-checks verified entries. Opted-out entries are never fetched, in any mode. Untouched entries are written back unchanged.

**Fetching** (per distinct website host; all through one client):
- Homepage = the entry's `website`. Test page: first `<a>` on the website's host, the host the homepage redirected to, or a subdomain of either (ignoring `www.`), whose text or href matches `/einb(ü|ue|u)rgerungstest/i` (resolved absolute, fragment dropped). If the homepage is itself that page, no second request.
- A page counts only when its `Content-Type` is missing or contains `html`; otherwise it is treated as not reachable.
- Request accounting counts one page per `get` call (redirect hops are reported separately). At most 2 page `get` calls per host.

**Verification rules** (all from the homepage and at most one test page):
- Test page confirmed when it is a 2xx HTML page and the pattern appears in its `<title>`, an `h1`–`h3`, or the visible text after removing `nav`, `header`, `footer` and `[role=navigation]`. Then `test_page_url` = the test page's final URL.
- Postcode confirmed when the entry's postcode appears (not inside a longer digit run) in either page's visible text.
- Name and address corrections come only from a schema.org JSON-LD node (any depth, `@graph` included) whose `@type` is one of `Organization`, `EducationalOrganization`, `LocalBusiness`, `GovernmentOrganization`, `CollegeOrUniversity`, `School`, and whose `address` is a `PostalAddress` with `postalCode` equal to the entry's postcode. Never from `Event`, `Place`, `location` or any other node. Values are whitespace-collapsed and trimmed. A `streetAddress` containing a comma or a room/floor word (`Raum`, `Stock`, `OG`, `EG`, `Etage`, `Zimmer`) and any value containing `{`, `}`, `<` or `>` is rejected and listed under "Not applied". A different postcode is never applied; it is listed under "Not applied".
- Hosts shared by centres with different postcodes (e.g. eso.de): no name or address corrections for any of them; each is still confirmed on its own postcode.
- `reader`: `kuferweb`/`itemkg` when a fingerprint appears in either page's HTML; both or neither → `none`. Set whenever the homepage was fetched, verified or not. `reader_config` stays `null`.
- `verified_at` = run start time when the test page and the postcode are both confirmed; otherwise `null` with the first failing reason (`no website`, `robots-disallowed`, `robots.txt unavailable: <reason>` when the disallow came from an unusable robots.txt rather than a rule, `unreachable: <reason>`, `no test page link`, `test page not reachable`, `postcode not on site`).
- Name, address and `test_page_url` changes are applied only when the entry ends up verified. For an unverified entry they are listed under "Not applied" as proposals, and the entry keeps its values.

**Id example:** "Euro-Schulen Nordbayern" (Würzburg) → `euro-schulen-nordbayern`; a second "Volkshochschule" row → `volkshochschule-<city>`.

## Verification

**Commands:**
- `npm ci && npm run typecheck && npm test && npm run check:directory && npm run build` -- expected: all exit 0; check prints `120 centres OK`.
- `grep -cE '"name": "[^"]*[{}]' data/directory/centres.json` -- expected: `0`.
- `grep -rnE "\bfetch\(" tools shared pipeline --include='*.ts' | grep -v "pipeline/fetch"` -- expected: no output.
- `grep -cE '"(phone|email|telefon)' data/directory/centres.json` -- expected: `0`.

## Auto Run Result

- **Summary:** The directory now exists: `data/directory/centres.json` holds 120 Bavarian test centres seeded from the rtpartner.de table (archived copy of 2026-04-16, because the live page shows a server error). It is validated by a strict zod schema in CI. All outbound HTTP goes through one polite client in `pipeline/fetch` (bot User-Agent, robots.txt once per host, serial per-host queue with a 2 s delay, timeout, manual redirects, charset decoding). One live verify run confirmed 19 centres against their own sites, set `reader` for 36 (16 kuferweb, 20 itemkg), and listed the other 101 with reasons in `data/directory/review-note.md`.
- **Files changed:**
  - `shared/directory.ts` — schema (strict, hostname rule, lat/lon pairing, reader_config rule), duplicate-id check, `slugify`, canonical serialisation.
  - `pipeline/fetch/index.ts`, `robots.ts`, `decode.ts` — the polite HTTP client, robots.txt parsing, charset decoding, per-client request stats.
  - `pipeline/config.ts` — default fetch delay (2000 ms) and timeout (20000 ms).
  - `tools/seed-directory.ts`, `tools/verify-directory.ts`, `tools/check-directory.ts`, `tools/paths.ts` — operator tools and the CI check.
  - `package.json`, `.github/workflows/ci.yml`, `tests/workflows.test.ts` — scripts and the `check:directory` CI step.
  - `tests/directory.test.ts`, `tests/fetch.test.ts`, `tests/seed-verify.test.ts`, `tests/fixtures/*` — schema, client, seed and verify tests.
  - `data/directory/centres.json`, `data/directory/review-note.md` — seeded and verified data plus the operator note; `.gitkeep` files removed from `shared/`, `tools/`, `pipeline/fetch/`, `data/directory/`.
  - `_bmad-output/implementation-artifacts/spec-1-3-attempt-1.patch` — attempt 1's code, kept as the loop-1 KEEP reference.
- **Commits:** `d0b3ad0` (attempt 1, superseded), `417a466` (re-implementation after the loop-1 spec fix), `1674fb3` (review patches), plus the commit adding this spec. All on `main`, not pushed. Each data commit names "120 centres".
- **Review:** pass 1 had 46 findings (6 high, 12 medium, 23 low, 5 false) → bad_spec loopback: verify had written venue names from JSON-LD into the directory ("Spielzeugmuseum 1. OG}", "Mittelschule"); Design Notes and tasks were amended and the code re-derived. Pass 2 had 35 findings (26 low, 9 false): 6 low patched (review-note label, nav headings no longer confirm a test page, any multi-centre host counts as shared, three missing tests). Deferred: none. Rejected: every other finding, each with its reason in the Review Triage Log above.
- **Follow-up review recommended:** false. Pass 2 patched 6 entries, all low (high 0, medium 0, low 6).
- **Verification:** `npm ci`, `npm run typecheck`, `npm test` (9 files, 286 tests), `npm run check:directory` (`120 centres OK`) and `npm run build` all exit 0. No direct `fetch(` outside `pipeline/fetch`; 0 phone/e-mail keys and 0 names with `{`/`}` in `centres.json`. Live run: max 2 page gets per host, every request with the bot User-Agent.
- **Residual risks:**
  - Only 19 of 120 centres are verified; 74 have no Einbürgerungstest link on their homepage and need manual follow-up from the review note before they go live.
  - Each centre site was visited three times on 2026-10-27 (two verify runs in attempt 1, one in the re-run); do not run verify against live sites again until 2026-10-28 (AD-5 limit of 4 per 24 h).
  - The seed source is a six-month-old archive; the live rtpartner list may have changed. Two source websites were invalid (Bad Kissingen, Eching) and are stored as `null`; `vhs-weiden-neustadt.de.de` passes the hostname rule but is likely a typo.
  - Centre ids keep legal suffixes (e.g. `vhs-aichach-friedberg-e-v`) and are meant to be stable forever; shorten them before Story 1.4 builds on them if wanted.
  - `main` carries a superseded attempt-1 commit; squash before pushing if a clean history matters.

