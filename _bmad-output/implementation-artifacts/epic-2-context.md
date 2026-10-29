# Epic 2 Context: See current test dates from KuferWeb and ITEM KG centres

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

About 55 Bavarian test centres on the two shared booking systems (KuferWeb ~30, ITEM KG ~25) switch from "not checked" to real test dates. Each date shows its status, deadline, registration method, who may register, and a deep link. A scheduled pipeline reads the provider sites politely once a day, keeps history across runs, and publishes a static snapshot. The UI shows result cards, no-dates cards and "not checked right now" cards, and is honest about freshness and failures, so a gap in data never reads as "nothing available".

## Stories

- Story 2.1: Shared listing shape and reader contract
- Story 2.2: Polite collection rules
- Story 2.3: KuferWeb reader
- Story 2.4: ITEM KG reader
- Story 2.5: Normalise and merge with history
- Story 2.6: Scheduled collection run
- Story 2.7: Result cards with test dates
- Story 2.8: No-dates and not-checked-right-now cards
- Story 2.9: Sort by soonest or nearest

## Requirements & Constraints

- **Listing fields:** `centre_id`, `starts_at`, `place` (room), `address` (falls back to the centre address), `status` (`free`/`booked_out`/`waitlist`/`unknown`), `deadline` (local date), `registration_method` (`online`/`email`/`post`/`in_person`), `source_url`, `link_ok`, `eligibility`, `first_seen_at`. Every absent optional field is `null` and shows as "unknown", never guessed. A deadline before today shows "Passed" and the card stays. Past dates are never listed: publish drops them, and the browser hides them again.
- **Eligibility (who may register):** the reader copies the paragraph that states the rule verbatim in German, length-capped. It takes it from the date page, else from the centre's test page. Match by keywords such as "Wohnsitz", "wohnhaft", "Hauptwohnsitz", "nur für", "Teilnehmende". The known example is MVHS (München): Munich residents only. No rule found → `null` → "Who may register: not stated, check the provider page", never "open to all". The rule is display text only: it is never matched against the searched place, and it never hides, reorders or flags a card. Scope covers residence area, own-course participants and age. Documents, fees and payment rules are out of scope, and centres without a reader get no eligibility. Each reader's fixtures include at least one page with a rule and one without. Coverage is an assumption: only the MVHS rule is confirmed so far.
- **Status mapping:** a waitlist offer ("Warteliste") on any system → `waitlist`. KuferWeb: "AUSGEBUCHT" or a full traffic light → `booked_out`, a free light → `free`, no indicator → `unknown`. ITEM KG: `bookable` true → `free`, false → `booked_out`, absent or in-person-only → `unknown`. Precedence: waitlist > booked_out > free > unknown.
- **Collection:** runs once a day (05:17 UTC). Every covered centre's last successful check must be under 36 h old (one daily run plus slack for a late or failed run), and a new published date must appear within 36 h.
- **About copy:** the "How it works" text says, in both languages, that the centres' websites are read once a day.
- **Politeness:** the bot sends an identified user agent and respects robots.txt. Each site gets at most 4 visits per rolling 24 h, manual and local reruns included. Requests to a host are serial, with a delay and a timeout. Opted-out centres and centres with reader `none` get no request at all.
- **Data minimisation:** store only date, time, place, status, deadline, registration method, eligibility text and link. No personal data such as instructor names; no schema has a field for it.
- **Honesty:**
  - A failed run keeps the centre's previous dates, shown as stale.
  - "No dates listed" appears only when the last check was `ok`.
  - A covered centre whose check failed or never ran, and that has no dates left, shows "Not checked right now. See the centre's page."
- **Freshness:** freshness is per centre, never per date, and always shows `last_success_at`.
- **Count line:** reads "N dates and M unchecked centres within R km".
- **Notices:** when only no-dates or uncovered cards are in range: "No dates found nearby. These centres may still have dates on their own pages." When every date is booked out: "All checked dates are booked out. Other centres may still have seats."
- **Search only:** no booking, no provider accounts, no form submission on provider sites. Running cost stays at €0.

## Technical Decisions

- **Pipeline:** fetch → parse → normalise → merge → publish (`npm run pipeline`). Allowed imports: readers → shared only; stages → readers, fetch, shared; web never imports pipeline or tools.
- **Reader contract:**
  - A reader lives in `pipeline/readers/<system>/` with `index.ts`, `fixtures/` and `*.test.ts`.
  - It exports `plan(centre)`, which gives list-page URLs, detail-page selection and a per-centre page cap.
  - It also exports a pure `parse(pages, centre, ctx)`, which returns `{kind:'ok', listings}` or `{kind:'failed', reason}`. `ctx.runAt` is its only clock.
  - Readers parse with cheerio `load()` only and do no I/O. Failures are values and are never thrown.
  - Output that fails `RawListing` (zod, in `shared/`) marks only that centre `failed('schema')`.
- **Zero dates needs proof:** each reader defines an expected-structure check. A "structure missing" fixture must return `failed`, never `ok` with zero listings. A non-2xx or timed-out list page fails the centre without calling `parse`.
- **Single HTTP path:** all requests go through `pipeline/fetch`.
  - User agent: `bgtsearch-bot/<version> (+<About URL>)`.
  - robots.txt is checked once per host per run, and charset is decoded.
  - The per-host visit log in `data/state/` is read by fetch, which returns this run's visits; merge persists them and drops entries older than 24 h.
  - `link_ok` comes only from detail-page fetches; there are no separate link checks.
- **Run outcomes:** each centre ends a run as `ok`, `failed` or `skipped`. `skipped` covers opt-out, reader `none`, robots and an exhausted budget.
  - `ok`: sets `last_checked_at`, `last_success_at` and `last_result=ok`, and replaces the listings.
  - `failed`: sets `last_checked_at` and `last_result=failed`, and keeps the listings.
  - `skipped`: sets nothing.
- **Merge history:**
  - Only merge writes `data/state/`, with atomic writes and its own schema with a `stateVersion`.
  - A listing missing from an `ok` run gets `removed_at`, but stays in state until `starts_at` passes. If it reappears, it keeps its original `first_seen_at`.
  - `first_seen_at` is set once and never changed.
  - The first `ok` run's listings are marked `baseline`.
- **Listing id:** normalise builds `<centre_id>@<YYYY-MM-DDTHH:mm local>`. Same-minute sessions get `#2`, `#3`, ordered by `place`. The id never uses the provider URL.
- **Time:** `starts_at` is ISO 8601 with the Europe/Berlin offset, `deadline` is a local date or `null`, and run timestamps are UTC `Z`. The 36 h freshness and 24 h "New" thresholds are constants in `shared/` (`FRESHNESS_HOURS = 36`), and freshness is computed in the browser.
- **Snapshot:**
  - `snapshot.json` holds `{schemaVersion, generated_at, systems[], centres[], listings[]}`.
  - Centres carry `coverage` (`covered`/`not_checked`), `last_result`, `last_checked_at` and `last_success_at`.
  - `systems[]` has `reader`, `centres_covered`, `centres_ok`, `centres_failed` and `last_success_at`.
  - `schemaVersion` bumps to 2, with `web/` updated in the same commit; the app reloads once on a mismatch.
  - Publish refuses invalid output, so the last good site stays deployed.
  - Removed listings, past listings and the listings of `not_checked` centres are excluded.
- **Card type (coverage first):**
  - `not_checked` → uncovered card.
  - `covered` with listings → result cards.
  - `covered` with no listings and `ok` → no-dates card.
  - `covered` with no listings and `failed` or never run → uncovered card, "Not checked right now".
- **Directory:** `data/directory/centres.json` is human-owned and the pipeline never writes it. The reader stories verify each centre's `test_page_url`, add a typed `reader_config`, and record which centres are confirmed on each system.
- **Codes and words:** data carries codes only. All words come from `web/src/i18n/{de,en}.json`, and CI fails on missing or extra keys. Provider free text (place, room, eligibility) is shown as published and marked `lang="de"` in the English UI.
- **Git as the database:**
  - Each run makes one commit for `data/state/` and `data/public/`, then deploys from the pushed SHA. A failed push means no deploy.
  - `pipeline.yml` runs on a daily schedule at 05:17 UTC (one cron entry, `17 5 * * *`), on push to main and on dispatch. It uses one concurrency group with no cancel-in-progress.
  - On a rejected push: if only the bot's own folders changed, rebase. Otherwise re-run merge and publish from the saved reader results, with no refetch.
  - A home-machine cron with a fine-grained token is the fallback.
- **Logging:** one line per centre per run (id, reader, outcome, count, duration), with no page content.
- **Tests:** readers run against committed HTML fixtures, at least 3 centres per system plus "structure missing". Merge tests cover tombstones, baseline, same-minute ids and failed-run retention. `npm test` gates publishing, so committed-data tests must derive their expectations from the files.

## UX & Interaction Patterns

- **Result card:** the whole card is one stretched link that opens in a new tab with `rel=noopener noreferrer`, and has no nested links. From top to bottom:
  - top row: date and time (card-date), "New" badge slot, status chip;
  - centre name;
  - address line with "Map ↗";
  - key facts as a `dl`, always in the order Distance, Status, Deadline, Registration;
  - optional registration note;
  - "Who may register" line;
  - bottom row: destination domain and freshness line.

  The address, the registration note and the eligibility line sit above the link layer: they are selectable and tapping them does nothing. If `link_ok` is false, the card opens `test_page_url` and the destination reads "Opens the centre's test page".
- **Status chip text:** "Free seats", "Booked out", "Booked out · Waitlist" (spoken "Booked out, waitlist open"), "Status unknown", "No dates listed", "Not checked". The chip is `aria-hidden` on result cards.
- **Card link name:** starts with the visible date: "<date, time>, <centre>, <status>, opens <domain> in a new tab". The glyphs ↗ ◷ · are `aria-hidden`.
- **Freshness line:** meta size in ink-secondary, using `<time datetime>`. Under 36 h it reads "Checked 2 h ago"; older, it reads "◷ Checked Tue 14:00". No banner and no colour change.
- **No-dates card:** centre name in card-date style and a "No dates listed" chip. Key facts: Deadline "unknown", Registration as known. It has a freshness line and opens the test page.
- **Uncovered "right now" card:** same layout as Epic 1's uncovered card, with the "Not checked right now" line and a "Why?" link to About `#not-checked`. It has no freshness line.
- **Sort:**
  - A radio group "Sort by" styled as two segments, Soonest (default) | Nearest.
  - Soonest: dated cards by date, then distance, followed by an h2 "No dates to show" with no-dates and uncovered cards by distance.
  - Nearest: all cards by distance, then date, with no heading.
  - On change, "Sorted by soonest/nearest" is announced through the existing `role=status` region and `sort` updates in the URL fragment.
  - Results never re-sort or refresh while the page is open.
- **UX docs gap:** DESIGN.md and EXPERIENCE.md do not yet describe the "Who may register" line. Use the story ACs and keep it consistent with the registration note's style.

## Cross-Story Dependencies

- **Build order:** 2.1 → 2.2 → 2.3 (KuferWeb first, end to end) → 2.5 → 2.6. Story 2.4 (ITEM KG) plugs into the same contract. Stories 2.7–2.9 need snapshot `schemaVersion` 2 from 2.6.
- **Epic 1 dependencies:** Epic 2 builds on Epic 1's uncovered card, search, count line, live region, About page and haversine distance.
  - Centres without coordinates must still appear as cards with Distance "unknown" (from Story 1.12) once they become covered.
  - They must also stay listed on About `#no-location` whatever their coverage.
  - About `#not-checked` must also list centres whose check failed.
- **Epic 3 dependencies:**
  - The "New" badge (24 h window) needs `first_seen_at` and `baseline` from 2.5.
  - The stale-system check uses the same 36 h freshness constant.
  - Booking-system status on About reads `systems[]` from 2.6.
  - The hide-booked-out toggle depends on the sort and notices from 2.7–2.9.
- **Place table:** the place table is still partial, because Stories 1.10 and 1.11 are deferred. Epic 2 must not assume a complete `places.json`.
