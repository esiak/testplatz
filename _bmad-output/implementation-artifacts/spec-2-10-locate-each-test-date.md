---
title: 'Story 2.10: Locate each test date'
type: 'feature'
created: '2026-10-30'
status: 'done'
baseline_revision: '4f537f9c6c7bef6dba0c3ef28bfbef68f45d1cb4'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Every test date has its own address, but the pipeline publishes no coordinates for it. Distance can only be measured from the centre, so dates held in another town (Herrsching for VHS Starnberger See, Roth for Hilpoldstein) are placed wrongly.

**Approach:** Add a pipeline stage `locate` between normalise and merge. It gives every listing `lat`, `lon` and `location` (`venue` | `centre`) by matching the centre address, reading a cache in `data/state/venues.json`, or looking up new addresses on Nominatim (serial, capped, polite). Merge persists the new lookups. Publish emits snapshot `schemaVersion` 3. The Nominatim request/parse/acceptance code moves from `tools/geocode.ts` to `pipeline/fetch/nominatim.ts` and is shared.

## Boundaries & Constraints

**Always:**
- Per listing, in this order (FR36):
  1. Address came from normalise's centre fallback → centre coordinates, `location: centre`, reason `no provider address`.
  2. Centre has coordinates and `normaliseAddress(listing.address) === normaliseAddress(formatAddress(centre.address))` → centre coordinates, `location: venue`, no request.
  3. Address does not parse as `street, NNNNN city` → centre, reason `unparseable address`.
  4. Cache entry for the normalised address: a hit → its coordinates, `venue`. A miss younger than 30 days (by `runAt`) → centre, with the cached reason. An older miss counts as not cached.
  5. Otherwise one Nominatim lookup per distinct normalised address per run. An accepted hit (same rules as `tools/geocode`: DE-BY and in the Bavaria box, `place_rank` ≥ 26, postcode equal to the parsed postcode or absent) → `venue`, cached as a hit. No match or rejected → centre, cached as a miss with the reason. Timeout, non-2xx or an invalid body → centre, reason `lookup failed: …`, nothing cached.
  6. Once `LOCATE_MAX_LOOKUPS_PER_RUN` requests have been sent, further uncached addresses → centre, reason `lookup cap reached`, nothing cached.
- The centre fallback copies the centre's `lat`/`lon`, which may both be `null`. Nothing is guessed.
- `normaliseAddress` lives in `shared/` and is the only key function. It lowercases, maps `straße` / `strasse` / `str.` to one form, collapses whitespace and normalises spacing around commas.
- Lookups go through `createFetchClient` with only `NOMINATIM_ROBOTS_EXEMPT`, `NOMINATIM_DELAY_MS` (≥ 1 s) and the bot User-Agent, one at a time. A lookup failure never fails the run or a centre.
- The run log has one line per distinct (centre, address) that fell back to the centre, with its reason, plus one locate summary line (listings by location, requests sent, cache hits). It never prints URLs.
- `data/state/venues.json` (`venuesVersion: 1`, entries keyed by normalised address: `{ fetched_at, lat, lon, reason }`, where a hit has numbers and `reason: null` and a miss has nulls and a reason) is validated by its own schema in `shared/`. Only merge writes it: atomically, and only when it changed. A missing file reads as empty. An invalid file fails the run before anything is written, like a bad `state.json`.
- Listing location fields: `lat` and `lon` are both numbers inside the Bavaria box or both `null`. `location` is `venue` or `centre`. Snapshot listings require all three; `SNAPSHOT_SCHEMA_VERSION = 3`.
- Stored state listings may lack the three fields (written before this story). Publish fills a missing set with the centre's coordinates and `location: centre`. `STATE_VERSION` stays 1.
- The committed `data/public/snapshot.json` is moved to v3 in the same commit, with no network. Each listing gets centre coordinates, with `location: venue` when it matches the centre address under rule 2 and `location: centre` otherwise. `web/` validates v3 and keeps measuring from the centre.

**Never:**
- No web distance or selection changes (Story 2.11). No lookups from `web/` or from `tools/` beyond today's centre geocoding.
- Locate never writes files. No new dependencies. No change to `tools/geocode` behaviour or its cache file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same as centre | "Löwenstraße 15, 96450 Coburg", centre "Löwenstr. 15, 96450 Coburg" (located) | centre lat/lon, `venue`, 0 requests | — |
| Cached hit | key present as a hit | cached lat/lon, `venue`, 0 requests | — |
| New hit | "Jahnstraße 10, 82211 Herrsching", not cached | 1 request; `venue` with the hit's lat/lon (6 decimals); merge writes the hit | — |
| Rejected hit | hit postcode 95615 for "…, 95100 Selb" | centre, reason `postcode mismatch (95615)`; cached as a miss | — |
| Unparseable | "Raum 2, Hauptstr. 1, 80331 München" or no postcode | centre, `unparseable address`, 0 requests | — |
| Provider fallback | reader address `null` | centre, `no provider address` | — |
| Nominatim down | 503 / timeout / bad JSON | centre, `lookup failed: …`; nothing cached; run exits 0 | logged |
| Cap reached | cap 1, two new addresses | 1 request; second → centre, `lookup cap reached`, not cached | — |
| Old miss | miss `fetched_at` 31 days before runAt | looked up again | — |
| Centre without coordinates | centre lat/lon null, fallback | `lat: null, lon: null, location: centre` | — |
| Shared address | 3 listings, same new address | 1 request | — |
| Rerun | unchanged collect, cache filled | 0 requests; `venues.json` byte-identical | — |

</intent-contract>

## Code Map

- `tools/geocode.ts:20-121` -- `MIN_PLACE_RANK`, `NominatimHit`, `hitSchema`, `searchUrl(address)`, `parseNominatim(text)`, `assessResult(result, entry)` (uses only `entry.address.postcode`), `round6`. Move these to `pipeline/fetch/nominatim.ts`; there `assessHit(result, postcode)`. `tools/geocode.ts` re-exports the names `tests/geocode.test.ts` imports (`assessResult`, `parseNominatim`, `searchUrl`, `NominatimHit`) so the tests run unchanged. `cacheSchema` keeps using the moved hit schema.
- `pipeline/config.ts:18-28` -- Nominatim constants; update the exemption comments (also used by locate). Add `LOCATE_MAX_LOOKUPS_PER_RUN = 50`.
- `pipeline/fetch/index.ts:38-57` -- `createFetchClient` options; update the `robotsExempt` doc comment. `FetchImpl`, `nativeFetch`.
- `shared/directory.ts:83-97,103` -- `isInBavariaBox`, `BAVARIA_BBOX`, `Address`, `formatAddress`.
- `shared/listing.ts:73-110` -- `listingFieldsSchema`, `checkListing`, `listingSchema`, which stay the normalise output. Add `LOCATIONS`, the location field shapes, `checkLocation`, `locatedListingSchema` / `LocatedListing`.
- `shared/address.ts` (new) -- `normaliseAddress(text)` and `parseAddress(text) → Address | null` (exactly one comma; `^street, (\d{5}) city$` after collapsing whitespace).
- `shared/venues.ts` (new) -- `VENUES_VERSION`, `venueEntrySchema`, `venuesSchema`, `emptyVenues`, `VENUE_MISS_RETRY_MS` (30 days).
- `shared/state.ts:18-27` -- `storedListingSchema`: add optional `lat`/`lon`/`location` with `checkLocation` when present.
- `shared/snapshot.ts:6,52-59` -- version 3; `snapshotListingSchema` extends the located fields.
- `pipeline/stages/normalise.ts:98-142` -- `normaliseCentre` keeps returning `Listing[]`. The `ok` outcome gains `centreAddressIds: string[]` (ids whose address came from the fallback at line 107), produced by a shared internal helper.
- `pipeline/stages/locate.ts` (new) -- `locateRun({ directory, outcomes, venues, runAt, client?/fetch options, maxLookups, log }) → { outcomes: LocatedOutcome, lookups: Record<key, VenueEntry>, stats }`. Also exports `LocatedOutcome` and the pure per-listing rule function.
- `pipeline/stages/merge.ts` -- `MergeInput.outcomes` becomes `LocatedOutcome`. Add `venues` + `lookups` in, `venues` out (merged; keys sorted). Add `readVenues(path)`, `serializeVenues`. `writeMergeResult` validates all three files before writing, then writes visits → venues → state.
- `pipeline/stages/paths.ts` -- `VENUES_PATH` (`data/state/venues.json`).
- `pipeline/stages/publish.ts:82-84` -- fill missing location fields from the centre; `outcomes` type → `LocatedOutcome`.
- `pipeline/stages/run.ts:92-178` -- read venues with the other inputs, call locate after normalise (including replays), pass to merge, add venues to the `stateChanged` check, and add a `venuesPath` option and a `locate?: { fetchImpl?, delayMs?, timeoutMs?, sleep?, maxLookups? }` option. Update the header comment.
- `tests/run.test.ts:155-170` -- the `pipeline()` helper must pass a fake Nominatim (no real network). The `schemaVersion` 2 assertion at line 189 becomes 3. Directory centre default address "Hauptstraße 1, 80331 München"; ebersberg fixture listings carry another address.
- `tests/merge.test.ts:49`, `tests/normalise.test.ts:150`, `tests/snapshot.test.ts:131,253`, `tests/fixtures/snapshot.ts:39-57`, `tests/state-writers.test.ts` -- update for the new shapes and version.
- `tests/import-rules.test.ts:45-53` -- layers. stages → fetch is allowed, and so is tools → fetch.
- `data/public/snapshot.json` -- v2 → v3 per Always.
- `docs/operations.md` -- mention `venues.json` and the unlocated-address log lines.

## Tasks & Acceptance

**Execution:**
- `pipeline/fetch/nominatim.ts`, `tools/geocode.ts`, `pipeline/config.ts` -- extract the shared lookup and add the cap constant -- AC 1, AD-5.
- `shared/address.ts`, `shared/venues.ts`, `shared/listing.ts`, `shared/state.ts`, `shared/snapshot.ts` -- normaliser, parser, venue cache schema, location fields, v3 -- FR36, AD-9.
- `pipeline/stages/normalise.ts` -- `centreAddressIds` -- needed for rule 1.
- `pipeline/stages/locate.ts` -- the stage -- FR36.
- `pipeline/stages/merge.ts`, `paths.ts`, `publish.ts`, `run.ts` -- persist venues, fill legacy listings, wire the stage -- AD-6.
- `data/public/snapshot.json` -- one-off move to v3 (generated by a scratch script using `normaliseAddress`, not committed as a tool).
- `tests/locate.test.ts` (new), `tests/address.test.ts` (new), and updates to `tests/merge.test.ts`, `tests/state-writers.test.ts`, `tests/run.test.ts`, `tests/snapshot.test.ts`, `tests/normalise.test.ts`, `tests/fixtures/snapshot.ts` -- every matrix row, venue file round trip, run end-to-end with a fake Nominatim.
- `docs/operations.md` -- operator note.

**Acceptance Criteria:**
- Given `tests/geocode.test.ts` unchanged, when `npm test` runs, then it passes against the refactored `tools/geocode.ts`.
- Given a full `runPipeline` with a fake provider network and a fake Nominatim, when it runs twice, then the first run writes `venues.json` and a v3 snapshot whose every listing has `lat`/`lon`/`location`, and the second run sends no Nominatim requests and leaves `venues.json` unchanged.
- Given an invalid `venues.json`, when the run starts, then it exits 1 and writes nothing.
- Given the whole repo, when `npm run typecheck`, `npm test` and `npm run build` run, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-30 — Review pass
- verdicts: 22 findings — high 0, medium 0, low 20, false 2, maybe-false 0
- findings:
  - `false` `reject` Intent: no `web/` file changed although the AC says web is updated to accept v3 — `web/src/data/snapshot.ts` validates with the shared `snapshotSchema`/`SNAPSHOT_SCHEMA_VERSION`, now 3; web tests load v3 fixtures and pass, and the committed snapshot is v3.
  - `low` `reject` Intent: committed snapshot has no geocoded venues (49 venue = centre-matching, 43 centre) — expected; the move to v3 has no network by spec, and the next scheduled run looks the addresses up.
  - `low` `reject` Intent: locate fixtures are synthetic, not the snapshot's own addresses — every AC fixture category is covered and the fixtures use real-shaped addresses (Herrsching, Selb, Coburg); a test over live data adds no guarantee.
  - `low` `reject` Intent: cap tested only at unit level — `locateRun` is the only place the cap lives; run passes it through unchanged.
  - `low` `reject` Intent: log de-duplication per (centre, address), not per address — the centre id makes each line actionable; same address under two centres is rare.
  - `low` `patch` Edge: docs suggest hand-adding a hit for an unparseable address, which rule 3 never reads — docs now limit the hand fix to no-match/rejected addresses and say unparseable ones can't be fixed that way.
  - `low` `reject` Edge: `maxLookups` NaN removes the cap — internal option; only config (50) and tests pass it.
  - `low` `reject` Edge: `delayMs` NaN removes the 1 s floor — internal option; no caller passes NaN.
  - `low` `reject` Edge: stored centre coordinates go stale for failed/skipped centres after a directory re-geocode — lasts only until the centre's next ok run; directory geocoding is manual and rare; fix adds a publish branch.
  - `low` `patch` Edge: run.ts header says `--from-collect` means "no fetch" though locate may look up — header and docs reworded.
  - `low` `patch` VG: normalise's same-minute fallback/stated duplicate branch untested — added `it.each` over both row orders asserting `centreAddressIds: []`.
  - `low` `reject` Blind: a rejected-push replay repeats lookups lost with the reset — bounded by the cap, only on a rejected push, and Nominatim answers are stable; saving lookups in the replay changes its format.
  - `low` `reject` Blind: no short-circuit while Nominatim is down (up to ~17 min) — only with many uncached addresses during an outage; steady state has few new addresses; adds a branch.
  - `low` `reject` Blind: `checkLocation` accepts `venue` with null coordinates — no code path produces it; adds a guard.
  - `low` `reject` Blind: stale centre coordinates (same as the Edge row) — same reason.
  - `false` `reject` Blind: cached hits never expire — the AC retries only misses after 30 days; hits are kept by design.
  - `low` `reject` Blind: `venues.json` only grows — tens of addresses; pruning adds logic for no user-visible gain.
  - `low` `reject` Blind: a Nominatim body without place_rank is retried every run — rare; costs one request per run within the cap.
  - `low` `patch` Blind: untested normalise duplicate branch — same root cause and fix as the VG row.
  - `low` `reject` Blind: `normaliseAddress` misses variants and rewrites "straße" inside words — applied identically to both sides, so keys still compare; a missed variant only costs one cached lookup.
  - `low` `reject` Blind: `cacheHits` counts cached misses and "1 requests" grammar — log wording only.
  - `low` `reject` Blind: untested 30-day boundary, future `fetched_at`, two raw spellings with one key — unlikely in practice; behaviour is defined (strict `<`).
  - `low` `patch` Blind: docs don't say replays may send Nominatim lookups — same root cause and fix as the Edge run.ts row.

## Design Notes

- **Why `centreAddressIds`:** a fallback address is the exact string `formatAddress(centre.address)`, and a provider address can be that same string. Only normalise knows which one it was, so it passes the ids along beside the listings and keeps the listing schema unchanged.
- **Why optional fields in state:** `state.json` already holds listings without coordinates, and bumping `STATE_VERSION` would make the next scheduled run refuse it. Every `ok` run rewrites a centre's listings with the fields. Only listings kept by a `failed` run can lack them, and publish fills those with the centre placeholder.
- Rule 2 needs centre coordinates. Without them, the address goes on to the cache and the lookup, so it can still be located.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all pass
- `npm run build` -- expected: succeeds

## Auto Run Result

Status: done

**Summary:** The pipeline now places every test date. A new stage `locate` (after normalise, before merge) gives each listing `lat`, `lon` and `location`. A date whose address matches its centre's takes the centre's coordinates (`venue`), a cached address uses `data/state/venues.json`, and a new `street, NNNNN city` address is looked up once on Nominatim (serial, ≥ 1 s apart, at most 50 per run). Anything else falls back to the centre (`centre`) with a run-log line naming the reason. Lookup failures never fail the run and are not cached. Merge writes the new lookups to `venues.json`. Publish emits snapshot `schemaVersion` 3, filling older stored listings with the centre placeholder. The Nominatim request/parse/acceptance code now lives in `pipeline/fetch/nominatim.ts`, shared with `tools/geocode.ts` (unchanged behaviour). Web still measures from the centre (Story 2.11).

**Files changed:**
- `pipeline/fetch/nominatim.ts` -- new: shared Nominatim search URL, parser, `assessHit`.
- `tools/geocode.ts` -- uses and re-exports the shared lookup.
- `pipeline/config.ts`, `pipeline/fetch/index.ts` -- `LOCATE_MAX_LOOKUPS_PER_RUN = 50`, exemption comments.
- `shared/address.ts` -- new: `normaliseAddress`, `parseAddress`.
- `shared/venues.ts` -- new: venue cache schema.
- `shared/listing.ts`, `shared/state.ts`, `shared/snapshot.ts` -- location fields; snapshot v3; optional fields in state.
- `pipeline/stages/normalise.ts` -- `centreAddressIds` on `ok` outcomes.
- `pipeline/stages/locate.ts` -- new stage.
- `pipeline/stages/merge.ts`, `paths.ts`, `publish.ts`, `run.ts` -- venue cache read/write, legacy fill, wiring.
- `data/public/snapshot.json` -- moved to v3 offline (49 venue, 43 centre).
- `docs/operations.md` -- venue cache, log lines, replay lookups.
- Tests: new `tests/locate.test.ts`, `tests/address.test.ts`; updated run, merge, normalise, snapshot, state-writers tests and `tests/fixtures/snapshot.ts`.

**Review findings:** 22 findings (high 0, medium 0, low 20, false 2). Patched 3 low entries (5 rows): docs hand-fix scope, replay wording in run.ts and docs, normalise duplicate-order test. Nothing deferred. Rejected 15 low and 2 false rows, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false. Patched entries: 0 high, 0 medium, 3 low.

**Verification:**
- `npm run typecheck` -- clean.
- `npm test` -- 34 files, 1233 passed, 1 skipped.
- `npm run build` -- succeeds.
- Matrix audit: every I/O row has a passing test in `tests/locate.test.ts`; rerun and Nominatim-down rows also end to end in `tests/run.test.ts`.

**Residual risks:**
- During implementation one test briefly ran without the fake Nominatim and sent 2 real requests; the stray `data/state/venues.json` was deleted and the test fixed.
- Real geocoding of test addresses first happens on the next scheduled run (about 25 lookups).
- `data/directory/centres.json` holds an unrelated uncommitted edit (brk-muenchen `test_page_url`), left out of this commit.
