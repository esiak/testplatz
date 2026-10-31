# Epic 3 Context: Spot new chances fast, and keep the data trustworthy

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Users see which test dates are new since yesterday, can hide booked-out dates, and scan compact date-tile cards that show status, registration method and missing eligibility as icons. The operator sees each booking system's health on About the data. The operator is alerted when a run fails, when runs stop, or when a centre's dates disappear suspiciously, and gets a monthly report of directory changes, so stale data gets fixed instead of going unnoticed. Since the Epic 2 retrospective (2026-10-31), the epic also fixes the data problems that retrospective found:
- same-minute listing ids that swapped history (fixed by Story 3.8, done);
- "Status unknown" on pages that also accept email registration;
- MVHS dates that have no published time yet;
- collection on every push, which used up each site's visit budget;
- five ITEM KG centres that never got checked;
- 8 centres without coordinates.

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

- **New:** a date is new when `now − first_seen_at < 24 h` and it is not `baseline`. `first_seen_at` is set once and survives a date disappearing and coming back. Dates found in a centre's first successful check are never new.
- **Hide booked-out:** hides only `booked_out` dates. It never hides waitlist, unknown, no-dates or uncovered cards. The count line ("N dates and M unchecked centres within R km") still counts hidden dates. When everything is hidden, a notice offers "Show them". Nothing is ever dropped silently.
- **Honesty:** a gap in data must never read as "nothing available". Missing fields read "unknown" and are never guessed. A reader never invents a time. "Who may register" is never shown as "open to all".
- **Freshness:** a covered centre's data is at most 36 h old. A system whose `last_success_at` is more than 36 h old reads "Not updated since <time>". Staleness is shown in text, never by colour alone and never in a banner.
- **Politeness:**
  - Collection runs once a day, plus manual dispatch.
  - Each site gets at most 4 visits in any rolling 24 h, reruns included.
  - Pushes never trigger collection.
  - A run's visits are recorded even when a later step of that run fails.
- **Reliability:** a failed run never breaks the live site. Failures reach the operator through a GitHub issue (which GitHub emails) and an external dead-man check that alerts after 13 h without a ping.
- **Directory:** the directory must stay complete. The monthly diff reports added, removed and changed centres and never edits `centres.json`.
- **Cost and privacy:** €0 running cost and no paid APIs. No analytics, cookies or third-party requests at page load.
- **Accessibility:**
  - WCAG AA with full keyboard access.
  - Targets are 44 px, except card icons: 36 px targets with 28 px visuals, spaced per WCAG 2.5.8.
  - Pages reflow at 320 px width and 200 % zoom with the longest German strings.
- **Translations:** all UI text lives in the DE and EN translation files. Both say the same thing, with no exclamation marks.

## Technical Decisions

- **Pipeline:** a batch pipeline (fetch → parse → normalise → locate → merge → publish) commits to `main` and deploys a static snapshot. The Preact app computes freshness and "New" in the browser from raw timestamps. The 36 h and 24 h thresholds are shared constants in `shared/`.
- **Import directions:** only `web → shared`, `stages → readers/fetch/shared`, `readers → shared` and `tools → fetch/shared`. Readers are pure: no I/O, and `ctx.runAt` is their only clock.
- **Run outcomes:** each centre's outcome in a run is `ok`, `failed` or `skipped`. Only merge writes `data/state/`.
  - `ok` replaces the centre's listings; `failed` keeps them.
  - A listing missing from an `ok` result gets a `removed_at` tombstone until its `starts_at` passes. If the date reappears, `removed_at` is cleared and `first_seen_at` is kept.
  - Story 3.12 changes skips. A skip records `last_skip_reason` (`robots`, `budget`, `opted-out` or `no-reader`) and `last_skip_at`, without touching listings or `last_result`. The state schema and `stateVersion` change with it.
- **Listing id:** built only in normalise as `<centre_id>@<YYYY-MM-DDTHH:mm>`, with `#n` added for same-minute sessions. Story 3.8 (done) amended the rule:
  - A session keeps the id of a stored listing from that minute when they match. Live listings are tried before tombstoned ones, and each stored listing matches only once.
  - Matches, strongest first:
    1. same `source_url` and place;
    2. same `source_url`, when exactly one session on each side has that URL;
    3. same non-null place.
  - Every other session takes the lowest `#n` that no stored listing of that minute holds (live or tombstoned), in order of place.
  - The id never uses the provider URL.
  - Story 3.10 adds untimed dates. Their id is `<centre_id>@<YYYY-MM-DD>`, with `starts_at` at 00:00 Europe/Berlin and `time_known: false`. Same-day untimed dates are numbered by the same `#n` rule, and an untimed date stays current until the end of its day.
- **Snapshot contract:** `snapshot.json` has `{schemaVersion, generated_at, systems[], centres[], listings[]}`. Each system carries `reader`, `centres_covered`, `centres_ok`, `centres_failed` and `last_success_at`.
  - A breaking change bumps `schemaVersion` and updates `web/` in the same commit. Story 3.10 bumps it to 4.
  - Publish refuses invalid output. On a version mismatch the app reloads once.
- **Codes and words:** `status`, `registration_method`, `coverage` and `last_result` are lowercase codes in the data. All words live in `web/src/i18n/{de,en}.json`, and CI fails on missing or extra keys. Provider text is shown as published and marked `lang="de"`.
- **Status:** the shared `mapStatus` applies the precedence waitlist > booked_out > free > unknown.
  - Story 3.9 moves three rules into single shared helpers that both readers use: the registration method, whether registration is in person only, and whether a course is a preparation course.
  - Only a page saying registration is in person only gives `unknown`.
- **Zero dates needs proof:** `ok` with zero listings requires the expected page structure. Story 3.4 alerts when a centre that had dates returns `ok` with zero dates while the structure is intact.
- **Workflows:**
  - `pipeline.yml` uses one concurrency group without cancel-in-progress. Each run makes one commit (`data/state` + `data/public`) and deploys only from the pushed SHA.
  - Story 3.11 limits collection to the 05:17 UTC schedule and manual dispatch. A collecting run checks out the tip of `main`; a push only builds and deploys.
  - `directory-monthly.yml` runs `tools/directory-diff` through `pipeline/fetch` on the 1st of each month.
  - The dead-man ping URL is a repository secret. Story 3.4 chooses and records the free provider.
- **Nominatim:** called only from `tools/geocode` (centres, run manually) and `pipeline/stages/locate` (capped per run and cached).
- **Testing:**
  - Readers are tested against committed HTML fixtures, including a "structure missing" one.
  - Merge and normalise tests cover tombstones, baseline and same-minute ids.
  - Tests on committed data derive their expectations from the data and never pin counts. Story 3.13 replaces `toHaveLength(119)`, adds a named allowlist of hand-set coordinates, and records this rule in AGENTS.md.

## UX & Interaction Patterns

- **Card layout (variant B, "date tile"):**
  - Left: a date tile with month, day (`tile-day`) and weekday.
  - Middle, in order:
    - the address (`card-address`), with a map-pin link that has its own 44 px target and the name "Map: <address> (Google Maps, new tab)";
    - a meta line "time · distance · Deadline …";
    - the centre name;
    - the freshness line.
  - Right: icons stacked top-right in a fixed order: status, then registration, then eligibility, which appears only when eligibility is `null`.
  - Eligibility text gets a full-width bottom line with a house icon. It is marked `lang="de"` and is selectable.
  - There is no key-facts row, status chip or destination line.
  - The whole card is one stretched link (new tab, `noopener noreferrer`). Links are never nested.
- **No-dates and uncovered cards:** use the same layout without icons. The tile shows a calendar icon for no-dates, or a question mark on the unknown tint for uncovered. Uncovered cards keep "Why?" and have no freshness line.
- **Icons are toggletips:**
  - Each value has its own shape.
  - Each icon is a `<button>` with `aria-label` and `aria-expanded`.
  - The label shows on hover, focus or tap, and only one is open at a time. Escape or tapping elsewhere closes it.
  - Tapping an icon never opens the card. An opened label is announced politely.
- **"New" badge:** an ink-primary pill on surface-muted (not blue), placed after the address and map pin. The card's link name says "new" after the date.
- **Link name:** "<date, time>, [new,] <address>, <centre>, <status>, <registration>, opens <domain> in a new tab". The tile text and the glyphs ↗ ◷ · are `aria-hidden`.
- **Hide booked-out toggle:**
  - A native checkbox (`accent-color: action`).
  - Shows "N booked-out dates hidden · Show". Focus stays on the checkbox.
  - Shares a row with the Soonest | Nearest control, and wraps below it when they don't fit.
- **Announcements:** the single `role=status` region announces "N booked-out dates hidden" or "shown".
- **About the data, "Booking systems":** a real `<table>` with header cells and one row per system: centres covered, last successful run, and "Working" or "Not updated since Tue 14:00". At 320 px the table scrolls inside its own container.
- **Visual reference:** `ux-designs/ux-bgtsearch-2026-10-25/mockups/card-b-states.html`.

## Cross-Story Dependencies

- **3.7 with 3.6:** build 3.7 together with 3.6 or right after it.
- **3.6 and 3.7 before 3.1:** the badge lives in the new card layout.
- **3.8 (done) before 3.1:** "New" relies on stable ids and `first_seen_at`.
- **3.10 after 3.6:** its card wording, "Time not published yet", uses the date-tile layout. 3.10 also reuses 3.8's `#n` rule.
- **3.10 and 3.13:** MVHS distance reads "unknown" until 3.13 gives MVHS coordinates.
- **3.12 after 3.11:** diagnosing and verifying the unchecked centres needs correct visit budgets and checkout.
- **3.3 and 3.4 build on Epic 2:** both read the `systems[]` that Epic 2's publish already emits. Story 3.4 also reads the per-centre outcomes.
- **3.5 and Epic 4:** the source list is rtpartner.de until Epic 4 switches the directory to the BAMF list, so the diff must follow the directory's `source`.
- **3.6 and Epic 2 tests:** 3.6 replaces Epic 2's card translation keys and updates the tests for Stories 2.7 and 2.8.
