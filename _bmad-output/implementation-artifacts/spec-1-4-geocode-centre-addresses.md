---
title: 'Story 1.4: Geocode centre addresses'
type: 'feature'
created: '2026-10-27'
status: 'done'
review_loop_iteration: 0
baseline_commit: '44fb1a46f8004caf5696aaec13c0089af28056e2'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** All 120 directory centres have `lat`/`lon` `null`, so later stories (1.6 snapshot, 1.8 search) cannot compute distances. FR19 requires geocoding once via Nominatim at ≤ 1 req/s, re-geocoding only changed addresses, and never guessing.

**Approach:** Add an operator tool `tools/geocode.ts` that looks up each centre address with Nominatim's structured `/search` through `pipeline/fetch`. It caches every lookup by query in `data/directory/geocode-cache.json`, writes accepted coordinates to `centres.json`, and reports rejected entries in `data/directory/geocode-note.md`. Nominatim's robots.txt disallows `/search` for all bots. The OSMF usage policy governs API use and permits this small, cached, identified, one-off job, so `pipeline/fetch` gains a narrow, explicit robots exemption for that one endpoint (operator decision, 2026-10-27), recorded in AD-5.

## Boundaries & Constraints

**Always:**
- All Nominatim HTTP goes through `createFetchClient`: bot `User-Agent`, one request at a time, ≥ 1100 ms between requests, default timeout. Processing is serial (single thread).
- Robots exemption: a client option `robotsExempt: readonly { origin: string; path: string }[]`. A URL whose `origin` and `pathname` exactly match an entry skips the robots check, and no robots.txt is fetched for it. Everything else (other paths on the same host, other hosts, redirect targets that do not match) keeps the full robots rules. Only `tools/geocode.ts` passes the option, with the one entry `{ origin: 'https://nominatim.openstreetmap.org', path: '/search' }` from `pipeline/config.ts`.
- Query: structured `/search?street=<street>&postalcode=<postcode>&city=<city>&country=Germany&format=jsonv2&addressdetails=1&limit=1` (URL-encoded via `URLSearchParams`). The cache key is `"<street>, <postcode> <city>"`.
- Acceptance rules, applied in this order to the (cached or fresh) result: empty array → `no match`; `address["ISO3166-2-lvl4"] !== "DE-BY"` or the point is outside `BAVARIA_BBOX` → `outside Bavaria`; `place_rank < 26` → `imprecise match (place_rank N)`; `address.postcode` present and ≠ entry postcode → `postcode mismatch (<found>)`. Otherwise accept `lat`/`lon` as numbers rounded to 6 decimals.
- A rejected entry is reported with its reason and gets `lat: null, lon: null` (never a guess, and never old coordinates for a changed address).
- Every successful lookup (including an empty array) is cached, so a rerun sends zero requests. Failed fetches (`ok: false`, non-JSON or non-array body) are not cached. The entry is left unchanged, listed under failures, and the tool exits 1.
- `shared/directory.ts` exports `BAVARIA_BBOX = { minLat: 47.2, maxLat: 50.6, minLon: 8.9, maxLon: 13.9 }`. `centreSchema` rejects non-null coordinates outside it (issue on `lat` or `lon`), so CI catches bad coordinates.
- The tool validates the new directory with `directorySchema` before writing, writes with `serializeDirectory`, and writes only `data/directory/`. The operator commits.

**Never:**
- No other Nominatim endpoint (`/details`, `/reverse`, `/lookup`), no fallback query (e.g. postcode/city only), no parallel requests, no scheduled or CI run of the tool.
- No new dependencies. No TypeScript-only syntax (tools run with plain `node`).
- No changes to `verify-directory`/`seed-directory` behaviour, no `data/state/` writes (AD-6), no snapshot or UI work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New entry | `lat: null`, no cache entry | 1 request; Bavarian street-level match → coords written, query cached, `centres[id]` recorded | N/A |
| Unchanged | coords set, `centres[id].query` = current key | no request, entry untouched | N/A |
| Address changed | coords set, recorded query ≠ current key | re-geocoded (cache or request); rejection clears coords | N/A |
| Hand-set coords | coords set, no `centres[id]` record | untouched, listed as "coordinates set by hand" | N/A |
| Rerun | everything cached | 0 requests | N/A |
| Shared address | two entries with the same key | 1 request, both use it | N/A |
| No match | `[]` | coords `null`, reported `no match`, result cached | N/A |
| Outside Bavaria | `DE-BW` or point outside bbox | coords `null`, reported | N/A |
| Imprecise | `place_rank` 16 (city) | coords `null`, reported | N/A |
| Fetch failure | timeout / HTTP 503 / bad JSON | entry unchanged, listed as failure, not cached | exit 1 |
| Robots exemption | client with exemption; robots disallows `/search` | `/search?...` requested without fetching robots.txt; `/details` on the same host → `robots-disallowed` | N/A |
| Bad coordinates in file | `lat: 52.5` | `check:directory` fails naming the entry and `lat` | fail |

</intent-contract>

## Code Map

- `pipeline/fetch/index.ts` -- `createFetchClient` options and `get()`. The robots check is at `const { rules } = await robotsFor(current.origin)` inside the redirect loop; skip it there when `current` matches an exemption. `robotsFor` must then not be called, so no robots.txt request happens.
- `pipeline/config.ts` -- add `NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'`, `NOMINATIM_DELAY_MS = 1100`, `NOMINATIM_ROBOTS_EXEMPT` (the one exemption entry), next to `FETCH_DELAY_MS`.
- `shared/directory.ts` -- `centreSchema.superRefine` already pairs lat/lon. Add the bbox check there, and export `BAVARIA_BBOX` and `isInBavariaBox(lat, lon)`.
- `tools/paths.ts` -- add `GEOCODE_CACHE_FILE`/`_PATH` and `GEOCODE_NOTE_FILE`/`_PATH`.
- `tools/verify-directory.ts` -- reference for patterns: `loadDirectory` (exit 1 on missing/invalid file), `runVerify(options)` with injectable `dir`, `fetchImpl`, `delayMs`, `log`, `error`, the UA-checking `fetchImpl` wrapper, and `if (import.meta.main)`. Mirror this in `runGeocode`.
- `tests/seed-verify.test.ts` -- `fakeNet`, `tmp()` and `quiet` helpers to copy. `tests/fetch.test.ts` -- `fakeNetwork` helper for the exemption tests.
- `tests/directory.test.ts:32` -- an existing valid entry with `lat: 49.47`. Keep fixtures inside the bbox.
- `tests/import-rules.test.ts` -- allows `tools → pipeline/fetch, shared, pipeline/config.ts`. No change needed.
- `_bmad-output/planning-artifacts/architecture/architecture-bgtsearch-2026-10-25/ARCHITECTURE-SPINE.md` AD-5 -- the Nominatim sentence to amend.
- `data/directory/centres.json` -- 120 entries, 119 distinct addresses, all coords `null`, none opted out.

## Tasks & Acceptance

**Execution:**
- [ ] `pipeline/config.ts` -- add the Nominatim constants -- one place for endpoint, rate and exemption.
- [ ] `pipeline/fetch/index.ts` -- add the `robotsExempt` option per Always -- the only way to reach `/search` without weakening robots checks elsewhere.
- [ ] `shared/directory.ts` -- add `BAVARIA_BBOX`, `isInBavariaBox` and the schema bbox issue -- CI guard against bad coordinates.
- [ ] `tools/paths.ts` -- add the cache and note paths.
- [ ] `tools/geocode.ts` -- pure `queryKey(address)`, `searchUrl(address)`, `parseNominatim(text)` → cached result or `null` on invalid body, `assessResult(result, entry)` → `{ ok, lat, lon } | { ok: false, reason }`. Add `runGeocode({ dir?, fetchImpl?, delayMs?, timeoutMs?, now?, log?, error? })` and the CLI `node tools/geocode.ts`. Cache file shape: `{ "queries": { [key]: { "fetched_at": ISO, "result": null | { lat, lon, state_code, postcode, place_rank, display_name } } }, "centres": { [centre_id]: { "query", "lat", "lon" } } }`, keys sorted, tab-indented, trailing newline. A missing cache file means empty; an invalid one exits 1. Accepted entries get a `centres` record; rejected ones lose theirs. The note lists run time, counts (requests sent, cache hits, accepted, rejected, unchanged, hand-set, failed), every rejected entry (`centre_id`, address, reason) and every failure. The log prints one line per request and a summary.
- [ ] `package.json` -- script `"geocode": "node tools/geocode.ts"`.
- [ ] `ARCHITECTURE-SPINE.md` AD-5 -- amend the Nominatim sentence: "`tools/geocode` calls only Nominatim's `/search` (manual, cached, ≤ 1 req/s, never scheduled). Nominatim's robots.txt targets crawlers, and its OSMF usage policy governs API use, so that one endpoint is the only robots exemption in `pipeline/fetch` (explicit per-client option). Every other host and path keeps full robots checks."
- [ ] `tests/fetch.test.ts`, `tests/directory.test.ts`, `tests/geocode.test.ts` -- cover every matrix row, plus: every request carries the bot UA; requests are ≥ the delay apart; the cache file round-trips; `runGeocode` on an invalid `centres.json` exits 1.
- [ ] Live run: `npm run geocode` exactly once, then `npm run geocode` again to confirm 0 requests. Commit `centres.json`, `geocode-cache.json` and `geocode-note.md`, with the accepted/rejected counts in the commit message.

**Acceptance Criteria:**
- Given the committed directory, when `npm run check:directory` runs, then it prints `120 centres OK`, and every non-null coordinate lies inside `BAVARIA_BBOX`.
- Given the committed cache, when `npm run geocode` runs again, then it sends 0 requests and leaves `centres.json` byte-identical.
- Given the live run, when it finished, then every request carried the bot User-Agent, went only to `nominatim.openstreetmap.org/search`, and requests were ≥ 1100 ms apart.
- Given `geocode-note.md`, when the operator opens it, then every centre without coordinates is listed with its reason.

## Spec Change Log

## Review Triage Log

### 2026-10-27 — Review pass
- verdicts: 31 findings — high 0, medium 0, low 25, false 4, maybe-false 2
- findings:
  - `[false]` `[reject]` No user surface (map, distances) is exercised (IA) — by the epic's dependencies, 1.6 publishes and 1.8 shows distances; this story produces the coordinates.
  - `[low]` `[patch]` Changed-address detection depends on a sidecar cache that CI does not check (IA) — grouped with the committed-cache test patch below.
  - `[false]` `[reject]` The diff changes `pipeline/fetch` and AD-5, which the story does not name (IA) — the operator chose the exemption on 2026-10-27 after the robots.txt blocker; it is limited to the exact origin and path and tested.
  - `[false]` `[reject]` The bbox in the shared schema reaches beyond the story (IA) — intended: the spec puts it there so CI catches bad hand-set coordinates as well.
  - `[low]` `[patch]` The 1100 ms constant is not tested (IA) — added a test asserting `NOMINATIM_DELAY_MS >= 1000`.
  - `[low]` `[reject]` Keeps requesting after a 429/403 (ECH) — at ≥ 1.1 s spacing on a one-off manual run of ~120 lookups, throttling is unlikely; a stop-on-throttle path adds a branch and run state; failures are listed and the tool exits 1.
  - `[low]` `[patch]` A crash between writing `centres.json` and the cache leaves coordinates with no record (ECH) — the cache is now written first.
  - `[low]` `[reject]` An interrupted run loses its lookups (ECH) — a rerun repeats at most ~119 requests; incremental persistence adds machinery.
  - `[low]` `[reject]` Coordinates nulled by hand are restored from the cache (ECH) — rare; the operator removes the cache record as well; a deny-list adds state.
  - `[low]` `[patch]` Coordinates hand-edited after geocoding count as unchanged and are not listed (ECH) — now treated as hand-set (listed, left alone, never overwritten); test added.
  - `[low]` `[reject]` A hand-set centre whose address changes keeps stale coordinates (ECH) — hand-set coordinates are operator-owned by design; storing their address adds state.
  - `[low]` `[reject]` Orphan cache records for removed ids; a reused id is misclassified (ECH) — `centre_id`s are stable and never reused (AD-8); orphans are harmless.
  - `[maybe-false]` `[reject]` A multi-value postcode ("90762;90763") is rejected as a mismatch (ECH) — not seen in the 112 accepted or 3 mismatched results; it would only be low.
  - `[low]` `[patch]` AD-5's 4-visits-per-24 h cap would forbid geocoding once the visit log exists (BH) — AD-5 now says the cap applies to centre hosts and Nominatim is limited by its usage policy.
  - `[low]` `[reject]` No backoff after errors (BH) — same as the ECH 429/403 row.
  - `[low]` `[reject]` "No match" is cached forever (BH) — repeating identical queries is what the usage policy discourages; correcting the address makes a new query key.
  - `[low]` `[reject]` A null postcode passes; street and city are not compared (BH) — the spec's rules; a structured street query plus `place_rank ≥ 26` constrains the street.
  - `[maybe-false]` `[reject]` `limit=1` misses a correct second candidate (BH) — the spec fixes `limit=1`; whether Selb or Kronach would match on candidate 2 is unknown; it would only be low.
  - `[low]` `[reject]` Addresses are not normalised; 8 centres stay without coordinates (BH) — the data needs operator fixes, listed in `geocode-note.md`; recorded as a residual risk.
  - `[low]` `[reject]` Hand-set coordinates are never re-checked on an address change (BH) — same as the ECH hand-set row.
  - `[low]` `[reject]` An operator cannot remove a bad accepted point (BH) — same as the ECH nulled-coordinates row.
  - `[low]` `[reject]` A failed re-geocode keeps the old point under the new address (BH) — the spec's matrix keeps the entry unchanged on failure; the next run retries.
  - `[low]` `[reject]` The cache is never pruned (BH) — same as the ECH orphan row.
  - `[low]` `[patch]` The committed-data test checks no cache consistency (BH) — grouped with the committed-cache test patch below.
  - `[low]` `[patch]` The bbox check is written twice in `shared/directory.ts` (BH) — grouped with the VG one-sided bbox test patch; the new south/east rows pin the inline check.
  - `[low]` `[reject]` "outside Bavaria" is reported when the state is missing (BH) — the spec's rule wording; cosmetic.
  - `[false]` `[reject]` ODbL attribution is only in the note (BH) — the footer attribution (Story 1.2) and the About page's Nominatim credit (Story 1.7) are planned in the epic.
  - `[low]` `[patch]` The schema bbox is tested only north and west (VG) — added south-latitude and east-longitude rejection rows.
  - `[low]` `[patch]` The note's "NO" self-check lines are never asserted (VG) — added a `geocodeNote` test for both NO lines and the n/a gap text.
  - `[low]` `[patch]` The committed `geocode-cache.json` is not validated or checked against `centres.json` (VG) — added a committed-data test: it loads, round-trips byte-identically, and records match coordinates both ways.
  - `[low]` `[patch]` Hand-edited coordinates with a matching query count as unchanged (VG other) — same fix as the ECH hand-edited row.

## Design Notes

Changed-address detection needs to know which query produced the stored coordinates, but the directory schema has no field for it. The cache's `centres` map records it, so `centres.json` keeps its schema. Coordinates with no record were set by hand. They are operator-owned and left alone.

Cached entries store the raw fields the rules need, not the verdict, so tightening the rules later never needs a new request.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run check:directory && npm run build` -- expected: all exit 0; check prints `120 centres OK`.
- `npm run geocode` (second run) -- expected: "0 requests sent"; `git status --short data/directory` empty afterwards.
- `grep -rnE "\bfetch\(" tools shared pipeline --include='*.ts' | grep -v "pipeline/fetch"` -- expected: no output.

## Auto Run Result

- **Summary:** `tools/geocode.ts` (`npm run geocode`) geocodes the centre directory with Nominatim's structured `/search` through `pipeline/fetch`. It is serial, ≥ 1100 ms apart, sends the bot User-Agent, and caches every lookup in `data/directory/geocode-cache.json`. Only Bavarian, street-level matches whose postcode agrees are accepted; everything else is reported and left without coordinates. Nominatim's robots.txt disallows `/search` for all bots, so after checking the OSMF usage policy the operator approved a narrow `robotsExempt` option in `pipeline/fetch` for that one endpoint, recorded in AD-5. The live run accepted 112 centres and rejected 8, which are listed in `data/directory/geocode-note.md`.
- **Files changed:**
  - `pipeline/fetch/index.ts` — `robotsExempt` option (exact origin and path; no robots.txt fetched for those).
  - `pipeline/config.ts` — Nominatim URL, 1100 ms delay, the one exemption entry.
  - `shared/directory.ts` — `BAVARIA_BBOX`, `isInBavariaBox`; the schema rejects coordinates outside the box.
  - `tools/geocode.ts`, `tools/paths.ts`, `package.json` — the tool, its paths and the `geocode` script.
  - `ARCHITECTURE-SPINE.md` — AD-5: the Nominatim `/search` robots exemption and its visit-cap scope.
  - `tests/geocode.test.ts`, `tests/fetch.test.ts`, `tests/directory.test.ts` — tool, exemption, bbox and committed-data tests.
  - `data/directory/centres.json`, `geocode-cache.json`, `geocode-note.md` — coordinates, cache and the operator note.
- **Review:** 31 findings (low 25, false 4, maybe-false 2; no high or medium). 7 low entries patched: write order (cache first), hand-edited coordinates treated as hand-set, AD-5 visit-cap scope, south/east bbox schema tests, note "NO" line test, committed-cache consistency test, delay constant test. Deferred: none. Rejected: every other finding, each with its reason in the Review Triage Log.
- **Follow-up review recommended:** false. Patched entries by verdict: high 0, medium 0, low 7.
- **Verification:** `npm run typecheck`, `npm test` (10 files, 332 tests), `npm run check:directory` (`120 centres OK`) and `npm run build` all exit 0. A second `npm run geocode` sends 0 requests and leaves `data/directory` unchanged. No direct `fetch(` outside `pipeline/fetch`. Live run: 119 requests, all with the bot User-Agent, all to `/search`, smallest gap 1161 ms, no robots.txt fetched.
- **Residual risks:**
  - 8 centres have no coordinates and will not appear in distance searches until the operator fixes their address or sets coordinates by hand: no match for `muenchner-vhs-gmbh`, `vhs-der-gemeinden-im-landkreis-roth`, `vhs-kaufering` (likely "Albert-Schweitzer-Str. 4a"), `volkshochschule-eching-e-v`, `volkshochschule-kitzingen` (building name in the street field); postcode mismatch for `bayerisches-rotes-kreuz`, `vhs-fichtelgebirge`, `vhs-kreis-kronach-e-v`.
  - Accepted points are plausible (Bavarian, street-level, same postcode) but were not checked one by one against a map.
  - AD-5 was edited, so the cached `epic-1-context.md` is now older than the planning artifacts and will be recompiled by the next story run.
