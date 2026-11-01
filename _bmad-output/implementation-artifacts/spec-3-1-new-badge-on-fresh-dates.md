---
title: 'Story 3.1: "New" badge on fresh dates'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_revision: 'ad3f8cd83b056373cc7fa3ea3fd13ca7d8a2973a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Users who check back every day cannot tell which dates appeared since yesterday. The snapshot already carries `first_seen_at` and `baseline` for every listing (Story 2.5), and Story 3.8 made them stable, but the result card does not use them.

**Approach:** Add a shared 24 h constant. A dated result card shows a "New" badge after the map pin when `now − first_seen_at < 24 h` and the listing is not `baseline`, and its link name gets "new" after the date. `now` is the clock the search already reads once per search.

## Boundaries & Constraints

**Always:** The threshold is one exported constant in `shared/` (24 h), compared in the browser against the search's `now`. The badge is visible text ("New" / "Neu") in `--new-badge-*` tokens (ink-primary on surface-muted, full radius, meta typography), never blue and never a link. It sits outside the card link, in the `AddressLine` slot after the map pin (DESIGN.md: "A 'New' badge follows the pin"). The link name reads "<date>, new, <address>, …" (EN) / "<date>, neu, <address>, …" (DE). Every new string exists in both `en.json` and `de.json` with the same placeholders.

**Never:** No badge on no-dates or uncovered cards. No change to the pipeline, merge, snapshot schema or `schemaVersion`. No re-render while the page stays open (results never refresh in place). No new design tokens (the `--new-badge-*` tokens already exist).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh date | `baseline: false`, `first_seen_at` 2 h before `now` | Badge "New" after the pin; link name "<date>, new, <address>, …" | No error expected |
| Just under threshold | `baseline: false`, age = 24 h − 1 ms | Badge shows | No error expected |
| At threshold | `baseline: false`, age = exactly 24 h | No badge, no "new" | No error expected |
| Old date | `baseline: false`, age 3 days | No badge | No error expected |
| Baseline | `baseline: true`, age 1 h | No badge (first successful check) | No error expected |
| Reappeared date | `baseline: false`, original `first_seen_at` 5 days ago (merge keeps it) | No badge | No error expected |
| Future `first_seen_at` | `baseline: false`, `first_seen_at` 1 h after `now` (clock skew) | Badge shows (age counts as 0, as in `freshness`) | No error expected |
| German | Fresh date, `lang` de | Badge "Neu"; link name "<date>, neu, <address>, …" | No error expected |

</intent-contract>

## Code Map

- `shared/snapshot.ts:12` -- `FRESHNESS_MS` lives here; add `NEW_MS = 24 * 60 * 60 * 1000` beside it with a doc comment (FR16, AD-11). `snapshotListingSchema` (~line 55) already has `first_seen_at` (UTC ISO) and `baseline`.
- `web/src/search/format.ts:109` -- `freshness(lastSuccessAt, now, lang)` is the pattern: `Date.parse`, `Math.max(0, now − at)`. Add `isNew(listing: Pick<SnapshotListing, 'first_seen_at' | 'baseline'>, now: number): boolean` here, importing `NEW_MS` from `shared/snapshot.ts` (web → shared imports are allowed).
- `web/src/search/card-parts.tsx:153-164` -- `AddressLine({ address })` has a comment slot "New badge slot (Story 3.1): here, after the map pin." Add an optional `isNew` prop (or a `badge` child) and render `<span class="card__new">{t('card.new')}</span>` there; remove the slot comment.
- `web/src/search/result-card.tsx` -- `ResultCard({ result, now })`: compute `isNew(listing, now)`; pass it to `AddressLine`; pick `card.result_link_label_new` instead of `card.result_link_label` when new (same params).
- `web/src/search/no-dates-card.tsx`, `uncovered-card.tsx` -- read-only: they must not show the badge (they don't use `AddressLine` with a listing; leave unchanged).
- `web/src/i18n/en.json:97`, `de.json:97` -- `card.result_link_label` is "{date}, {address}, {name}, {status}, {registration}, opens {domain} in a new tab". Add `card.result_link_label_new` ("{date}, new, {address}, …" / "{date}, neu, {address}, …", otherwise identical) and `card.new` ("New" / "Neu").
- `web/src/styles/base.css:662` -- `.card__address` block; add `.card__new` after it: `display: inline-block`, `font: var(--new-badge-typography)`, `color: var(--new-badge-color)`, `background: var(--new-badge-background)`, `border-radius: var(--new-badge-rounded)`, small padding and left margin (mockup: `3px 6px`, `margin-left: 4px`, `vertical-align` nudge). Only the existing tokens are used, so `tests/design-tokens.test.ts` ("base.css uses only custom properties declared") still passes.
- `web/src/styles/tokens.css:154-157` -- read-only: `--new-badge-color/background/rounded/typography` already exist.
- `tests/fixtures/snapshot.ts:40-60` -- `snapshotListing` defaults `first_seen_at: '2026-10-28T06:00:00Z'`, `baseline: true`, so existing card tests show no badge. Override per test.
- `tests/search-page.test.tsx:447` -- `describe('result cards')`, `NOW = DEFAULT_NOW` (`2026-10-29T12:00:00Z`), `listingOf(...)`, `cardName(card)` (~131) reads the link name. Add the badge cases here.
- `tests/format.test.ts` -- unit tests for `format.ts` helpers; add `isNew` boundary cases.
- `_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/mockups/card-b-states.html:133,165` -- reference look for the badge.

## Tasks & Acceptance

**Execution:**
- `shared/snapshot.ts` -- export `NEW_MS` (24 h) with a comment -- the single shared threshold the AC requires.
- `web/src/search/format.ts` -- add `isNew(listing, now)`: `!listing.baseline && Math.max(0, now − Date.parse(listing.first_seen_at)) < NEW_MS` -- one tested predicate.
- `web/src/i18n/en.json`, `web/src/i18n/de.json` -- add `card.new` and `card.result_link_label_new` -- DE/EN parity.
- `web/src/search/card-parts.tsx` -- `AddressLine` renders the badge after the pin when asked; drop the slot comment.
- `web/src/search/result-card.tsx` -- wire `isNew` into the address line and the link-name key.
- `web/src/styles/base.css` -- `.card__new` pill from the `--new-badge-*` tokens.
- `tests/format.test.ts` -- `isNew` cases from the I/O matrix: under / at / over 24 h, baseline, future `first_seen_at`.
- `tests/search-page.test.tsx` -- rendered cases in `result cards`: fresh non-baseline card shows "New" after the map link inside `.card__address` and its link name has ", new, " right after the date; baseline and 25 h old cards show neither; German shows "Neu" and ", neu, "; the badge is not inside the card link.

**Acceptance Criteria:**
- Given a listing with `baseline: false` and `first_seen_at` less than 24 h before the search's `now`, when its result card renders, then the address line shows a "New" badge after the map pin, styled ink-primary on surface-muted (not blue, not a link), and the card's link name is "<date>, new, <address>, <centre>, <status>, <registration>, opens <domain> in a new tab".
- Given a listing first seen 24 h or more before `now`, or with `baseline: true`, when its card renders, then no badge shows and the link name has no "new".
- Given a date that disappeared and came back (merge kept its original `first_seen_at`, days old), when its card renders, then no badge shows.
- Given the code, when the threshold is looked up, then it is the exported `NEW_MS` in `shared/snapshot.ts`, and the web compares it against the `now` read once per search.

## Spec Change Log

## Review Triage Log

### 2026-11-01 — Review pass
- verdicts: 13 findings — high 0, medium 0, low 8, false 5, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) Forced-colours mode drops the badge fill, so "New" loses its pill — patched: `border: 0.0625rem solid transparent` on `.card__new`.
  - `[low]` `[patch]` (blind) Selecting/copying the address (`.card__address` is `user-select: text`) copies "New" glued to it — patched: `user-select: none` on `.card__new`.
  - `[low]` `[reject]` (blind) No test that no-dates/uncovered cards never show the badge — no defect: both call `AddressLine` without `isNew` (default `false`, `no-dates-card.tsx:29`, `uncovered-card.tsx:44`); a regression needs someone to add the prop deliberately.
  - `[low]` `[reject]` (blind) `card.result_link_label` and `_new` can drift apart — hypothetical developer drift with no current harm; the full EN link name is asserted in `search-page.test.tsx`.
  - `[low]` `[reject]` (blind) "Reappeared" `isNew` case duplicates the 3-day case; `NEW_MS` assertion restates the constant — cosmetic; reappearance is covered where it lives (`tests/merge.test.ts:102`, `:200`).
  - `[low]` `[reject]` (blind) Comments and test names say "24 h" instead of `NEW_MS` — cosmetic; the AC defines the threshold as 24 h.
  - `[false]` `[reject]` (blind) Unparseable `first_seen_at` yields NaN — unreachable: `snapshotListingSchema` validates `first_seen_at` as a UTC ISO datetime before the web uses it.
  - `[false]` `[reject]` (intent) Badge position differs from UX-DR14 "after the date" — the story AC says "after the address" and DESIGN.md says "A 'New' badge follows the pin"; the diff matches both.
  - `[low]` `[reject]` (intent) "Not blue" pill styling is not asserted in tests — CSS uses only the `--new-badge-*` tokens (ink-primary on surface-muted), checked by the design-token test; computed-style asserts in jsdom add little.
  - `[false]` `[reject]` (intent) `now` is read once per search, not a live browser clock — EXPERIENCE.md: "Results never re-sort or refresh while the page is open"; at search time it is the browser's current time.
  - `[false]` `[reject]` (intent) Reappearance only tested at the predicate level — the guarantee is merge behaviour, already tested in `tests/merge.test.ts:102,200` (Stories 2.5, 3.8); `isNew` only reads `first_seen_at`.
  - `[low]` `[reject]` (intent) No test for no-dates/uncovered cards — same as the blind finding above; no defect.
  - `[false]` `[reject]` (intent) Future `first_seen_at` counted as new is not in the story — it follows `freshness`'s existing age-0 rule and only matters under clock skew; not a defect.

## Design Notes

- The badge stays readable by screen readers (not `aria-hidden`), like the address it sits in: it is outside the link, and EXPERIENCE.md says "new" carries visible text. The link name repeats "new" for users who move by link.
- A separate `card.result_link_label_new` key keeps each language's word order in its own catalogue instead of joining fragments in code.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including i18n parity, design tokens, format and search-page badge cases.
- `npm run typecheck` -- expected: no errors.

## Auto Run Result

**Summary:** Result cards show a "New" pill after the map pin when a non-baseline date was first seen less than 24 h before the search's `now`, and the card link name gets "new"/"neu" right after the date. The threshold is `NEW_MS` in `shared/`. No pipeline or schema change.

**Files changed:**
- `shared/snapshot.ts` -- `NEW_MS` (24 h) beside `FRESHNESS_MS`.
- `web/src/search/format.ts` -- `isNew(listing, now)`.
- `web/src/search/card-parts.tsx` -- `AddressLine` renders the badge after the pin when `isNew`.
- `web/src/search/result-card.tsx` -- wires `isNew` into the address line and the link-name key.
- `web/src/i18n/en.json`, `de.json` -- `card.new`, `card.result_link_label_new`.
- `web/src/styles/base.css` -- `.card__new` pill from the `--new-badge-*` tokens; rem/em values instead of the mockup's px (the token test forbids px literals).
- `tests/format.test.ts`, `tests/search-page.test.tsx` -- `isNew` boundaries and rendered badge / link-name cases (EN and DE).

**Review:** 13 findings. Patched: 2 low (forced-colours outline, badge excluded from address selection). Deferred: none. Rejected: 6 low and 5 false, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false — patched counts: high 0, medium 0, low 2.

**Verification:** `npm test` 1,300 passed, 1 skipped (34 files); `npm run typecheck` clean, before and after the review patches. Every I/O matrix row has a passing test.

**Residual risks:** Not checked visually in a real browser (jsdom only), including forced-colours mode.
