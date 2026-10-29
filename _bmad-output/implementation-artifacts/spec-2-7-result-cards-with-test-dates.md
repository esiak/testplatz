---
title: 'Story 2.7: Result cards with test dates'
type: 'feature'
created: '2026-10-29'
status: 'done'
baseline_revision: '7026b59f80d3106614e14affc4fb8d77eb2e9c54'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A covered centre whose last check was ok but that has no upcoming date is still shown as an uncovered "Not checked automatically" card and counted among the "unchecked centres" in the count line.
    evidence: |-
      Pre-existing: before 2.7 every centre rendered as an uncovered card and was counted as unchecked. Story 2.8 ("No-dates and not-checked-right-now cards") owns the no-dates card and the count/notice rules for these centres; 2.7's spec keeps the interim behaviour so the count matches the cards shown.
    location: >-
      web/src/search/search-page.tsx CountLine; web/src/search/results.ts undated
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Snapshot v2 (Story 2.6) publishes `listings[]`, but the search page ignores them: every centre in range still renders as an uncovered "Not checked" card and the count line always says "0 dates".

**Approach:** After a search, turn the snapshot's upcoming listings of the centres shown into one result card per date (date/time, status chip, centre, address + Map, key facts `dl`, "Who may register" line, destination, freshness), list them before the centres without dates, and make the count line and no-dates notice count them. All words come from `web/src/i18n/{de,en}.json`; formatting is computed in the browser against one `now` taken when the search runs.

## Boundaries & Constraints

**Always:**
- Which dates: listings whose `centre_id` is a centre shown by the search (in-range `items` or in-place `unlocated`) and whose `Date.parse(starts_at) >= now` (earlier ones hidden, FR5). `now` comes from an injectable clock (`SearchServices.now`, default `Date.now`), read once per shown outcome; results never refresh while open.
- Order: dated cards by `starts_at`, then distance (unknown last), then listing `id`; then the centres without a shown date as today's `UncoveredCard`s, in today's order (in-range nearest first, then in-place unlocated). Story 2.8 replaces those cards; 2.9 adds the sort control.
- Count line: `dates` = dated cards shown, `unchecked` = centres shown without a dated card; four keys cover singular/plural of each ("1 date", "1 unchecked centre"). The announcement in the `role=status` region uses the same text. The "No dates found nearby…" notice shows only when `dates` is 0.
- Result card (UX-DR9, top to bottom): `<h3>` card-date with the stretched link (`target=_blank`, `rel="noopener noreferrer"`, no nested links) → "New" badge slot left empty (Story 3.1) → status chip (`aria-hidden`); centre name (`lang="de"`); address line = `listing.address` + "Map ↗" (existing pattern, above the link layer); key facts `dl` Distance / Status / Deadline / Registration; "Who may register" line (above the link layer, selectable); bottom row: destination (`aria-hidden`) and freshness line.
- Formats (Europe/Berlin local, read from the `starts_at` string itself, never the browser time zone): card date en `Wed 9 Dec, 10:00`, de `Mi., 9. Dez., 10:00` (Intl `weekday:short, day:numeric, month:short` in `en-GB` / `de-DE`, UTC on the date parts, + `HH:mm`). Deadline en `11 Nov`, de `11. Nov.`; `Passed` / `Abgelaufen` when the deadline is before today's Berlin date (the card stays); `null` → "unknown".
- Status words: chip and Status cell use `status.free` / `status.booked` / `status.booked_waitlist` / `status.unknown`; chip variants free → `chip--free`, booked_out and waitlist → `chip--booked`, unknown → `chip--unknown`. Wherever "Booked out · Waitlist" is read aloud it is spoken "Booked out, waitlist open" (new `status.booked_waitlist_spoken`); in the Status cell the visible text is `aria-hidden` with a visually hidden spoken copy.
- Registration: `online`/`email`/`post`/`in_person` → "Online" / "Email" / "Post" / "In person" (de "Online" / "E-Mail" / "Post" / "Vor Ort"); `null` → "unknown". Distance: rounded km, or "unknown" for an unlocated centre.
- Eligibility: "Who may register: " + provider text in `<span lang="de">` as published; `null` → "Who may register: not stated, check the provider page". It never affects which cards show or their order.
- Link: `link_ok: true` → `listing.source_url`, destination "<domain> ↗"; `link_ok: false` → centre `test_page_url` (else `website`, else `source_url`), destination "Opens the centre's test page". Link name (`aria-label`): "<date, time>, <centre>, <status spoken>, opens <domain> in a new tab" with the domain of the opened URL.
- Freshness (per centre, `centre.last_success_at`, `<time datetime=…>`, meta, ink-secondary): age < 1 h → "Checked less than 1 h ago"; < 36 h (`FRESHNESS_MS`) → "Checked {hours} h ago" (whole hours, floored); otherwise "◷ Checked {time}", time = Berlin weekday + `HH:mm` when under 7 days, else weekday, day, month + `HH:mm`; ◷ `aria-hidden`. A future timestamp counts as age 0. No line when `last_success_at` is `null`.

**Never:**
- No pipeline, schema, snapshot or data changes; no new dependencies. No sort control, no "No dates to show" heading, no no-dates card, no "Not checked right now" card, no booked-out notice (2.8 / 2.9), no "New" badge (3.1).
- Eligibility is never matched against the searched place, never hides, reorders or flags a card.
- No colour-only or glyph-only meaning; no hard-coded UI words outside the catalogues.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two dates, one centre | covered centre in range, 2 future listings | 2 result cards, centre absent from uncovered list, "2 dates and 0 unchecked centres within 40 km", no no-dates notice | — |
| Past date | `starts_at` before now | hidden; centre falls back to an uncovered card if it has no other date | — |
| Out-of-range centre's listing | listing of a centre not shown | not shown, not counted | — |
| Unlocated centre with a date | centre without coords in the searched place | result card, Distance "unknown", sorted after equal-time located dates | — |
| Passed deadline | `deadline` before today (Berlin) | Deadline "Passed", card stays | — |
| Missing fields | `deadline`, `registration_method`, `eligibility` null; `status` unknown | "unknown", "unknown", "Who may register: not stated, check the provider page", chip "Status unknown" | — |
| Waitlist | `status: waitlist` | chip "Booked out · Waitlist"; link name and Status cell spoken "Booked out, waitlist open" | — |
| Dead deep link | `link_ok: false` | opens `test_page_url`; destination "Opens the centre's test page" | — |
| Fresh / stale | `last_success_at` 2 h / 40 h / 10 d ago | "Checked 2 h ago" / "◷ Checked Tue 14:00" / "◷ Checked Mon 19 Oct, 14:00" | — |

</intent-contract>

## Code Map

- `web/src/search/search-page.tsx` -- `show()` calls `runSearch` and stores the outcome; results branch at ~L257 renders `CountLine`, notice, `UncoveredCard`s for `outcome.items` then `outcome.unlocated`. `CountLine` hard-codes `dates: 0`. `SearchServices` is the injection point for `now`. `AnnouncementText` reuses `CountLine`.
- `web/src/search/search.ts` -- `runSearch` (centre-level, keep unchanged so `tests/search.test.ts` holds), `CentreInRange`, `destinationDomain`, `mapsUrl`, `formatAddress`.
- `web/src/search/uncovered-card.tsx` -- card markup pattern to mirror: h3 + `.card__link` stretched link with `aria-label`, `.chip`, `.card__address` + `.card__map`, `.card__facts` > `dl.key-facts`, `.card__bottom` > `.card__destination`.
- `shared/snapshot.ts` -- `SnapshotListing` (id, centre_id, starts_at `YYYY-MM-DDTHH:mm:00+0X:00`, address, status, deadline, registration_method, source_url, link_ok, eligibility, first_seen_at, baseline), `FRESHNESS_MS`. `shared/listing.ts` -- `StatusCode`, `RegistrationMethod`.
- `web/src/i18n/{en,de}.json` -- existing `status.*`, `freshness.relative`, `freshness.exact` ("◷ Checked {time}"), `card.destination`, `card.fact.*`, `results.count[_one]`. `tests/i18n.test.ts` checks same keys/placeholders in both files and that every EXPERIENCE.md Voice-and-Tone string ("◷ Checked Tue 14:00", "Checked 2 h ago", …) matches an en value as a pattern (placeholders → `.+`).
- `web/src/styles/base.css` ~L411–570 -- `.card*`, `.chip`, `.chip--unknown`, `.key-facts*`; tokens `--status-chip-{free,booked}-{color,background}` already exist in `tokens.css`; `.visually-hidden` exists.
- `tests/search-page.test.tsx` -- App-level harness (`serve()`, fake storage, `snapshotOf`); `tests/fixtures/snapshot.ts` -- `snapshotCentre`, `coveredCentre`, `snapshotOf` (listings `[]`).
- `tests/shell.test.tsx` -- renders with sentinel catalogues `[[key]]`; must keep passing.

## Tasks & Acceptance

**Execution:**
- `web/src/search/results.ts` (new) -- pure `datedResults(outcome, listings, now)` → `{ dated: Array<{listing, centre, distanceKm|null}>, undated: Array<{centre, distanceKm|null}> }` with the filtering and order rules above.
- `web/src/search/format.ts` (new) -- pure `cardDate(startsAt, lang)`, `deadlineText` inputs (`deadlineState(deadline, now)` → `unknown`/`passed`/date text), `berlinToday(now)`, `freshness(lastSuccessAt, now, lang)` → `{kind:'under_hour'} | {kind:'relative', hours} | {kind:'exact', time}`.
- `web/src/search/result-card.tsx` (new) -- `ResultCard` per the card rules above.
- `web/src/search/search-page.tsx` -- `SearchServices.now`; store `now` with the outcome; render dated cards then undated `UncoveredCard`s; `CountLine` with real counts and four plural keys; notice only when 0 dates.
- `web/src/i18n/{en,de}.json` -- new keys: `results.count_date_one`, `results.count_date_one_one`, `status.booked_waitlist_spoken`, `card.result_link_label`, `card.destination_test_page`, `card.eligibility_label`, `card.eligibility_unknown`, `card.deadline_passed`, `card.registration.{online,email,post,in_person}`, `freshness.under_hour`; change `freshness.exact` to "{mark} Checked {time}" / "{mark} Geprüft {time}" so ◷ renders `aria-hidden` and the Voice-and-Tone pattern still matches.
- `web/src/styles/base.css` -- `.chip--free`, `.chip--booked`, `.card__date`, `.card__centre`, `.card__eligibility` (above link layer, `z-index:1`, selectable), `.card__freshness`.
- `tests/results.test.ts`, `tests/format.test.ts` (new) -- matrix rows at function level: filtering, order, Berlin formats in both languages (incl. DST offset and a browser TZ-independent result), passed/today deadline boundary, freshness thresholds (59 min, 2 h, 35 h 59, 36 h, 8 d, future).
- `tests/search-page.test.tsx` -- App-level: result cards render with all parts, link `href`/`target`/`rel`/`aria-label` for `link_ok` true and false, `aria-hidden` chip/destination/glyphs, `lang="de"` eligibility in EN UI, count line + announcement + notice with and without dates, past date hidden, centre with all dates past reverts to uncovered card.
- `tests/fixtures/snapshot.ts` -- `snapshotListing(centreId, startsAt, extra)` helper; `snapshotOf(centres, listings = [])`.

**Acceptance Criteria:**
- Given a snapshot with future listings for a centre in range, when I search, then each date is one `article.card` whose h3 link text is the date and time, with chip, centre, address + Map, a `dl` with Distance / Status / Deadline / Registration in that order, the "Who may register" line, destination and freshness line.
- Given the English UI and an eligibility text, when the card renders, then the text is inside an element with `lang="de"` that is not inside the card link.
- Given a card, when its link is inspected, then its `aria-label` starts with the visible date and ends "opens <domain> in a new tab", and the chip, destination, ◷ and ↗ are `aria-hidden`.
- Given results with dates, when the search completes, then the count line and the status announcement read "N dates and M unchecked centres within R km" (singular forms for 1) and the no-dates notice is absent.
- Given the whole repo, when `npm run typecheck`, `npm test` and `npm run build` run, then all pass.

## Spec Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 25 findings — high 0, medium 2, low 12, false 11, maybe-false 0
- findings:
  - `low` `patch` Edge: a check 6.x days ago at a later clock time got a weekday-only label naming today's weekday — weekday-only now requires the check's Berlin date to be after the Berlin date of `now - 7 d`; two boundary tests added.
  - `false` `reject` Edge: unparseable `last_success_at` → NaN → RangeError — the snapshot schema validates `last_success_at` as a UTC datetime before the page ever sees it.
  - `false` `reject` Edge: a centre in both `items` and `unlocated` loses its distance — `items` needs coordinates and `unlocated` needs null coordinates, so the sets are disjoint.
  - `medium` `defer` Blind: covered centres with no upcoming date counted and shown as "unchecked" — pre-existing behaviour (all centres were uncovered cards before), owned by Story 2.8; deferred.
  - `low` `patch` Blind: dead link with no test page still says "Opens the centre's test page" — that wording now shows only when the card opens `test_page_url`; else "<domain> ↗"; tests for the website and source_url fallbacks added.
  - `false` `reject` Blind: freshness NaN crash — same as the Edge row.
  - `false` `reject` Blind: `clock` missing from `show` deps — services are fixed for the page's lifetime, the same documented pattern as the existing load effect; no caller changes them.
  - `false` `reject` Blind: `outcome` and `shown` can drift apart — both are set in the same `show()` call every time; no path sets one without the other.
  - `low` `patch` Blind: singular-count test exercised no singular form, `count_one` and DE singulars untested — test now covers all four forms plus a German singular.
  - `low` `patch` Blind: `.card__date` duplicates `.card__name` — rules merged.
  - `low` `patch` Blind: no page-level result card with distance unknown — added (covered centre without coordinates in Nürnberg).
  - `low` `patch` Blind: format tests miss the 7-day boundary — added with the Edge fix; deadline equal to today was already tested (`2026-10-30` case).
  - `false` `reject` Blind: link name omits the deadline — the link name is exactly what the AC and UX-DR23 define.
  - `false` `reject` Blind: fixture id `near@2026-12-09T10:00#2` breaks the id rule — `LISTING_ID_PATTERN` allows `#2` and `checkListing` compares only the minute part, which matches.
  - `low` `patch` VG: dead-link fallback to website / source_url untested — page tests added (with the Blind destination fix).
  - `low` `patch` VG: "under 1 h" freshness never rendered — EN and DE render tests added.
  - `low` `patch` VG: `booked_out` and email/post registration never rendered — test added for chip, aria-label, Status cell and both words.
  - `low` `patch` VG (other): destination wording wrong when the fallback lands on website or source_url — same fix as the Blind row.
  - `medium` `defer` Intent: "M unchecked centres" counts checked centres without dates — same root cause as the deferred Blind row.
  - `false` `reject` Intent: registration note absent — the listing contract has no note field and the AC marks it optional (Design Notes).
  - `false` `reject` Intent: eligibility `lang="de"` also in the German UI — the attribute is correct in both languages; no harm.
  - `low` `reject` Intent: tap-anywhere, selectability over the link layer and grey colour untested in a real browser — layout is CSS (same stretched-link pattern as the shipped uncovered card); happy-dom can't lay it out, and a browser harness is new infrastructure.
  - `low` `reject` Intent: FR35 not tested at page level across two searched places — the card code never reads the searched place; the function-level test covers ordering, and a second page test adds little.
  - `false` `reject` Intent: past dates not re-evaluated while results stay open — the UX rule is "results never re-sort or refresh while the page is open".
  - `false` `reject` Intent: null `last_success_at` omits the line instead of "unknown" — unreachable for a centre with listings: listings only come from an `ok` run, which sets `last_success_at`.

## Design Notes

- **Registration note:** the listing contract (2.1, data minimisation) has no note field, so no card has a registration note; the eligibility line is the only free-text line. Nothing to render until a field exists.
- **Room (`place`):** not in the 2.7 card list; not shown. The address line uses the listing `address`, which already falls back to the centre address.
- **Undated centres** keep today's uncovered card and count as "unchecked" until 2.8 splits off no-dates cards; this keeps the count consistent with the cards on screen.
- Splitting a message on a placeholder to insert an `aria-hidden` glyph:
  ```tsx
  const [before, after] = t('freshness.exact', { mark: '\u0000', time }).split('\u0000');
  <>{before}<span aria-hidden="true">◷</span>{after}</>
  ```

## Verification

**Commands:**
- `npm run typecheck` -- expected: no errors
- `npm test` -- expected: all tests pass
- `npm run build` -- expected: succeeds

**Manual checks (if no CLI):**
- Dev server with a local snapshot containing listings: cards render in both languages, light/dark, at 375 px width.

## Auto Run Result

Status: done

**Summary:** The search page now shows one result card per upcoming test date of the centres in range. Each card has the date and time as its stretched link (new tab, `noopener noreferrer`), a status chip, the centre name, the address with "Map ↗", the key facts (Distance / Status / Deadline / Registration) as a `dl`, a "Who may register" line (provider text in `lang="de"`, above the link layer), the destination and the freshness line (`<time datetime>`; relative under 36 h, "◷ Checked Tue 14:00" after). Dates before `now` are hidden. Cards are ordered by start, then distance, then id, followed by the centres without a date as today's uncovered cards. The count line and its announcement use the real counts with singular forms; the "No dates found nearby" notice shows only with 0 dates. All dates use the Europe/Berlin local time, whatever the browser's zone.

**Files changed:**
- `web/src/search/results.ts` -- new: `datedResults` (which dates show, order, undated centres).
- `web/src/search/format.ts` -- new: card date, deadline (Berlin today), freshness formats.
- `web/src/search/result-card.tsx` -- new: `ResultCard`.
- `web/src/search/search-page.tsx` -- clock service, result cards, count line, notice rule.
- `web/src/search/uncovered-card.tsx` -- `item` prop type widened.
- `web/src/i18n/{en,de}.json` -- new card, status, count and freshness keys; `freshness.exact` takes `{mark}`.
- `web/src/styles/base.css` -- free/booked chips, result-card parts.
- Tests: new `tests/results.test.ts`, `tests/format.test.ts`; `tests/search-page.test.tsx` result-card block; `tests/fixtures/snapshot.ts` listing helper.

**Review findings:** 25 findings (high 0, medium 2, low 12, false 11). Patched 10 low rows: the weekday-only freshness boundary, the dead-link destination wording, the shared CSS rule, and tests for the link fallbacks, "under 1 h", booked_out/email/post, all count forms and an unlocated result card. Deferred 1 entry (2 rows, medium): checked centres without dates still show as uncovered and count as "unchecked" until Story 2.8. Rejected: 11 false rows and 2 low rows, each with its reason in the Review Triage Log.

**Follow-up review recommended:** false. Patched entries: 0 high, 0 medium, 10 low.

**Verification:**
- `npm run typecheck` -- clean.
- `npm test` -- 32 files, 1113 passed, 1 skipped (skipped before this change).
- `npm run build` -- succeeds.
- Matrix audit: every I/O row has a passing test (`results.test.ts` for filtering/order/unlocated, `format.test.ts` for formats and freshness, `search-page.test.tsx` for the rendered rows).

**Residual risks:**
- Not checked by eye in a real browser (both languages, dark mode, 375 px); tap-anywhere and text selection over the link layer rely on CSS.
- The German wording of the new keys has not had a language review.
- Checked centres without dates read "Not checked automatically" until Story 2.8.
