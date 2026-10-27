---
title: 'Story 1.5: Build the place table'
type: 'feature'
created: '2026-10-27'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: '928c81817113f7accf02c8177d0c38d7feb6e85c'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred:
  - summary: 'Complete the place table: fetch the 29 missing ags-* queries and the bavaria boundary (Story 1.11).'
    evidence: 'Operator stopped the live Overpass run on 2026-10-27 (server busy, 2 of 38 prefix queries in ~25 min); places.json is complete: false.'
    location: 'data/places/places-note.md'
    severity: 'medium'
---

<intent-contract>

## Intent

**Problem:** Search (1.8–1.10) needs an offline table that turns a typed town or postcode into coordinates, tells same-name towns apart by district, and knows Bavaria's outline. Nothing exists yet: there is no `places.json`, no places schema and no shared name normaliser.

**Approach:** Add the operator tool `tools/build-places.ts`. It reads OpenStreetMap through the Overpass API, all through `pipeline/fetch`: one index query (every municipality key and every district name), then one query per 3-digit municipality-key prefix (Bavaria splits into its 7 Regierungsbezirke), then one for the Bavaria boundary. Each raw response is cached, and from them it builds `data/public/places.json`, validated by a zod schema in `shared/places.ts`. Overpass's robots.txt disallows `/api/` for all bots. On 2026-10-27 the operator decided to add a second explicit exemption for exactly `https://overpass-api.de/api/interpreter` (manual, cached, never scheduled), recorded as an AD-5 amendment. **Dataset choice:** OpenStreetMap via Overpass (ODbL).

## Boundaries & Constraints

**Always:**
- All Overpass HTTP goes through `createFetchClient` with `robotsExempt: [OVERPASS_ROBOTS_EXEMPT]` (the Nominatim entry is not passed). Requests are serial with ≥ `OVERPASS_DELAY_MS` (10 000) between them, use `OVERPASS_TIMEOUT_MS` (900 000) and send the bot User-Agent. Queries are sent as `GET <OVERPASS_INTERPRETER_URL>?data=<URL-encoded QL>`.
- Busy server: on `http-error` with status 429, 502, 503 or 504, or on `timeout`, retry the same query up to 3 more times, waiting 60 s, 120 s, then 240 s (injectable `sleep`). Any other failure, or a 4th failure, means the query failed: nothing is cached for it, and the tool still processes the remaining queries. It writes no `places.json` and exits 1.
- Queries: `index` lists the tags of every municipality relation (below) and every level-6 relation with a 5-digit AGS (`out tags`). The distinct first 3 AGS digits of the municipalities give the `ags-<prefix>` queries (about 40). Each one returns its municipalities (`out body center qt`) and then one group per municipality (see Design Notes). `bavaria` returns the boundary relation with `out geom`. Order: `index`, then `ags-*` ascending, then `bavaria`.
- Cache: each successful raw response is stored as `data/places/cache/<query-name>.json` (gitignored). The `ags-*` names come from the cached `index`. A rerun with every cache file present sends 0 requests and writes a byte-identical `places.json`. The flag `--refresh` ignores the cache.
- Municipalities: relations anywhere (tag filter, no area filter) with `boundary=administrative`, `admin_level` 4, 6 or 8, and an 8-digit `de:amtlicher_gemeindeschluessel` (AGS) whose first two digits are the state's. This covers kreisfreie Städte (level 6) and Berlin/Hamburg (level 4). Row `key` = AGS. `state` = the two-letter code for AGS digits 1–2 (`01` SH, `02` HH, `03` NI, `04` HB, `05` NW, `06` HE, `07` RP, `08` BW, `09` BY, `10` SL, `11` BE, `12` BB, `13` MV, `14` SN, `15` ST, `16` TH). `district` = the `name` of the level-6 relation whose AGS equals the first 5 digits; if there is none, the municipality's own `name`.
- Postcodes of a municipality: the 5-digit `postal_code:DE` (else `postal_code`) of every `boundary=postal_code` area that contains a `place` node (city, town, village, borough, suburb, quarter, neighbourhood, hamlet, isolated_dwelling, locality) lying inside the municipality. Overpass computes this server-side (`map_to_area` → `node(area)` → `is_in`). Deduplicated and sorted. A municipality with no place node inside and no postcode (unincorporated forests and lakes) is dropped and counted in the note.
- Coordinates, first match wins: the relation's `admin_centre` member node, then its `label` member node, then the inside place node whose normalised name equals the municipality's normalised name (highest place class first), then the relation's bbox centre from `out center`. Rounded to 4 decimals.
- Bavaria boundary: the outer and inner ways of the relation `ISO3166-2=DE-BY`, `admin_level=4`, stitched into closed rings, simplified with Douglas–Peucker at `0.002°`, and stored as rings of `[lon, lat]` pairs (4 decimals). It is read with the even-odd rule, so holes need no special casing.
- `shared/places.ts` exports `placesSchema`, `placeRowSchema`, `STATE_CODES`, `normalizePlaceName` and `isInBoundary(lat, lon, rings)`. The file shape is `{ schemaVersion: 1, data_timestamp, attribution, bavaria: number[][][], places: Row[] }`, where `data_timestamp` is the oldest `osm3s.timestamp_osm_base` among the responses used. Rows are sorted by `key`, and keys are unique. Output is minified JSON with a trailing newline, and there is no wall-clock timestamp, so reruns are deterministic.
- `normalizePlaceName`: lowercase, then `ß`→`ss`, `ä/ö/ü`→`a/o/u`, then `ae/oe/ue`→`a/o/u`, strip remaining diacritics, and collapse whitespace and trim. "Gunzburg", "Guenzburg", "günzburg" and "Günzburg" all give the same value.
- The tool refuses to write a file that fails `placesSchema`. It writes `data/public/places.json` and `data/places/places-note.md` (data timestamp, request and cache counts, row counts total and per state, raw and gzipped byte size with `FLAG: over 300 KB gzipped` when > 307 200 bytes, boundary point count, duplicate AGS and Bavarian rows outside the boundary).

**Never:**
- No geocoder call (Nominatim or any other), no other Overpass endpoint, no parallel requests, no scheduled or CI run.
- No new dependencies and no TypeScript-only syntax (tools run with plain `node`). No `web/` changes and no snapshot work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh build | empty cache | `index` + one per prefix + `bavaria`, ≥ delay apart, bot UA; `places.json` + note written | N/A |
| Rerun | all cache files | 0 requests; `places.json` byte-identical | N/A |
| Partial cache | `index` + some `ags-*` cached | only the missing queries sent | N/A |
| Uninhabited area | `Ammersee`, 0 place nodes, 0 postcodes | no row; counted in note | N/A |
| Busy server | 502, then 200 | 1 retry after 60 s; cached; success | N/A |
| Persistent failure | 4 × 504 for `ags-051` | other queries still run and cache; no `places.json` written | exit 1, note lists failure |
| Kreisfreie Stadt | level 6, AGS `09162000` | row `München`, district `München`, state `BY` | N/A |
| Same name | two `Hausen`, different AGS | two rows, each with its own district | N/A |
| Duplicate AGS | two relations, same AGS | keep the lower relation id; listed in note | N/A |
| No centre node | no admin_centre/label | name-matched place node, else bbox centre | N/A |
| Non-5-digit postcode | `postal_code=6691` | ignored | N/A |
| Invalid output | row fails schema | nothing written | exit 1 |
| Bad cache file | cached file is not valid JSON | error names the file; nothing sent or written (operator deletes it or uses `--refresh`) | exit 1 |

</intent-contract>

## Code Map

- `pipeline/config.ts` -- add `OVERPASS_INTERPRETER_URL = 'https://overpass-api.de/api/interpreter'`, `OVERPASS_DELAY_MS`, `OVERPASS_TIMEOUT_MS`, `OVERPASS_ROBOTS_EXEMPT`, next to the Nominatim constants.
- `pipeline/fetch/index.ts` -- `robotsExempt` already exists (exact origin + pathname). Only the doc comment naming its users changes. `get()` returns `FetchFailure.reason`/`status` for the retry decision.
- `tools/geocode.ts` -- pattern to mirror: injectable `fetchImpl`, `delayMs`, `timeoutMs`, `log`, `error`, a UA-checking `fetchImpl` wrapper, `if (import.meta.main)`, cache-first writes.
- `tools/paths.ts` -- add `PLACES_DIR`, `PLACES_CACHE_DIR`, `PLACES_NOTE_PATH`, `PUBLIC_DIR`, `PLACES_PATH`.
- `shared/directory.ts` -- `slugify` shows the existing umlaut style; the place normaliser is separate (different folding rule).
- `tests/import-rules.test.ts` -- `tools` may import `pipeline/fetch`, `shared` and `pipeline/config.ts`; `shared` imports nothing project-internal. No change.
- `tests/geocode.test.ts`, `tests/fetch.test.ts` -- `tmp()`, `quiet`, and fake-network helpers to copy.
- `ARCHITECTURE-SPINE.md` AD-5 and Deferred "Places dataset source" -- amend.
- `.gitignore` -- add `data/places/cache/`.

## Tasks & Acceptance

**Execution:**
- [ ] `pipeline/config.ts` -- Overpass constants -- one place for endpoint, pacing, exemption.
- [ ] `shared/places.ts` -- schema, state codes, normaliser, `isInBoundary` -- the public contract (AD-9) used by 1.8–1.10.
- [ ] `tools/paths.ts`, `.gitignore` -- places paths; cache ignored.
- [ ] `tools/build-places.ts` -- pure `indexQuery()`, `prefixQuery(prefix)`, `bavariaQuery()`, `parseIndex`, `parsePrefixResponse`, `stitchRings`, `simplifyRing`, `buildPlaces(inputs)`, `placesNote(...)`, and `runBuildPlaces({ dir?, publicDir?, fetchImpl?, delayMs?, timeoutMs?, sleep?, refresh?, log?, error? })` plus the CLI. Log one line per request and a summary.
- [ ] `package.json` -- script `"build:places": "node tools/build-places.ts"`.
- [ ] `ARCHITECTURE-SPINE.md` -- AD-5: Overpass `/api/interpreter` becomes the second explicit exemption (manual, cached, never scheduled, operator decision 2026-10-27), and the "only robots exemption" wording is replaced. Deferred: the places dataset is resolved as OSM via Overpass.
- [ ] `tests/places.test.ts`, `tests/build-places.test.ts` -- normaliser cases (Gunzburg/Guenzburg/günzburg/Günzburg, ß, whitespace), schema accept/reject, `isInBoundary` with a hole, every matrix row with fixture Overpass JSON, UA and delay checks, retry schedule, and a committed-data test (`places.json` parses, BY row count > 2000, München and both `Hausen` rows present with distinct districts, a Munich point inside and a Berlin point outside the boundary).
- [ ] Live run: `npm run build:places`, then a second run to confirm 0 requests and a byte-identical file. Commit `places.json` and `places-note.md` with row count and gzipped size in the message.

**Acceptance Criteria:**
- Given the committed `places.json`, when it is parsed with `placesSchema`, then it is valid, covers all 16 states, and has a Bavaria boundary that contains Munich (48.137, 11.575) and excludes Berlin (52.52, 13.405).
- Given two Bavarian rows named `Hausen`, when listed, then each has a different `district`.
- Given `places-note.md`, when the operator opens it, then it records the dataset (OSM via Overpass, ODbL), the data timestamp, and the gzipped size, flagged if over 300 KB.
- Given the live run, when it finished, then every request carried the bot User-Agent, went only to `overpass-api.de/api/interpreter`, and no geocoder was contacted.

## Spec Change Log

### 2026-10-27 — Operator stopped the live run; partial build
- **Trigger:** the public Overpass server was too busy (2 of 38 prefix queries in about 25 minutes, with retries). The operator said: "stop it for now. Lets continue with only available data. Add a story to continue later".
- **Amended (outside the intent contract):** `tools/build-places` gains `--cached-only`. It sends nothing and builds from whatever is cached, and needs the `index` plus at least one `ags-*` file. `places.json` gains `complete` (boolean) and `missing` (sorted query names left out). `bavaria` may be empty only when `missing` includes `bavaria`. The note gets a "PARTIAL BUILD" section. A full build is unchanged (`complete: true`, `missing: []`). The committed-data tests check 16 states only when the file is complete, and skip the boundary test while `bavaria` is missing.
- **Data:** `ags-091` … `ags-097` were seeded from the single whole-Bavaria probe made during planning (same query shape, OSM base 2026-10-27T19:17:35Z), split by prefix. `index`, `ags-010` and `ags-020` came from the live run.
- **Avoids:** a file with no Bavaria rows, or a partial file that looks complete.
- **KEEP:** the full-build path, its retry and cache rules, and every test of them.
- **Follow-up:** Story 1.11 "Complete the place table" in `epics.md`.

## Review Triage Log

## Design Notes

Postcode ↔ municipality is resolved server-side because the geometry is too big to handle locally: Bavaria's municipality outlines alone are 131 MB from Overpass. A probe of the per-municipality query for all of Bavaria (2,217 municipalities) took 14.5 minutes and returned 12.8 MB: München got 70 postcodes, 2,058 of Bavaria's 2,069 postcode areas were linked, and the only municipalities with none were 75 unincorporated forests and lakes. A whole-state query is too close to the server timeout, hence the 3-digit prefix split. A postcode is linked to every municipality that has a named place inside that postcode area. This avoids false links from shared border ways, which an area-overlap query would produce.

Sketch of a prefix query (`ags-091`, Oberbayern):

```
[out:json][timeout:900];
rel[boundary=administrative][admin_level~"^(4|6|8)$"]["de:amtlicher_gemeindeschluessel"~"^091[0-9]{5}$"]->.munis;
.munis out body center qt;
foreach.munis->.m(.m out ids; .m map_to_area->.a;
  node(area.a)[place~"^(city|town|…|locality)$"]->.p; .p out qt;
  .p is_in->.in; area.in[boundary=postal_code]; out tags;);
```

The response is a header block (municipalities with tags, members and centre), then one group per municipality: a tagless relation marker, its place nodes, then its postcode areas.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run check:directory && npm run build` -- expected: all exit 0.
- `npm run build:places` (second run) -- expected: "0 requests sent"; `git status --short data/public` empty afterwards.
- `grep -rnE "\bfetch\(" tools shared pipeline --include='*.ts' | grep -v "pipeline/fetch"` -- expected: no output.

## Auto Run Result

- **Status:** in-review. The implementation is done, but the step-04 review pass has not run (stopped at the operator's request).
- **Summary:** `tools/build-places.ts` (`npm run build:places`) builds `data/public/places.json` from OpenStreetMap via Overpass through `pipeline/fetch`, using a second explicit robots exemption for `overpass-api.de/api/interpreter` (AD-5 amended). `shared/places.ts` holds the schema, state codes, `normalizePlaceName` and `isInBoundary`. The committed file is a **partial build** (`complete: false`): 3,247 rows (BY 2,142, SH 1,104, HH 1), 2,588 distinct postcodes, 70,740 bytes gzipped, with no Bavaria boundary yet. 75 uninhabited Bavarian areas (forests, lakes) were dropped.
- **Verification:** `npm run typecheck`, `npm run build` and `npm run check:directory` exit 0. `npm test` runs 380 passed and 1 skipped (the boundary test, until `bavaria` is fetched). The 1 failure is `tests/directory.test.ts`, which expects 120 centres: it comes from the operator's uncommitted hand edits to `data/directory/centres.json` (119 entries), not from this story. A second `--cached-only` run leaves `places.json` byte-identical. There is no direct `fetch(` outside `pipeline/fetch`.
- **Residual risks:** the place table is not complete until Story 1.11. The Bavarian rows come from a probe, not the prefix queries. Postcodes are linked only through named place nodes, so a postcode area with no place node is missing (Bavaria: 2,058 of 2,069 linked).

