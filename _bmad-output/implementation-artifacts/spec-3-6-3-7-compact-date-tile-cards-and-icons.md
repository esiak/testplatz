---
title: 'Stories 3.6 + 3.7: Compact date-tile result cards with status, registration and eligibility icons'
type: 'feature'
created: '2026-10-31'
status: 'in-review'
baseline_revision: 'fe29cbf18b348d0256e988c7410624e78828176a'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md'
warnings: ['multiple-goals', 'oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Result cards are ~260 px tall on a phone: a key-facts box, a status chip, a destination line and a registration word repeat facts and push dates apart (UX revision 2026-10-30, UX-DR30/31).

**Approach:** Rebuild result, no-dates and uncovered cards as variant B "date tile" (DESIGN.md Components, `mockups/card-b-states.html`): tile | text column (address + map pin, meta line, centre, freshness) | stacked icon toggletips (status, registration, eligibility-when-null), with a full-width eligibility line when a rule exists. Stories 3.6 and 3.7 ship together because the icons replace the chip and facts the tile layout removes.

## Boundaries & Constraints

**Always:**
- One stretched link per card: `h3.card__heading > a.card__link` wrapping the tile (tile content `aria-hidden`), new tab, `rel="noopener noreferrer"`. Dated link name: `<cardDate>, <address>, <centre>, <status spoken>, <registration label>, opens <domain> in a new tab` (EN/DE). Map pin, icons, address text, eligibility line and "Why?" sit above the link layer (`position: relative; z-index`); never nested in the link.
- Map pin: icon-only link, 44 px target, `aria-label` "Map: <address> (Google Maps, new tab)" (existing `card.map_label`).
- Meta line: dated `HH:mm · <distance> · <deadline>` — distance "14 km" / "distance unknown"; deadline "Deadline 13 Nov" / "Deadline passed" (`--color-status-unknown`) / "Deadline unknown". No-dates: "No dates listed · <distance>". Uncovered: "Not checked automatically" or "Not checked right now" (unknown colour) · distance. Separators "·" come from CSS `content: "·" / ""` (no text nodes, not spoken).
- `link_ok: false` with a test page: last meta line "Opens the centre's test page" in action colour; card opens `test_page_url` (existing href fallback order unchanged).
- Eligibility text → full-width `.card__eligibility` row: house icon (`aria-hidden`), visually hidden "Who may register:", rule in `<span lang="de">`. Never hides, reorders or flags a card.
- Icons (dated cards only): status, registration, then eligibility only when `eligibility === null`. Each is `<button type="button">` with `aria-label` = its label and `aria-expanded`; visible label bubble (icon-label tokens, `aria-hidden`) above it on hover, `:focus-visible`, or when expanded; a per-icon visually hidden `aria-live="polite"` span holds the label text while expanded (no extra `role=status`). Click/Enter/Space toggles; Escape, pointerdown outside, or opening another icon closes; only one open page-wide. Target ≥ 36 × 36 px, visible circle 28 px.
- Status shapes/tints: tick free (free), slashed circle booked_out (booked), clock waitlist (booked), question mark unknown (unknown). Registration: screen online, envelope email, mailbox post, person in_person, form-with-question null. Eligibility: person-with-question "Who may register: not stated". SVG paths from the mockup's `<symbol>`s.
- Tiles: dated = month (meta), day (`tile-day`), weekday (meta); no-dates = calendar icon; uncovered = question mark on `--color-status-unknown-bg`. Uncovered keeps "Why?" (44 px), no freshness line; no-dates/uncovered have no icons. When an undated card has no URL, the h3 holds the centre name as visually hidden text.
- Tokens: `tokens.css` matches DESIGN.md exactly — removed tokens (`--font-card-date*`, `--font-fact*`, `--space-fact-cell-min`, `--key-facts-row-*`, `--status-chip-*`, `--destination-line-*`) gone, and the design-tokens test fails on any token not derived from DESIGN.md.
- 320 px / 200 % zoom, longest German strings: tile, text and icon columns stay side by side (`grid-template-columns: var(--date-tile-width) minmax(0, 1fr) auto`), text wraps, no sideways scroll.
- All words from `web/src/i18n/{en,de}.json`, same meaning, no "!".

**Never:**
- No "New" badge or "new," in the link name (Story 3.1). No untimed-date wording (Story 3.10).
- No change to search, selection, sorting, hide-booked-out or fragment logic.
- No literal colours/px/`height:`/inline styles in web files (scanner in `tests/design-tokens.test.ts`).
- Nothing on the card may read as "open to all".

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Waitlist, online, rule | status waitlist, deadline future, eligibility text | tile Dec/9/Wed; meta "10:00 · 0 km · Deadline 11 Nov"; clock icon "Booked out · Waitlist", screen "Register online"; no eligibility icon; eligibility row | No error expected |
| Dead link, past deadline, nulls | link_ok false, deadline past, registration null, eligibility null | meta "… · Deadline passed" (warn class); "Opens the centre's test page"; icons tick, form-question "Registration: see website", person-question "Who may register: not stated" | No error expected |
| Unknowns | distance null, deadline null | "distance unknown", "Deadline unknown"; card stays | No error expected |
| Icon toggle | click status icon, then registration icon, then Escape / outside pointerdown | first expanded then closed when second opens; Escape or outside closes; live span text set only while open; card link not followed | No error expected |
| No-dates card | checked, no current dates | calendar tile; "No dates listed · 0 km"; centre; freshness; no icons | No error expected |
| Uncovered card | no reader / failed | question tile (unknown tint); "Not checked automatically"/"Not checked right now" · distance; centre; "Why?"; no freshness, no icons | No error expected |

</intent-contract>

## Code Map

- `web/src/search/result-card.tsx` -- dated card. Today: h3 date link, chip, `card__centre`, address + "Map ↗", `<dl class="key-facts">`, eligibility p, `card__bottom` destination + `FreshnessLine` (exported, reused by no-dates card; `MARK` split keeps ◷ `aria-hidden`). `STATUS_WORD`, `REGISTRATION_WORD` maps; `statusSpoken` waitlist rule; href fallback `link_ok ? source_url : test_page_url ?? website ?? source_url`; `testPage` flag. Rewrite markup; keep href/domain/freshness logic.
- `web/src/search/no-dates-card.tsx`, `web/src/search/uncovered-card.tsx` -- same old structure (chip, key-facts, destination). Rewrite to tile layout; keep `whyUrl`/`aboutSectionUrl` exports (used by `search-page.tsx`), `card.no_dates_link_label`.
- New `web/src/search/card-parts.tsx` -- shared `Glyph` SVGs, `DateTile`/`IconTile`, `MapPin`, `MetaLine` (parts joined by CSS separators), `CardIcon` toggletip with page-wide single-open state.
- `web/src/search/format.ts` -- `cardDate` (`Wed 9 Dec, 10:00`), `deadlineState`, `localParts`/`calendar` helpers. Add `tileDate(startsAt, lang)` → `{ month, day, weekday }` and `cardTime(startsAt)` → `HH:mm`.
- `web/src/search/search.ts` -- `destinationDomain`, `mapsUrl`, `formatAddress` (reuse).
- `web/src/styles/tokens.css` -- new tokens already present (date-tile, status-icon, info-icon, icon-label, eligibility-line, card-meta, tile-width, icon-size, icon-target, card-address, tile-day); delete removed ones; update header comment (variants rule now generic).
- `web/src/styles/base.css` ~548–735 -- `.card`, `.card__top`, `.card__name/.card__date`, `.chip*`, `.card__centre`, `.card__eligibility`, `.card__freshness`, `.card__address`, `.card__map`, `.card__body`, `.card__facts`, `.key-facts*`, `.card__bottom`, `.card__destination`, `.card__why`. Replace with tile grid; keep `.card:has(.card__link:focus-visible)` ring and `.card__link::after` stretch. `.visually-hidden` exists (~161).
- `web/src/i18n/en.json`, `de.json` -- remove `card.fact.*`, `card.destination`, `card.eligibility_unknown`, `card.chip_not_checked`, `card.map`; `card.deadline_passed` → "Deadline passed"/"Anmeldeschluss abgelaufen"; add `card.distance`, `card.distance_unknown`, `card.deadline`, `card.deadline_unknown`, `card.registration.unknown`, `card.meta_not_checked_automatically`, `card.meta_not_checked_right_now`; `card.registration.*` → "Register online/by email/by post/in person"; `card.result_link_label` gains `{address}`, `{registration}`; `card.link_label` → `{name}, {reason} Opens {domain} in a new tab` using the full not-checked sentences (kept: they are Voice-and-Tone strings checked by `tests/i18n.test.ts`). `link.external_mark` stays (About page).
- `tests/search-page.test.tsx` -- `uncovered card` (~184), `result cards` (~273), `no-dates and not-checked-right-now cards` (~541) assert chips/facts/destination; `cardNames()` (~127) reads h3 text; `facts()` helpers at ~337, ~582, ~1392. Update to the new layout.
- `tests/shell.test.tsx` ~231, ~313 -- expects `.card__destination` and `[[card.fact.distance_unknown]]`; sentinel `leftoverText` forbids untranslated text nodes.
- `tests/design-tokens.test.ts` -- add "no extra tokens" check.

## Tasks & Acceptance

**Execution:**
- `web/src/search/format.ts` -- add `tileDate`, `cardTime` -- tile and meta parts.
- `web/src/search/card-parts.tsx` -- new shared parts and `CardIcon` toggletip -- one implementation for three cards.
- `web/src/search/result-card.tsx`, `no-dates-card.tsx`, `uncovered-card.tsx` -- rebuild to variant B -- UX-DR30/31, FR7/8/12/24/35.
- `web/src/styles/tokens.css`, `web/src/styles/base.css` -- drop removed tokens/rules; add tile grid, meta, icon, label, eligibility styles -- UX-DR25/30/31.
- `web/src/i18n/en.json`, `de.json` -- key changes above -- UX-DR26.
- `tests/design-tokens.test.ts` -- no-extra-tokens test -- UX-DR30 AC.
- `tests/format.test.ts` -- `tileDate`/`cardTime` EN/DE.
- `tests/search-page.test.tsx`, `tests/shell.test.tsx` -- rewrite card assertions; add `describe('card icons')` covering every matrix row, order, shapes (`data-icon` attr on the glyph), toggle/Escape/outside/single-open, `aria-expanded`, live text, no navigation, German labels.

**Acceptance Criteria:**
- Given DESIGN.md frontmatter, when `tests/design-tokens.test.ts` runs, then it passes and fails if any removed token is re-added.
- Given the built site at 320 px wide in German, when results render, then each card's tile, text and icon columns share one row, `document.documentElement.scrollWidth` equals 320, and icon buttons measure ≥ 36 × 36 px without overlapping each other or the map pin.
- Given any card, when read by a screen reader, then no tile text or separator is exposed, and the dated link name follows the Always rule.

## Design Notes

The full "Not checked automatically. See the centre's page." sentences stay in the catalogues (Voice-and-Tone test) and move into the uncovered link name, while the visible meta line uses the short form the AC requires: `Akademie Nürnberg, Not checked automatically. See the centre's page. Opens kurse.akademie.example.de in a new tab`.

Single-open: a module-level `closeOpen` callback; opening an icon calls the previous one's close. Tests can read `cardNames()` via `.card__link` label prefix up to `, <address>` for dated cards and `.card__centre` for undated ones.

## Verification

**Commands:**
- `npm test` -- expected: all pass, including i18n parity, design tokens and new card-icon tests.
- `npm run typecheck` -- expected: no errors.
- `npm run build` -- expected: succeeds.

**Manual checks:**
- `vite preview`, "Herrsching" 10 km EN and DE: tile/icons/meta render; tap icon shows label and does not open card; 320 px DE: no sideways scroll, icon targets 36 px.
