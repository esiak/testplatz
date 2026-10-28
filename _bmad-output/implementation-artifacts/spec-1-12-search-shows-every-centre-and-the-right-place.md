---
title: 'Story 1.12: Search shows every centre and the right place'
type: 'bugfix'
created: '2026-10-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '0a13540910714107b2216ebb331628474eb4e2d6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-retro-2026-10-28.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Search misleads people. Kitzingen and Kronach say "No test centres within 10 km", and München leaves out Münchner Volkshochschule, because 8 centres without coordinates are dropped. "Lindau" gets "Bavaria only". "Essen", "Hamm" and "Siegen" silently search Essenbach, Hammelburg and Siegenburg. This is retrospective F1–F3 (FR2, FR27, NFR5).

**Approach:**
1. Show a centre without coordinates when it matches the searched place, and count the rest in a notice that links to a new About list.
2. Let a Bavarian name with a qualifier match on its leading words.
3. Put the names of non-Bavarian municipalities, taken from the cached Overpass index, into `places.json`, so a place outside Bavaria is recognised as such instead of being swapped for a Bavarian town.

## Boundaries & Constraints

**Always:**
- **Unlocated match.** A centre with `lat === null` is a match when its `address.postcode` is in the resolved place's `postcodes`, or `normalizePlaceName(address.city)` equals the normalised place name.
  - It shows as an uncovered card with Distance "unknown" (`card.fact.distance_unknown`), after every distanced card, sorted by name.
  - It counts in the count line's `unchecked` figure.
  - It never appears twice.
- **Hidden unlocated count.** Let `hidden` be the number of centres with no coordinates that are not shown as cards. When `hidden > 0`, every `results` and `no_centres` state shows a notice line: "N centres have no map position yet and may be nearby." with the link "See which" to About `#no-location`. When `hidden` is 0, the line is absent. The link URL is built like `whyUrl`, with the `NO_LOCATION_ID` key.
- **Outcome kinds.** An outcome with only unlocated cards is `results`, not `no_centres`.
- **About `#no-location`.**
  - About gets an h2 section, "Centres we can't place on the map", with `id`/target `no-location`, after `#not-checked`.
  - It has an intro ("We don't know where these centres are yet, so they only appear when you search their town or postcode.") and the list of centres with null coordinates, whatever their coverage, sorted by name, linked like the not-checked list.
  - Snapshot loading moves up so both lists share one fetch.
  - Deep links `#no-location` and `#no-location=&lang=…` scroll there, the same way as `#not-checked`.
- **Hand-set coordinates.** The geocode-cache test checks a record only where one exists. `lat === null` still requires no record. Coordinates set by hand, with no record, pass.
- **Resolution order in `resolvePlace`, for names:**
  1. Exact Bavarian match (one → found; an ambiguous name → several).
  2. Bavarian rows whose normalised name starts with the input plus a space (whole words): one → found, several → several.
  3. An exact non-Bavarian match, in rows or in `others` → `outside_bavaria`.
  4. Otherwise `not_found` (and `resolveSearch`'s suggestion rule from Story 1.9 then applies unchanged).
- **Qualified form.** `"<postcode> <name>"` also accepts a row with that postcode whose name starts with the name plus a space.
- **`places.json` schema version 2.**
  - Add `others: {key, name, state}[]`, sorted by key, with unique keys.
  - Its entries are level-8 municipalities from the cached index whose 3-digit prefix is in `missing`.
  - `state` comes from `stateForKey` and is never `BY`. `others` is empty when `complete` is true.
  - `parseIndex` keeps municipality names. `buildPlaces` and `--cached-only` fill `others`.
  - The note records the `others` count. The Size line is unchanged in format.
  - Rebuild the committed file with `npm run build:places -- --cached-only`, which sends no requests and uses the current cache, including the `ags-031`…`ags-053` files already there.
- **CI.** `ci.yml` ignores only `data/state/**` and `data/public/snapshot.json`. `tests/workflows.test.ts` matches.
- **Copy.** All new copy is in `en.json` and `de.json`, with the same meaning, no exclamation marks, and formal "Sie".
- **Committed-data tests** derive their expectations from the files.

**Decisions (user, 2026-10-28, review pass 1):**
- **Keep the city-name match as built**, even when two Bavarian towns share the name. For example, searching the Landshut Eching also shows VHS Eching (Freising); its card shows its own address and "unknown" distance.
- **Leave non-Bavarian names that carry a qualifier as place-not-found.** "Frankfurt", "Freiburg", "Offenbach" and "Brandenburg" are examples. Only exact non-Bavarian names give "Bavaria only".

**Never:**
- Guess coordinates or distances.
- Send any network request (no Overpass, no Nominatim).
- Edit `centres.json` or `geocode-cache.json`.
- Show `others` entries in suggestions or in did-you-mean.
- Change Story 1.9's single-suggestion rule for input that matches nothing exactly.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unlocated in town | "Kitzingen", 10 km | `volkshochschule-kitzingen` card, Distance "unknown"; the hidden notice counts the other 7 | N/A |
| Unlocated plus distanced | "München", 20 km | 14 distanced cards, then MVHS and BRK (postcodes 81667/81379 belong to München) | N/A |
| Unlocated elsewhere | "Augsburg", 40 km | distanced cards plus the notice "8 centres have no map position yet…" | N/A |
| None at all | radius with no centres, `hidden > 0` | "No test centres within N km" plus the next-radius button plus the notice | N/A |
| Qualifier | "Lindau" | Lindau (Bodensee) is searched | N/A |
| Several qualifiers | "Neuburg" | "Several places match. Pick one." with the Neuburg rows | N/A |
| Qualified postcode | "88131 Lindau" | Lindau (Bodensee) is searched | N/A |
| Outside, by name only | "Essen", "Siegen", "Gera", "Berlin" | "Bavaria only"; the field keeps the text | N/A |
| Outside, row present | "Kiel" | "Bavaria only" (unchanged) | N/A |
| Prefix in no state | "Augs" | Augsburg is searched (Story 1.9) | N/A |
| Exact Bavarian name wins | "Au", "Hof" | that Bavarian town | N/A |
| Hand-set coordinates | centre with lat/lon and no cache record | `npm test` passes | N/A |
| Old places file | v1 `places.json` cached in the browser | reload once, then the load error (existing path) | existing |

</frozen-after-approval>

## Code Map

- `web/src/search/search.ts` -- `resolvePlace` L188-211 (the qualified form first, then postcode/name; add tier 2 and the `others` check before `outside_bavaria`). `placeIndex` WeakMap L80-102 (add the normalised `others` names). `centresInRange` L257-279 (keep it distanced-only). `Outcome` L284-287 and `runSearch` L307-315 (add `unlocated: SnapshotCentre[]` and `hiddenUnlocated: number` to `results`/`no_centres`). `resolveSearch` L296-304 stays as it is. `suggestPlaces` and `didYouMean` stay Bavaria-only.
- `web/src/search/search-page.tsx` -- `CountLine` L30-34 (count plus unlocated); `no_centres` body L225-240 and `results` body L241-257 (unlocated cards after the distanced ones; the hidden notice line after `results.notice_no_dates`, or after the none-in-radius text).
- `web/src/search/uncovered-card.tsx` -- `whyUrl` L6-8 (generalise to a section id); distance L20 (a null distance → `card.fact.distance_unknown`). Make `CentreInRange.distanceKm` `number | null`, or pass a separate prop. Keep `uncoveredLinkName` consistent.
- `web/src/about-page.tsx` -- `CentreList` L28-98, `useNotCheckedTarget` L101-111 (handle both ids), `AboutContent` L113-164 (new section after `#not-checked`; lift `loadSnapshot` so both lists share one load and its states).
- `web/src/data/snapshot.ts` -- add `unlocatedCentres(snapshot)` next to `uncheckedCentres` (L16-20).
- `web/src/fragment.ts` -- add `NO_LOCATION_ID = 'no-location'` next to `NOT_CHECKED_ID` (L24).
- `web/src/i18n/en.json`, `de.json` -- new keys: `card.fact.distance_unknown`, `results.unlocated_notice` / `_one` / `results.unlocated_link`, `about.no_location.heading` / `intro` / `count` / `none`.
- `shared/places.ts` -- `PLACES_SCHEMA_VERSION` 1 → 2 (L37); `placesSchema` L89-118 gets `others` (strict entries; key 8 digits; state matches `stateForKey`, not `BY`; sorted and unique; empty when `complete`).
- `tools/build-places.ts` -- `ParsedIndex` / `parseIndex` L174-202 (keep `{key, name}` for level-8 AGS); `buildPlaces` L447-505 (fill `others` for prefixes in `missing`); `placesNote` L529-600 (an "Other-state names: N" line; keep the Size line and the unchanged check at L816-822 working).
- `data/public/places.json`, `data/places/places-note.md` -- regenerated by `--cached-only`.
- `tests/directory.test.ts` L195-206 -- relax the cache check as described in Always.
- `.github/workflows/ci.yml` L3-12; `tests/workflows.test.ts` L22-24.
- Tests:
  - `tests/fixtures/places.ts`: add Lindau (SH) plus "Lindau (Bodensee)" (BY), two "Neuburg …" rows, and an `others` entry "Essen".
  - `tests/search.test.ts`: `resolvePlace` L88, `runSearch` L369, committed data L409-546.
  - `tests/search-page.test.tsx`: `CENTRES` L19; add a null-coordinate centre.
  - `tests/about.test.tsx`: the `section()` helper hard-codes `#not-checked`.
  - Also `tests/snapshot-loader.test.ts`, `tests/shell.test.tsx` (sentinel states), `tests/places.test.ts` L73/L123, `tests/build-places.test.ts` (`parseIndex` L248, `buildPlaces` L379, cached-only L494, `placesNote` L656), `tests/site-config.test.ts` (production `#no-location` URL).

## Tasks & Acceptance

**Execution:**
- [x] `shared/places.ts` -- schema v2 with `others` -- the contract comes first.
- [x] `tools/build-places.ts` -- keep names in `parseIndex`, fill `others`, add the note line; then run `npm run build:places -- --cached-only` and commit `places.json` and the note -- the data for Fix 3.
- [x] `web/src/search/search.ts` -- resolution tiers, the qualified prefix, the `others` check; unlocated matching and the hidden count in `runSearch` -- the pure rules.
- [x] `web/src/fragment.ts`, `web/src/data/snapshot.ts`, `web/src/search/uncovered-card.tsx`, `web/src/search/search-page.tsx` -- unlocated cards, the "unknown" distance, the hidden notice.
- [x] `web/src/about-page.tsx` -- the `#no-location` section, a shared snapshot load, targeting for both ids.
- [x] `web/src/i18n/en.json`, `de.json` -- the new keys.
- [x] `tests/directory.test.ts` -- hand-set coordinates allowed.
- [x] `.github/workflows/ci.yml`, `tests/workflows.test.ts` -- CI runs on `places.json` changes.
- [x] Tests listed in the Code Map -- every matrix row at the logic and UI level. Committed-data tests: "Essen", "Hamm", "Siegen", "Gera", "Berlin" and "Kiel" give `outside_bavaria`; "Lindau" gives Lindau (Bodensee); no Bavarian row with a qualifier resolves to `outside_bavaria` from its first word; every null-coordinate snapshot centre is in `unlocatedCentres`. Also: the shell sentinel covers the new states, and the production URL for `#no-location` is pinned.

**Acceptance Criteria:**
- Given the built site, when I search Kitzingen 10 km, München 20 km, Lindau, Essen and Augs in `vite preview`, then each behaves as in the matrix, the only requests are the two same-origin data files, and at 320 px in light and dark mode there is no horizontal scroll. The check is repeated after any review patch that changes behaviour.
- Given About at `#no-location=&lang=de`, when it loads, then it scrolls to the new section, which lists the 8 centres.

## Implementation Notes

- **Municipality level.** "Level-8 municipalities" is read as every municipality relation in the index with an 8-digit key (admin levels 4, 6 and 8). Berlin is level 4 and Gera is level 6 in OSM, so a strict level-8 reading would miss them.
- **German link text.** "See which" became "Welche sind das?".
- **Notice placement.** In `no_centres`, the hidden notice sits after the next-radius button. The notice link has a 44 px minimum target.
- **About load failure.** Both lists share one load and either Try again reloads it, but only the first list's error carries `role=alert`.
- **Rebuilt place table.** `places.json` was rebuilt with `--cached-only` from the cache as it stood, with 21 `ags-*` files. An operator Overpass run (started 15:26, using the old code) was still adding files. Result: 4,946 rows, 5,909 `others`, 162 KB gzipped. **Rerun `--cached-only` after that run ends, before committing**, or the old code's final write leaves a schema-v1 file.
- **Test for hand-set coordinates.** Added by the orchestrator in the matrix audit: `cacheDisagreements` in `tests/directory.test.ts` is now unit-tested with a centre whose coordinates were set by hand.
- **Review pass 1** (orchestrator): attempt 1 was saved as a patch and reverted for two intent gaps. The user kept both behaviours. The attempt was re-applied plus five patches: re-scroll after the About load, only named index relations, a comment fix, a CI comment, import order. Tests were added for the re-scroll and the unnamed-duplicate case.
- **Review pass 2:** one patch, a single shared `isUnlocated` in `web/src/data/snapshot.ts`.
- **Browser check after the patches** (`vite preview`):
  - Kitzingen 10 km: the VHS card shows "unknown" distance, and the notice says 7.
  - München 20 km: 16 cards, with BRK and MVHS last.
  - Lindau, Essen and Augs behave as the matrix says.
  - About `#no-location=&lang=de` lands at top 0 with 8 centres.
  - 320 px has no horizontal scroll in dark (About) or light (search) mode.
  - There were no third-party requests.
- **Left as is (retro F7/F8, out of scope):** `toHaveLength(119)`, and the "town with most centres" test.

## Spec Change Log

### 2026-10-28 — Intent gaps resolved by the user (review pass 1)
- **Trigger:** two medium intent-gap findings: the city match picks up a namesake town (Eching), and bare non-Bavarian names that carry a qualifier ("Frankfurt") give place-not-found.
- **Amended (inside `<frozen-after-approval>`, with the user's answers):** a "Decisions" block in Boundaries keeps both behaviours as built.
- **Known-bad state avoided:** none; the user accepted both behaviours.
- **KEEP:** everything in [spec-1-12-attempt-1.patch](spec-1-12-attempt-1.patch). Re-apply it, then apply the five patch rows from the review pass: re-scroll `#no-location` after the snapshot loads, compare only named relations in `parseIndex`, the `aboutSectionUrl` comment, a `ci.yml` comment, and import grouping.

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 25 findings — high 0, medium 3, low 13, false 6, maybe-false 0 (verification-gap layer: no gaps)
- attempt saved: [spec-1-12-attempt-1.patch](spec-1-12-attempt-1.patch) (code reverted; re-applies cleanly on `0a13540`)
- findings:
  - `[medium]` `[intent_gap → resolved: keep]` City match pulls in a centre from a namesake town (ECH, BH) — confirmed on committed data: `volkshochschule-eching-e-v` (85386, Lkr. Freising) matches a search for "84174 Eching" (Lkr. Landshut) by city name alone. The rule is in the frozen Always ("or `normalizePlaceName(address.city)` equals the normalised place name"). Halted for the user's decision.
  - `[medium]` `[intent_gap → resolved: keep]` Bare names of cities outside Bavaria that carry a qualifier ("Frankfurt", "Freiburg", "Offenbach", "Mülheim", "Brandenburg") give place-not-found, not "Bavaria only" (ECH, ECH claim) — confirmed: tier 3 in the frozen order matches exact names only. Not a swap for a Bavarian town (the Essen bug class), but FR27 wants "Bavaria only". Halted for the user's decision.
  - `[low]` `[reject]` A postcode shared by several municipalities lists their centre (97318 Biebelried → VHS Kitzingen) (ECH) — the frozen rule matches by postcode; the card shows its own address and "unknown" distance, and a shared postcode area is close by; changing it edits the frozen rule.
  - `[medium]` `[patch]` `#no-location` deep link scrolls before the list above it loads (BH) — `useSectionTarget` scrolls on mount while `#not-checked` is still "Loading…"; browsers without scroll anchoring (Safari) can land off the section. Smallest fix: scroll again once the snapshot is loaded.
  - `[low]` `[patch]` `parseIndex` lets an unnamed lower-id relation win, then drops it (BH, ECH) — not reachable today (0 duplicate AGS in the cached index), but the fix is a direct correction: compare only named relations.
  - `[low]` `[patch]` `aboutSectionUrl` comment claims a default section (BH) — direct correction.
  - `[low]` `[patch]` `ci.yml` narrowing has no comment (BH) — add one line saying why `places.json` is checked.
  - `[low]` `[patch]` Import grouping in `search-page.tsx` and `uncovered-card.tsx` (BH) — direct correction.
  - `[low]` `[defer]` Postcodes from missing non-Bavarian prefixes ("10115") give place-not-found (ECH) — pre-existing before this story; `others` carry no postcodes.
  - `[low]` `[reject]` Bavarian names of a missing `ags-09x` prefix are not kept (ECH) — every Bavarian prefix is cached; the frozen spec says `others` are never BY.
  - `[low]` `[reject]` Qualified form with several leading-word names under one postcode picks the lowest key (ECH) — no such postcode seen; the guard adds a branch.
  - `[false]` `[reject]` Unlocated covered centre labelled "Not checked" (BH) — the Epic 1 producer emits `not_checked` for every centre; card choice by coverage is Epic 2's job.
  - `[low]` `[reject]` Count line says "within R km" while counting unknown-distance centres (BH) — the frozen spec counts them; the fix edits the spec.
  - `[low]` `[reject]` "may be nearby" is the same on every search (BH) — frozen copy; the fix edits the spec.
  - `[low]` `[reject]` `placesSchema` does not forbid `others` keys that are also `places` keys (BH) — not reachable: rows come only from cached prefixes, `others` only from missing ones; the committed-data test pins it.
  - `[low]` `[reject]` `others` grows `places.json` to 162 KB gzipped (BH) — under the 300 KB flag the spec set; dropping `state` edits the frozen shape.
  - `[low]` `[reject]` Outside-Bavaria check rescans ~5,000 rows per lookup (BH) — one submit, well under a frame; no measured harm.
  - `[false]` `[reject]` Typing "Essen" still suggests Essenbach (BH) — offering a Bavarian prefix match while typing is correct (the user may mean Essenbach); only searching it unasked was the bug.
  - `[false]` `[reject]` `no_centres.unlocated: []` is noise (BH) — no named harm.
  - `[false]` `[reject]` No-location list reuses not-checked error strings (BH) — same meaning today; no named harm.
  - `[low]` `[reject]` Hidden notice not in the status announcement (BH) — UX-DR24 announces the count line; the notice is page text; adding it adds an announcement branch.
  - `[false]` `[reject]` Review diff leaves out the spec, epic context and `places.json` (BH) — by design: the spec is the claims file, `places.json` is one 1 MB line checked by committed-data tests.
  - `[low]` `[reject]` `#q=Eching` style shared links for the ambiguous town (BH grouping) — covered by the intent-gap row.
  - `[false]` `[reject]` City false negatives ("Lindau" vs "Lindau (Bodensee)") (BH) — the postcode matches in those cases; the committed-data test searches every unlocated centre's postcode.
  - `[false]` `[reject]` Claim that only exact outside names are recognised misleads (ECH claim) — same root as the qualifier intent-gap row.

### 2026-10-28 — Review pass 2 (after the user's decisions; attempt 1 re-applied plus the five pass-1 patches)
- verdicts: 33 findings — high 0, medium 1, low 15, false 5, maybe-false 0; 12 carried
- findings:
  - `[medium]` `[intent_gap → resolved: keep]` City match picks up the namesake Eching (ECH, BH) — carried: the user chose to keep it.
  - `[low]` `[reject]` Count line counts unknown-distance centres "within R km" (ECH, BH) — carried: frozen spec.
  - `[low]` `[reject]` Hidden notice says "may be nearby" for every unlocated centre in Bavaria (ECH, BH) — carried: frozen copy.
  - `[low]` `[reject]` Unlocated matches ignore the radius, so "Search N km" disappears (BH) — the frozen Always makes an outcome with only unlocated cards a `results` outcome; changing it edits the spec.
  - `[low]` `[reject]` An exact non-Bavarian name loses to a Bavarian whole-word match (Neuhof → Neuhof an der Zenn, Ebersdorf, Bischofsheim, Oberndorf, Steinberg) (ECH) — the frozen tier order and Design Notes put Bavarian whole-word matches first on purpose (the Lindau rule); the town searched is a real Bavarian town whose name starts with the input, and the field keeps the text.
  - `[low]` `[reject]` Non-Bavarian names that fold onto a Bavarian name (Worth → Wörth, Munster → Münster, Neuenkirchen → Neunkirchen) (ECH, ECH claim "170 names") — pre-existing: the umlaut and `ue` fold and "Bavarian exact match wins" date from Stories 1.5 and 1.8 (1.5 triage accepted the fold collisions); not caused by this change.
  - `[low]` `[reject]` Qualified form with several distinct Bavarian leading-word names under one postcode picks the lowest key (ECH) — carried.
  - `[low]` `[reject]` Retry re-scrolls to the targeted section (ECH, BH) — only on Retry after a load failure, where the target section is where the user is; a "scrolled once" ref adds state.
  - `[low]` `[defer]` "<postcode> <name>" for a name only in `others` ("45127 Essen") gives place-not-found (BH) — pre-existing (no postcodes for missing states); same class as the deferred bare-postcode row.
  - `[low]` `[defer]` Bare postcodes from missing prefixes ("10115") give place-not-found (BH) — carried: already deferred in pass 1.
  - `[false]` `[reject]` Unlocated card's "Why?" points to `#not-checked`, a list that may not hold it (BH) — carried: every Epic 1 centre is `not_checked`, so every unlocated centre is in that list.
  - `[false]` `[reject]` City match fails for names with a qualifier (BH) — carried: the postcode matches, and the committed-data loop searches every unlocated centre's postcode.
  - `[low]` `[reject]` Hidden notice not announced (BH) — carried.
  - `[low]` `[reject]` Schema does not forbid `others`/`places` key overlap, nor require names for every missing prefix (BH) — carried for the overlap (unreachable by construction); an index without names would fail loudly in the committed-data tests ("Essen" etc.).
  - `[low]` `[reject]` Outside-Bavaria check rescans rows per lookup (BH) — carried.
  - `[low]` `[patch]` The "no coordinates" check is defined twice (`isUnlocated` in search, inline in `unlocatedCentres`) (BH) — if one changes, About and search would disagree; patched: one `isUnlocated` in `web/src/data/snapshot.ts`, used by both.
  - `[false]` `[reject]` `no_centres.unlocated: []` noise (BH) — carried.
  - `[false]` `[reject]` Tests rely on `:has()` in happy-dom (BH) — the tests run and pass; happy-dom supports it.
  - `[low]` `[reject]` `others` size not flagged separately (BH) — carried: the note flags the whole file over 300 KB.
  - `[low]` `[defer]` Hand-set coordinates are allowed with no allowlist, so a lost cache record goes unnoticed (VG, pre-verified, filed `defer`) — no hand-set centre exists yet; replace the blanket allowance with a named list when the first one is added.

## Design Notes

**Why `others` is a separate array, not rows with null fields.** `placeRowSchema` promises coordinates and postcodes, and search, suggestions, the boundary check and the tests all rely on that. Name-only entries in their own array leave every existing reader untouched. The schema bump makes stale browsers reload once.

**Why tier 2 comes before outside-Bavaria exact matches.** The site covers Bavaria only, so someone typing "Lindau" or "Landsberg" most likely means the Bavarian town. "Essen", "Halle" and "Gera" have no Bavarian whole-word match (checked against the committed rows), so they still reach "Bavaria only".

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run check:directory && npm run build` -- expected: all exit 0.
- `npm run build:places -- --cached-only` (second run) -- expected: "0 requests sent", and `places.json` unchanged.

**Manual checks:**
- `npm run preview`, then the flows in the Acceptance Criteria in the browser pane.
