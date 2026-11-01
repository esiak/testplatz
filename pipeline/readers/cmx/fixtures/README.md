# CMX reader fixtures

Trimmed copies of pages from the local coverage cache (`data/coverage/cache/`, fetched 2026-11-01
with the bot client, robots.txt respected). Each keeps only the CMX content container the reader
reads (with its `body` and `main#content` ancestors) and the CMX script tag; navigation, scripts,
images (except the seat-light icons), contact blocks and comments are removed. No personal data.
Cases no cached page showed (a waitlist light, a teaser without a time, DTZ / LiD titles in place
of the test) are made by string edits inside `cmx.test.ts`, never as committed files.

| file | source URL | covers |
|------|------------|--------|
| `germering/list.html` | https://vhs-germering.de/Programmbereich/cmx67e28778abee8.html | Programmbereich, `li` teasers: 2 "Deutsch-Test für Zuwanderer" + 6 Einbürgerungstest; `status_100` / "keine freien Plätze" and "Plätze frei" lights |
| `dachau/list.html` | https://vhs-dachau.de/Artikel/cmx655e01456395b.html | Artikel page, 12 `div` teasers, date in the title |
| `buchloe/list.html` | https://vhs-buchloe.de/Programmbereich/cmx69c2693eca8cf.html | a past ("Beendet") teaser, skipped; "noch 1 Platz frei" / "noch 3 Plätze frei" (`status_75`) |
| `kempten/list.html` | https://vhs-kempten.de/Programmbereich/cmx6321cc9fe80ca.html | CMX container linking sub-areas, no course teaser → ok, 0 listings |
| `structure-missing/list.html` | https://vhs-dillingen.de | CMX homepage (`body.Homepage`, no page id): no Programmbereich or Artikel container |
