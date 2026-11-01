---
title: 'Story 4.3: Find missing test pages'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_revision: '52aa44c20f789abca137b99d4d0239ab44f78c3c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-local-coverage-script-fetch-cache-and-parse-offline.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** 29 of 111 directory centres have no `test_page_url`, so they sit in `no-test-page`, outside the coverage denominator, and can never be checked.

**Approach:** Add `npm run coverage -- --discover` to the Story 4.2 script: for each centre with a `website` and no `test_page_url`, look for its Einbürgerungstest page with at most 3 page requests per host through the polite client, and write the proposals with their evidence to a review file for the operator. Nothing is written to `centres.json`.

## Boundaries & Constraints

**Always:**
- Scope: centres with `test_page_url === null`, not opted out, not `pdf_only`. A centre with `website === null` is reported `not found` with evidence `no website`, and nothing is requested for it.
- At most 3 page requests per host per run (robots.txt and redirect hops are not page requests), counted across all centres sharing that host. Pages come through the Story 4.2 cache and polite client (`createFetchClient` with the visit budget); a cached page is reused and costs no request. Visits are recorded in `data/state/visits.json` exactly as `--fetch` does.
- Search order per centre, stopping at the first match:
  1. `<origin>/sitemap.xml`: the first `<loc>` whose URL matches the test pattern.
  2. the `website` page: the first link on the centre's host (or a subdomain) whose text, title or decoded href matches the test pattern.
  3. one follow-up page: the first link on the centre's host whose text or href matches `/programm|kurse|deutsch|sprache|integration|prüfung|pruefung/i`; the first matching link on it.
- Test pattern: `/einb(ü|ue|u)rgerungstest|einb(ü|ue|u)rgerung|leben[ -]in[ -]deutschland/i`. A link that matches "Einbürgerungstest" wins over one that only matches "Einbürgerung" or "Leben in Deutschland" on the same page.
- Proposed URLs are absolute http(s), fragment removed.
- The review file `data/coverage/test-page-proposals.json` (gitignored) holds one entry per scoped centre, sorted by `centre_id`: `{centre_id, website, proposed_url | null, source: 'sitemap' | 'website' | 'follow-up' | null, evidence}`, where `evidence` is the matched link text, sitemap URL or page title, or the reason nothing was found (`no website`, `budget`, `robots`, `unreachable`, `not found`). The script also prints it as a table plus a count line.
- Link matching reuses one shared helper: move `TEST_PATTERN`-style link finding out of `tools/verify-directory.ts` into `shared/test-page.ts` (pure, cheerio) and import it from both places; `tools/verify-directory.ts` keeps its behaviour and its tests pass unchanged.

**Never:**
- No write to `data/directory/centres.json`.
- No more than 3 page requests per host, no following links to other hosts, no search engines or third-party services.
- No change to `--fetch`, the offline parse, the daily pipeline or the snapshot.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output |
|----------|--------------|-----------------|
| sitemap hit | sitemap lists `/kurse/einbuergerungstest` | proposed, source `sitemap`, 1 page request |
| homepage hit | no sitemap (404), homepage links "Einbürgerungstest" | proposed, source `website`, 2 requests |
| follow-up hit | homepage links "Deutsch & Integration", that page links "Leben in Deutschland" | proposed, source `follow-up`, 3 requests |
| preference | page links both "Einbürgerung" and "Einbürgerungstest" | the "Einbürgerungstest" link |
| off-host link | homepage links "Einbürgerungstest" on another host | ignored |
| nothing | no match after 3 pages | `proposed_url: null`, evidence `not found` |
| no website | `website: null` | evidence `no website`, no request |
| host over budget | 4 visits in 24 h | evidence `budget`, nothing sent |
| robots disallow / unreachable homepage | — | evidence `robots` / `unreachable` |
| shared host | two scoped centres on one host | ≤ 3 page requests to that host in total |
| re-run | pages cached | no new request for cached pages |
| centre already has a test page | `test_page_url` set | not in scope, not in the file |

</intent-contract>

## Code Map

- `pipeline/stages/coverage-script.ts` -- `fetchCoverage` (`page()` cache/in-run dedupe at ~line 168, `request()`, visits written after `Promise.allSettled`), `runCoverage`, `parseCliArgs`; add `discoverTestPages(options)` alongside and a `--discover` flag (`--refresh` allowed with it).
- `pipeline/stages/coverage-cache.ts` -- cache entries; reuse unchanged.
- `pipeline/stages/paths.ts` -- add `TEST_PAGE_PROPOSALS_PATH` under `COVERAGE_DIR`.
- `tools/verify-directory.ts:19,68,108-128` -- `TEST_PATTERN`, `stripWww`, `findTestLink(html, baseUrl, hosts)`: logic to move to `shared/test-page.ts` (extend for the wider pattern and the "test" preference without changing what verify-directory finds: it keeps its own narrow pattern by passing it in).
- `tests/import-rules.test.ts` -- `pipeline/stages` and `tools` may import `shared`; `shared` imports no project layer (cheerio is fine; `web/` must not import `shared/test-page.ts`).
- `tests/seed-verify.test.ts` -- existing tests of `findTestLink`; must keep passing.
- `docs/operations.md` "Coverage script" section -- add `--discover` and how to apply proposals.

## Tasks & Acceptance

**Execution:**
- `shared/test-page.ts` (new) -- `stripWww`, `findTestLink(html, baseUrl, hosts, pattern)` returning the best match with its link text, plus sitemap `<loc>` matching; pure.
- `tools/verify-directory.ts` -- import the moved helpers; behaviour unchanged.
- `pipeline/stages/paths.ts` -- `TEST_PAGE_PROPOSALS_PATH`.
- `pipeline/stages/coverage-script.ts` -- `discoverTestPages` with the per-host request cap, search order, review file, printed table; `--discover` in the CLI (runs discovery, then the offline parse); usage text.
- `docs/operations.md` -- `--discover`, the review file, applying a proposal (set `test_page_url`, run `npm run check:directory`, then `--fetch`).
- `tests/coverage-discover.test.ts` (new) -- every matrix row with a fake transport and temp dirs; visits recorded; `centres.json` untouched; after applying a proposal to a temp directory, `fetchCoverage` requests that test page.

**Acceptance Criteria:**
- Given a temp directory with scoped centres and a fake transport, when `discoverTestPages` runs, then no host receives more than 3 page requests and every scoped centre appears once in the review file.
- Given the operator copies a proposed URL into a centre's `test_page_url`, when `npm run check:directory` runs, then it passes, and the next `--fetch` requests that page.
- Given `--discover` runs, when it ends, then `data/directory/centres.json` is byte-identical to before.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 31 findings — high 0, medium 3, low 21, false 7, maybe-false 0
- findings:
  - `[low]` `[reject]` Intent: no live `--discover` run against real sites — operator action with side effects on third-party hosts; done before Story 4.4.
  - `[low]` `[reject]` Intent: AC3 tested in-process, not via the real CLI — `checkDirectoryText` is what `npm run check:directory` runs; no user harm.
  - `[false]` `[reject]` Intent: no site-search step — the epic's "programme or search page" is met by the programme/follow-up page the spec chose.
  - `[low]` `[reject]` Intent: "titles" read as link `title` attributes, not page titles — a defensible reading; evidence uses page titles.
  - `[medium]` `[patch]` Intent: sitemap index not handled — grouped with the Blind/Edge sitemap-index finding below.
  - `[low]` `[patch]` Intent: per-host cap keyed by literal host — grouped with the grouping finding below.
  - `[false]` `[reject]` Intent: verify-directory behaviour preservation unproven — `tests/seed-verify.test.ts` runs and passes unchanged.
  - `[false]` `[reject]` Intent: an existing test was edited — the edit only replaces `--discover` (now valid) with an unknown flag.
  - `[low]` `[patch]` Verification gap: `--refresh` keeps a cached `ok` page on an over-budget host, untested — test added.
  - `[low]` `[patch]` Verification gap: cached `budget` entry retried later, untested — test added (24 h later, centre gets its proposal).
  - `[low]` `[patch]` Verification gap: discover failure path (visits, exit 1, message) untested — test added.
  - `[low]` `[patch]` Verification gap: robots-blocked sitemap not using the cap, untested — test added.
  - `[low]` `[reject]` Blind: centres sharing a host get the same sitemap proposal — proposals are reviewed by the operator; preferring path-local locs adds logic for a rare case.
  - `[medium]` `[patch]` Blind: sitemap index `<sitemap><loc>` proposed as a page — only `url > loc` matched; test added.
  - `[medium]` `[patch]` Blind: `FOLLOW_UP_PATTERN` hits the language switcher — `hreflang`/`lang` and bare language-name links skipped; test added.
  - `[low]` `[patch]` Blind: no content-type check, PDF links proposed — file links (`.pdf`, `.doc(x)`, `.xls(x)`, `.zip`, images) skipped; test added.
  - `[low]` `[patch]` Blind: cached `unreachable`/`robots` never retried without `--refresh` — documented in the runbook; behaviour matches `--fetch`.
  - `[low]` `[patch]` Blind: grouping by literal host is timing-dependent — grouped by `siteHost` (www stripped); test added.
  - `[low]` `[reject]` Blind: further untested branches (`exclude`, `--json`, wrapper whitespace) — covered indirectly or cosmetic.
  - `[false]` `[reject]` Blind: dead `test_page_url` centres out of scope — the spec scopes discovery to missing test pages.
  - `[low]` `[reject]` Blind: `?? 1` fallback unreachable — dead branch, rewritten with the refund fix.
  - `[low]` `[patch]` Blind: proposals file overwritten each run not documented — runbook updated; `discover?: true` shape rejected as cosmetic.
  - `[low]` `[patch]` Edge: redirect then robots/budget block refunded although sent — refund only when the block was at the requested URL. No dedicated test (residual risk).
  - `[low]` `[patch]` Edge: cached `unreachable` sticky — same as the runbook row above.
  - `[low]` `[patch]` Edge: homepage self-anchor proposed as test page — website step now excludes the website and final home URL.
  - `[low]` `[patch]` Edge: language switcher spends the follow-up — same fix as the Blind row.
  - `[low]` `[patch]` Edge: follow-up to a PDF — same fix as the file-link row.
  - `[medium]` `[patch]` Edge: sitemap index — same fix as the Blind row.
  - `[low]` `[reject]` Edge: follow-up robots/unreachable reported as `not found` — evidence wording only.
  - `[low]` `[patch]` Edge: grouping nondeterminism — same fix as the Blind row.
  - `[false]` `[reject]` Edge: claim that an applied proposal is served from the discovery cache on `--fetch` — that is the documented cache behaviour; `--refresh` refetches.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass except the known stale-snapshot check in `tests/directory.test.ts` (snapshot lists centres removed in 0914077; clears on the next pipeline run)
- `npx vitest run tests/coverage-discover.test.ts tests/seed-verify.test.ts tests/import-rules.test.ts` -- expected: all pass

## Auto Run Result

Status: done

**Summary:** `npm run coverage -- --discover` looks for the Einbürgerungstest page of every centre with a website and no `test_page_url` (not opted out, not PDF-only): the origin's `sitemap.xml` (page entries only), then the website page, then one follow-up page, at most 3 page requests per host, through the Story 4.2 cache and polite client, with visits recorded. Proposals with evidence go to `data/coverage/test-page-proposals.json` (gitignored) and a printed table; `centres.json` is never written. Link finding now lives in `shared/test-page.ts` and is shared with `tools/verify-directory.ts`, whose behaviour is unchanged.

**Files changed:**
- `shared/test-page.ts` (new) -- link and sitemap matching, patterns, file and language-link filters.
- `tools/verify-directory.ts` -- uses the shared helpers.
- `pipeline/stages/coverage-script.ts` -- `discoverTestPages`, `formatDiscovery`, `--discover` CLI, shared `cacheEntryOf`.
- `pipeline/stages/paths.ts` -- `TEST_PAGE_PROPOSALS_PATH`.
- `docs/operations.md` -- `--discover`, review file, applying proposals, cache retry rules.
- `tests/coverage-discover.test.ts` (new), `tests/coverage-script.test.ts`, `tests/import-rules.test.ts` (web may not import `shared/test-page.ts`).

**Review:** 31 findings. Patched 19 rows in 9 fixes (3 medium: sitemap index, language-switcher follow-up; 16 low). Deferred 0. Rejected 12 (7 false, 5 low), reasons in the triage log.

**Follow-up review recommended:** false -- the medium fixes are narrow selector/filter changes each pinned by a new test; no unverified risk beyond the residual one below.

**Verification:** `npm run typecheck` clean; `npm run check:directory` passes (110 centres); `npm run build` passes; `npm run coverage` exits 0 offline. `npm test`: 1544 passed, 1 failed -- the known stale-snapshot check in `tests/directory.test.ts` (snapshot still lists centres removed in 0914077).

**Residual risks:**
- The refund rule for a request that redirects and is then blocked has no dedicated test.
- No live `--discover` has been run; the first real run is the operator's.
- `data/directory/centres.json` has uncommitted operator edits (Erlangen website and test page, Herzogenaurach website, `vhs-herrsching` removed), not part of this commit.
