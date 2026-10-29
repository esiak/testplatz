---
title: 'Story 2.8: No-dates and not-checked-right-now cards'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: 'f9cdae8a3e47f7b48c982e1c0505dce4d04b9e64'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Since Story 2.7, every centre in range without an upcoming date renders as the uncovered "Not checked automatically" card and counts as "unchecked", even when its last check succeeded and simply found no dates, or when it is read automatically but the check failed. A gap in data must never read as "nothing available", and a real "nothing listed" must not read as "not checked".

**Approach:** Classify each shown centre without an upcoming date by coverage first (AD-8): `covered` + `last_result: ok` → a new no-dates card; `covered` + `failed`/`null` → the uncovered card with the "Not checked right now" line; `not_checked` → the uncovered card as today. Only uncovered cards count as "unchecked" in the count line.

## Boundaries & Constraints

**Always:**
- Classification is a pure function of the centre (`coverage`, `last_result`), applied to the 2.7 `undated` list only. A covered centre that still has upcoming dates keeps its result cards whatever its `last_result` (FR14); their freshness line already ages from `last_success_at`.
- No-dates card (UX-DR16), same layout as a result card: h3 in card-date style holding the centre name (`lang="de"`) as the stretched link to `test_page_url ?? website` (new tab, `rel="noopener noreferrer"`; plain text and no destination line when both are null), chip "No dates listed" (`status.no_dates`, `chip--booked`, `aria-hidden`); address line with "Map ↗" (centre address); key facts Distance / Status "No dates listed" / Deadline "unknown" / Registration "unknown" (no centre-level registration data exists); bottom row: destination "<domain> ↗" (`aria-hidden`) and the 2.7 freshness line from `last_success_at`. No "Why?" link, no body line. Link name: "<centre>, no dates listed, opens <domain> in a new tab".
- "Not checked right now" card: today's `UncoveredCard` with `card.not_checked_right_now` as its body line instead of `card.not_checked_automatically`; everything else unchanged (chip "Not checked", facts, "Why?" to About `#not-checked`, no freshness line). Never shows "No dates listed".
- Count line: `unchecked` = uncovered cards shown (both variants); no-dates cards count in neither number. With 0 dates, the "No dates found nearby…" notice shows (already true since 2.7) — including when every card is a no-dates card.
- Order unchanged: dated cards, then the undated centres in the outcome's order (Story 2.9 adds sorting).
- All words from `web/src/i18n/{de,en}.json`; new keys in both files.

**Never:**
- No pipeline, schema or snapshot changes; no new dependencies; no sort control or heading (2.9); no "New" badge (3.1).
- A covered centre with `last_result` `failed` or `null` never gets a no-dates card or "No dates listed" anywhere on its card.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Checked, nothing listed | covered, `ok`, no listings | no-dates card with freshness line, opens test page; not counted as unchecked | — |
| Checked, only past dates | covered, `ok`, all listings before now | no-dates card | — |
| Check failed, no dates | covered, `failed`, no listings | uncovered card, "Not checked right now. See the centre's page.", counted | — |
| Never checked | covered, `last_result: null` | uncovered card, "Not checked right now…", counted | — |
| Not covered | `not_checked` | uncovered card, "Not checked automatically…", counted | — |
| Failed but has dates | covered, `failed`, future listings, `last_success_at` 40 h ago | result cards stay, freshness "◷ Checked …" | — |
| Only no-dates/uncovered in range | 0 dates | "0 dates and M unchecked centres within R km" (M = uncovered cards) + no-dates notice | — |
| No link | no-dates centre with no test page and no website | name as plain text, no destination line | — |

</intent-contract>

## Code Map

- `web/src/search/results.ts` -- `datedResults` → `{ dated, undated }`; `UndatedResult { centre, distanceKm }`. Add the pure classifier (e.g. `undatedKind(centre)` → `'no_dates' | 'not_checked_right_now' | 'not_checked'`) here.
- `web/src/search/search-page.tsx` -- `CountLine` (`unchecked = shown.undated.length` today; `COUNT_KEYS` for singular/plural), results body renders `shown.undated` as `UncoveredCard`s, notice rule `shown.dated.length === 0`.
- `web/src/search/uncovered-card.tsx` -- `UncoveredCard({ item })`: body line `t('card.not_checked_automatically')`; add a prop for the right-now variant. `aboutSectionUrl`, `whyUrl` live here.
- `web/src/search/result-card.tsx` -- `FreshnessLine` (not exported yet) and the result-card markup/classes (`card__date` h3 with `.card__link`, `.chip--booked`, `.card__address`, `dl.key-facts`, `.card__bottom`, `.card__destination`); export `FreshnessLine` for reuse.
- `web/src/search/search.ts` -- `destinationDomain`, `mapsUrl`, `formatAddress`.
- `web/src/i18n/{en,de}.json` -- existing `status.no_dates`, `card.not_checked_right_now`, `card.fact.*` (`distance_unknown` is the "unknown" word), `card.destination`, `card.link_label`.
- `web/src/data/snapshot.ts` -- `uncheckedCentres` already lists covered non-`ok` centres on About `#not-checked`; no change.
- `tests/search-page.test.tsx` -- `describe('result cards')` has `showWith(centres, listings, lang)`, fixed clock `DEFAULT_NOW`, helpers `cards()`, `cardNames()`, `statusText()`; its first two tests assert the 2.7 interim (a covered `ok` centre "vhs Erlangen" as an uncovered card with `.card__why`, counted unchecked) and must be updated to the new classification. `tests/results.test.ts`, `tests/fixtures/snapshot.ts` (`coveredCentre(id, lastResult)`, `snapshotListing`).

## Tasks & Acceptance

**Execution:**
- `web/src/search/results.ts` -- add the classifier (and attach it to undated entries or export it) -- AD-8 card rule.
- `web/src/search/no-dates-card.tsx` (new) -- `NoDatesCard` per the rules above, reusing `FreshnessLine` -- FR24, UX-DR16.
- `web/src/search/result-card.tsx` -- export `FreshnessLine`.
- `web/src/search/uncovered-card.tsx` -- right-now variant of the body line -- FR12.
- `web/src/search/search-page.tsx` -- render undated entries by kind; `unchecked` counts uncovered kinds only -- FR30/FR31.
- `web/src/i18n/{en,de}.json` -- `card.no_dates_link_label`: "{name}, no dates listed, opens {domain} in a new tab" / "{name}, keine Termine angegeben, öffnet {domain} in einem neuen Tab".
- `tests/results.test.ts` -- classifier for all coverage/result combinations.
- `tests/search-page.test.tsx` -- every matrix row at page level (card parts, link, aria, count line and announcement, notice), and update the 2.7 interim assertions.

**Acceptance Criteria:**
- Given a covered centre with `last_result: ok` and no upcoming date in range, when I search, then its card shows the name as the h3 link to its test page, the "No dates listed" chip, address + Map, facts Distance / "No dates listed" / "unknown" / "unknown", the destination and the freshness line, and no "Why?" link.
- Given a covered centre with `last_result` `failed` or `null` and no upcoming date, when I search, then its card reads "Not checked right now. See the centre's page." and no text on it reads "No dates listed".
- Given only no-dates and uncovered cards in range, when I search, then the count line and the status announcement read "0 dates and M unchecked centres within R km" with M = uncovered cards, and the no-dates notice shows.
- Given the whole repo, when `npm run typecheck`, `npm test` and `npm run build` run, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 17 findings — high 0, medium 0, low 8, false 9, maybe-false 0
- findings:
  - `false` `reject` Blind: no-dates cards are not counted or announced in the count line — the count line wording is fixed by the AC ("N dates and M unchecked centres"); no-dates cards are still in the list a screen reader reads.
  - `low` `patch` Blind: "No dates listed" shown on stale data — the freshness line already ages to the exact time after 36 h (no banner by design); added a page test for a 40 h old no-dates card.
  - `low` `reject` Blind: Deadline/Registration reuse `card.fact.distance_unknown` — same pattern as the shipped 2.7 result card; harm only if the word is reworded, and the fix adds a key across both catalogues.
  - `low` `reject` Blind: `NoDatesCard` and `UncoveredCard` duplicate markup — a shared card shell is a refactor, not a direct correction.
  - `low` `patch` Blind: `rightNow` boolean instead of the kind; over-long JSDoc line — JSDoc re-wrapped; the prop shape stays (two variants, typed caller).
  - `false` `reject` Blind: classification runs twice — the same pure function on the same centre gives the same answer; no divergence possible.
  - `low` `patch` Blind: German right-now test asserts against the JSON value — now asserts the literal German sentence.
  - `low` `patch` Blind: singular test title no longer matches and no mixed count — renamed, and a dated + no-dates + uncovered case asserts "1 date and 1 unchecked centre".
  - `false` `reject` Blind: `ok` with `last_success_at: null` untested — unreachable: merge sets `last_success_at` on every `ok` run.
  - `false` `reject` Blind: right-now card address, Map and link fallbacks untested — that markup is the unchanged `UncoveredCard`, already covered by the "uncovered card" tests.
  - `low` `patch` VG: no-dates card with a null distance never rendered — added a test for a centre without coordinates in the searched place (Distance "unknown").
  - `false` `reject` Intent: Registration hard-coded "unknown" instead of "as known" — no centre-level registration data exists; recorded in Design Notes.
  - `false` `reject` Intent: no-dates name uses `card__name`, not `card__date` — both classes share one CSS rule (card-date font).
  - `false` `reject` Intent: "0 dates and 0 unchecked centres" when only no-dates cards show — that is the AC's count rule (M = uncovered cards), and the notice shows.
  - `false` `reject` Intent: AC3 has no code change, only a test — the behaviour already exists from 2.7 and the test proves it.
  - `false` `reject` Intent: "Why?" leads to About `#not-checked` for a failed centre — that section already lists centres whose last check failed.
  - `low` `reject` Intent: stretched link and card-date style not checked in a real browser — same CSS pattern as the shipped cards; a browser harness is new infrastructure.

## Design Notes

- "Registration as known" (UX-DR16): a centre has no registration field and no-dates centres have no listings, so the value is always "unknown" today.
- The "Not checked" chip on the right-now card is kept: the check really did not happen, and the chip vocabulary has no other word for it.

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all tests pass
- `npm run build` -- expected: succeeds

## Auto Run Result

Status: done

**Summary:** Centres in range without an upcoming date now get the card their check status calls for (coverage first): a covered centre whose last check was `ok` gets a new "No dates listed" card (name as the link to its test page, chip, address + Map, facts Distance / "No dates listed" / "unknown" / "unknown", destination, freshness line); a covered centre whose check failed or never ran gets the uncovered card with "Not checked right now. See the centre's page."; uncovered centres keep "Not checked automatically". Only uncovered cards count as "unchecked" in the count line and announcement. Result cards of a failed centre stay and age.

**Files changed:**
- `web/src/search/results.ts` -- `undatedKind` classifier.
- `web/src/search/no-dates-card.tsx` -- new `NoDatesCard`.
- `web/src/search/uncovered-card.tsx` -- `rightNow` body-line variant.
- `web/src/search/result-card.tsx` -- `FreshnessLine` exported.
- `web/src/search/search-page.tsx` -- cards by kind; unchecked count.
- `web/src/i18n/{en,de}.json` -- `card.no_dates_link_label`.
- Tests: `tests/results.test.ts` classifier; `tests/search-page.test.tsx` new block and updated 2.7 counts.

**Review findings:** 17 findings (high 0, medium 0, low 8, false 9). Patched 5 low entries (tests for a null-distance and a stale no-dates card, literal German assertion, mixed count case and renamed test, JSDoc wrap). Nothing deferred. Rejected 9 false and 3 low rows, each with its reason in the Review Triage Log. The 2.7 deferred item (checked centres without dates shown as uncovered) is resolved by this story.

**Follow-up review recommended:** false. Patched entries: 0 high, 0 medium, 5 low.

**Verification:**
- `npm run typecheck` -- clean.
- `npm test` -- 32 files, 1128 passed, 1 skipped (skipped before).
- `npm run build` -- succeeds.
- Matrix audit: every I/O row has a passing page test in `tests/search-page.test.tsx` ("no-dates and not-checked-right-now cards"), plus the classifier table in `tests/results.test.ts`.

**Residual risks:**
- Not checked by eye in a real browser.
- Registration on no-dates cards is always "unknown" until some centre-level registration data exists.
