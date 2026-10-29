---
title: 'Story 2.4: ITEM KG reader'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: 'd7dd785cdaa8e4056b28e1db21b83ab20bfee258'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-3-kuferweb-reader.md'
warnings: [oversized]
deferred:
  - summary: >-
      The reader reads only the first page of a paginated category list, so tests beyond page 1 would be dropped while the centre reads ok.
    evidence: |-
      Several list URLs are paged category views (tx_itemkgconnect_categorys[page]=0); the largest test list seen has 15 rows on one page (Fichtelgebirge), and MVHS shows 40 rows per page. Settled by a real ITEM KG test category with a second page.
    location: >-
      pipeline/readers/itemkg/index.ts testRows / parse
    severity: medium (unverified)
  - summary: >-
      The eligibility pattern also matches document hints or unrelated restrictions ("Nachweis über Ihren Wohnsitz", "Parkplätze nur für Anwohner"), and the list-page search covers aside and banner areas.
    evidence: |-
      The pattern is fixed by the intent-contract (same as KuferWeb, which has a related deferred item); no fetched ITEM KG page has such text. Settled by a live ITEM KG page whose non-rule text matches.
    location: >-
      pipeline/readers/itemkg/index.ts RULE / listRule
    severity: medium (unverified)
  - summary: >-
      MVHS (München) yields no dates: it publishes no start time, and RawListing requires one, so the centre fails with date-unparseable.
    evidence: |-
      Real MVHS rows show "Fr. 04.12.2026" and the detail page "00:00 - 23:59 Uhr". Fix needs RawListing/normalise to allow an unknown time (shared contract, Story 2.5 listing id uses HH:mm).
    location: >-
      shared/listing.ts rawListingSchema.time; pipeline/readers/itemkg/index.ts parse step 5
    severity: medium
---

<intent-contract>

## Intent

**Problem:** About 20 Bavarian centres publish their Einbürgerungstest dates through ITEM KG (TYPO3 `itemkg_connect`), but there is no reader for it, so the pipeline cannot turn their pages into `RawListing`s; several ITEM KG directory entries point at search forms, info pages or the wrong category, and Bad Kissingen is not marked as ITEM KG at all.

**Approach:** Add `pipeline/readers/itemkg/` implementing the Story 2.1 `Reader` contract: `plan` fetches the centre's course list (category or search-word page) and selects the detail pages of its dated Einbürgerungstest rows; `parse` builds one listing per such row from the list row's flags plus its detail page. Commit real saved pages as fixtures, and fix the directory so every ITEM KG centre has a verified `test_page_url` and `reader_config`.

## Boundaries & Constraints

**Always:**
- Contract (AD-4): `plan`/`parse` pure; cheerio `load()` only; no I/O, no clock other than `ctx.runAt`; failures returned as values, never thrown; imports from `shared/` only (plus `cheerio`). Helpers shared with KuferWeb are copied, not imported across readers.
- Test rows (one rule used by both `plan` and `parse`): in every list page, each `.course-item` whose `.course-title` text matches `/einb(ü|ue)rgerungstest/i` and not `/vorbereitung/i`, whose `.course-list-item-date` holds a `D.M.YYYY` date (rows with an empty or missing date element are "dates on request" and are skipped), and whose `a.card-list-item[href]` resolves (against the list page's `finalUrl ?? url`, fragment dropped) to an http(s) URL. List pages with `html: null` give no rows.
- `plan(centre)`: `listUrls = [reader_config?.list_url ?? test_page_url]` (empty when both null); `selectDetailUrls` = the test rows' URLs in page order; `maxDetailPages = 30` (exported `ITEMKG_MAX_DETAIL_PAGES`).
- `parse` order: (1) any list page without html or without `#category-courses, .category-courses-container` → `failed('structure-missing')`; (2) no test rows → `ok []`; (3) a test row without a matching detail page (by URL), or whose detail page is non-2xx or `html: null` → `failed('detail-page')`; (4) a detail page without `.course-show-wrap` → `failed('structure-missing')`; (5) a row date that does not parse to a real date, or no start time (row time, else the detail `Start` block's `HH:MM Uhr` on the same date) → `failed('date-unparseable')`; else one listing per test row, in row order.
- Flags: read from the row's `i.bk-icon` classes (else the detail page's first `.course-show-wrap i.bk-icon`): type `bk-bookable|bk-byphone|bk-written|bk-inperson|bk-notbookable`, availability `bk-av-enough|bk-av-few|bk-av-soldout`, reasons `bk-rs-*`.
- `registration_method`, first match wins: type `bk-bookable` → `online`; type `bk-inperson` → `in_person`; type `bk-written` with class `bk-hint-e-mail_registration` → `email`; registration text (row `.bk-text`, row `.course-content`, detail `.course-show-wrap` text, read per sentence) with an in-person-only phrase (`nur persönlich`, `ausschließlich persönlich`, `Anmeldung erfolgt persönlich`, `Persönliche Anmeldung`, `nur persönliche Anmeldung`, `persönlich entgegengenommen`) in a sentence about `Anmeld…` → `in_person`; `Anmeld…` + `per (E-)?Mail` → `email`; `Anmeld…` + `per Post|postalisch` → `post`; else `null`.
- `status` via `mapStatus` (FR10): registration in person only (`registration_method === 'in_person'`) → no flag signal; otherwise `bookedOut` for type `bk-notbookable` or `bk-av-soldout`, `free` for type `bk-bookable|bk-byphone|bk-written` with `bk-av-enough|bk-av-few` and no `bk-rs-registrationdeadlineexpired|coursecompleted|coursealreadystarted`; `waitlist` for a waitlist offer (`Warteliste` in the row or detail text, not negated by `kein(e)/nicht` within 25 chars before or `voll|geschlossen|nicht` right after) together with `bookedOut`. No icon → `unknown`.
- `place`/`address`: from the detail page's first `.venueContainer`: `place` = `.venueName`, plus `, Raum <n>` when `.venueNumber` (minus a leading `Raum`) is not already in it; `address` = `"<.venueStreet>, <.venueCity>"` when the city starts with a 5-digit postcode, else `null`. No venue → `place` = row `.course-list-item-location` text or `null`, `address` = `null`.
- `deadline`: first real date in detail text, then row text, matching `Anmeldeschluss[:]? [ist der|am] D.M.YY(YY)` or `Anmeldung [und Beratung] bis [zum|spätestens] D.M.YYYY`; else `null`.
- `eligibility`: first leaf block (`p, li, td, dd, div/span` without block children) matching `\b(Haupt)?Wohnsitz\b|\bwohnhaft\b|\b(nur|ausschließlich) für\b|(nur|ausschließlich)\b … Teilnehmende` (not `Merkliste|eingeloggt`), first in the detail `.course-show-wrap`, else in the list page outside every `.course-item`, `header`, `nav`, `footer`; verbatim via `clampEligibility`; none → `null`.
- `source_url`: the detail page's `finalUrl ?? url`.
- Fixtures are real pages saved on 2026-10-29 with the bot client (robots.txt respected), committed unmodified. Cases no live page shows (a residence rule, a waitlist offer, a start time for MVHS) are made by string edits of a real fixture inside the test, never as committed files.

**Never:**
- No change to `shared/`, fetch, stages, KuferWeb or the workflow; no wiring into `run.ts` (Story 2.6).
- No instructor names or other personal data in output; no fees/documents in `eligibility`.
- No guessed values: no start time invented for all-day or time-less sessions (MVHS fails the centre instead).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Free + booked out | Starnberg list + 6 details (`bk-byphone`, "Anmeldung nur per Mail oder persönlich") | 6 listings, `email`; 2 `bk-av-soldout` → `booked_out`, 4 → `free` | none |
| In person | Bad Kissingen list + 3 details ("Persönliche Anmeldung", `bk-inperson`) | 3 listings, `in_person`, `unknown` (AC Kissingen) | none |
| In person by text, negated waitlist | Erding list + 5 (`bk-inperson`, soldout, "keine Warteliste") | 5 listings `in_person`, `unknown`, none `waitlist` | none |
| Deadline | Roth (search page) + 2 details ("Anmeldung bis 22.10.2026 nur persönlich") | `deadline: 2026-10-22`, `in_person`, place `Landwirtschaftsschule, Aula` | none |
| Email, mixed category | Ebersberg (`bk-written` + e-mail hint) / Würzburg (telc rows skipped) | Ebersberg 1 `free` `email`; Würzburg 5 listings only | none |
| Waitlist | Starnberg booked-out row/detail edited to "Anmeldung auf die Warteliste möglich" | `waitlist` | none |
| No start time | MVHS Einbürgerung category (rows "Fr. 04.12.2026", detail "00:00 - 23:59 Uhr") | `failed('date-unparseable')`; prep course "Geschichte und Politik" not a test row | value |
| Rule | MVHS fixtures edited: row time added, rule paragraph added to detail | `eligibility` = the paragraph | none |
| No dated tests | Bamberg (empty course list) / Bamberg-Land (row without date) | `ok []` | none |
| Structure missing | Donauwörth info page `/einbuergerungstests` as list page | `failed('structure-missing')` | value |
| Detail failed | a selected detail page `status: 404, html: null` | `failed('detail-page')` | value |

</intent-contract>

## Code Map

- `shared/reader.ts` -- `Reader`, `ReaderPlan`, `FetchedPage` (`finalUrl`), `ParseResult`, `selectDetailUrls` (dedupe + cap), `checkParseResult`; implement against these unchanged.
- `shared/listing.ts` -- `RawListing` (strict; `time` required `HH:mm`), `mapStatus`, `clampEligibility`, `isLocalDate`; reuse.
- `shared/directory.ts` -- `Centre`, `readerConfigSchema = {list_url}` (strict).
- `pipeline/readers/kuferweb/index.ts` -- pattern to copy: block-aware leaf text, eligibility search, deadline/date parsing, header doc comment style.
- `pipeline/readers/kuferweb/kuferweb.test.ts` -- test layout to mirror (`centre()` helper, `FixtureCentre`, edited-fixture helper writing to a temp dir, `directory` block parsing the note table).
- `pipeline/readers/fixture-runner.ts` -- `runReaderOnFixtures`; URL → `{file}` map; throws on an unmapped URL.
- `tests/reader-contract.test.ts`, `tests/import-rules.test.ts` -- reader clock rule and readers → shared only; the new reader must pass both.
- `data/directory/centres.json` -- 20 `itemkg` entries + `vhs-bad-kisingen-und-hammelburg` (reader `none`, website null); canonical form (sorted, tab-indented); `npm run check:directory`.
- Saved pages (this planning run, scratchpad `/private/tmp/claude-502/-Users-eleni-Workspace-bgtsearch/a71168ef-b13a-4b59-a5b7-bfab7a16917d/scratchpad/`): list pages `ik/<centre_id>.html`, `ik/kisshab-cat.html`, `ik/mvhs-einb.html`, `ik3/{roth-s,donau-s,arberland-s,kelheim-s,beilngries}.html`; detail pages `ikd/<prefix>--C-<id>.html` (prefix = list file name; the detail URL is the row link on that list page); `*-meta.json` files hold each page's URL. `grab.ts` there is the bot-client fetch script.
- Planning findings (2026-10-29, all list URLs below answered 200 with a course-list container): ITEM KG course URLs are `/p|/kurse/…-<NNN>-C-<id>`, categories `…-<NNN>-CAT-KAT<n>`. No Einbürgerungstest row on any site is `bk-bookable` (online). MVHS publishes no start time and no residence rule today. Bamberg lists no test right now; Bamberg-Land's test row has no date.

## Tasks & Acceptance

**Execution:**
- `pipeline/readers/itemkg/fixtures/` -- copy saved pages unmodified as `<short-name>/list.html` and `<short-name>/<course-id>.html` for starnberg (6), kissingen (3), erding (5), roth (2), ebersberg (1), wuerzburg (5), mvhs (2), plus `bamberg/list.html`, `bamberg-land/list.html`, `structure-missing/list.html` (Donauwörth `/einbuergerungstests`); `README.md` listing each file's source URL, fetch date and what it covers.
- `pipeline/readers/itemkg/index.ts` -- export `itemkgReader: Reader`, `ITEMKG_MAX_DETAIL_PAGES` and the pure helpers the tests need (flags → signals, registration method), implementing the rules above.
- `pipeline/readers/itemkg/itemkg.test.ts` -- per fixture centre the full expected listing array, hand-checked against the page; every matrix row; plan tests (list URL choice, title/date filter, relative links against `finalUrl`, cap); flag → status table (free/booked_out/waitlist/unknown, in-person override, negated waitlist); registration-method table; Straubing-style "Erstwohnsitz" and "Wohnsitznachweis" are no rule; schema-valid output via `checkParseResult`; directory consistency with `itemkg-note.md`.
- `data/directory/centres.json` -- for all 21 ITEM KG centres set `reader: 'itemkg'`, `reader_config: {list_url: <test_page_url>}`, `verified_at: '2026-10-29T12:00:00.000Z'`; `test_page_url` changes: MVHS → `https://www.mvhs.de/kurse/deutsch-integration/pruefungen-einbuergerung/einbuergerung-460-CAT-KAT7868`; Beilngries → `https://www.vhs-beilngries.de/p/sprachen/deutsch-integration-641-CAT-KAT17`; Arberland, Kelheim, Donauwörth, Roth → `<site>/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest`; Bad Kissingen → reader `itemkg`, website `https://www.vhs-kisshab.de/`, test page `https://www.vhs-kisshab.de/p/integration/einbuergerungstest-675-CAT-KAT77`; all others unchanged.
- `data/directory/itemkg-note.md` -- the confirmed ITEM KG centres (id, test page, date checked) in the KuferWeb note's table format, the URL changes with reasons, and the MVHS findings (no start time, no residence rule published).

**Acceptance Criteria:**
- Given the committed fixtures of at least three ITEM KG centres, when the reader parses them through `runReaderOnFixtures`, then each dated Einbürgerungstest row yields a schema-valid `RawListing` equal to the hand-checked expected value in the test.
- Given the MVHS fixtures edited to carry a residence-rule paragraph (and a start time), and a real fixture without a rule, when parsed, then `eligibility` is that verbatim paragraph and `null` respectively.
- Given the directory, when `npm run check:directory` runs, then it passes and every `itemkg` centre has a non-null `test_page_url`, `reader_config.list_url` equal to it and `verified_at`, matching `itemkg-note.md`.
- Given the whole repo, when `npm run typecheck` and `npm test` run, then both pass, including import rules and the reader clock rule.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 34 findings — high 0, medium 3, low 19, false 9, maybe-false 3
- findings:
  - `[low]` `[patch]` (verification) Detail-page `i.bk-icon` fallback never exercised — added edited Ebersberg test with only the row icon removed → `free`, `email`.
  - `[low]` `[patch]` (verification) header/nav/footer exclusion of the list-page rule never tested — added edited Starnberg tests with a "nur für" footer and nav → all `eligibility` null.
  - `[false]` `[reject]` (edge) Rows beyond the 30 cap fail the centre — deliberate (Design Notes): failing loudly avoids tombstoning dates in merge.
  - `[low]` `[patch]` (edge) Two-digit row year silently dropped — grouped with the blind date-format finding; same fix.
  - `[low]` `[patch]` (edge) "00:00" accepted as a start time — 00:00 now counts as no time (falls to the Start block, then `date-unparseable`); tests added.
  - `[low]` `[patch]` (edge) Sentence split after "22.10." loses `in_person` — no split after a digit-period; table row added.
  - `[low]` `[patch]` (edge) Negation look-back crosses sentences ("keine Kosten. Warteliste möglich") — look-back cut at the last sentence/line end; tests added.
  - `[maybe-false]` `[defer]` (edge) Eligibility pattern catches non-rule "Wohnsitz"/"nur für" text — pattern fixed by the contract; no fetched page has such text; deferred medium (unverified).
  - `[low]` `[patch]` (edge) Room number substring check — whole-token check (`containsToken`); test added.
  - `[false]` `[reject]` (edge) No list URLs → `ok []` — `fetchCentre` (2.2) returns `failed('reader-error')` for empty `listUrls`; `parse` is never called.
  - `[false]` `[reject]` (edge) "Test Leben in Deutschland" titles skipped — the LiD test is a different exam (integration course), excluded on purpose (Cham fixture planning).
  - `[low]` `[patch]` (blind) Start block range "15:30 - 17:00 Uhr" gives 17:00 — first `HH:MM` after the date now wins; test added.
  - `[low]` `[patch]` (blind) "00:00" all-day time — grouped with the edge finding; same fix.
  - `[low]` `[patch]` (blind) Non-D.M.YYYY date text silently skipped — rows are skipped only for a missing/empty date element; otherwise `date-unparseable`; test added.
  - `[maybe-false]` `[defer]` (blind) No pagination guard — no test category seen beyond one page; deferred medium (unverified).
  - `[low]` `[reject]` (blind) Soft hyphen in titles — no fetched page has one; fix adds normalisation for an unseen state.
  - `[low]` `[patch]` (blind) Plural "Wartelisten werden nicht geführt" counted as an offer — `Wartelisten?` with `sind/werden` in the after-check; test added.
  - `[low]` `[patch]` (blind) Room substring check — grouped with the edge finding; same fix.
  - `[maybe-false]` `[defer]` (blind) Eligibility too broad, aside/banners searched — grouped with the edge eligibility finding.
  - `[low]` `[reject]` (blind) Deadline not checked against the test date — no page shows a later or unrelated deadline; the check adds a branch for an unseen state.
  - `[low]` `[reject]` (blind) Untested branches: multiple list pages, shared detail pages — plan always yields one list URL; no page links two rows to one detail page. Icon fallback grouped with the verification finding (patched).
  - `[false]` `[reject]` (blind) Non-2xx list page with a container read as data — `fetchCentre` (2.2) fails a non-2xx list page before `parse`.
  - `[low]` `[reject]` (blind) New list URLs have no fixtures — the planning run's saved pages for Beilngries (8 rows), Arberland (2), Kelheim (3), Donauwörth (3) were run through `selectDetailUrls` and Regensburg (10) end to end through `parse` during verification; the AC needs 3 fixture centres (7 given).
  - `[low]` `[reject]` (blind) cHash URLs may go stale — each answered 200 with the course list on 2026-10-29; a stale URL fails loudly as `structure-missing`/fetch failure.
  - `[low]` `[reject]` (blind) `verified_at` overwritten with one timestamp — every ITEM KG list URL was re-checked in the 2026-10-29 planning run, so the new date supersedes the old one; recorded in `itemkg-note.md`.
  - `[low]` `[reject]` (blind) Fixture count 35 vs 34 — the miscount was in the review diff header only (34 HTML + README); nothing in the repo.
  - `[low]` `[reject]` (blind) Directory test hard-codes 21 — a deliberate guard against silently losing entries; low.
  - `[low]` `[reject]` (blind) Phone registration unmodelled — `RegistrationMethod` has no phone value (shared contract, out of scope); `null` shows "unknown". Noted as a residual risk.
  - `[false]` `[reject]` (blind) Past dates emitted — publish drops past dates and the browser hides them (epic Requirements).
  - `[medium]` `[defer]` (intent) MVHS yields no dates — needs an unknown-time listing (shared contract, Story 2.5); deferred.
  - `[medium]` `[reject]` (intent) MVHS rule met only by an in-test edit — MVHS no longer publishes the rule (checked on all MVHS test pages 2026-10-29); the edit follows the 2.3 precedent for cases no live page shows; recorded in `itemkg-note.md`.
  - `[false]` `[reject]` (intent) Status from CSS classes instead of a "bookable" flag — ITEM KG renders its bookable/availability flags as these classes; there is no other flag on the page.
  - `[false]` `[reject]` (intent) URL pattern differs from the story wording — `-CAT-KAT` URLs are category (list) pages on every site; `-C-` are course detail pages.
  - `[false]` `[reject]` (intent) "Verified" not tested live — tests never touch the network; verification is the recorded planning-run check.
  - `[low]` `[reject]` (intent) Length cap untested here — `clampEligibility` is covered by `tests/listing.test.ts`.

## Design Notes

- List rows carry the only uniform flag source: every site renders the same `.course-item` card with `i.bk-icon` classes, while detail templates differ (MVHS has no venue block, no `Start` block and no `bk-icon`). Detail pages add time fallback, venue, deadline, registration text, eligibility and `link_ok`.
- `bk-byphone` is common but its page text usually says registration is in person (Würzburg, Roth, MVHS); deriving "in person only" from `registration_method` applies FR10's in-person → `unknown` rule to those too. Consequence: only Starnberg and Ebersberg fixtures produce `free`/`booked_out`.
- A failed detail page or a row beyond the cap fails the centre, as in KuferWeb, so an `ok` run never drops a date that merge (2.5) would tombstone.
- MVHS fails with `date-unparseable` until `RawListing` can carry an unknown time; that is a contract decision for Story 2.5, not this reader.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all suites pass, including `pipeline/readers/itemkg/itemkg.test.ts`, `import-rules`, `reader-contract`
- `npm run check:directory` -- expected: `<n> centres OK`

## Auto Run Result

Status: done

**Summary:** Added the ITEM KG reader. `plan` reads the centre's course list (category or search-word page) and picks the detail pages of its dated Einbürgerungstest rows (title filter, prep courses and telc/LiD exams skipped, cap 30). `parse` builds one `RawListing` per row: date and time from the row (Start block fallback, 00:00 is no time), status from the ITEM KG `bk-icon` flags (in-person registration → unknown, sold out / not bookable → booked out, bookable with seats → free, waitlist offer on a booked-out date → waitlist), room and address from the venue block, deadline, registration method and the verbatim who-may-register rule. Unknown structures, failed detail pages and unreadable dates fail the centre as values. All 21 ITEM KG centres now have a verified test page and `reader_config`; Bad Kissingen moved from `none` to ITEM KG.

**Files changed:**
- `pipeline/readers/itemkg/index.ts` — the reader (`itemkgReader`, `ITEMKG_MAX_DETAIL_PAGES`, flag/status/registration/waitlist helpers).
- `pipeline/readers/itemkg/itemkg.test.ts` — 86 tests: full listings for 6 real centres, every matrix row, plan, flag/status and registration tables, edited-fixture field rules, directory consistency.
- `pipeline/readers/itemkg/fixtures/` — 34 real pages saved 2026-10-29 (starnberg, kissingen, erding, roth, ebersberg, wuerzburg, mvhs, bamberg, bamberg-land, structure-missing) plus `README.md` (4.9 MB).
- `data/directory/centres.json` — 21 ITEM KG centres with `reader_config.list_url`, `verified_at`; new test pages for MVHS, Beilngries, Arberland, Kelheim, Donauwörth, Roth; Bad Kissingen switched to `itemkg`.
- `data/directory/itemkg-note.md` — confirmed centres, URL changes with reasons, MVHS findings.

**Review:** one pass, 34 findings (medium 3, low 19, false 9, maybe-false 3, high 0). Patched 9 entries (all low): Start-block range time, 00:00 placeholder, non-date row text fails loudly, plural/negated waitlist (2), sentence split after "22.10.", room-number token check, two missing tests (detail icon fallback, header/nav/footer exclusion). Deferred 3: pagination, broad eligibility pattern (both maybe-false, medium if true), MVHS no start time (medium, needs a shared contract change in 2.5). All rejected findings and reasons are in the triage log.

**Follow-up review recommended:** false. No high or medium entry was patched. Patched counts: high 0, medium 0, low 9.

**Verification:** `npm run typecheck` — clean. `npm test` — 26 files, 978 passed, 1 skipped (pre-existing, `tests/places.test.ts`). `npm run check:directory` — 119 centres OK. Extra: saved Regensburg pages (10 dates, not committed) parse `ok` end to end; row selection checked on the saved pages of 12 unfixtured centres.

**Residual risks:**
- MVHS shows "Not checked right now" until a listing may have an unknown time (deferred to 2.5).
- The MVHS residence rule named in the AC is no longer published; it is tested by an in-test edit.
- Most dates map to `unknown`: nearly every centre registers in person; only Starnberg and Ebersberg fixtures yield free/booked out.
- `bk-byphone` registration without in-person/e-mail wording gives `registration_method: null` (no phone value in the contract).
- Bad Kissingen's "cash only" is not stated on its pages today; it yields `in_person`.
- Arberland, Kelheim, Donauwörth and Roth use search-word URLs; 12 confirmed centres have no committed fixture.
- Fixtures contain instructor names as published; reader output never does.
