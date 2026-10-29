# ITEM KG note

Centres read by the ITEM KG reader (`pipeline/readers/itemkg/`, Story 2.4). Checked on
2026-10-29 with the bot client (identified user agent, robots.txt respected): every test page
below answered 200 and is an ITEM KG course list (`#category-courses`). The reader reads
`reader_config.list_url`, which equals the test page for every centre.

## Confirmed

| centre_id | test page | checked |
|-----------|-----------|---------|
| `muenchner-vhs-gmbh` | https://www.mvhs.de/kurse/deutsch-integration/pruefungen-einbuergerung/einbuergerung-460-CAT-KAT7868 | 2026-10-29 |
| `vhs-arberland` | https://www.vhs-arberland.de/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest | 2026-10-29 |
| `vhs-bad-kisingen-und-hammelburg` | https://www.vhs-kisshab.de/p/integration/einbuergerungstest-675-CAT-KAT77 | 2026-10-29 |
| `vhs-bad-reichenhall` | https://www.vhs-reichenhall.de/pruefungen-einbuergerungstest-und-deutsch | 2026-10-29 |
| `vhs-bamberg` | https://www.vhs-bamberg.de/einbuergerungstests | 2026-10-29 |
| `vhs-bamberg-land-e-v` | https://www.vhs-bamberg-land.de/p/488-CAT-KAT4512071 | 2026-10-29 |
| `vhs-beilngries-e-v` | https://www.vhs-beilngries.de/p/sprachen/deutsch-integration-641-CAT-KAT17 | 2026-10-29 |
| `vhs-coburg-ggmbh` | https://www.vhs-coburg.net/p//programmbereich/sprachen/deutsch/pruefungen/einbuergerungstest/494-CAT-KAT7323077 | 2026-10-29 |
| `vhs-der-gemeinden-im-landkreis-roth` | https://www.vhs-roth.de/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest | 2026-10-29 |
| `vhs-des-landkreises-forchheim` | https://www.vhs-forchheim.de/p/sprachen/integration-498-CAT-KAT39?tx_itemkgconnect_categorys%5Bpage%5D=0&tx_itemkgconnect_categorys%5Bsword%5D=&cHash=4a1d6151f01f9cac543ca2281b840352 | 2026-10-29 |
| `vhs-donauwoerth` | https://www.vhs-don.de/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest | 2026-10-29 |
| `vhs-ebersberger-land-grafing-bei-muenchen` | https://www.vhs-ebersberger-land.de/p/sprachen/deutsch/einbuergerungstests-649-CAT-KAT215 | 2026-10-29 |
| `vhs-f-d-landkreis-regensburg-e-v` | https://www.vhs-regensburger-land.de/p/deutsch-schule/einbuergerungstest-647-CAT-KAT256 | 2026-10-29 |
| `vhs-fichtelgebirge` | https://www.vhs-fichtelgebirge.de/p/integration/einbuergerungstest-644-CAT-KAT223?tx_itemkgconnect_categorys%5Bpage%5D=0&tx_itemkgconnect_categorys%5Bsword%5D=&cHash=e885cf8b12db5f275383bc211595c590 | 2026-10-29 |
| `vhs-fuerth-ggmbh` | https://www.vhs-fuerth.de/p/grundbildung/einbuergerungen/einbuergerungstest-33-fragen-477-CAT-KAT222 | 2026-10-29 |
| `vhs-starnberger-see-e-v` | https://www.vhs-starnbergammersee.de/p/sprachen-und-integration/deutsch-als-fremdsprache/pruefungen-pruefungsvorbereitung-einbuergerung/einbuergerungstest-665-CAT-KAT96?tx_itemkgconnect_categorys%5Bfilters%5D%5Bsort%5D%5B0%5D=startDate%2Casc&tx_itemkgconnect_categorys%5Bpage%5D=0&tx_itemkgconnect_categorys%5Bsword%5D=&cHash=e569d94aa4bc8aa65614afb3e67fd1ab | 2026-10-29 |
| `vhs-straubing-ggmbh` | https://www.vhs-straubing.de/p/sprachen/einbuergerungstest-563-CAT-KAT406 | 2026-10-29 |
| `vhs-weiterbildungsakademie-kehlheim-e-v` | https://www.vhs-weiterbildungsakademie.de/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest | 2026-10-29 |
| `vhs-wuerzburg` | https://www.vhs-wuerzburg.info/p/sprachen-489-CAT-KAT5892356?tx_itemkgconnect_categorys%5Bfilters%5D%5Breset%5D=1&tx_itemkgconnect_categorys%5Bfilters%5D%5Bsort%5D%5B0%5D=__EMPTY__&tx_itemkgconnect_categorys%5Bsword%5D=einbürgerung&cHash=7c429aef482378a0bbc422fcfe4806e7 | 2026-10-29 |
| `volkshochschule-im-landkreis-cham-e-v` | https://www.vhs-cham.de/p/sprachen/einbuergerungstest-test-leben-in-deutschland-461-CAT-KAT70?tx_itemkgconnect_categorys%5Bpage%5D=0&cHash=d57e7b9c77d9ef12bdcb69d237598ae3 | 2026-10-29 |
| `zweckverband-vhs-im-landkreis-erding` | https://www.vhs-erding.de/p/deutsch-integration/pruefungen/einbuergerungstest-664-CAT-KAT329 | 2026-10-29 |

## URL changes

| centre_id | change | reason |
|-----------|--------|--------|
| `muenchner-vhs-gmbh` | Integrationskurse category → Prüfungen › Einbürgerung category (`…-460-CAT-KAT7868`) | the old page lists BAMF integration courses, not the test |
| `vhs-beilngries-e-v` | single course page (`…-641-C-B3021`) → Deutsch & Integration category (`…-641-CAT-KAT17`) | a course page is not a list and shows one date only; the category lists every test date |
| `vhs-arberland` | search form URL with session-bound form tokens → plain search-word URL | the stored URL carried `__referrer`/`__trustedProperties` form state; the plain `sword` URL gives the same list |
| `vhs-weiterbildungsakademie-kehlheim-e-v` | same as Arberland | same |
| `vhs-donauwoerth` | info page `/einbuergerungstests` → search-word URL | the info page has no course list (`structure-missing`) |
| `vhs-der-gemeinden-im-landkreis-roth` | none → search-word URL | the centre had no test page; the search lists both test dates |
| `vhs-bad-kisingen-und-hammelburg` | reader `none` → `itemkg`; website and test page added (`https://www.vhs-kisshab.de/`, Einbürgerungstest category `…-675-CAT-KAT77`) | the site runs ITEM KG; the directory had no website for the centre |

The search-word URL is `<site>/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest`.
Bamberg's test page lists no test today, and Bamberg-Land's test row has no date ("dates on
request"); both read as `ok` with no dates.

## MVHS (München)

- The Einbürgerung category lists each test with a date only ("Fr. 04.12.2026"); the detail page
  shows "00:00 - 23:59 Uhr" and no `Start` block. MVHS publishes no start time ("10 Tage vor der
  Prüfung bekommen Sie die genauen Prüfungszeiten …"), so the reader fails the centre with
  `date-unparseable` rather than guess a time, until `RawListing` can carry an unknown time
  (Story 2.5 decision).
- No residence rule ("Munich residents only") is published on the category or the detail pages
  today; the reader would copy it verbatim if it appeared.
- The prep course "Deutsch Geschichte und Politik von A-Z" in the same category is not a test row.
