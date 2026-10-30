# Epic 2 Context: See current test dates from KuferWeb and ITEM KG centres

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

About 55 Bavarian test centres on the KuferWeb and ITEM KG booking systems switch from "not checked" to real test dates, each with status, deadline, registration method, who may register and a deep link to its page. A polite pipeline collects them once a day, keeps their history and publishes a static snapshot. The site stays honest about freshness and failures, so a gap never reads as "nothing available". Each date is placed at its own test address, which can be in a different town from the centre. Search radius and distance use that address, so a user finds dates held in their town by a centre based elsewhere, and dates held far away don't look close.

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
- Story 2.10: Locate each test date
- Story 2.11: Search by test location

## Requirements & Constraints

- **Card selection by test address:**
  - Each current date whose own coordinates lie within the radius is one result card.
  - A covered centre with no current dates is selected by the centre's coordinates.
  - A covered centre whose current dates all lie outside the radius does not appear, even if its own address is inside. A centre outside the radius appears if one of its dates is inside.
  - Distance is straight-line: to the test address on result cards, to the centre on other cards. "Map ↗" opens the listing's `address`.
  - A date uses its centre's coordinates only when it has no test address or the address can't be located. A date with no coordinates at all follows the Epic 1 rule for centres without coordinates (Distance "unknown" when the centre's postcode or city matches the place), so it never disappears silently.
- **Date fields:** date/time, centre, full test address (falls back to the centre address), status, deadline, registration method, who may register and the provider link. A missing field shows "unknown", never a guess. A deadline before today shows as passed and the card stays. Past dates are never listed.
- **Status mapping:** a waitlist offer → `waitlist` on any system. KuferWeb: "AUSGEBUCHT" or a full light → `booked_out`, a free light → `free`, no indicator → `unknown`. ITEM KG: `bookable` true → `free`, false → `booked_out`, absent or in-person-only → `unknown`.
- **Who may register:** the German paragraph, verbatim and length-capped, found by keywords (Wohnsitz, wohnhaft, Hauptwohnsitz, nur für, Teilnehmende). It comes from the date page, else the centre's test page. `null` reads "not stated, check the provider page", never "open to all". It is display text only and never filters, reorders or flags a card.
- **Dead deep link:** when `link_ok` is false, the card opens the centre's `test_page_url` and says "Opens the centre's test page".
- **Freshness:** collection runs once a day, and covered data must be ≤ 36 h old. Result and no-dates cards show the centre's last successful check: "Checked 2 h ago" under 36 h, "◷ Checked Tue 14:00" when older. A failed check keeps the previous dates, which age visibly.
- **Honesty:** "No dates listed" appears only after an `ok` check. A covered centre that failed or never ran and has no dates left shows "Not checked right now. See the centre's page."
- **Politeness:** identified bot user agent, robots.txt respected, at most 4 visits per site per rolling 24 h (manual and local reruns included), serial requests per host with delay and timeout. No request goes to opted-out or reader-`none` centres.
- **Data minimisation:** store only date, time, place, address, status, deadline, registration method, eligibility and link. No schema field can hold personal data such as instructor names.
- **Cost and reliability:** €0 running cost. A failed run never breaks the live site. Geocoding happens in the pipeline and never involves anything about users; the user's place and coordinates stay in the browser and never go into a URL, request or storage.
- **Count line:** "N dates and M unchecked centres within R km". It counts the cards actually selected; the no-centres state and the date notices count the same way.

## Technical Decisions

- **Pipeline:** fetch → parse → normalise → locate → merge → publish. Readers never import fetch or stages; web never imports pipeline or tools.
- **Reader contract:** `plan(centre)` gives list URLs, detail-page selection and a per-centre page cap. A pure `parse(pages, centre, ctx)` returns `{kind:'ok',listings}` or `{kind:'failed',reason}`. `ctx.runAt` is the only clock; parsing uses cheerio `load()` only. The `RawListing` zod schema lives in `shared/` and uses `null` for absent fields; a validation failure fails only that centre (`failed('schema')`). Status goes through the shared `mapStatus` (waitlist > booked_out > free > unknown).
- **Zero dates need proof:** `ok` with zero listings only when the reader found its expected structure; each reader has a "structure missing" fixture that returns `failed`. A non-2xx or timed-out list page fails the centre without calling `parse`.
- **Fetch** (`pipeline/fetch`) is the only HTTP client. It reads robots.txt once per host per run, decodes charsets, reads the visit log but never writes it, and returns this run's visits. Detail-page fetches set `link_ok`.
- **Nominatim:** only `tools/geocode` (centres, manual) and `pipeline/stages/locate` may call it, both through the shared lookup and acceptance rules in `pipeline/fetch/nominatim.ts` (structured `/search`; street-level hit, inside Bavaria, matching postcode).
- **Locate**, per listing: an address equal to the centre's after the shared address normaliser takes the centre's coordinates with `location: venue` and no request. Otherwise the `data/state/venues.json` cache is used. Otherwise a "street, NNNNN city" address is looked up: serial, ≥ 1 s apart, at most `LOCATE_MAX_LOOKUPS_PER_RUN` (default 50, `pipeline/config.ts`). An accepted hit gives `location: venue`. Anything else (centre-fallback address, unparseable, rejected, failed, over the cap) takes the centre's `lat`/`lon` (possibly null) with `location: centre`, logs the reason once, and never fails the run or a centre. Failed requests cache nothing; a cached miss is retried after 30 days. Locate never writes state.
- **Merge is the only state writer:** `ok` sets `last_checked_at`, `last_success_at`, `last_result=ok` and replaces listings; `failed` sets `last_checked_at` and `last_result=failed` and keeps listings; `skipped` sets nothing. Missing listings are tombstoned with `removed_at` until `starts_at` passes. `first_seen_at` is immutable; a centre's first `ok` run marks listings `baseline`. Merge also writes the visit log (24 h) and `venues.json` (keyed by normalised address, hit or miss with `fetched_at`). Writes are atomic and schema-validated with a `stateVersion`.
- **Listing id:** `<centre_id>@<YYYY-MM-DDTHH:mm>` (Berlin local), `#2`, `#3` for same-minute sessions by place; built only in normalise.
- **Snapshot** `{schemaVersion, generated_at, systems[], centres[], listings[]}`, a zod contract; publish refuses invalid output. Centres carry `coverage`, `last_result`, `last_checked_at`, `last_success_at`; systems carry `centres_covered`, `centres_ok`, `centres_failed`, `last_success_at`; listings carry `lat`, `lon` (nullable) and `location` (`venue` | `centre`), with freshness per centre. `schemaVersion` is 3 from Story 2.10; a breaking change updates `web/` in the same commit, and the app reloads once on a mismatch. Publish drops `starts_at ≤ runAt`, tombstoned and `not_checked` listings.
- **Card type, coverage first:** `not_checked` → uncovered; covered with in-range listings → one result card each; covered, no listings, `ok` → no-dates; covered, no listings, failed or never run → uncovered "right now".
- **Distance and search** run in the browser (haversine); search state lives only in the URL fragment.
- **Time:** `starts_at` ISO with Berlin offset, `deadline` local date or null, run timestamps UTC. The 36 h and 24 h thresholds are constants in `shared/`. The browser also hides `starts_at ≤ now`.
- **Codes and words:** data holds lowercase codes; all UI words come from `web/src/i18n/{de,en}.json`, and CI fails on missing or extra keys. Provider text is shown as published, marked `lang="de"` in the English UI.
- **Operations:** `pipeline.yml` runs daily at 05:17 UTC, on push to main and on dispatch, in one concurrency group without cancel-in-progress. One commit of `data/state/` + `data/public/` per run, deployed from the pushed SHA, never if the push failed. On a rejected push, rebase if only bot folders conflict; otherwise re-run merge and publish from saved reader results without refetching. Log one line per centre (id, reader, outcome, count, duration), no page content. Fallback: home cron with a fine-grained token.

## UX & Interaction Patterns

- **Cards:** the whole card is one stretched link (new tab, `rel=noopener noreferrer`), with no nested links. The address line ("Map ↗", own 44 px target) and the "Who may register" line sit above the link layer. The card link name starts with the visible date. Uncovered cards keep a "Why?" link to About `#not-checked` and have no freshness line.
- **Layout is being replaced:** Epic 3 Stories 3.6–3.7 swap the Epic 2 card layout (key-facts row, status chip, destination line) for compact date-tile cards with icons. Don't invest in the old layout beyond what a story requires.
- **Sort:** radio group "Sort by", segments Soonest | Nearest. Soonest: dated cards by date then distance, then h2 "No dates to show" with the other cards by distance. Nearest: all cards by each card's distance then date, no heading. Applies on change, announces "Sorted by nearest", updates `sort` in the fragment; results never re-sort while the page is open.
- **Notices** (plain body text, no background): "No dates found nearby. These centres may still have dates on their own pages." and "All checked dates are booked out. Other centres may still have seats."
- No staleness banners or colour change for old data; microcopy has no exclamation marks and means the same in DE and EN.
- About "How it works" says the sites are read once a day and that distance is measured to the address where the test takes place.

## Cross-Story Dependencies

- Stories 2.1–2.9 are implemented. Story 2.10 must land before 2.11; until 2.11, `web/` accepts schema v3 but may still measure from the centre.
- Story 2.10 moves the Nominatim lookup out of `tools/geocode.ts` into `pipeline/fetch/nominatim.ts`; `tools/geocode` behaviour and tests must not change.
- Story 2.11 changes Story 2.7's distance source and the selection logic from Epic 1 Story 1.12; 2.9's sort already uses each card's distance.
- Epic 3 builds on this epic: the "New" badge uses `first_seen_at` and `baseline`, hide-booked-out uses status, system status uses `systems[]`, and 3.6–3.7 rework the 2.7/2.8 cards and their tests.
