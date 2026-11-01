# CMX note

Centres read by the CMX reader (`pipeline/readers/cmx/`, Story 4.4). CMX is the CMS behind many
VHS sites: pages load `/cmx/interpreter/js/index.js`, the `body` carries the page's `cmx<hex>` id,
courses are `.Veranstaltung.Teaser` blocks with links under `/Veranstaltung/`. The reader reads the
test page only (a `Programmbereich` or an `Artikel`), never a detail page; teasers marked `Beendet`
(course over) are skipped and the title must name the Einbürgerungstest. Listings carry
`link_ok: false` and the card opens the centre's test page.

Assignments reach `centres.json` only through the operator, from `data/coverage/reader-proposals.json`
(`npm run coverage`). Move a centre from "Proposed" to "Confirmed" (test page as in the directory,
checked = the `verified_at` date you set) when you set its reader to `cmx`.

## Confirmed

| centre_id | test page | checked |
|-----------|-----------|---------|

## Proposed

Proposals from the offline coverage run over the cache fetched 2026-11-01 (`cmx` parsed or
parsed-empty for all 18 centres of the group). Not yet in the directory.

| centre_id | test page | outcome |
|-----------|-----------|---------|
| `oberallgaeuer-vhs` | https://oa-vhs.de/integrationskurse-bamf | parsed-empty (integration courses only) |
| `vhs-buchloe-e-v` | https://vhs-buchloe.de/Programmbereich/cmx69c2693eca8cf.html | parsed, 2 |
| `vhs-dachau-gmbh` | https://vhs-dachau.de/Artikel/cmx655e01456395b.html | parsed, 12 |
| `vhs-des-landkreises-ansbach` | https://vhs-lkr-ansbach.de/Artikel/cmx66d95c61bf49b.html | parsed-empty (registration by phone appointment, no dates) |
| `vhs-dingolfing-e-v` | https://vhs-dingolfing.de/test | parsed, 6 |
| `vhs-germering-e-v` | https://vhs-germering.de/Programmbereich/cmx67e28778abee8.html | parsed, 6 |
| `vhs-geschaeftsstelle-neufarn-hallbergmoos` | https://vhs-neufahrn-hallbergmoos.de/Programmbereich/cmx69a6c68abf085.html | parsed, 8 |
| `vhs-gunzenhausen-e-v` | https://vhs-gunzenhausen.de/integration | parsed-empty (article overview, no course teasers) |
| `vhs-kaufbeuren-e-v` | https://vhs-kaufbeuren.de/Programmbereich/cmx642597b681e77.html | parsed, 1 |
| `vhs-kempten` | https://vhs-kempten.de/Programmbereich/cmx6321cc9fe80ca.html | parsed-empty (links to sub-areas, no teasers) |
| `vhs-rhoen-grabfeld-gemeinnuetzige-gmbh` | https://die-vhs.de/Programmbereich/cmx6a2a986855055.html | parsed-empty (links to sub-areas, no teasers) |
| `vhs-rieser-noerdlingen-e-v` | https://vhs.noerdlingen.de/Programmbereich/cmx6a16d51b12d9a.html | parsed, 1 |
| `vhs-rosenheim` | https://vhs-rosenheim-inntal.de/sprache/daf-und-daz/einbuergerungstest | parsed-empty (information page, no teasers) |
| `vhs-stadt-fuerstenfeldbruck-e-v` | https://vhs-stadtlandbruck.de/Programmbereich/cmx6a157a8b20248.html | parsed, 4 |
| `vhs-staedtedreieck-e-v` | https://vhs-schwandorf-land.de/Programmbereich/cmx673b5b519a273.html | parsed, 4 |
| `vhs-verband-landau-e-v` | https://vhs-landau.de/Programmbereich/cmx68af342bd1d1b.html | parsed, 3 |
| `vhs-waldkraiburg-e-v` | https://vhs-waldkraiburg.de/einbuergerungstest-termin | parsed, 1 |
| `volkshochschule-guenzburg` | https://vhs-landkreis-guenzburg.de/Programmbereich/cmx6a35553379ad3.html | parsed, 6 |

The parsed-empty pages pass the structure check (they are CMX content pages) but show no
Einbürgerungstest teaser. For Kempten and Rhön-Grabfeld the dates are likely one level down (the
page links sub-areas such as "Wissenstest zur Einbürgerung" / "Einbürgerungstest"); check whether a
deeper `Programmbereich` is the better test page before confirming.

`vhs-kaufering` (uncommitted operator edit, test page https://vhs-kaufering.de/Programmbereich/cmx684bf6ed8fbf0.html)
is also CMX but not yet in the cache; it needs the next `--fetch`.
