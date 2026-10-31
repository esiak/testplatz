# Epic 3 Context: Spot new chances fast, and keep the data trustworthy

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make the daily-refreshed date list quicker to act on and safer to trust. Users see which dates appeared since yesterday ("New"), can hide booked-out dates, and get compact date-tile cards with icon-based status, registration and eligibility. The operator sees each booking system's health on About the data, is alerted when a run fails or stops, and gets a monthly directory diff. The epic also closes the Epic 2 retrospective's data-quality gaps: stable same-minute ids, honest status for mixed-registration pages, MVHS dates without a published time, collection only once a day, every covered centre actually checked, and coordinates for every centre. This way, stale or broken data gets fixed instead of going unnoticed.

## Stories

- Story 3.1: "New" badge on fresh dates
- Story 3.2: Hide booked-out dates
- Story 3.3: Booking-system status on About the data
- Story 3.4: Alert the operator when collection breaks
- Story 3.5: Monthly directory check
- Story 3.6: Compact date-tile result cards
- Story 3.7: Status, registration and eligibility icons
- Story 3.8: Same-minute dates keep their history
- Story 3.9: Status shown unless registration is in person only
- Story 3.10: Dates whose start time is not published yet
- Story 3.11: Collect only once a day
- Story 3.12: Every covered centre gets checked
- Story 3.13: Coordinates for every centre, and data tests that follow the data

## Requirements & Constraints

- **New badge:** shows when `now − first_seen_at < 24 h` and the listing is not `baseline`. `first_seen_at` is set once and survives a disappear/reappear. Dates found in a centre's first successful check are never new.
- **Hide booked-out:** hides only `booked_out`. Waitlist, unknown, no-dates and uncovered cards always stay. It is ticked by default (operator decision). The count line still counts hidden dates. A "N booked-out dates hidden · Show" line appears, and an "everything hidden" notice offers "Show them".
- **Booking-system status:** one row per system with centres covered, last successful run, and "Working" or "Not updated since Tue 14:00" (36 h rule). The status is text, never colour alone.
- **Alerting:** any failed `pipeline.yml` run (fetch, publish validation, push, deploy) opens or comments on a GitHub issue. A run where every fetched centre failed counts as failed. A system with `centres_ok = 0` for more than 24 h gets an issue, which closes automatically after its next success. A centre that drops from listings to `ok` with zero listings is flagged "dates disappeared, check the page". Each successful run pings a free dead-man check (alerts after 13 h of silence), with the URL stored as a repo secret.
- **Directory diff:** runs monthly (and on manual dispatch). It reports added, removed and changed centres as an issue and never edits `centres.json`. When there are no differences, it opens no issue.
- **Honesty:** a gap in data must never read as "nothing available". Missing fields read "unknown", and nothing implies eligibility is "open to all".
- **Politeness:** at most 4 visits per site per rolling 24 h, including reruns. Pushes to `main` must not collect: they only build and deploy committed data. Only the schedule (05:17 UTC) and dispatch collect.
- **Freshness:** covered centres' data must be at most 36 h old. Every covered centre must end each run `ok`, `failed`, or `not_checked` with a recorded reason.
- Cost €0, no backend, no third-party requests at page load. WCAG AA, 320 px / 200 % reflow, and DE/EN parity for every string.

## Technical Decisions

- **Layering:** imports flow one way only: `web` and `pipeline/stages` depend on `shared`, readers never import fetch or stages, and `web` never imports pipeline or tools. All HTTP goes through `pipeline/fetch`, including `tools/directory-diff`.
- **Merge is the only state writer.** An `ok` outcome replaces listings and tombstones missing ones with `removed_at`, kept until `starts_at` passes. A `failed` outcome keeps the previous listings. Story 3.12 amends `skipped`: it now records `last_skip_reason` (`robots`, `budget`, `opted-out`, `no-reader`) and `last_skip_at`, without touching listings or `last_result`, and bumps `stateVersion`. A robots-skipped centre publishes as `not_checked`.
- **Listing id:** `<centre_id>@<YYYY-MM-DDTHH:mm>`, built only in normalise. A same-minute session keeps its stored id by matching on `source_url` + `place`, then a unique `source_url`, then `place`. Unmatched sessions take the lowest free `#n`, counting tombstoned ids as taken. Untimed dates use `<centre_id>@<YYYY-MM-DD>`.
- **Untimed dates:** `RawListing.time` may be `null` only when the page gives no time; an "00:00 - 23:59" placeholder also counts as no time. Normalise sets `starts_at` to 00:00 Europe/Berlin and `time_known: false`. Such a date stays current until the end of its day. Snapshot `schemaVersion` becomes 4, and `web/` changes in the same commit.
- **Shared reader helpers:** one helper in `shared/` decides the registration method and whether registration is in person only; another detects preparation courses. Both readers use them. Status is `unknown` only when registration is in person only.
- **Snapshot contract:** `systems[]` has `reader`, `centres_covered`, `centres_ok`, `centres_failed`, `last_success_at`. Centres carry `coverage`, `last_result`, `last_checked_at`, `last_success_at`. The 24 h and 36 h thresholds are constants in `shared/`, compared in the browser against the current time.
- **Codes in data, words in `web/src/i18n/{de,en}.json`.** CI fails on missing or extra keys.
- **Git as database:** each run makes one commit to `data/state/` + `data/public/`, and deploys only the pushed SHA. The collecting job checks out the current tip of `main`. Visits from a failed collecting run must still be committed to `data/state/visits.json`.
- **Tests:** readers run against committed HTML fixtures, including a "structure missing" fixture. Merge and normalise tests cover tombstones, baseline and same-minute cases. `tests/workflows.test.ts` asserts the workflow triggers, checkout ref and visits-on-failure step. Data tests derive their expectations from the data files (no fixed counts). Hand-set coordinates are allowed only for centres on a named allowlist.

## UX & Interaction Patterns

- **Date-tile card (variant B):** a tile on the left (month, day in `tile-day`, weekday). The text column has the address in `card-address` with a map pin, a meta line "14:00 · 14 km · Deadline 13 Nov", the centre name and the freshness line. Icons are stacked on the right. An optional full-width eligibility line (house icon, `lang="de"`) sits below. Cards have no key-facts row, status chip or destination line.
- **Card link:** the whole card is one stretched link that opens in a new tab. The map pin, icons, address, eligibility line and "Why?" sit above the link layer. Links are never nested.
- **Card link name:** "<date, time>, [new,] <address>, <centre>, <status>, <registration>, opens <domain> in a new tab". The tile text and the ↗ ◷ · glyphs are `aria-hidden`.
- **Icons:** status, then registration, then eligibility (only when null). Each is a toggletip `<button>` with `aria-label` and `aria-expanded`. Each value has its own shape, and colour is never the only cue. Only one label is open at a time; Escape or tapping elsewhere closes it, and opening one never opens the card. The visual is 28 px inside a 36 px target.
- **"New" badge:** an ink-primary pill on `surface-muted`, never blue.
- **No-dates card:** shows a calendar icon in the tile. **Uncovered card:** shows a question mark on the unknown tint, keeps "Why?" (44 px), and has no freshness line.
- **Live region:** one `role="status"` region announces "N booked-out dates hidden/shown". Focus stays on the checkbox. The toggle wraps below the sort control on narrow screens.
- **About table:** a real `<table>` that scrolls inside its own container at 320 px, never the page.
- **Wording examples:** "Deadline passed", "Deadline unknown", "distance unknown", "Time not published yet" ("Uhrzeit noch nicht veröffentlicht"). No exclamation marks, and no staleness banners.
- **UX references:** `ux-designs/ux-bgtsearch-2026-10-25/mockups/card-b-states.html` and the tokens in the DESIGN.md frontmatter.

## Cross-Story Dependencies

- 3.6 and 3.7 come before 3.1, which uses the new card layout. 3.8 also comes before 3.1, because "New" needs stable `first_seen_at`.
- 3.10 comes after 3.6 (its card wording). MVHS distance stays "unknown" until 3.13 adds coordinates.
- 3.12 comes after 3.11, so visit budgets are no longer used up by push-triggered runs.
- 3.4's alert criteria rely on the merge and run outcomes from Epic 2. 3.3 reads the `systems[]` that Epic 2's publish already emits.
- 3.5 switches its source to the BAMF list once Epic 4 (Story 4.2) lands.
