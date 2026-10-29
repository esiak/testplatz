# ITEM KG reader fixtures

Real pages, fetched on 2026-10-29 with the bot client (`pipeline/fetch`, identified user agent,
robots.txt respected) and committed unmodified. Cases no live page showed (a residence rule, a
waitlist offer, a start time for MVHS) are made by string edits inside `itemkg.test.ts`, never as
committed files. Instructor names appear in the pages as published; the reader never outputs them.

Detail pages are named after their course id; each one's URL is the row link on its list page
(`…-<NNN>-C-<id>`, listed in `itemkg.test.ts`).

| file | source URL | covers |
|------|------------|--------|
| `starnberg/list.html` | https://www.vhs-starnbergammersee.de/p/sprachen-und-integration/deutsch-als-fremdsprache/pruefungen-pruefungsvorbereitung-einbuergerung/einbuergerungstest-665-CAT-KAT96?tx_itemkgconnect_categorys%5Bfilters%5D%5Bsort%5D%5B0%5D=startDate%2Casc&tx_itemkgconnect_categorys%5Bpage%5D=0&tx_itemkgconnect_categorys%5Bsword%5D=&cHash=e569d94aa4bc8aa65614afb3e67fd1ab | 6 rows `bk-byphone`, 2 `bk-av-soldout`, 4 `bk-av-enough`; "Anmeldung nur per Mail oder persönlich möglich" |
| `starnberg/262-3479-S.html`, `262-3492-A.html` | `…/einbuergerungstest/einbuergerungstest-665-C-<id>` | booked out; venue with and without `.venueNumber` |
| `starnberg/262-3480-S.html`, `262-3481-S.html`, `262-3482-S.html`, `262-3493-A.html` | same | free |
| `kissingen/list.html` | https://www.vhs-kisshab.de/p/integration/einbuergerungstest-675-CAT-KAT77 | "Persönliche Anmeldung"; one `bk-notbookable` past row, two `bk-inperson` |
| `kissingen/2617425KG.html`, `2627400KG.html`, `2627405KG.html` | https://www.vhs-kisshab.de/p/integration/einbuergerungstest/einbuergerungstest-{5,6,7}-26-675-C-<id> | in person; "Anmeldeschluss: drei Wochen …" (no date) |
| `erding/list.html` | https://www.vhs-erding.de/p/deutsch-integration/pruefungen/einbuergerungstest-664-CAT-KAT329 | `bk-inperson`, 4 sold out |
| `erding/262-4085.html` … `262-4089.html` | https://www.vhs-erding.de/p/deutsch-integration/pruefungen/einbuergerungstest/pruefung-einbuergerungstest[/ausgebucht]-664-C-<id> | "keine Warteliste" (4089) |
| `roth/list.html` | https://www.vhs-roth.de/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest | search page; "Anmeldung bis 22.10.2026 nur persönlich" |
| `roth/N31300.html`, `N31301.html` | https://www.vhs-roth.de/p/sprachen/deutsch/test-leben-in-deutschland/integration-einbuergerungstest-ebt-681-C-<id> | deadline; venue "Landwirtschaftsschule, Aula" |
| `ebersberg/list.html` | https://www.vhs-ebersberger-land.de/p/sprachen/deutsch/einbuergerungstests-649-CAT-KAT215 | `bk-written` + `bk-hint-e-mail_registration` |
| `ebersberg/262-30994.html` | https://www.vhs-ebersberger-land.de/p/sprachen/deutsch/einbuergerungstests/einbuergerungstest-649-C-262-30994 | free, e-mail; room number already in the venue name |
| `wuerzburg/list.html` | https://www.vhs-wuerzburg.info/p/sprachen-489-CAT-KAT5892356?tx_itemkgconnect_categorys%5Bfilters%5D%5Breset%5D=1&tx_itemkgconnect_categorys%5Bfilters%5D%5Bsort%5D%5B0%5D=__EMPTY__&tx_itemkgconnect_categorys%5Bsword%5D=einbürgerung&cHash=7c429aef482378a0bbc422fcfe4806e7 | mixed: 5 test rows + 2 telc rows |
| `wuerzburg/<id>.html` (5) | https://www.vhs-wuerzburg.info/p/sprachen/einbuergerungstest-489-C-<id> | "Die Anmeldung erfolgt persönlich" |
| `mvhs/list.html` | https://www.mvhs.de/kurse/deutsch-integration/pruefungen-einbuergerung/einbuergerung-460-CAT-KAT7868 | rows with a date and no time; prep course "Geschichte und Politik" |
| `mvhs/X674118.html`, `X674130.html` | https://www.mvhs.de/kurse/deutsch-integration/pruefungen-einbuergerung/einbuergerung/einbuergerungstest/10-tage-vor-der-pruefung-bekommen-sie-die-genauen-pruefungszeiten-per-e-mail-zugeschickt-460-C-<id> | no venue block, no `Start` block, no `bk-icon`; "Nur persönliche Anmeldung"; "Anmeldeschluss: 31.10.2026" (X674118) |
| `bamberg/list.html` | https://www.vhs-bamberg.de/einbuergerungstests | course list container without rows |
| `bamberg-land/list.html` | https://www.vhs-bamberg-land.de/p/488-CAT-KAT4512071 | one test row without a date |
| `structure-missing/list.html` | https://www.vhs-don.de/einbuergerungstests | Donauwörth info page, no course list |

All files fetched 2026-10-29. No fixture states a residence rule.
