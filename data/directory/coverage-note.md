# Coverage note

Why centres do not parse, grouped by page shape, and what Story 4.4 did about it. Source: the
local coverage cache (`npm run coverage`, fetched 2026-11-01, `data/coverage/fetch-report.json`),
after the 9 reader assignments of commit 1db82c9. Coverage = (`parsed` + `parsed-empty`) /
(`parsed` + `parsed-empty` + `failed` + `no-reader`).

## Starting point

33 of 66 centres in the denominator parsed (50%); 90% needs 60. The 33 that did not:

| group | size | page shape |
|-------|------|------------|
| CMX | 18 | reader `none`; pages load `/cmx/interpreter/js/index.js`, ids `cmx<hex>` |
| KuferWeb near-misses | 5 | KuferWeb pages the reader missed |
| ITEM KG near-misses | 5 | ITEM KG pages the reader missed |
| Other | 5 | TYPO3 and WordPress layouts of their own, one JavaScript-rendered site |

## Order

1. Near-misses first: widen the existing readers (selectors, date formats), never special-case a
   centre; a cause that is not the reader's is recorded below with its evidence.
2. Then the largest new group, CMX (new reader `pipeline/readers/cmx/`).
3. The rest (5 "Other" centres) is left for a later story.

## Near-misses: diagnosis and outcome

### KuferWeb

| centre_id | was | diagnosis (from the cached pages) | outcome |
|-----------|-----|-----------------------------------|---------|
| `volkshochschule-eching-e-v` | `failed:date-unparseable` | Detail pages have no `Beginn` label and no session table; the date is a single `Termin` value, "Fr. 16.07.2027 (10:00 - 11:00 Uhr)". The Kursort link also carried a screen-reader hint ("- Mehr Details zum Raum öffnen"). | **Reader widened**: a single `Termin` value is the start when there is neither `Beginn` nor a session table; `.sr-only` / `.visually-hidden` text is left out of detail fields. Parses (8 listings). Fixture `kuferweb/fixtures/eching/`. |
| `vhs-landkreis-amberg-sulzbach` | structure-missing (now `failed:detail-page` as a candidate) | The test page (`/kurssuche/kurs/Einbuergerungstest/W40432S`) is itself a course detail page (`.kw-kursdetails`). Its font-size and dark-mode toggles (`…/W40432S?size=1`, `?dark-mode=1`) were taken as test-course links; robots.txt disallows them. | **Reader widened**: links back to the page itself are not course links; a list page that is itself an Einbürgerungstest course page is read as its own detail page. Parses (1 listing), proposal `kuferweb`. Fixture `kuferweb/fixtures/amberg/`. The test page names one course: when that course is over, the page goes; the operator should look for the category page before confirming. |
| `inlingua-sprachenschule-e-k` (Ingolstadt) | parsed-empty | KuferWeb without speaking URLs: course links are `?kathaupt=11&knr=…&kursname=Pruefung%20Einbuergerungstest`, not `/kurs/…`, so no test link was found. | **Reader widened**: a `kathaupt=11` link with a course number `knr` is a course link, its title is the `kursname` parameter. Six test courses now selected; their detail pages are not cached yet, so it is `failed:detail-page` until the next `--fetch`. Fixture `kuferweb/fixtures/ingolstadt/`. |
| `inlingua-sprachschule-u-c-bernau-gmbh` (München) | parsed-empty | Not the reader: the test page (`?id=2872&kathaupt=6&suchesetzen=true`) is page 1 of a search over all courses (English, French, Spanish …); no "Einbürger…" text anywhere on it. The `kuferweb` parsed-empty proposal is technically right but says nothing about test dates. | No reader change. Operator: find the Einbürgerungstest category URL (or confirm inlingua München offers no test) before applying the proposal. |
| `vhs-muehldorf-e-v` | `failed:detail-page` | Not the reader: of the two test detail pages, `…/Deutsch-Einbuergerungstest/E36901` answered **HTTP 500** on 2026-11-01 (`F36900` answered 200); the same page parsed in the committed fixture of 2026-10-28. | No reader change. Re-fetch with `npm run coverage -- --fetch --refresh` (or wait for the daily run). |

### ITEM KG

| centre_id | was | diagnosis | outcome |
|-----------|-----|-----------|---------|
| `vhs-deggendorfer-land-e-v` | structure-missing | Newer ITEM KG theme (`itemkgtheme_itmhead`): the list is `.course-list[data-arguments]` with `article` cards (`h2.title`, `.start-date`, `.start-time`, `.course-location`), not `#category-courses` / `.course-item`. | **Reader widened** for the newer theme: such cards are read from the card alone (date, time, place, flags, card text); their detail pages, never seen yet, are not fetched, so venue address, deadline and eligibility stay `null` unless on the card. Parses (3 listings), proposal `itemkg`. Fixture `itemkg/fixtures/deggendorf/`. |
| `vhs-kreis-kronach-e-v` | structure-missing | Same newer theme (4 test cards). | Same widening. Parses (4 listings), proposal `itemkg`. |
| `volkshochschule-suedost-im-lkr-muenchen` | structure-missing | Same newer theme, title in `h2.course-title` ("Einbürgerungstest 1 Gruppe"). | Same widening. Parses (2 listings, in-person registration from the card text), proposal `itemkg`. Fixture `itemkg/fixtures/suedost/`. |
| `muenchner-vhs-gmbh` | `failed:date-unparseable` | Not the reader: MVHS publishes no start time. The list row has only "Fr. 22.01.2027"; the detail page says "00:00 - 23:59 Uhr" (ITEM KG's all-day placeholder) and "10 Tage vor der Prüfung bekommen Sie die genauen Prüfungszeiten per E-Mail zugeschickt". A listing needs a time (`RawListing.time`), so this stays `date-unparseable` (already a committed test case). | No change. |
| `vhs-des-lk-freyung-grafenau` | structure-missing | Not the reader: an old ITEM KG CMS content page with no course list; the dates are free text and all past ("13.05.2025 (10:00-11:00 Uhr)", "26.06.2025", "29.07.2025"). | No change. Operator: check whether the site has a current course list for the test. |

No `reader_config` or `test_page_url` of an assigned centre was changed.

## CMX

New reader `cmx` (`pipeline/readers/cmx/`, fixtures Germering, Dachau, Buchloe, Kempten and a CMX
homepage as structure-missing). It reads `.Veranstaltung.Teaser` blocks (an `li` on Programmbereich
pages, a `div` on Artikel pages such as Dachau and Dingolfing) from the test page only. Against the
cache it proposes `cmx` for **all 18** centres of the group: 12 parsed, 6 parsed-empty. Teasers
marked `Beendet` are skipped, and a title must name the Einbürgerungstest (oberallgaeuer-vhs,
vhs-des-landkreises-ansbach, vhs-gunzenhausen-e-v, vhs-kempten, vhs-rhoen-grabfeld-gemeinnuetzige-gmbh,
vhs-rosenheim). See `cmx-note.md` for the list and which parsed-empty test pages deserve a second look.

## Projected coverage

With every proposal in `data/coverage/reader-proposals.json` applied to a scratch copy of the
committed directory (23 proposals: 18 `cmx`, 3 `itemkg` for Deggendorf, Kronach and Südost,
`kuferweb` for Amberg-Sulzbach and inlingua München) and the offline coverage run over the same cache:

**57 / 66 = 86.4%** (parsed 48, parsed-empty 9, failed 2, no-reader 7). Without the doubtful inlingua
München proposal: 56 / 66 = 84.8%. With the uncommitted operator edits to `centres.json` (two more
test pages, not cached yet) it is 57 / 68 = 83.8%.

Below 90% partly because pages are not cached yet. **Centres that need the next
`npm run coverage -- --fetch`**:

| centre_id | reader | why |
|-----------|--------|-----|
| `inlingua-sprachenschule-e-k` | `kuferweb` | 6 detail pages (`?kathaupt=11&knr=…`) not cached |
| `vhs-muehldorf-e-v` | `kuferweb` | detail page E36901 answered 500; needs `--refresh` |
| `vhs-kaufering` | (CMX test page, uncommitted operator edit) | test page not cached |
| `vhs-landkreis-pfaffenhofen-a-d-ilm` | (ITEM KG test page, uncommitted operator edit) | test page not cached |

If inlingua Ingolstadt and Mühldorf parse: 59 / 66 = 89.4% (61 / 68 = 89.7% with the two new
test pages parsing). Reaching 90% needs one centre of the "Other" group (or a better test page for
Freyung-Grafenau or inlingua München).

## Still not parsed, with reason

| centre_id | reader | category | reason |
|-----------|--------|----------|--------|
| `bayerisches-rotes-kreuz` | none | no-reader | TYPO3 page in a layout of its own; "Other" group, not in this story |
| `bildungszentrum-stadt-nuernberg` | none | no-reader | TYPO3 page in a layout of its own; "Other" group, not in this story |
| `kolping-akademie-ingolstadt-ggmbh` | none | no-reader | WordPress; "Other" group, not in this story |
| `mas-sprachschule-muenchen` | none | no-reader | WordPress; "Other" group, not in this story |
| `vhs-augsburg-e-v` | none | no-reader | dates rendered by JavaScript; needs a browser, counts as not parsed |
| `inlingua-sprachenschule-e-k` | none | no-reader (`kuferweb` candidate `failed:detail-page`) | detail pages not cached yet |
| `vhs-des-lk-freyung-grafenau` | none | no-reader | no course list; only past dates in free text |
| `muenchner-vhs-gmbh` | itemkg | failed `date-unparseable` | MVHS publishes no start time |
| `vhs-muehldorf-e-v` | kuferweb | failed `detail-page` | a detail page answered HTTP 500 |
