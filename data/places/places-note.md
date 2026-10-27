# Place table note

Dataset: OpenStreetMap via the Overpass API (`overpass-api.de/api/interpreter`). Data © OpenStreetMap contributors, ODbL 1.0.

## Run

- Queries: 40
- Requests sent: 0
- Retries: 0
- Cache hits: 10
- Failed queries: 0
- Every request sent User-Agent `bgtsearch-bot/0.1.0 (+https://esiak.github.io/testplatz/about/)`: yes
- Every request went to https://overpass-api.de/api/interpreter: yes
- Smallest gap between two requests: n/a (fewer than two requests)

## PARTIAL BUILD: 30 queries not cached and left out (`--cached-only`)

places.json has `complete: false`. Rows for these key prefixes are absent, and the Bavaria boundary is empty when `bavaria` is listed. Run `npm run build:places` to fetch them.

- ags-031
- ags-032
- ags-033
- ags-034
- ags-040
- ags-051
- ags-053
- ags-055
- ags-057
- ags-059
- ags-064
- ags-065
- ags-066
- ags-071
- ags-072
- ags-073
- ags-081
- ags-082
- ags-083
- ags-084
- ags-100
- ags-110
- ags-120
- ags-130
- ags-145
- ags-146
- ags-147
- ags-150
- ags-160
- bavaria

## Output

- Complete: NO (30 queries missing)
- Data timestamp (oldest OSM base among the responses): 2026-10-27T19:17:35Z
- Rows: 3247
- Rows per state: SH 1104, HH 1, NI 0, HB 0, NW 0, HE 0, RP 0, BW 0, BY 2142, SL 0, BE 0, BB 0, MV 0, SN 0, ST 0, TH 0
- Distinct postcodes: 2588
- Rows without postcodes: 0
- Size: 449754 bytes raw, 70740 bytes gzipped
- Bavaria boundary: MISSING (bavaria query not cached)

## Dropped: no place node and no postcode (75)

- 09173452 Wolfratshauser Forst
- 09176451 Haunstetter Forst
- 09181451 Ammersee
- 09183451 Mühldorfer Hart
- 09188451 Starnberger See
- 09189452 Waginger See
- 09371452 Eichen
- 09374458 Speinsharter Forst
- 09376455 Wolferlohe
- 09471453 Eichwald
- 09471454 Geisberger Forst
- 09471455 Hauptsmoor
- 09471456 Koppenwinder Forst
- 09471457 Lindach
- 09471459 Semberg
- 09471460 Steinachsrangen
- 09471461 Winkelhofer Forst
- 09471462 Zückshuter Forst
- 09472454 Forst Neustädtlein am Forst
- 09472456 Glashüttener Forst
- 09472458 Heinersreuther Forst
- 09472463 Neubauer Forst Nord
- 09472469 Waidacher Forst
- 09472470 Warmensteinacher Forst-Nord
- 09473452 Callenberger Forst-West
- 09475454 Martinlamitzer Forst Nord
- 09476451 Birnbaum
- 09478451 Breitengüßbacher Forst
- 09478453 Neuensorger Forst
- 09479457 Neubauer Forst-Süd
- 09479459 Tröstauer Forst-Ost
- 09479461 Vordorfer Forst
- 09571451 Unterer Wald
- 09572451 Birkach
- 09574453 Engelthaler Forst
- 09574456 Forsthof
- 09574461 Leinburg
- 09574464 Winkelhaid
- 09576451 Abenberger Wald
- 09576452 Dechenwald
- 09576455 Soos
- 09672451 Dreistelzer Forst
- 09672454 Forst Detter-Süd
- 09672455 Geiersnest Ost
- 09672456 Geiersnest West
- 09672458 Kälberberg
- 09672461 Mottener Forst-Süd
- 09672462 Neuwirtshauser Forst
- 09672463 Omerz und roter Berg
- 09672465 Römershager Forst-Ost
- 09672466 Roßbacher Forst
- 09672468 Waldfensterer Forst
- 09673452 Burgwallbacher Forst
- 09673453 Forst Schmalwasser-Nord
- 09673454 Forst Schmalwasser-Süd
- 09673455 Mellrichstadter Forst
- 09673456 Steinacher Forst rechts der Saale
- 09673457 Sulzfelder Forst
- 09673458 Weigler
- 09676452 Forstwald
- 09677457 Haurain
- 09678452 Geiersberg
- 09678454 Nonnenkloster
- 09678456 Vollburg
- 09678457 Wustvieler Forst
- 09679452 Guttenberger Wald
- 09772451 Schmellerforst
- 09774451 Ebershauser-Nattenhauser Wald
- 09774452 Winzerwald
- 09775451 Auwald
- 09775452 Oberroggenburger Wald
- 09775455 Unterroggenburger Wald
- 09778451 Ungerhauser Wald
- 09779452 Dornstadt-Linkersbaindt
- 09779453 Esterholz

## Dropped: no name (0)

None.

## Dropped: no coordinates (0)

None.

## Duplicate AGS (lower relation id kept) (0)

None.

## Bavarian rows outside the boundary (0)

None.
