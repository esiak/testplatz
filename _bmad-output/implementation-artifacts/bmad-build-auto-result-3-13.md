---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: intent gap — Story 3.13 (Coordinates for every centre) needs one operator decision. `vhs-kreis-kronach-e-v` cannot be geocoded, and the AC reserves hand-set coordinates for the operator ("set by hand by the operator from the map").

## Findings (2026-11-01)

Each centre's own website was read, then the corrected address was tried once with the same structured Nominatim search `tools/geocode` uses (project User-Agent, ≥ 1.5 s apart).

| Centre | Directory address | Address on the centre's site (source) | Nominatim, corrected |
|---|---|---|---|
| bayerisches-rotes-kreuz | Goethestr. 53, 81379 München | Goethestraße 53, **80336** München (test page) | building, 80336 ✓ |
| muenchner-vhs-gmbh | Orleanstraße 34, 81667 München | **Orleansstr.** 34 (test page, registration desk; MVHS head office is Einsteinstraße 28, 81675) | building, 81667 ✓ |
| vhs-der-gemeinden-im-landkreis-roth | Maria-Dorothea-Str. 8, 91161 Hilpoldstein | Maria-Dorothea-Straße 8, 91161 **Hilpoltstein** (Impressum) | building, 91161 ✓ |
| vhs-fichtelgebirge | Ludwigsmühle 10, 95615 Selb | Ludwigsmühle 10, **95100** Selb (Impressum) | building, 95100 ✓ |
| vhs-kaufering | Albert-Schweizer-Str.4a, 86916 Kaufering | **Albert-Schweitzer-Str. 4a**, 86916 Kaufering (vhs-kaufering.de) | building (Marktbücherei, shared with the VHS), 86916 ✓ |
| vhs-kreis-kronach-e-v | Kulmbacher Str. 1, 96317 Kronach | same (Impressum) | **wrong place**: only Kulmbacher Straße 1 in Weißenbrunn (96369) and Marktrodach (96364) exist in OSM |
| volkshochschule-eching-e-v | Roßbergstr. 8, 85386 Eching | **Roßbergerstr.** 8, 85386 Eching (Impressum) | building "Volkshochschule Eching", 85386 ✓ |
| volkshochschule-kitzingen | Paul-Eber-Haus, Schulhof 1, 97318 Kitzingen | **Hindenburgring Süd 3**, 97318 Kitzingen (Impressum; "Geschäftsstelle im Luitpoldbau") | building "Luitpoldbau", 97318 ✓ |

So 7 of 8 can be fixed the AC's first way (correct the address in `centres.json`, rerun `tools/geocode`).

## Unanswered question

**Kronach coordinates.** OSM tags a "Volkshochschule" at Rodacher Straße 1, 96317 Kronach: **50.2377498, 11.3251820** (likely the corner building of Kulmbacher Straße 1). Should Story 3.13 hand-set Kronach to these coordinates (and list it as hand-set in `geocode-note.md` and the test allowlist)? Or do you want to place it yourself from the map, and if so, at which lat/lon?

Check on the map: https://www.openstreetmap.org/?mlat=50.2377498&mlon=11.3251820#map=19/50.2377498/11.3251820

## To continue

Answer the question (for example add the coordinates to the Story 3.13 ACs in `epics.md`, or reply in chat), then rerun `/bmad-build-auto story 3.13`.
