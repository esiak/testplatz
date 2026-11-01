---
title: 'Story 4.4: Readers for the uncovered centres, to 90%'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_revision: '1db82c9142bcc5c8f607c6aef1d015129f7d539c'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/specs/spec-einbuergerungstest-search/data-sources.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-2-local-coverage-script-fetch-cache-and-parse-offline.md'
warnings: ['multiple-goals', 'oversized']
deferred:
  - summary: >-
      The story's 90% coverage target is not reached; projected coverage against the cache is 57/66 (86.4%).
    evidence: |-
      Reaching it needs operator steps an unattended run may not take: applying the 23 reader proposals to
      centres.json, a further `npm run coverage -- --fetch` (inlingua Ingolstadt detail pages, Mühldorf
      refresh, two new test pages), and at least one reader from the "Other" group (TYPO3/WordPress) or
      Story 3.10 (null start times for MVHS and CMX teasers without a time). Listed in coverage-note.md.
    location: >-
      data/directory/coverage-note.md
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Against the local cache (fetched 2026-11-01), 33 of 66 centres in the coverage denominator parse; 90% needs 60. The 33 that do not parse fall into a few page shapes, and the two existing readers miss some centres that use their own systems.

**Approach:** Record the groups in `data/directory/coverage-note.md`, then, in this order: widen the KuferWeb and ITEM KG readers for their near-misses, then add a reader for the largest new group, the "CMX" CMS (18 centres). Each change ships with trimmed fixtures from the cache. Reader assignments for reader-`none` centres reach `centres.json` only through the operator, from `reader-proposals.json`.

## Boundaries & Constraints

**Always:**
- Groups (from the cache, `data/coverage/fetch-report.json`, after the 9 assignments in commit 1db82c9):
  - **CMX (18, reader `none`):** pages load `/cmx/interpreter/js/index.js`; ids `cmx<hex>`. Centres: oberallgaeuer-vhs, vhs-buchloe-e-v, vhs-dachau-gmbh, vhs-des-landkreises-ansbach, vhs-dingolfing-e-v, vhs-germering-e-v, vhs-geschaeftsstelle-neufarn-hallbergmoos, vhs-gunzenhausen-e-v, vhs-kaufbeuren-e-v, vhs-kempten, vhs-rhoen-grabfeld-gemeinnuetzige-gmbh, vhs-rieser-noerdlingen-e-v, vhs-rosenheim, vhs-stadt-fuerstenfeldbruck-e-v, vhs-staedtedreieck-e-v, vhs-verband-landau-e-v, vhs-waldkraiburg-e-v, volkshochschule-guenzburg.
  - **KuferWeb near-misses (5):** inlingua-sprachenschule-e-k and inlingua-sprachschule-u-c-bernau-gmbh (parsed-empty), vhs-landkreis-amberg-sulzbach (structure-missing), vhs-muehldorf-e-v (`failed:detail-page`), volkshochschule-eching-e-v (`failed:date-unparseable`).
  - **ITEM KG near-misses (5):** muenchner-vhs-gmbh (`failed:date-unparseable`), vhs-deggendorfer-land-e-v, vhs-des-lk-freyung-grafenau, vhs-kreis-kronach-e-v, volkshochschule-suedost-im-lkr-muenchen (structure-missing).
  - **Other (5, not in this story):** bayerisches-rotes-kreuz and bildungszentrum-stadt-nuernberg (TYPO3, own layouts), kolping-akademie-ingolstadt-ggmbh and mas-sprachschule-muenchen (WordPress), vhs-augsburg-e-v (JavaScript-rendered: needs a browser, counts as not parsed).
- Near-misses first: diagnose each from its cached pages; fix by widening the existing reader (selectors, date formats), never by special-casing a centre id. A cause that is not the reader's (a detail page that answered non-2xx, a page with no test dates) is recorded in `coverage-note.md` with the evidence, not "fixed".
- The CMX reader (`pipeline/readers/cmx/`) follows the reader contract: pure `plan`/`parse`, cheerio only, `null` for absent fields, shared `mapStatus`, a structure check (`failed('structure-missing')` when the page has no CMX content container) and a structure-missing fixture. It reads the list page only (`maxDetailPages: 0`): one listing per `li.Veranstaltung` teaser whose title (`.Name`) names the Einbürgerungstest (same title rule as KuferWeb: the Einbürgerungstest, not DTZ or "Leben in Deutschland"); date from `.Datum` (`dd.mm.yy`), time from `.UhrzeitBeginn` (or `null`), place from `.Ort`, status from the `.Ampelanzeige` text/icon (`status_100`/"keine freien Plätze" → booked out, "Plätze frei" → free, "Warteliste" → waitlist, else unknown), `source_url` the teaser's absolute `/Veranstaltung/…` link; address, deadline, registration method and eligibility `null`. A CMX page with the container and no teasers is `ok` with zero listings.
- `cmx` is added to `READERS` (`shared/directory.ts`) and `READER_REGISTRY` (`pipeline/stages/run.ts`); everything that enumerates reader systems keeps working (snapshot `systems[]`, coverage `by_reader`).
- Fixtures: trimmed copies of cached pages (only the markup the reader needs plus its container, no personal data), at least two centres per changed or new reader where the group has two, plus a structure-missing fixture; existing reader tests keep passing. A `cmx-note.md` lists confirmed CMX centres after the operator applies them (same table format as `kuferweb-note.md`).
- `data/directory/coverage-note.md`: groups, sizes, chosen order (near-misses, then CMX, then the rest), each near-miss's diagnosis and outcome, and every centre still not parsed with its reason.

**Never:**
- No edit of `reader` in `centres.json` for reader-`none` centres (operator applies proposals). Changing `reader_config` or `test_page_url` of an already-assigned near-miss centre is allowed only when the diagnosis shows the configured URL is the cause, and must be listed in `coverage-note.md`.
- No live network request from the implementation or its tests; work only from `data/coverage/cache/` and committed fixtures.
- No headless browser, no PDF parsing, no new listing fields, no change to the snapshot schema beyond the new `cmx` enum value.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output |
|----------|-------|-----------------|
| CMX test teaser, seats free | teaser "Einbürgerungstest", `30.11.26`, `09:30`, "Plätze frei" | listing 2026-11-30 09:30, status `free`, place "Germering", source_url absolute detail URL |
| CMX booked out | Ampel `status_100` / "keine freien Plätze" | status `booked_out` |
| CMX other tests | teasers "Deutsch-Test für Zuwanderer", "Leben in Deutschland" | not listings |
| CMX no time | teaser without `.UhrzeitBeginn` | `time: null` |
| CMX container, no test teasers | Programmbereich page without matching teasers | `ok`, 0 listings |
| CMX structure missing | page without CMX container | `failed: structure-missing` |
| non-CMX page | KuferWeb / ITEM KG fixture | CMX reader `structure-missing`; existing readers unchanged |
| near-miss fixed | each fixed near-miss's cached pages | its reader returns `ok` |

</intent-contract>

## Code Map

- `pipeline/readers/kuferweb/index.ts` -- `LIST_CONTAINER` (line 17), `parse` (~line 461), `testLinks`, date parsing (`date-unparseable` at ~486), `plan` (~511).
- `pipeline/readers/itemkg/index.ts` -- `LIST_CONTAINER` (line 18), `parse` (~329), `plan` (~388).
- `pipeline/readers/{kuferweb,itemkg}/fixtures/` + `*.test.ts` -- fixture layout and `runReaderOnFixtures` usage (`pipeline/readers/fixture-runner.ts`); directory tests in each `*.test.ts` `describe('directory')` compare against `data/directory/<reader>-note.md`.
- `shared/reader.ts` -- `Reader`, `ParseResult`, `checkParseResult`; `shared/listing.ts` -- `RawListing` (`date`, `time`, `place`, `address`, `status`, `deadline`, `registration_method`, `eligibility`, `source_url`); shared `mapStatus`.
- `shared/directory.ts:4` -- `READERS`; `pipeline/stages/run.ts:53` -- `READER_REGISTRY`.
- `pipeline/stages/normalise.ts:200` -- `link_ok` = source_url among fetched OK pages; with `maxDetailPages: 0` CMX listings get `link_ok: false` and the card opens the centre's test page (accepted).
- Cache lookup: `pipeline/stages/coverage-cache.ts` `cacheFileName(url)` (SHA-256), entries hold `html`; `npm run coverage` (offline) re-runs every reader and refreshes `data/coverage/reader-proposals.json`.
- `tests/import-rules.test.ts` -- readers import only `shared`.

## Tasks & Acceptance

**Execution:**
- `data/directory/coverage-note.md` (new) -- groups, order, diagnoses, remaining centres with reasons.
- `pipeline/readers/kuferweb/index.ts` + fixtures + tests -- widen for the KuferWeb near-misses the diagnosis attributes to the reader.
- `pipeline/readers/itemkg/index.ts` + fixtures + tests -- same for ITEM KG near-misses.
- `pipeline/readers/cmx/index.ts`, `pipeline/readers/cmx/fixtures/` (≥ 2 centres + structure-missing), `pipeline/readers/cmx/cmx.test.ts` -- the CMX reader and its matrix.
- `shared/directory.ts`, `pipeline/stages/run.ts` -- register `cmx`; update any test that enumerates readers.
- `docs/operations.md` -- one line naming the CMX reader in the coverage section.

**Acceptance Criteria:**
- Given the current cache, when `npm run coverage` runs offline after this story, then `reader-proposals.json` proposes `cmx` (parsed or parsed-empty) for at least 15 of the 18 CMX centres, and each near-miss is either parsing under its reader or listed in `coverage-note.md` with a non-reader cause.
- Given those proposals applied to a scratch copy of the directory, when the offline coverage runs against it, then the projected coverage is reported in `coverage-note.md`; if it is below 90% because detail pages for widened readers are not cached yet, the note says which centres need the next `--fetch`.
- Given `npm test`, when it runs, then every reader's fixtures pass, including the existing KuferWeb and ITEM KG fixtures unchanged.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 40 findings — high 0, medium 3, low 29, false 8, maybe-false 0
- findings:
  - `[medium]` `[defer]` Intent: the 90% target is not met (projected 81.8%, 86.4% after patches) and only projected — needs operator application of proposals, a further `--fetch` and another reader; deferred with evidence.
  - `[low]` `[reject]` Intent: no centre newly reaches users; tests cover fixtures, not the snapshot — reader assignments for reader-`none` centres are operator-only (AD-8); the snapshot changes once proposals are applied.
  - `[medium]` `[patch]` Intent: ITEM KG newer theme built without a real detail page — grouped with the Blind/Edge newer-theme finding below.
  - `[low]` `[reject]` Intent: CMX directory test compares two empty lists — becomes meaningful once the operator assigns `cmx`.
  - `[low]` `[reject]` Intent: spec deviations (no-time → `date-unparseable`, `.Veranstaltung.Teaser` selector, past teasers) — the first two are forced by `RawListing.time` and Dachau's `div` teasers; past teasers now skipped (patch below). Fix would be a spec edit.
  - `[false]` `[reject]` Intent: PDF-only centres not covered — none identified in the cache.
  - `[false]` `[reject]` Intent: operator gate assumed — the operator reviewed and applied the 9 safe proposals (commit 1db82c9) and chose to leave the rest.
  - `[low]` `[reject]` Intent: `coverage-note.md` mixes projected and committed frames — the note states which frame each table uses.
  - `[low]` `[reject]` Intent: notes reference uncommitted operator edits — those edits are the operator's own; committed separately at their request.
  - `[low]` `[patch]` Verification gap: CMX same-teaser dedupe untested — test added.
  - `[low]` `[patch]` Verification gap (other): `tools/verify-directory.ts` has no `cmx` — CMX fingerprint and summary count added, tests added.
  - `[false]` `[reject]` Verification gap (other): CMX no-time vs spec — required by the schema; same as the Intent deviation row.
  - `[medium]` `[patch]` Verification gap (other): ITEM KG newer-theme detail pages never structure-checked — newer-theme rows now read only their card; no detail URL selected; old-theme check unchanged.
  - `[medium]` `[patch]` Edge: newer-theme any-200 detail page accepted — same fix.
  - `[low]` `[reject]` Edge: newer/old rows sharing one detail page — newer-theme rows no longer use detail pages.
  - `[low]` `[patch]` Edge: newer-theme card's first link may not be the course link — title link preferred; test added.
  - `[low]` `[reject]` Edge: newer-theme card with empty start time — fails loudly as `date-unparseable`, same as other readers.
  - `[low]` `[reject]` Edge: KuferWeb Termin fallback skipped when a session row lacks date — not seen in any cached page.
  - `[low]` `[reject]` Edge: `.sr-only` text inside session table — not seen in any cached page; stripping covers the observed case.
  - `[low]` `[reject]` Edge: query course link resolved against a `/kurs/` base — not seen; title comes from `kursname` on the observed pages.
  - `[low]` `[reject]` Edge: self-detail page linked from another list page — not seen; rare.
  - `[low]` `[reject]` Edge: in-page anchors on a self-detail page — not seen; rare.
  - `[low]` `[patch]` Edge: CMX seat-light `srcset` descriptor / query missed — regex widened; tests added.
  - `[medium]` `[patch]` Edge: CMX title rule accepts any "Einbürger" title — now requires "Einbürgerungstest"; negative test added.
  - `[low]` `[reject]` Edge: CMX dedupe key collides for link-less teasers at the same minute — not seen; every cached teaser has a link.
  - `[low]` `[reject]` Edge: CMX teaser's first link not its detail link — every cached teaser's first link is its `/Veranstaltung/` link.
  - `[low]` `[reject]` Edge: `.Ampelanzeige` itself carrying the title — not seen.
  - `[low]` `[reject]` Edge: one malformed teaser fails the whole centre — same contract as the other readers (fail loudly, keep stale dates).
  - `[medium]` `[patch]` Blind: ITEM KG newer theme without structure check — same fix as above.
  - `[low]` `[patch]` Blind: newer-theme tests serve the list page as detail page — tests rewritten; list page only.
  - `[low]` `[patch]` Blind: verify-directory lacks CMX / newer ITEM KG fingerprint — CMX added; newer ITEM KG theme detection left (no centre is detected by that tool any more; seeding is done).
  - `[medium]` `[patch]` Blind: CMX title filter too broad — same fix as Edge row.
  - `[low]` `[patch]` Blind: CMX `srcset` handling — same fix as Edge row.
  - `[low]` `[patch]` Blind: ended ("Beendet") CMX teasers listed as free — skipped now; Buchloe test updated.
  - `[low]` `[reject]` Blind: KuferWeb self-detail page's own traffic light ignored — status stays `unknown`, which is honest; not worth new parsing.
  - `[low]` `[reject]` Blind: `.sr-only` stripping partial — same as Edge row.
  - `[false]` `[reject]` Blind: story misses its goal / notes record uncommitted state — same as the deferred Intent row and the notes row.
  - `[low]` `[reject]` Blind: small CMX branches untested (no-link fallback, Artikel via list_url) — defensive paths not seen in the cache.
  - `[low]` `[patch]` Blind: newer-theme row takes the first link — same fix as Edge row.
  - `[false]` `[reject]` Blind: KuferWeb README footnote not wrapped — cosmetic; Markdown renders it the same.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass except the known stale-snapshot check in `tests/directory.test.ts`
- `npm run coverage` -- expected: exits 0, sends no request, proposals include `cmx` for the CMX centres

## Auto Run Result

Status: done (target deferred)

**Summary:** The uncovered centres are grouped in `data/directory/coverage-note.md`. The KuferWeb reader is widened (query-string course links, self-links skipped, a test page that is itself a course page, single `Termin` start, screen-reader text dropped); the ITEM KG reader reads the newer theme's course cards (card-only, no detail pages); a new CMX reader (`pipeline/readers/cmx/`, registered as `cmx`) reads CMX course teasers from the test page. Against the local cache, `npm run coverage` now proposes 23 reader assignments (18 `cmx`, 3 `itemkg`, 2 `kuferweb`); with them applied, projected coverage is 57/66 (86.4%). The 90% target is deferred: it needs those proposals applied, another `--fetch`, and one more reader or Story 3.10.

**Files changed:**
- `pipeline/readers/cmx/` (new) -- reader, fixtures (Germering, Dachau, Buchloe, Kempten, structure-missing), tests.
- `pipeline/readers/kuferweb/index.ts`, `itemkg/index.ts` + new fixtures (Eching, Amberg, Ingolstadt; Deggendorf, Südost) and tests.
- `shared/directory.ts`, `pipeline/stages/run.ts` -- `cmx` registered; `tests/run.test.ts` systems row.
- `tools/verify-directory.ts`, `tests/seed-verify.test.ts` -- CMX detection and count.
- `data/directory/coverage-note.md`, `data/directory/cmx-note.md` (new); `docs/operations.md`.

**Review:** 40 findings. Patched 16 rows in 7 fixes (3 medium: CMX title rule, ITEM KG newer-theme structure check; 13 low). Deferred 1 (90% target, medium). Rejected 23 (8 false, 15 low), reasons in the triage log.

**Follow-up review recommended:** true -- two medium entries were patched on this first pass. Unverified risk: the ITEM KG newer theme (card-only) and the widened KuferWeb paths have only been checked against cached list pages and trimmed fixtures, never against a live daily run.

**Verification:** `npm run typecheck` clean; `npm run check:directory` passes; `npm run build` passes; `npm run coverage` exits 0 offline with 23 proposals. `npm test`: 1590 passed, 1 failed -- the known stale-snapshot check in `tests/directory.test.ts`.

**Residual risks:**
- The proposals are not applied; no new centre reaches the site until the operator applies them and the daily run reads them.
- Six CMX proposals are `parsed-empty`; Kempten and Rhön-Grabfeld probably list dates one page deeper (see `cmx-note.md`).
- `data/directory/centres.json` has uncommitted operator edits (test pages for `vhs-kaufering` and `vhs-landkreis-pfaffenhofen-a-d-ilm`), not part of this commit.
