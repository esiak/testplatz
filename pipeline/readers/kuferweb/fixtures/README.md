# KuferWeb reader fixtures

Real pages, fetched on 2026-10-28 with the bot client (`pipeline/fetch`, identified user agent,
robots.txt respected) and committed unmodified. Status cases no live page showed (waitlist, a full
traffic light, a negated waitlist) are made by string edits inside `kuferweb.test.ts`, never as
committed files. Instructor names appear in the pages as published; the reader never outputs them.

| file | source URL | covers |
|------|------------|--------|
| `aichach/list.html` | https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest | bootstrap-row list; rule "Voraussetzung: Wohnsitz in Bayern!" in the content column |
| `aichach/G40108-17.html` | https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest/kurs/AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40108-17 | `AUSGEBUCHT` title → booked out; Kursort line triple |
| `aichach/G40208-17.html` | https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest/kurs/AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40208-17 | booked out |
| `aichach/G40308-17.html` | https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest/kurs/AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40308-17 | booked out |
| `aichach/G40203-18.html` | https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest/kurs/Einbuergerungstest/G40203-18 | "in den Warenkorb" control → online; no light label → unknown |
| `aichach/G40303-18.html` | https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest/kurs/Einbuergerungstest/G40303-18 | same template, second open date |
| `taufkirchen/list.html` | https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest | product-tile list (`.hauptseite_kurse` only); lights "Keine Online-Anmeldung möglich" / "Anmeldung möglich" |
| `taufkirchen/262-30111.html` | https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest/kurs/Einbuergerungstest/262-30111 | inline labels (`Kursbeginn:`, `Kursort:`); "Der Termin ist ausgebucht" → booked out; address from the session location cell |
| `taufkirchen/262-30112.html` | https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest/kurs/Einbuergerungstest/262-30112 | booked out |
| `taufkirchen/262-30113.html` | https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest/kurs/Einbuergerungstest/262-30113 | booked out |
| `taufkirchen/262-30121.html` | https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest/kurs/Einbuergerungstest/262-30121 | booked out |
| `taufkirchen/262-30122.html` | https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest/kurs/Einbuergerungstest/262-30122 | "Anmeldung möglich" light → free; "In den Warenkorb legen" → online |
| `moosburg/list.html` | https://www.vhs-moosburg.de/programm/sprachen/kategorie/Einbuergerungstest/50 | image lights (`alt="Keine Anmeldung möglich"`) |
| `moosburg/262.3071.html` | https://www.vhs-moosburg.de/programm/sprachen/kurs/Einbuergerungstest/262.3071 | `Beginn 15:00` beats session table `14:00`; two Kursort blocks; "nur persönlich" → in person |
| `moosburg/262.3072.html` | https://www.vhs-moosburg.de/programm/sprachen/kurs/Einbuergerungstest/262.3072 | same template, 2027 date |
| `traunreut/list.html` | https://www.vhs-traunreut.de/programm/sprachen/kategorie/Einbuergerungstest/1052 | list without the webbasys fingerprint |
| `traunreut/X4046.html` | https://www.vhs-traunreut.de/programm/sprachen/kurs/Einbuergerungstest/X4046 | `Adresse:` Kursort block without a room line; `Anmeldeschluss: 16.10.26.` (2-digit year); `<table>` session list |
| `traunreut/X4047.html` | https://www.vhs-traunreut.de/programm/sprachen/kurs/Einbuergerungstest/X4047 | same template |
| `straubing/list.html` | https://www.vhs-straubing-bogen.de/programm/sprachen/kategorie/Deutsch+als+Fremdsprache/69 | mixed category (Erstorientierungskurs + test) |
| `straubing/262-S09OA.html` | https://www.vhs-straubing-bogen.de/programm/sprachen/kurs/Einbuergerungstest/262-S09OA | `Anmeldeschluss` label line; "ausschließlich persönlich" → in person |
| `muehldorf/list.html` | https://www.vhs-muehldorf.de/programm/sprachen-verstaendigung/kategorie/Einbuergerung/61 | mixed category: DaF courses (one with a waitlist light) + one test |
| `muehldorf/E36901.html` | https://www.vhs-muehldorf.de/programm/sprachen-verstaendigung/kurs/Deutsch-Einbuergerungstest/E36901 | `13.00 Uhr` time; "Anmeldung bis 13.11.2026"; Kursort without street → address null |
| `no-tests/list.html` | https://www.vhs-mainburg.de/programm/sprachen | course list without Einbürgerungstest links |
| `structure-missing/list.html` | https://www.vhs-neumarkt.de/ | KuferWeb homepage, no course list container |

All files fetched 2026-10-28. No fixture states a rule except Aichach's list page (and its detail
pages outside `.kw-kursdetails`).
