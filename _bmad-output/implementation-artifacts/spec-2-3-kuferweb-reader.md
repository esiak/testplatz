---
title: 'Story 2.3: KuferWeb reader'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: 'b8ab0252d863eaea1b4f97326830f3dfebce9ae3'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-2-polite-collection-rules.md'
warnings: [oversized]
deferred:
  - summary: >-
      The list-page eligibility fallback searches the content column around the course list, wider than the contract's "course-list container".
    evidence: |-
      Needed so Aichach's real rule ("Voraussetzung: Wohnsitz in Bayern!") is found (matrix row 1, AC). Whether it also picks up unrelated "nur für" / "Wohnsitz" text needs more live KuferWeb pages; the contract wording should be aligned in a later spec change.
    location: >-
      pipeline/readers/kuferweb/index.ts listRuleScope
    severity: medium (unverified)
  - summary: >-
      An ok run with zero listings cannot be told apart from a test page that moved to another page that still has a course list.
    evidence: |-
      Would tombstone a centre's dates in merge (2.5). Settled by a real example of a KuferWeb test page moving or redirecting to a page with a course list.
    location: >-
      pipeline/readers/kuferweb/index.ts parse step 2
    severity: medium (unverified)
  - summary: >-
      A preparation course whose title names the Einbürgerungstest would pass the title filter and be listed as a test date.
    evidence: |-
      No fetched KuferWeb page has such a course; the filter is fixed by the intent-contract, so excluding "Vorbereitung" needs a spec decision. Settled by finding such a course on a covered centre.
    location: >-
      pipeline/readers/kuferweb/index.ts TEST_TITLE
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** About a dozen Bavarian centres publish their Einbürgerungstest dates through KuferWeb (TYPO3 "webbasys"), but there is no reader for it, so the pipeline cannot turn their pages into `RawListing`s; several KuferWeb directory entries also lack a working test page.

**Approach:** Add `pipeline/readers/kuferweb/` implementing the Story 2.1 `Reader` contract: `plan` fetches the centre's test (category) page and selects the Einbürgerungstest course detail pages; `parse` reads one listing per detail page from the KuferWeb detail template, mapping status, deadline, registration method and eligibility. Commit real saved pages as fixtures, and fix the directory so every remaining `kuferweb` centre has a working `test_page_url`.

## Boundaries & Constraints

**Always:**
- Contract (AD-4): `plan`/`parse` pure; cheerio `load()` only; no I/O, no clock other than `ctx.runAt`; failures returned as values, never thrown; imports from `shared/` only (plus `cheerio`).
- `plan(centre)`: `listUrls = [reader_config?.list_url ?? test_page_url]` (empty when both null); `maxDetailPages = 30` (constant in the reader); `selectDetailUrls` returns absolute http(s) URLs of `a[href]` whose pathname contains `/kurs/` and whose decoded path segment right after `/kurs/` matches `/einb(ue|ü)rger/i` (title filter, so mixed language categories and category names containing "Einbürgerung" do not pull in other courses), resolved against each list page's `finalUrl ?? url`, list pages with `html: null` ignored.
- `parse` order: (1) any list page without html or without a KuferWeb course-list container (`.kw-kursuebersicht, .kw-kat-kurs-ueb, .hauptseite_kurse`) → `failed('structure-missing')`; (2) no selected test links → `ok` with `[]`; (3) any detail page with non-2xx status or `html: null` → `failed('detail-page')`; (4) any detail page without `.kw-kursdetails` → `failed('structure-missing')`; (5) any detail page whose start date or time cannot be read → `failed('date-unparseable')`; else one listing per detail page, in detail-page order.
- Field rules (all read inside `.kw-kursdetails`; text compared after whitespace collapse):
  - `date`/`time`: from the `Beginn`/`Kursbeginn` label (`Beginn Mi., 2.12.2026, 14:00 Uhr`, `um 08:00`, `13.00 Uhr`, 2- or 4-digit year → 20YY); a missing time there is taken from the first row of `.kw-kurstageuebersicht` with that date; no `Beginn` → date and time from that table's first row.
  - `place`/`address`: from the block after the `Kursort` label (exact label line, or inline `Kursort: …`), up to the next label: a line or line pair `<street> <house no.>` + `<5-digit postcode> <city>` gives `address` as `"<street>, <postcode> <city>"`; the first remaining line before it (not `Adresse:`) is `place`. No Kursort block → `place` = the first session row's location cell. `address` falls back to a `<street no.>, <postcode city>` tail of that location cell; otherwise `null`. Never guessed from the centre address (normalise does that).
  - `status` via `mapStatus` from shared signals: list-row and detail traffic light labels/classes (`Plätze frei`, `Anmeldung möglich` (not preceded by "Keine"), `wenige Plätze` → free; `ausgebucht`/`voll` label or class `ausgebucht` → bookedOut; `Warteliste` label not negated → waitlist); detail/title text: upper-case `AUSGEBUCHT` or `ist/sind (bereits|leider|schon)? ausgebucht` → bookedOut; a body waitlist offer (`Anmeldung auf (die) Warteliste`, `auf die Warteliste`, `Warteliste (ist) möglich`) counts only together with bookedOut. "Keine (Online-)Anmeldung möglich" / "nicht buchbar" is no signal → `unknown`.
  - `deadline`: first `Anmeldeschluss[:]? [ist am] D.M.YY(YY)` or `Anmeldung bis [zum] D.M.YYYY` that is a real date; else `null`.
  - `registration_method`: `in_person` for `nur persönlich` / `ausschließlich persönlich` / `Anmeldung erfolgt (nur) persönlich`; else `online` when the detail page offers an "In den Warenkorb" control; else `email` / `post` for `Anmeldung … per E-Mail` / `per Post|postalisch`; else `null`.
  - `eligibility`: the first leaf block (`p, li, td, dd, div/span` without block children) whose text matches `Hauptwohnsitz|Wohnsitz|wohnhaft|nur für|(nur|ausschließlich) … Teilnehmende` and not `Merkliste|eingeloggt`, first in the detail page's `.kw-kursdetails`, else in the list page's course-list container; verbatim via `clampEligibility`; none → `null`.
  - `source_url`: the detail page's `finalUrl ?? url`.
- Fixtures are real pages saved on 2026-10-28 with the bot client (robots.txt respected), committed unmodified; status cases that no live page shows (waitlist, full light) are tested by string-edits of a real fixture inside the test, never as committed synthetic files.

**Never:**
- No change to `shared/` contracts, fetch, stages or the workflow; no wiring into `run.ts` (Story 2.6); no ITEM KG work (2.4).
- No instructor names or other personal data in output; no fees/documents in `eligibility`.
- No search-form URLs as list pages.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | Aichach list + 5 detail pages | 5 listings; 3 `booked_out` (`AUSGEBUCHT` title), eligibility "Voraussetzung: Wohnsitz in Bayern!" | none |
| Free + booked | Taufkirchen list + 5 detail pages | 262-30122 `free`, `online`; "Termin ist ausgebucht" ones `booked_out` | none |
| Negated waitlist | VHS Nord-style "ausgebucht. Eine Warteliste ist nicht möglich." | `booked_out`, not `waitlist` | none |
| Waitlist | list-row light label edited to "Anmeldung auf Warteliste" | `waitlist` | none |
| Mixed category | Mühldorf list with DaF courses + 1 test | 1 listing only | none |
| No test dates | course list (Mainburg Sprachen) without test links | `ok`, `[]` | none |
| Structure missing | KuferWeb homepage (Neumarkt) as list page | `failed('structure-missing')` | value, not throw |
| Detail failed | a selected detail page `status: 404, html: null` | `failed('detail-page')` | value |
| No plan URL | `test_page_url` and `reader_config` null | `listUrls: []` | fetch fails it (2.2) |

</intent-contract>

## Code Map

- `shared/reader.ts` -- `Reader`, `ReaderPlan`, `FetchedPage` (`finalUrl`), `ParseResult`; implement against these unchanged.
- `shared/listing.ts` -- `RawListing` (strict, nullable optionals), `mapStatus(StatusSignals)`, `clampEligibility` (500 chars), `isLocalDate`; reuse, do not re-implement.
- `shared/directory.ts` -- `Centre`, `readerConfigSchema = {list_url}` (strict; no new keys).
- `pipeline/readers/fixture-runner.ts` -- `runReaderOnFixtures(reader, centre, fixtures, ctx, fixturesDir)`; fixture map is URL → `{file}`; throws on an unmapped URL.
- `pipeline/readers/.gitkeep` -- remove once the reader directory exists.
- `tests/reader-contract.test.ts:258` -- scans `pipeline/readers/**/*.ts` for `Date.now()`/`new Date()`; the reader must pass it.
- `tests/import-rules.test.ts` -- readers may import only `shared` (and packages).
- `data/directory/centres.json` -- 16 `kuferweb` entries; edit in canonical form (sorted, tab-indented); validate with `npm run check:directory`.
- Saved pages (scratchpad, from this planning run): `/private/tmp/claude-502/-Users-eleni-Workspace-bgtsearch/0084ccd9-358c-4574-853e-3d58c4fe352f/scratchpad/kw/<centre_id>.html` (list pages), `.../kwd/<centre_id>--<n>.html` (detail pages; the URL of each is its `/kurs/` link on the list page), `.../home/mainburg-2.html` (no-tests list), `.../home/neumarkt.html` (structure missing).
- Directory findings (2026-10-28): Rottenburg's course URL 404s, the test is listed on `https://www.vhs-rottenburg-laaber.de/kurse/sprachen`; Burghausen's robots.txt disallows the bot; Neumarkt, Mainburg and Trostberg list no Einbürgerungstest on their programme pages (search is robots-disallowed).

## Tasks & Acceptance

**Execution:**
- `pipeline/readers/kuferweb/fixtures/` -- copy the saved pages unmodified as `<short-name>/list.html` and `<short-name>/<course-no>.html` for aichach (5), taufkirchen (5), moosburg (2), traunreut (2), straubing (1), muehldorf (1), plus `no-tests/list.html` and `structure-missing/list.html`; add `README.md` listing each file's source URL, fetch date and what it covers -- real pages per AC.
- `pipeline/readers/kuferweb/index.ts` -- export `kuferwebReader: Reader` (`plan`, `parse`) and `KUFERWEB_MAX_DETAIL_PAGES`, implementing the rules above with small helpers (block-aware text lines, label lookup, date/time parse, status signals) -- the reader.
- `pipeline/readers/kuferweb/kuferweb.test.ts` -- per fixture centre, run `runReaderOnFixtures` and assert the full expected listing array, hand-checked against the page text; plan tests (list URL choice, title filter, relative link resolution against `finalUrl`, cap); every matrix row; status mapping table (free/booked_out/waitlist/unknown, negated waitlist, body waitlist without bookedOut stays not-waitlist); eligibility with and without rule; schema-valid output via `checkParseResult` -- proves the ACs.
- `data/directory/centres.json` -- Rottenburg `test_page_url` → `https://www.vhs-rottenburg-laaber.de/kurse/sprachen`; Burghausen, Neumarkt, Mainburg, Trostberg → `reader: 'none'`, `reader_config: null`; set `verified_at` to `2026-10-28T19:30:00.000Z` (the planning-run check) for every remaining `kuferweb` centre (all 12 answered 200 then) -- AC directory.
- `data/directory/kuferweb-note.md` -- the confirmed KuferWeb centres (id, test page, date checked) and each centre moved to `none` with the reason -- recorded list.

**Acceptance Criteria:**
- Given the committed fixtures of at least three KuferWeb centres, when the reader parses them through `runReaderOnFixtures`, then each Einbürgerungstest date yields a schema-valid `RawListing` whose fields equal the hand-checked expected values in the test.
- Given the Aichach fixtures (rule) and a fixture centre without a rule, when parsed, then `eligibility` is the verbatim rule paragraph and `null` respectively.
- Given the directory, when `npm run check:directory` runs, then it passes and every `kuferweb` centre has a non-null `test_page_url` and `verified_at`, matching `kuferweb-note.md`.
- Given the whole repo, when `npm run typecheck` and `npm test` run, then both pass, including import rules and the reader clock rule.

## Spec Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 50 findings — high 0, medium 1, low 31, false 12, maybe-false 6
- findings:
  - `[low]` `[reject]` (blind) 30-page cap drops dates silently when a list has more test links — no centre comes close (max seen 8); the guard adds a branch for a state never shown.
  - `[medium]` `[patch]` (blind) Session-table `place` taken from the last cell, so an instructor column after Ort would leak a name — location now read from the cell labelled `Ort`/`Wo` (or `headers` ending in `ort`); test with an added instructor column.
  - `[low]` `[patch]` (blind) No test for the no-Kursort path — added edited-fixture test: place from the Ort cell, address from its street/postcode tail.
  - `[false]` `[reject]` (blind) A status legend matched by `[class*="ampel"]` turns every date into waitlist — Moosburg's real legend uses classes `legend`/`k-buchbar`; no legend element carries an `ampel` class in any fixture.
  - `[low]` `[patch]` (blind) "Warteliste voll" read as waitlist — negation extended to voll/ausgebucht/geschlossen; status-table rows added.
  - `[low]` `[patch]` (blind) `in_person` matched any "nur persönlich" and outranked a cart control — now needs `Anmeld` earlier in the same sentence and no `nicht` before `nur`; negative tests added.
  - `[low]` `[reject]` (blind) "Anmeldung bis" accepts only 4-digit years — the intent-contract states `D.M.YYYY` for that form; no page shows a 2-digit one.
  - `[maybe-false]` `[defer]` (blind) List-page rule search covers the `#content`/`main` column, wider than the contract's "course-list container" — needed for Aichach's real rule (matrix row 1); whether it picks up unrelated "nur für"/"Wohnsitz" text needs more live pages.
  - `[maybe-false]` `[defer]` (blind) `ok []` cannot be told from a test page that moved — a moved page that keeps a course list would tombstone dates; needs a real moved KuferWeb page to settle.
  - `[low]` `[reject]` (blind) Only 6 of 12 confirmed centres have fixtures — the AC requires 3; 6 themes are covered.
  - `[low]` `[reject]` (blind) Instructor names in the committed fixtures — the contract requires unmodified real pages; the names are public on those pages and no reader output contains them (schema rejects extra keys). Noted as a residual risk.
  - `[low]` `[reject]` (blind) `labelValue` 3-line limit and unescaped `RegExp` — names are fixed constants without regex syntax that matters; the digit check was replaced by the Beginn patch.
  - `[low]` `[reject]` (blind) `INLINE_LABEL` would end a Kursort block at "Raum: 2.2" — no page shows such a line.
  - `[low]` `[patch]` (blind) Header comment says the list page is an Einbürgerungstest category — reworded to include wider language categories; README checked: Taufkirchen's address does come from the session cell.
  - `[false]` `[reject]` (blind) Diff incomplete — fixtures were left out on purpose (noted in the diff header) and the spec is the claims file.
  - `[false]` `[reject]` (edge) List page timeout reported as structure-missing — `fetchCentre` (2.2) fails a non-2xx/timed-out list page as `list-page` before `parse` runs.
  - `[false]` `[reject]` (edge) Non-2xx list body with a container parsed as valid — same: `parse` is never called for a failed list page.
  - `[false]` `[reject]` (edge) No list URLs → `ok []` — `fetchCentre` returns `failed('reader-error')` for empty `listUrls`.
  - `[low]` `[reject]` (edge) Test links outside the list container or on another host — a site's own nav links lead to its own test courses; no cross-host link seen.
  - `[maybe-false]` `[defer]` (edge) A "Vorbereitung … Einbürgerungstest" course would pass the title filter — no fetched page has one; the filter is fixed by the contract, so a change needs a spec decision.
  - `[low]` `[patch]` (edge) "Beginn der Anmeldung: 01.09.2026" read as the start — inline value must now start with a weekday or digit; test added.
  - `[low]` `[reject]` (edge) Beginn without a year fails the centre — a loud `date-unparseable` is correct behaviour; no page shows it.
  - `[false]` `[reject]` (edge) One unreadable page fails the whole centre — deliberate (Design Notes): dropping one date would tombstone it in merge.
  - `[low]` `[reject]` (edge) An invalid first time token ("25.00") hides a valid time — the Beginn value stops at the next label; no page shows it.
  - `[low]` `[reject]` (edge) "Raum 2.12" read as 02:12 when a row has no time cell — every row seen has a time cell.
  - `[low]` `[reject]` (edge) "9 Uhr" times unread — fails loudly as `date-unparseable`; no page shows it.
  - `[low]` `[reject]` (edge) Kursort block unbounded — lines come only from `.kw-kursdetails` and the next label stops the block.
  - `[low]` `[reject]` (edge) Empty Kursort block leaves `place` null — no page shows it.
  - `[low]` `[reject]` (edge) "Raum 2" above a postcode read as street — no page shows it.
  - `[low]` `[reject]` (edge) "Anmeldung bis 13.11.26" dropped — same as the blind finding; contract-defined.
  - `[low]` `[patch]` (edge) Waitlist offer negated after the match still counted — following `nicht/keine` within 25 chars now rejects it; Taufkirchen test added.
  - `[low]` `[patch]` (edge) "Warteliste voll/geschlossen" → waitlist — grouped with the blind finding; same fix.
  - `[false]` `[reject]` (edge) Legend inside the row/root gives every signal — grouped with the blind legend finding; refuted the same way.
  - `[low]` `[reject]` (edge) Row walk reaches the whole page for a single-course list outside the container — no page shows it.
  - `[low]` `[patch]` (edge) "Wohnsitznachweis" read as a residence rule — `Wohnsitz` no longer matches before `nachweis|bescheinigung`; negative test added. "nur für Anwohner" left as is (no page shows it).
  - `[maybe-false]` `[reject]` (edge) A mixed category's DaF rule attached to the test — if true only low; no mixed fixture has such text.
  - `[low]` `[patch]` (edge) "nicht nur persönlich" → in_person — grouped with the in_person fix.
  - `[low]` `[reject]` (edge) Disabled cart control read as online — no page shows a disabled cart control.
  - `[low]` `[patch]` (verification) Detail-page light never decides status in a test — added Taufkirchen test with a neutral list light; 262-30122 stays `free`.
  - `[low]` `[patch]` (verification) List link titles never decide booked-out in a test — added Aichach test with AUSGEBUCHT removed from one detail page; stays `booked_out`.
  - `[maybe-false]` `[defer]` (verification, other) List-page rule scope wider than the spec — grouped with the blind scope finding.
  - `[low]` `[reject]` (verification, other) Test name "full light … even with a free detail light" — the name is accurate; cosmetic.
  - `[false]` `[reject]` (intent) No user-visible effect — wiring into the run is Story 2.6 by the epic's build order.
  - `[low]` `[reject]` (intent) One listing per course, not per date; cap drops dates — every KuferWeb test course seen has one session; cap grouped with the blind finding.
  - `[false]` `[reject]` (intent) Thin "place" values (Moosburg `UG4`, Traunreut null) — `UG4` is the room as published; Traunreut's Kursort block has no room line.
  - `[maybe-false]` `[defer]` (intent) Eligibility fallback widened — grouped with the blind scope finding.
  - `[false]` `[reject]` (intent) Waitlist offer counted only with booked-out — data-sources.md: "booked out with a waitlist offer → waitlist".
  - `[false]` `[reject]` (intent) Aichach free dates come out `unknown` — their rows show no free light; "no indicator → unknown" (FR10).
  - `[false]` `[reject]` (intent) A failed detail page failing the centre goes beyond the AC — a deliberate design choice, not a defect.
  - `[low]` `[reject]` (intent) Directory "verified" rests on a recorded check; half the centres unfixtured — every test page answered 200 on 2026-10-28 (recorded in `kuferweb-note.md`); the AC requires 3 fixture centres.

## Design Notes

- Listings come from detail pages, not list rows: list templates differ per site theme (bootstrap rows, product tiles, tables), while every detail page seen shares `.kw-kursdetails`, the `Beginn`/`Kursort` labels and `.kw-kurstageuebersicht`. List rows are used only for links and traffic-light labels (walk up from the link while the ancestor holds one course URL).
- A failed detail page fails the centre instead of dropping that date: an `ok` run with a date missing would tombstone it in merge (2.5). Consequence: for KuferWeb, `link_ok` is effectively always true on `ok` runs.
- `Beginn` beats the session table when both give a time (Moosburg: `Beginn 15:00`, table `14:00 - 17:00`, list row `15.00 Uhr`).
- `Teilnehmende` alone is not a rule keyword ("Liebe Teilnehmende,", "Höchstteilnehmendenzahl"); only a restricting `nur/ausschließlich … Teilnehmende` is.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all suites pass, including `pipeline/readers/kuferweb/kuferweb.test.ts`, `import-rules`, `reader-contract`
- `npm run check:directory` -- expected: `<n> centres OK`

## Auto Run Result

Status: done

**Summary:** Added the KuferWeb reader. `plan` reads the centre's test page (`reader_config.list_url` or `test_page_url`) and picks the Einbürgerungstest course links (title filter, capped at 30). `parse` turns each course detail page into one `RawListing`: start date and time, room and address, status from traffic lights and "AUSGEBUCHT"/"ausgebucht" wording, deadline, registration method, and the verbatim who-may-register rule. Unknown page structures, failed detail pages and unreadable dates fail the centre as values. The directory now has a working test page and `verified_at` for every remaining KuferWeb centre.

**Files changed:**
- `pipeline/readers/kuferweb/index.ts` — the reader (`kuferwebReader`, `KUFERWEB_MAX_DETAIL_PAGES`, status helpers).
- `pipeline/readers/kuferweb/kuferweb.test.ts` — 72 tests: full listings for 6 real centres, every matrix row, status/eligibility/registration rules, plan rules, directory consistency.
- `pipeline/readers/kuferweb/fixtures/` — 23 real pages saved 2026-10-28 (aichach, taufkirchen, moosburg, traunreut, straubing, muehldorf, no-tests, structure-missing) plus `README.md`.
- `data/directory/centres.json` — Rottenburg test page → `/kurse/sprachen`; Burghausen (robots), Neumarkt, Mainburg, Trostberg (no test page found) → reader `none`; `verified_at` set on the 12 confirmed KuferWeb centres.
- `data/directory/kuferweb-note.md` — the confirmed KuferWeb centres and the four moved to `none`, with reasons.
- `pipeline/readers/.gitkeep` — removed.

**Departures from the spec text (made by the implementation, kept after review):** the list-page eligibility fallback searches the content column around the list (needed for Aichach's real rule; deferred for a spec change); "per E-Mail/per Post" must follow "Anmeldung" within 5 words; a `Beginn` value may wrap over up to 3 lines (Landshut).

**Review:** one pass, 50 findings (medium 1, low 31, false 12, maybe-false 6, high 0). Patched 8 entries (1 medium: session location from the Ort column; 7 low: closed-waitlist labels, negated waitlist offers, in-person wording anchored to "Anmeldung", "Beginn der Anmeldung" not read as the start, "Wohnsitznachweis" not a rule, three missing status/place tests, header comment). Deferred 3 (maybe-false, medium if true). All rejected findings and reasons are in the triage log.

**Follow-up review recommended:** false. One medium and no high finding was patched; every patch has a passing test. Patched counts: high 0, medium 1, low 7.

**Verification:** `npm run typecheck` — clean. `npm test` — 25 files, 892 passed, 1 skipped (pre-existing). `npm run check:directory` — 119 centres OK.

**Residual risks:**
- Six confirmed centres (Aschaffenburg, Gröbenzell, VHS Nord, Landshut, Unterallgäu, Rottenburg) have no committed fixture; a one-off run on saved pages parsed them without failure.
- Most fixture dates map to `unknown`: many sites show only "Keine (Online-)Anmeldung möglich" lights.
- Traunreut's room appears only in the session table, so its `place` is `null`.
- The committed fixtures are unmodified public pages and contain instructor names; reader output never does.
- Burghausen keeps its old `test_page_url` and `verified_at: null` now that it is reader `none`.
- For KuferWeb, `link_ok` will effectively always be true on `ok` runs (a failed detail page fails the centre) — Story 2.5 should know this.
