---
title: 'Story 1.9: Place suggestions while typing'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_revision: 'f53a082f7165b59e1b3722b4f9f88b4bb713052c'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/EXPERIENCE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      On touch or pen input, preventDefault on pointer-down may not keep focus in the field, so the list could close before a tapped row registers.
    evidence: |-
      happy-dom and desktop Chrome keep focus; not tried on a real iOS or Android browser. Settle by tapping a suggestion on a real phone.
    location: >-
      web/src/search/search-bar.tsx (listbox onPointerDown/onMouseDown)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The place field (Story 1.8) is a plain text input. Phone users must type a town exactly, and same-name Bavarian towns (49 groups, e.g. Kastl ×3) silently resolve to the lowest-key row, so some users get the wrong town's results with no way to choose (FR25, UX-DR4).

**Approach:** Turn the field into an ARIA 1.2 combobox that suggests up to 6 matching Bavarian towns or postcodes after 2 characters. Picking a row runs the search. Enter without a pick searches one match or an exact postcode, says "Several places match. Pick one." for an ambiguous name, and otherwise shows place-not-found as today.

## Boundaries & Constraints

**Always:**
- Suggestions (pure, `suggestPlaces(input, places)`), from `state === 'BY'` rows only, all name comparisons through `normalizePlaceName`, input trimmed:
  - Fewer than 2 characters (trimmed) → none.
  - All digits (2–5) → rows having a postcode that starts with the input; that row's *matched postcode* is its smallest such postcode. Order: matched postcode, then `name` (`localeCompare(…, 'de')`), then `key`.
  - Otherwise → rows whose normalised name starts with the normalised input. Order: exact normalised match first, then `name` (`de` collation), then `key`.
  - Each row has a *pick text*: the town name, or `"<label postcode> <name>"` when the name is *ambiguous*. A name is ambiguous when its BY rows (same normalised name) have more than one distinct label postcode (a row's label postcode = its smallest postcode). Rows with the same pick text collapse into one (the first in order, which is the lowest key). Then at most 6 rows.
  - Row display: the town name in body text, then a meta line. Postcode input: the matched postcode, plus ` · district` when the name is ambiguous. Name input: no meta line unless ambiguous; then `"<label postcode> · <district>"`. Meta separator text comes from the catalogue (`search.suggestion_meta`).
- Resolution changes (`resolvePlace`, used by every search):
  - `"<5 digits> <name>"` (qualified form) → rows (all states) having that postcode and that normalised name; any BY → found (lowest key); only non-BY → outside Bavaria; none → handled as plain text (as before).
  - Plain name with BY exact matches: one distinct label postcode → found (lowest key, as before); more than one → new `several` result.
  - 5-digit input → unchanged (lowest-key BY row, even if several rows share it). Non-BY, not-found and did-you-mean → unchanged.
  - `runSearch` maps `several` to a field outcome with code `several_places` and no did-you-mean links.
- Search rule (every search: submit, Enter without a pick, fragment, "Search N km"; user decision 2026-10-28, "match what's shown"): an exact match always decides; otherwise the suggestions decide.
  1. `resolvePlace` gives found, `several` or outside Bavaria → that result (so an exact town name like "Au" searches it even though other towns start with "Au", and a pick text always reproduces its town).
  2. Otherwise (no exact match) take the text's suggestions, collapsed as above but **not** capped at 6: exactly one → search that town, and the field and the fragment `q` become its pick text (e.g. "Augs" → "Augsburg"); two or more → `several_places` with the list open ("Ober", "Mün"); none → place-not-found with did-you-mean, as before.
- Combobox (`search-bar.tsx`): the input gets `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` → a `<ul role="listbox">` labelled by the field label, and `aria-activedescendant` → the highlighted `<li role="option" aria-selected>` (only while open and a row is highlighted). The list sits directly under the field as an overlay, with `--place-suggestions-*` tokens. Rows are at least `--place-suggestions-item-min-height` tall, and the highlighted row uses the highlight background.
  - Open when: field focused, data ready, the suggestions are non-empty, and the list was not dismissed. Each input event undismisses. Escape, a pick, a submit (unless its outcome is `several_places`), blur and a fill from the fragment or "Search N km" dismiss it.
  - Highlight: none when the list opens or its rows change. ↓ moves down (wrapping to the first row); when closed with suggestions available it opens and highlights the first row. ↑ moves up (from none or the first row, to the last). Escape closes.
  - Enter with a highlighted row, or a click/tap on a row (pointer-down must not blur the field) → pick: the field shows the pick text, the list closes, and the search runs with `q` = pick text and the current radius (same path as a submit: fragment written with `replaceState`, focus stays in the field).
  - Enter without a highlighted row → the normal submit, resolved with the search rule above.
- `several_places` outcome: the field message "Several places match. Pick one." in the existing field-message slot (`role="alert"`, linked by `aria-describedby`, input text kept, no `aria-invalid`). Results are cleared, and the list opens with the current text's suggestions (the ambiguous rows come first). This also applies when the search came from the fragment (e.g. an old shared link `#q=Kastl`).
- Status: whenever the list opens or its rows change, the page's single `role="status"` region announces "{count} suggestions" (singular variant for 1). Use the existing announce path in `search-page.tsx`. Closing announces nothing.
- All new text in `web/src/i18n/{de,en}.json` (same keys, formal "Sie", no `!`). Styles only via tokens; the design-tokens scanner must pass. Reflow at 320 px / 200 % zoom (light and dark) with the longest German strings; long names and districts wrap inside the list.

**Never:**
- No location button (Story 1.10), no fuzzy (Levenshtein) suggestions while typing (did-you-mean after a failed search stays), no debounce timers, no new dependencies, no network request beyond the two existing files, no `localStorage`.
- Never put coordinates or place keys in the fragment; `q` stays human text.
- No change to the radius select, card, results, loading, failure or About behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Prefix, spelling variant | "gunz" / "Guenz" | Günzburg among the rows; status "N suggestions" | N/A |
| One character | "M" | list closed | N/A |
| Postcode prefix | "8923" | rows like "Neu-Ulm" with meta "89231", ordered by postcode | N/A |
| Same-name towns | "Kastl" | up to 3 Kastl rows, each with meta like "92280 · Landkreis Amberg-Sulzbach", exact matches first | N/A |
| Same name and postcode | "Chiemsee" / "Fichtelberg" (two rows each share a label postcode) | one row each; Enter searches it | N/A |
| Cap | "Ober" | exactly 6 rows | N/A |
| Keyboard pick | ↓ ↓ Enter | 2nd row picked, search runs, list closed, fragment `q` = pick text | N/A |
| Pointer pick | tap a Kastl row | field "92280 Kastl", search runs for that row | N/A |
| Escape | list open | list closes, text kept, `aria-expanded="false"` | N/A |
| Enter, one match | "Ingolstadt" + Enter | search runs (as Story 1.8) | N/A |
| Enter, exact postcode | "89231" + Enter | search runs, lowest-key BY row | N/A |
| Enter, one suggestion | "Augs" + Enter | Augsburg searched; field and fragment `q` = "Augsburg" | N/A |
| Enter, several suggestions | "Ober" / "Mün" + Enter | "Several places match. Pick one.", list open, no results, no `aria-invalid` | N/A |
| Enter, exact name among prefixes | "Au" + Enter (many towns start with "Au") | Au searched | N/A |
| Partial name in link | `#q=Augs` | Augsburg searched; field and fragment rewritten to "Augsburg" | N/A |
| Enter, ambiguous | "Kastl" + Enter | "Several places match. Pick one.", list open with the Kastl rows, no results | N/A |
| Enter, none | "Nurnbreg" + Enter | place-not-found + did-you-mean (as Story 1.8) | N/A |
| Qualified form in link | `#q=92280+Kastl` | that Kastl's results | N/A |
| Ambiguous link | `#q=Kastl` | several message, list open (field focused on mount) | N/A |
| Data not ready | typing before load | list closed; opens once data is ready and the field is typed into | N/A |
| Language switch | list open, DE → EN | rows unchanged, catalogue text in English | N/A |

</intent-contract>

## Code Map

- `web/src/search/search.ts` -- `resolvePlace` (POSTCODE regex, BY lowest-key reduce, `didYouMean`), `runSearch`, `FieldErrorCode` (`'place_not_found' | 'outside_bavaria'`), `Outcome`. Add `suggestPlaces`, the pick-text/ambiguity helpers, the `several` resolution, the qualified form and the `several_places` code here. Build a per-`places` index (normalised name, label postcode, ambiguous names) once, e.g. memoised in a `WeakMap` keyed by the rows array; about 2,100 BY rows today, more after Story 1.11.
- `web/src/search/search-bar.tsx` -- `SearchBar` props `{text, radius, error, fieldRef, onText, onRadius, onSubmit}`, `FIELD_ID`, `FIELD_MESSAGE_ID`, `ERROR_KEYS` (add `several_places`). Today `aria-invalid` is set for any error; make it false for `several_places`. The field message block (`key={error.id}`) stays. Add combobox state (dismissed, highlight), listbox, keyboard handling, and new props for the places/suggestions, the pick callback and the announcement callback. The label needs an `id` for `aria-labelledby`.
- `web/src/search/search-page.tsx` -- `requestSearch(search, {fill, focus})` is the one search path (fragment, `replaceState`, pending/loading); a pick calls it with `fill: true, focus: true`. `announce()` + `Announcement` union + `AnnouncementText`: add a `{kind: 'suggestions', count}` variant. `data.kind === 'ready'` gives `data.places.places`. Fragment effect and "Search N km" call `requestSearch` with `fill: true`; these must dismiss the list, except for a `several_places` outcome.
- `shared/places.ts` -- `normalizePlaceName`, `PlaceRow` (`key, name, postcodes[], district, state, lat, lon`). Read-only.
- `web/src/i18n/en.json`, `de.json` -- add `error.several_places` (en "Several places match. Pick one.", de "Mehrere Orte passen. Wählen Sie bitte einen aus."), `search.suggestions_count` ("{count} suggestions" / "{count} Vorschläge"), `search.suggestions_count_one` ("{count} suggestion" / "{count} Vorschlag"), `search.suggestion_meta` ("{postcode} · {district}" in both).
- `web/src/styles/base.css` -- `.search-bar__field` gets `position: relative`; the listbox is absolutely positioned under the input (full field width, `--place-suggestions-*` tokens, border, radius, surface background, above the results via `z-index`). The meta line uses the existing meta type tokens. No px, no `height:` (use `min-height`). `tests/design-tokens.test.ts` enforces this.
- `tokens.css` -- `--place-suggestions-background|border|highlight-background|item-min-height|rounded|max-items` already exist (lines 95–100). Read-only.
- `tests/fixtures/places.ts` -- the places fixture builder; add same-name BY rows (different label postcodes), a same-name-same-postcode pair, a non-BY namesake and enough "Ober…" rows to test the cap of 6.
- `tests/search.test.ts` -- `describe('resolvePlace')` at line 82 (keep its cases; add several/qualified); add `describe('suggestPlaces')`. The existing committed-data block reads `data/public/places.json` with `node:fs`: add a property test that every BY row's pick text resolves to `found` with the same normalised name and label postcode, and that no suggestion list exceeds 6 or contains a non-BY row. Derive expectations from the file, never fixed counts.
- `tests/search-page.test.tsx` -- happy-dom with stubbed `fetch`; has helpers for typing, settling and fragment checks. Add the combobox UI tests here.
- `tests/shell.test.tsx` -- sentinel "no hard-coded UI text" loop; add an open-list state and the several-places state (place names, postcodes and districts are allowed as data text).
- `data/public/places.json` -- partial until Story 1.11, but every Bavarian prefix is present. 49 same-name BY groups; Chiemsee (83209) and Fichtelberg (95686) are the only same-name pairs sharing a label postcode.

## Tasks & Acceptance

**Execution:**
- [x] `web/src/search/search.ts` -- `suggestPlaces`, pick text and ambiguity, the qualified form, the `several` resolution, `several_places` -- the pure rules in Always, testable without the DOM.
- [x] `web/src/i18n/en.json`, `de.json` -- the four new keys -- copy for the several message, the status count and the meta line.
- [x] `web/src/search/search-bar.tsx` -- combobox and listbox, keyboard and pointer picks, open/dismiss and highlight rules, `aria-invalid` off for `several_places` -- UX-DR4.
- [x] `web/src/search/search-page.tsx` -- pass places and callbacks, the pick runs `requestSearch`, the suggestions announcement, open the list on a `several_places` outcome -- one search path and one live region.
- [x] `web/src/styles/base.css` -- listbox overlay, rows, highlight and meta, tokens only -- DESIGN place-suggestions.
- [x] `tests/fixtures/places.ts`, `tests/search.test.ts` -- every matrix row at the logic level plus the committed-data property tests.
- [x] `tests/search-page.test.tsx` -- every matrix row at the UI: ARIA attributes (`role`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-selected`), ↓/↑ wrapping, Escape, Enter pick vs submit, pointer pick keeps focus, fragment `q` = pick text via `replaceState`, the several message without `aria-invalid` and with the list open, status "N suggestions" (and singular), no list before data is ready, no list popping open after a fragment fill on mount, unchanged Story 1.8 behaviour for single matches.
- [x] `tests/shell.test.tsx` -- open-list and several-places states in the sentinel loop.

**Acceptance Criteria:**
- Given the built site at `/testplatz/` in German, when I type "Gunz", then a list of at most 6 Bavarian towns including Günzburg appears directly under the field, and the status region says "N Vorschläge".
- Given the list is open, when I press ↓ then Enter, then the highlighted town is searched, the list closes, the results show and the URL fragment's `q` is that town's pick text.
- Given the search page, when I type "Kastl" and press Enter, then I see "Mehrere Orte passen. Wählen Sie bitte einen aus." and the open list shows each Kastl with its postcode and district; tapping one shows that town's results and a fragment like `#q=92280+Kastl&r=40&lang=de` that reproduces them when opened in a new tab.
- Given 320 px and 1280 px at 200 % zoom, light and dark, when the list is open with the longest district names, then `document.documentElement.scrollWidth <= clientWidth` and every row is at least 44 px tall.

## Spec Change Log

### 2026-10-28 — Intent gap resolved by the user (review pass 1)
- **Trigger:** `[medium]` intent-alignment finding: Enter without a pick was tied to exact-name resolution, so "Augs" (1 suggestion) and "Ober" (6) gave place-not-found.
- **Amended (inside `<intent-contract>`, with the user's decision "match what's shown"):** new "Search rule" bullet in Always; the Enter bullet points to it; four matrix rows added (one suggestion, several suggestions, exact name among prefixes, partial name in link). Design Notes: the "several" rationale replaced.
- **Known-bad state avoided:** a user sees exactly one suggestion, presses Enter and is told the place is unknown.
- **KEEP:** everything else in [spec-1-9-attempt-1.patch](spec-1-9-attempt-1.patch) — `suggestPlaces`, pick text `"<postcode> <name>"`, the qualified form, the combobox, dismiss/reopen, announcements, i18n keys, CSS, and the tests. Also add: a `forced-colors` rule so the highlighted row stays visible; one pick-text helper used by both `suggestPlaces` and `pickText`; a committed-data round-trip test for postcode-input picks.

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 22 findings — high 0, medium 2, low 11, false 9, maybe-false 0
- attempt saved: [spec-1-9-attempt-1.patch](spec-1-9-attempt-1.patch) (code reverted; re-applies cleanly on `f53a082`)
- findings:
  - `[low]` `[reject]` "Did you mean" links can name an ambiguous town, leading to "Several places match" (VG other) — the list opens with the towns, so one tap recovers; qualifying the links adds pick-text logic to `didYouMean`.
  - `[medium]` `[intent_gap]` Enter without a pick is tied to exact-name resolution, not to the suggestions shown (IA) — confirmed on the committed data: "Augs" shows 1 suggestion (Augsburg) but Enter gives place-not-found; "Ober" and "Mün" show 6 but Enter gives place-not-found, not "Several places match. Pick one." The epic AC ("the list stays open" when several match) reads most naturally as list-based; the spec chose exact-name ties from Story 1.8's own Design Note. Two defensible readings with observably different outcomes, inside `<intent-contract>` (Always, Enter rule). Halted for the user's decision.
  - `[false]` `[reject]` Same-name rows render on two lines, not "town · postcode · district" on one (IA) — DESIGN.md "Place suggestions": "town in `body`, then postcode and district in `meta`", which is what the rows render.
  - `[false]` `[reject]` Browser-surface criteria not exercised (IA) — the implementation report records `vite preview` checks: Gunz list and status, ↓↓Enter, Kastl several + tap, 320 px dark with doubled font, rows 130–165 px, only the two same-origin requests.
  - `[low]` `[reject]` The list sits under the field message, not directly under the field, while a message shows (IA) — deliberate so the several message and did-you-mean links stay visible; a cosmetic deviation, moot under this halt.
  - `[low]` `[reject]` Ambiguous name with a postcode-less row loops on "several" (ECH) — 0 Bavarian rows have empty `postcodes`, and every `ags-09*` query is already in the table, so Story 1.11 adds none; the guard adds a branch for no reachable row.
  - `[false]` `[reject]` Qualified form picks a lower-key namesake listing the postcode as a secondary one (ECH) — on the committed data every name-input suggestion's pick text resolves to its own row (0 mismatches).
  - `[false]` `[reject]` Postcode-input pick of a collapsed name searches the other row (ECH) — every postcode-input suggestion for every Bavarian postcode resolves to the row it showed (0 mismatches).
  - `[false]` `[reject]` Display names that normalise equal (Au/Äu) pick the wrong row (ECH) — the data has Pöcking/Pocking, Furth/Fürth, Thalmassing/Thalmässing; all resolve to their own rows (0 mismatches).
  - `[low]` `[reject]` Enter during IME composition picks a row (ECH) — German and English place input rarely composes; the guard adds a branch.
  - `[low]` `[reject]` Postcode-less row in an ambiguous group never resolves (BH) — same as the ECH postcode-less row.
  - `[low]` `[reject]` Postcode-input meta can differ from the postcode in the field text (BH) — the search is right (0 mismatches); only the shown postcode differs for an ambiguous town matched on a second postcode; cosmetic.
  - `[low]` `[patch]` Pick-text rule duplicated in `suggestPlaces` and `pickText` (BH) — direct correction (one helper); moot under this halt, not applied.
  - `[medium]` `[patch]` Highlighted row invisible in forced-colors mode (BH) — only `background` marks `[aria-selected='true']` and `base.css` has no `forced-colors` rule; moot under this halt, not applied — carry into the re-derivation.
  - `[low]` `[reject]` Hover and keyboard highlight look the same and do not sync (BH) — common listbox behaviour; Enter follows the keyboard highlight as announced.
  - `[false]` `[reject]` "Several places match" lacks the "Error:" prefix (BH) — the copy is verbatim from the epic AC and EXPERIENCE.md, and the state is not an error (no `aria-invalid`).
  - `[low]` `[reject]` Alert and status speak at once on "several" (BH) — screen readers queue the polite status after the alert; deciding precedence adds state.
  - `[low]` `[reject]` Incomplete `useEffect` dependencies in `search-bar.tsx` (BH) — the callback is memoised and the comment names `token` as the row key; no caller passes a fresh callback.
  - `[false]` `[reject]` Listbox remounts and covers did-you-mean links (BH) — inside `.field-message` it renders after the links, so it sits below them.
  - `[low]` `[patch]` Data tests skip postcode-input round-trips (BH) — the check run during triage passes (0 mismatches); worth adding as a test; moot under this halt, not applied.
  - `[false]` `[reject]` Reflow unverified; `MIN_SUGGESTION_CHARS` exported unused (BH) — reflow: see the IA browser-surface row; the unused export is not a defect.
  - `[false]` `[reject]` Unrelated `centres.json` change and untracked spec (BH) — `centres.json` is a user edit outside this story and was kept out of the diff; the spec is the claims file, committed at finalization.

### 2026-10-28 — Review pass (2, after the user's "match what's shown" decision)
- verdicts: 26 findings — high 0, medium 0, low 18, false 7, maybe-false 1
- findings:
  - `[low]` `[reject]` "Au" + Enter searches Au although the list shows several rows, a refinement of the literal ruling (IA) — the exact-match-first rule was stated to the user with the decision ("Au" would otherwise be unsearchable); recorded in Design Notes.
  - `[false]` `[reject]` The rule also runs after Escape and for links, where no list is shown (IA) — the Search rule applies to every search by design, so a link behaves like typing its text and pressing Enter; stated to the user.
  - `[low]` `[reject]` No test presses a real Enter that submits the form (IA) — native implicit submission is browser behaviour; tests assert the keydown is not prevented and the submit path; the preview check exercised real Enter.
  - `[false]` `[reject]` Row height, reflow, dark mode not measured (IA) — carried: pass-1 preview checks (320 px dark, rows 130–165 px).
  - `[low]` `[reject]` The list sits under the field message (IA) — carried: deliberate, keeps the message visible.
  - `[false]` `[reject]` Same-name rows on two lines (IA) — carried: matches DESIGN.md.
  - `[low]` `[patch]` Single-suggestion tests pass even if the search runs twice (VG, pre-verified) — patched: both tests now assert exactly one `replaceState` for the pick text and an unchanged status element after an extra settle; they fail with `lastSearch.current = result.search` removed.
  - `[low]` `[reject]` Postcode-less row in an ambiguous group is unpickable (ECH) — carried: 0 Bavarian rows lack postcodes.
  - `[low]` `[reject]` A null label counts as a distinct label (ECH) — carried: same root cause as the row above.
  - `[false]` `[reject]` Qualified form matches a secondary postcode of a lower-key namesake (ECH) — carried: 0 mismatches on the committed data, now pinned by a data test.
  - `[false]` `[reject]` Postcode-input pick of a collapsed name searches another row (ECH) — carried: the new committed-data test proves every postcode-input pick resolves to the row shown.
  - `[low]` `[reject]` A pending search that resolves to one suggestion overwrites text typed while data loaded (ECH) — data loads once at mount in well under a second; the guard adds a branch.
  - `[maybe-false]` `[defer]` On touch/pen, `preventDefault` on pointer-down may not stop the blur, losing the tap (ECH) — happy-dom and desktop Chrome keep focus; settle on a real iOS/Android device. Medium if true.
  - `[low]` `[reject]` A decomposed umlaut counts as 2 characters (ECH) — keyboards emit composed characters; normalising adds a step for no observed input.
  - `[false]` `[reject]` Tapping a Kastl row may show another Kastl when postcodes overlap (ECH claim) — carried: every pick text round-trips to its row on the committed data.
  - `[low]` `[reject]` Postcode-less ambiguous row (BH) — carried, as the ECH row.
  - `[false]` `[reject]` Postcode pick searches a different row (BH) — carried, as the ECH row; the fixture case relies on a postcode split the committed data does not have.
  - `[low]` `[reject]` No "keep typing" cue when more than 6 match (BH) — the several message already asks to pick; DESIGN caps the list at 6 with no overflow row; adds UI.
  - `[low]` `[reject]` Editing a qualified pick text ("92280 Kast") closes the list (BH) — rare edit; supporting qualified prefixes adds a branch to `suggestPlaces`.
  - `[low]` `[reject]` `resolveSearch` computes did-you-mean it then discards (BH) — one submit, ~2,100 rows, well under a frame; no measured harm.
  - `[low]` `[reject]` The status region keeps "N suggestions" after the list closes (BH) — live regions are not re-read on their own; the spec says closing announces nothing.
  - `[low]` `[reject]` Alert and status speak together on several (BH) — carried.
  - `[low]` `[patch]` A press on the listbox outside a row blurs the field and closes the list (BH) — patched: the pointer-down/mouse-down handlers moved from each row to the `<ul>`.
  - `[low]` `[reject]` No keyboard pick test while a field message shows (BH) — same component and handlers as the tested path; the highlight token resets on remount.
  - `[low]` `[reject]` The field message stays while typing a new place (BH) — unchanged Story 1.8 behaviour; it clears on the next search.
  - `[low]` `[patch]` Fixture does not explain the SH Kastl's Bavarian postcode (BH) — patched: comment above `kastlSh`.

## Design Notes

**Why an exact match decides before the suggestions.** The user chose "match what's shown" for Enter without a pick (2026-10-28): one suggestion searches it, several keep the list open. Checking the exact match first keeps a full town name searchable when other towns share its prefix ("Au", "Hof"), keeps a non-Bavarian exact name on "Bavaria only", and makes every pick text and shared link reproduce its town. The same rule runs for fragment searches, so a link behaves like typing its text and pressing Enter.

**Why the qualified pick text.** The fragment holds human text, never keys or coordinates, and a shared link must reproduce the same town. `"92280 Kastl"` follows the German address order and resolves to exactly that row. Unique names stay bare ("Günzburg"), so most fragments look as they did. Chiemsee and Fichtelberg each have two rows with the same name and postcode (a municipality plus an unincorporated area of the same place). They collapse to one suggestion and resolve to the lowest key, so each pick text names exactly one search.

**Pointer pick without blur:**
```tsx
<li role="option" onPointerDown={(e) => e.preventDefault()} onClick={() => pick(row)}>…</li>
```

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run build` -- expected: all exit 0.

**Manual checks (if no CLI):**
- `npm run preview`, open `/testplatz/#lang=de` in the browser pane: type "Gunz" (list, status), ↓/↑/Escape/Enter, "Kastl" + Enter (several message, pick a row, fragment), "8923" (postcode rows), 320 px and dark mode with the list open; network shows only the two same-origin data files.

## Auto Run Result

- **Summary:** The place field is now an ARIA 1.2 combobox. After 2 characters it suggests up to 6 Bavarian towns or postcodes (case- and umlaut-insensitive), with same-name towns showing "postcode · district" and a status announcing "N suggestions". ↓/↑/Enter/Escape and taps pick a row and run the search. Enter without a pick follows the user's decision (match what's shown): an exact match decides; otherwise one suggestion is searched (field and fragment become its name), several keep the list open with "Several places match. Pick one.", none gives place-not-found. A picked same-name town is saved as `"<postcode> <name>"` (e.g. `#q=92280+Kastl`), so shared links reproduce it.
- **Run history:** pass 1 halted on an intent gap (Enter semantics); attempt 1 saved as [spec-1-9-attempt-1.patch](spec-1-9-attempt-1.patch). The user chose "match what's shown"; the spec was amended (Spec Change Log), the patch re-applied and adjusted.
- **Files changed:**
  - `web/src/search/search.ts`: `suggestPlaces`, pick text and ambiguity index, qualified form, `several`, `resolveSearch`, `runSearch` uses it.
  - `web/src/search/search-bar.tsx`: combobox, listbox, keyboard and pointer picks.
  - `web/src/search/search-page.tsx`: list open/dismiss state, pick path, suggestions announcement, pick-text rewrite of field and fragment.
  - `web/src/i18n/en.json`, `de.json`: 4 new keys.
  - `web/src/styles/base.css`: list overlay, rows, highlight, meta line, `forced-colors` highlight.
  - Tests: `tests/fixtures/places.ts`, `tests/search.test.ts` (incl. committed-data round-trips), `tests/search-page.test.tsx`, `tests/shell.test.tsx`.
- **Review:** 2 passes, 1 intent-gap loopback.
  - Pass 1: 22 findings (medium 2, low 11, false 9). The intent gap was resolved by the user; its carried fixes (forced-colors highlight, one pick-text helper, postcode-input round-trip test) went into the re-derivation.
  - Pass 2: 26 findings (low 18, false 7, maybe-false 1). Patched 3 (all low): a double-run test guard, the listbox press handlers, a fixture comment. Deferred 1: touch blur on real devices (unverified). The rest rejected with reasons in the Review Triage Log; main groups: postcode-less rows (none exist), overlapping-postcode picks (0 mismatches on the data, now tested), announcement overlap, no overflow cue, rare edit paths.
- **Follow-up review recommended:** false. No high was patched and no medium was patched in pass 2.
- **Verification:**
  - `npm run typecheck`, `npm test` (623 passed, 1 skipped: the Story 1.5 boundary test until Story 1.11), `npm run build`: all exit 0 after the patches.
  - Every I/O-matrix row has a passing test.
  - Browser check (`npm run preview`, by the implementation agent, attempt 1): Gunz list and status, ↓↓Enter, Kastl several + tap, `#q=92280+Kastl`, 320 px dark with doubled font, rows ≥ 44 px, only the two same-origin requests. It was not repeated after the Enter-rule change and the pass-2 patches.
- **Residual risks:**
  - Tapping a row on a real phone is untested (deferred).
  - "Au"-style exact names search directly even when other towns share the prefix (stated to the user).
  - Old shared links with a partial or shared name now resolve differently from Story 1.8 (`#q=Augs` → Augsburg, `#q=Kastl` → pick one).
  - Story 1.10 is still blocked on Story 1.11 (empty Bavaria boundary).
