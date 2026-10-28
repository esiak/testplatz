# KuferWeb note

Centres read by the KuferWeb reader (`pipeline/readers/kuferweb/`, Story 2.3). Checked on
2026-10-28 with the bot client (identified user agent, robots.txt respected): every test page
below answered 200 and is a KuferWeb course list.

## Confirmed

| centre_id | test page | checked |
|-----------|-----------|---------|
| `vhs-aichach-friedberg-e-v` | https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest | 2026-10-28 |
| `vhs-aschaffenburg` | https://www.vhs-aschaffenburg.de/kurse/deutsch-integration-grundbildung/einbuergerungstest | 2026-10-28 |
| `vhs-groebenzell-e-v` | https://www.vhs-groebenzell.de/programm/sprachen/kategorie/Einbuergerungstest/68 | 2026-10-28 |
| `vhs-im-norden-des-landkreises-muenchen` | https://www.vhs-nord.de/programm/sprachen/kategorie/Einbuergerungstest/348#inhalt | 2026-10-28 |
| `vhs-landshut-e-v` | https://www.vhs-landshut.de/kurse/sprachen-integration/pruefungen-einbuergerungstest | 2026-10-28 |
| `vhs-moosburg-e-v` | https://www.vhs-moosburg.de/programm/sprachen/kategorie/Einbuergerungstest/50#inhalt | 2026-10-28 |
| `vhs-muehldorf-e-v` | https://www.vhs-muehldorf.de/programm/sprachen-verstaendigung/kategorie/Einbuergerung/61#inhalt | 2026-10-28 |
| `vhs-taufkirchen` | https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest | 2026-10-28 |
| `vhs-traunreut-e-v` | https://www.vhs-traunreut.de/programm/sprachen/kategorie/Einbuergerungstest/1052 | 2026-10-28 |
| `volkshochschule-im-landkreis-unterallgaeu-e-v` | https://www.vhs-ua.de/programm/sprachen-und-verstaendigung/deutsch/kategorie/Einbuergerungspruefung/26 | 2026-10-28 |
| `volkshochschule-rottenburg-an-der-laaber-e-v` | https://www.vhs-rottenburg-laaber.de/kurse/sprachen | 2026-10-28 |
| `volkshochschule-straubing-bogen-ggmbh` | https://www.vhs-straubing-bogen.de/programm/sprachen/kategorie/Deutsch+als+Fremdsprache/69#inhalt | 2026-10-28 |

Rottenburg: the earlier course URL (`/kurssuche/kurs/Einbuergerungstest/R26+S32`) answered 404;
the test is listed on the Sprachen category page. Straubing and Rottenburg list the test inside a
wider language category; the reader keeps only courses whose title names the Einbürgerungstest.

## Moved to reader `none`

| centre_id | reason |
|-----------|--------|
| `vhs-burghausen-burgkirchen-e-v` | robots.txt disallows the bot |
| `vhs-im-ldkr-neumarkt-opf` | no Einbürgerungstest on the programme pages; the course search is robots-disallowed |
| `vhs-mainburg-e-v` | no Einbürgerungstest on the programme pages; the course search is robots-disallowed |
| `vhs-trostberg-e-v` | no Einbürgerungstest on the programme pages; the course search is robots-disallowed |
