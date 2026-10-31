# Epic 3 Context: Spot new chances fast, and keep the data trustworthy

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users see which test dates are new since yesterday, can hide booked-out dates, and scan compact date-tile cards whose status, registration method and missing eligibility appear as icons. The operator sees each booking system's health on About the data, is alerted when a run fails, stops running, or a centre's dates disappear suspiciously, and gets a monthly report of directory changes, so stale data gets fixed instead of going unnoticed. Since the Epic 2 retrospective (2026-10-31), the epic also fixes the data problems that retrospective found: same-minute listing ids that swap history, "Status unknown" on pages that also accept email registration, MVHS dates without a published time, collection on every push that uses up sites' visit budgets, five ITEM KG centres that never get checked, and 8 centres without coordinates.

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

- **New:** a date is new when `now − first_seen_at < 24 h` and it is not `baseline`. `first_seen_at` is set once and survives disappear/reappear. Dates found in a centre's first successful check are never new.
- **Hide booked-out:** hides only `booked_out`. Never hides waitlist, unknown, no-dates or uncovered cards. The count line ("N dates and M unchecked centres within R km") still counts hidden dates. An "everything hidden" notice offers "Show them". Nothing is ever dropped silently.
- **Honesty:** a gap in data must never read as "nothing available". Missing fields read "unknown" and are never guessed. A reader never invents a time. "Who may register" is never shown as "open to all".
- **Freshness:** covered centres' data must be no more than 36 h old. A system reads "Not updated since <time>" when its `last_success_at` is more than 36 h old. Staleness is shown in text, never by colour alone and never in a banner.
- **Politeness:** collection runs once a day plus manual dispatch. At most 4 visits per site per rolling 24 h, including reruns. Pushes must not trigger collection. Visits must be recorded even when a later step of the run fails.
- **Reliability:** a failed run never breaks the live site. Failures must reach the operator (GitHub issue → email, plus an external dead-man check that alerts after 13 h without a ping).
- **Directory:** the directory must stay complete. The monthly diff reports added, removed and changed centres and never edits `centres.json`.
- **Cost and privacy:** €0 running cost and no paid APIs. No analytics, cookies or third-party requests at page load.
- **Accessibility:** WCAG AA. Full keyboard access. Targets of 44 px, except card icons, which are 36 px targets with 28 px visuals, spaced per WCAG 2.5.8. Pages reflow at 320 px and 200 % zoom with the longest German strings.
- **Translations:** all UI text lives in DE and EN translation files with the same meaning in both, and no exclamation marks.

## Technical Decisions

- **Paradigm:** a batch pipeline (fetch → parse → normalise → locate → merge → publish) commits to `main` and deploys a static snapshot. The Preact app computes freshness and "New" in the browser from raw timestamps and shared constants (36 h, 24 h in `shared/`).
- **Imports:** only `web → shared`, `stages → readers/fetch/shared`, `readers → shared`, `tools → fetch/shared`. Readers stay pure, with no I/O and `ctx.runAt` as their only clock.
- **Outcomes (AD-6):** each centre's run outcome is `ok`, `failed` or `skipped`, and only merge writes `data/state/`.
  - `ok` replaces the centre's listings. `failed` keeps them.
  - A listing missing from an `ok` result gets a `removed_at` tombstone until its `starts_at` passes.
  - Story 3.12 amends this: a skip records `last_skip_reason` (`robots`, `budget`, `opted-out`, `no-reader`) and `last_skip_at`, without touching listings or `last_result`, and bumps `stateVersion`.
- **Listing id (AD-7):** built only in normalise as `<centre_id>@<YYYY-MM-DDTHH:mm>`, with `#n` for same-minute sessions.
  - Story 3.8: surviving dates are matched to stored ones (live before tombstoned) by `source_url` and place, then by a `source_url` no other session shares, then by non-null place, before any numbering. A new date takes the lowest free `#n`, counting live and tombstoned ids.
  - Story 3.10: an untimed date's id is `<centre_id>@<YYYY-MM-DD>`, with `starts_at` at 00:00 Europe/Berlin and `time_known: false`. It stays current until the end of its day.
- **Snapshot contract (AD-9):** `{schemaVersion, generated_at, systems[], centres[], listings[]}`. Each system carries `reader`, `centres_covered`, `centres_ok`, `centres_failed` and `last_success_at`.
  - A breaking change bumps `schemaVersion` and updates `web/` in the same commit. Story 3.10 takes it to 4.
  - Publish refuses invalid output. The app reloads once on a version mismatch.
- **Codes and words (AD-10):** `status`, `registration_method`, `coverage` and `last_result` are lowercase codes in data, and all words live in `web/src/i18n/{de,en}.json`. CI fails on missing or extra keys. Provider text is shown verbatim and marked `lang="de"`.
- **Status mapping:** the shared `mapStatus` applies the precedence waitlist > booked_out > free > unknown.
  - Story 3.9 moves the registration-method, "in person only" and "preparation course" rules into single shared helpers that both readers use.
  - A page gives `unknown` only when it says registration is in person only.
- **Zero dates needs proof (AD-4):** `ok` with zero listings requires the expected page structure. Story 3.4 adds an alert when a centre that had dates returns `ok` with zero and the structure is intact.
- **Workflows:**
  - `pipeline.yml` runs one concurrency group with no cancel-in-progress and makes one commit per run (`data/state` + `data/public`). It deploys only from the pushed SHA.
  - Story 3.11 limits collection to the schedule (05:17 UTC) and dispatch, checking out the tip of `main`. A push only builds and deploys.
  - `directory-monthly.yml` runs `tools/directory-diff` through `pipeline/fetch` on the 1st of each month.
  - The dead-man ping URL is a repository secret. Story 3.4 chooses and records the provider.
- **Nominatim:** called only from `tools/geocode` (centres, manual) and `pipeline/stages/locate` (capped, cached).
- **Testing:**
  - Readers are tested against committed HTML fixtures, including a "structure missing" one.
  - Merge and normalise tests cover tombstones, baseline and same-minute ids.
  - Committed-data tests derive their expectations from the data and never pin counts. Story 3.13 replaces `toHaveLength(119)` with checks derived from the data and adds a named allowlist of hand-set coordinates. It also records this convention in AGENTS.md.

## UX & Interaction Patterns

- **Card layout (variant B, "date tile"):**
  - Left: date tile (month, day in `tile-day`, weekday).
  - Middle: the address in `card-address` with a map-pin link (own 44 px target, "Map: <address> (Google Maps, new tab)"), then a meta line "time · distance · Deadline …", the centre name and the freshness line.
  - Right: icons stacked top-right in a fixed order: status, registration, then eligibility only when it is `null`.
  - The eligibility rule takes a full-width bottom line with a house icon, `lang="de"`, selectable.
  - There is no key-facts row, status chip or destination line.
  - The whole card is one stretched link (new tab, `noopener noreferrer`), and there are never nested links.
- **No-dates and uncovered cards:** use the same layout. The tile shows a calendar icon for no-dates and a question mark on the unknown tint for uncovered. These cards have no icons. Uncovered cards keep "Why?" and have no freshness line.
- **Icons are toggletips:** each has a distinct shape per value and is a `<button>` with `aria-label` and `aria-expanded`. The label shows on hover, focus or tap, and only one is open at a time. Escape or tapping elsewhere closes it. Tapping an icon never opens the card. The opened label is announced politely.
- **"New" badge:** ink-primary on a surface-muted pill (not blue), placed after the address or pin. The link name includes "new" after the date.
- **Link name:** "<date, time>, [new,] <address>, <centre>, <status>, <registration>, opens <domain> in a new tab". The tile text and the glyphs (↗ ◷ ·) are `aria-hidden`.
- **Hide booked-out toggle:** a native checkbox (`accent-color: action`). It shows "N booked-out dates hidden · Show", and focus stays on the checkbox. It shares a row with the Soonest | Nearest control and wraps below it when they don't fit.
- **Live region:** the single `role=status` region announces "N booked-out dates hidden/shown". The count line stays unchanged.
- **About the data, "Booking systems":** a real `<table>` with header cells, one row per system (centres covered, last successful run, "Working" / "Not updated since Tue 14:00"). It scrolls within its own container at 320 px.
- **Visual reference:** `ux-designs/ux-bgtsearch-2026-10-25/mockups/card-b-states.html`.

## Cross-Story Dependencies

- **3.6 → 3.7:** 3.7 is built together with 3.6 or right after it.
- **3.6 and 3.7 before 3.1:** the badge lives in the new card layout.
- **3.8 before 3.1:** "New" relies on stable ids and `first_seen_at`.
- **3.6 before 3.10:** 3.10's card wording ("Time not published yet") uses the date-tile layout. 3.10 also reuses 3.8's `#n` rule for untimed dates on the same day.
- **3.10 needs 3.13:** MVHS distance stays "unknown" until 3.13 gives MVHS coordinates.
- **3.11 before 3.12:** 3.12's diagnosis and verification depend on correct visit budgets and checkout.
- **3.4 uses Epic 2 data:** its alert criteria (system with `centres_ok = 0` for more than 24 h, all fetched centres failed, dates disappeared) read `systems[]` and the per-centre outcomes from the Epic 2 pipeline.
- **3.3 builds on Epic 2:** it reads the `systems[]` that Epic 2 publish already emits.
- **3.5 and Epic 4:** the source list is rtpartner.de until Epic 4 switches the directory to the BAMF list. The diff must follow the directory's `source`.
- **3.6 and Epic 2 tests:** 3.6 replaces Epic 2 card translation keys and updates the Story 2.7 and 2.8 tests.
