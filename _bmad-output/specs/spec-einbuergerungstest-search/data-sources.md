# Data sources

## Reader types

| Reader | Fingerprint | Approx. sites (of 78 Bavarian VHS) | Seat status shown | Examples |
|---|---|---|---|---|
| KuferWeb | `/fileadmin/kuferweb/webbasys/` on TYPO3 | ~30 | Yes: traffic light ("Kursampel"), "only courses with free places" filter, "AUSGEBUCHT" in title | vhs-aichach-friedberg.de, vhs-aschaffenburg.de |
| ITEM KG | `typo3conf/ext/itemkg_*`, URLs `/p/<slug>-<NNN>-CAT-KAT<n>` | ~25 | Partial: `bookable` / `bookableonline` flags | vhs-kisshab.de, mvhs.de, vhs-wuerzburg.de, vhs-fuerth.de, vhs-erding.de |
| none | unknown build or blocked automated fetch | ~23 VHS + ~15 non-VHS | — | vhs-augsburg.de, vhs-dachau.de, bfz, Kolping, DAA |

Counts come from homepage fingerprints (2026-10-25), not from each site's test page.

## Listing fields

| Field | Required | Notes |
|---|---|---|
| centre_id | yes | links to directory entry |
| starts_at | yes | date and time, Europe/Berlin |
| place | yes | room, if given |
| address | yes | full street address of the test location; falls back to the centre address |
| status | yes | `free` / `booked_out` / `waitlist` / `unknown` |
| deadline | no | e.g. 3–5 weeks before the test; `unknown` if not published |
| registration_method | no | `online` / `email` / `post` / `in_person` (e.g. Bad Kissingen: in person, cash only) |
| source_url | yes | provider page for the date |
| link_ok | yes | whether `source_url` was reachable at the last check; if false, UI links to the centre's `test_page_url` |
| first_seen_at | yes | set once, never overwritten (CAP-6) |
| last_checked_at | yes | per collection run (CAP-5) |

## Status mapping

- Any system: booked out with a waitlist offer ("Warteliste") → `waitlist`.
- KuferWeb: "AUSGEBUCHT" / full traffic light → `booked_out`; free traffic light → `free`; no indicator → `unknown`.
- ITEM KG: `bookable` true → `free`; false → `booked_out`; absent, or registration in person only → `unknown`.

## Centre directory

- v1 seed: rtpartner.de "Prüfstellen für den Einbürgerungstest in Bayern" (~116 entries, cites BAMF, reuse licence unclear). Each entry is verified against the centre's own website before going live.
- Official source: none machine-readable found (bamf.de links only BAMF-NAvI, which covers integration courses and authorities; oet.bamf.de hosts practice tests only). Request the list from BAMF by email, then by IFG request via FragDenStaat; switch to it when received.
- Refresh: monthly diff for added or removed centres.
- Each entry: name, address, coordinates, website, test_page_url (the centre's Einbürgerungstest page), reader type, opted_out flag (CAP-8).
- Centre coordinates: geocoded once with Nominatim (max 1 req/s, attribution), stored; re-geocode only changed addresses.

## User location

- Built-in table of Bavarian postcodes and towns with coordinates, derived from OpenStreetMap (ODbL, attribution shown).
- Matching and straight-line distance run in the browser; no runtime geocoding service.
- Optional: browser geolocation ("use my location"), also client-side only.
