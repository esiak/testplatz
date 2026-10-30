# Epic 2 Context: See current test dates from KuferWeb and ITEM KG centres

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

About 55 Bavarian test centres on the KuferWeb and ITEM KG booking systems switch from "not checked" to real test dates: status, deadline, registration method, who may register and a deep link to each date's page. A polite pipeline collects them once a day, keeps history, and publishes a static snapshot. The site stays honest about freshness and failures, so a gap never reads as "nothing available". Each date is placed at its own test address, which can differ from the centre's address. Search radius and distance use that address, so dates held in a user's town by a centre based elsewhere are found, and dates held far away don't look close.

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

- **Card selection:** each current date whose own coordinates lie within the radius is one result card. A covered centre without current dates is selected by the centre's coordinates. A covered centre whose current dates all lie outside the radius does not appear. A centre outside the radius does appear if one of its dates is inside. Distance is straight-line: to the test address on result cards, to the centre on other cards. "Map ↗" opens the listing's `address`.
- **Date fields:** date/time, centre, full test address (falls back to the centre address), status, deadline, registration method, who may register, and the provider link. A missing field shows as "unknown", never a guess. A deadline before today shows "Passed" and the card stays. Past dates are never listed.
- **Status mapping:** any system: a waitlist offer → `waitlist`. KuferWeb: "AUSGEBUCHT" or full light → `booked_out`, free light → `free`, no indicator → `unknown`. ITEM KG: `bookable` true → `free`, false → `booked_out`, absent or in-person-only → `unknown`.
- **Who may register:** verbatim German paragraph, length-capped, found by keywords (Wohnsitz, wohnhaft, Hauptwohnsitz, nur für, Teilnehmende). Taken from the date page, else the centre's test page. `null` shows "not stated, check the provider page", never "open to all". It is display text only: it never filters, reorders or flags a card.
- **Dead deep link:** when `link_ok` is false, the card opens the centre's `test_page_url` and the destination line reads "Opens the centre's test page".
- **Freshness:** collection runs once a day. Covered centres' data must be ≤ 36 h old. Each result card and no-dates card shows the centre's `last_success_at`: relative ("Checked 2 h ago") under 36 h, exact time ("◷ Checked Tue 14:00") when older. A failed check keeps the previous dates, which age visibly.
- **Honesty:** "No dates listed" is shown only when the last check was `ok`. A covered centre that failed or never ran and has no dates left shows "Not checked right now. See the centre's page."
- **Politeness:** identified bot user agent, robots.txt respected, at most 4 visits per site per rolling 24 h (manual and local reruns included), serial requests per host with a delay and a timeout. No request goes to opted-out or reader-`none` centres.
- **Data minimisation:** store only date, time, place, status, deadline, registration method, eligibility, address and link. No personal data such as instructor names. No schema field can hold it.
- **Cost and reliability:** €0. A failed run never breaks the live site. Nominatim lookups never send anything about users.
- **Count line:** "N dates and M unchecked centres within R km". It counts the cards actually selected. The no-centres state and the date notices count the same way.

## Technical Decisions

- **Pipeline stages:** fetch → parse → normalise → locate → merge → publish. Allowed imports: readers never import fetch or stages; web never imports pipeline or tools; tools may import fetch.
- **Reader contract:** a reader exports `plan(centre)`, which gives the list URLs, how to pick detail pages and a per-centre page cap. It also exports a pure `parse(pages, centre, ctx)` returning `{kind:'ok',listings}` or `{kind:'failed',reason}`. Rules:
  - `ctx.runAt` is the only clock.
  - Parse with cheerio `load()` only.
  - The `RawListing` zod schema lives in `shared/`. A validation failure marks only that centre `failed('schema')`.
  - Use the shared `mapStatus`, with precedence waitlist > booked_out > free > unknown.
- **Zero dates need proof:** `ok` with zero listings is allowed only when the reader found its expected structure. Each reader has a "structure missing" fixture that must return `failed`. A non-2xx or timed-out list page fails the centre without calling `parse`.
- **Fetch:** `pipeline/fetch` is the only HTTP client.
  - It reads robots.txt once per host per run and decodes charsets.
  - It reads the per-host visit log in `data/state/` but never writes it. It returns this run's visits.
  - Detail-page fetches set `link_ok`; there are no separate link checks.
- **Nominatim exemptions:** only `tools/geocode` (centres, manual) and `pipeline/stages/locate` may call Nominatim. Both use the shared lookup and acceptance rules in `pipeline/fetch/nominatim.ts`: street-level hit, inside Bavaria, matching postcode.
- **Locate stage:** for each listing, in order:
  1. An address equal to the centre's (after the shared address normaliser) takes the centre's coordinates, with no request.
  2. Otherwise the address is looked up in the `data/state/venues.json` cache. A miss is retried after 30 days.
  3. Otherwise a "street, NNNNN city" address is looked up on Nominatim. Lookups are serial, ≥ 1 s apart, at most `LOCATE_MAX_LOOKUPS_PER_RUN` per run (default 50, in `pipeline/config.ts`).
  4. If the lookup fails, is over the cap or the address doesn't parse, the listing gets the centre's coordinates, which may be null, with `location: centre`. The run log shows the reason. The run never fails because of this.
- **Merge is the only state writer:**
  - `ok` sets `last_checked_at`, `last_success_at` and `last_result=ok`, and replaces the centre's listings. `failed` sets `last_checked_at` and `last_result=failed` and keeps the listings. `skipped` sets nothing.
  - A listing missing from an `ok` result is tombstoned with `removed_at` until its `starts_at` passes.
  - `first_seen_at` is immutable. Listings from a centre's first `ok` run are marked `baseline`.
  - Merge also writes the visit log (entries kept 24 h) and `venues.json`.
  - Writes are atomic, and state is schema-validated with a `stateVersion`.
- **Listing id:** `<centre_id>@<YYYY-MM-DDTHH:mm>` in Berlin local time. Same-minute sessions get `#2`, `#3` in order of place. Only normalise builds the id, and it never uses the provider URL.
- **Snapshot:** `{schemaVersion, generated_at, systems[], centres[], listings[]}`, a zod contract; publish refuses invalid output.
  - Centres carry `coverage` (`covered` or `not_checked`), `last_result`, `last_checked_at` and `last_success_at`.
  - Systems carry `centres_covered`, `centres_ok`, `centres_failed` and `last_success_at`.
  - Listings carry `lat`, `lon` (nullable) and `location` (`venue` | `centre`). Freshness is per centre, not per listing.
  - `schemaVersion` is 3 (after 2.10). A breaking change updates `web/` in the same commit. The app reloads once on a version mismatch.
  - Publish drops listings with `starts_at ≤ runAt`, tombstoned listings and listings of `not_checked` centres.
- **Card type, coverage first:**
  - `not_checked` → uncovered card.
  - `covered` with current listings → one result card per in-range listing.
  - `covered`, no listings, last result `ok` → no-dates card.
  - `covered`, no listings, failed or never run → uncovered card with the "right now" text.
- **Time:** `starts_at` is ISO with its Berlin offset. `deadline` is a local date or null. Run timestamps are UTC (`Z`). The 36 h and 24 h thresholds are constants in `shared/`. The browser computes freshness and hides `starts_at ≤ now` again.
- **Missing coordinates:** a listing with null `lat`/`lon` follows the rule for centres without coordinates. It shows with Distance "unknown" when its centre's postcode or city matches the place, so it never disappears silently.
- **Codes and words:** data holds lowercase codes only (status, registration_method, reader, coverage, last_result). All UI words come from `web/src/i18n/{de,en}.json`; CI fails on missing or extra keys. Provider text is shown as published, marked `lang="de"` in the English UI.
- **Operations:**
  - `pipeline.yml` runs daily at 05:17 UTC, on push to main and on dispatch. It uses one concurrency group, without cancel-in-progress.
  - Each run makes one commit of `data/state/` and `data/public/`, then deploys from the pushed SHA, and never if the push failed.
  - If the push is rejected, the bot rebases when only its own folders conflict. Otherwise it re-runs merge and publish from this run's saved reader results, without refetching.
  - The run logs one line per centre (id, reader, outcome, count, duration) and no page content.
  - Home-cron fallback: a home machine runs `npm run pipeline` and pushes with a fine-grained token.

## UX & Interaction Patterns

- **Result card:** the whole card is one stretched link that opens in a new tab with `rel=noopener noreferrer`, and it contains no nested links. It shows:
  - top row: date and time (card-date style), then the status chip;
  - centre name;
  - address line with "Map ↗" (44 px target, 8 px dead zone);
  - key-facts `dl`: Distance, Status, Deadline, Registration, on `surface-muted`, four across when cells are ≥ 9em, else 2×2;
  - optional registration note and the "Who may register" line, both selectable above the link layer;
  - bottom row: destination domain + ↗, then the freshness line (`<time datetime>`).
- **Status chip words:** Free seats, Booked out, Booked out · Waitlist (spoken "Booked out, waitlist open"), Status unknown. Also "No dates listed" with the booked tint and "Not checked" with the unknown tint.
- **No-dates card:** centre name in card-date style and a "No dates listed" chip. Key facts: Deadline "unknown", Registration as known. It has a freshness line and opens the test page.
- **Uncovered card (right now):** "Not checked" chip and the explanation line. Key facts: Deadline and Registration "see website". It has a "Why?" link to About `#not-checked` and no freshness line.
- **Card link name** starts with the visible date: "<date, time>, <centre>, <status>, opens <domain> in a new tab". The chip, the destination line and the glyphs ↗ ◷ · are `aria-hidden`.
- **Sort:** a radio group "Sort by" styled as two segments, Soonest | Nearest.
  - Soonest: dated cards by date then distance, then an h2 "No dates to show" with the other cards by distance.
  - Nearest: all cards by distance then date, with no heading.
  - Sorting applies on change, announces "Sorted by nearest" and updates `sort` in the URL fragment. Results never re-sort while the page is open.
- **Notices:** plain body text with no background:
  - "No dates found nearby. These centres may still have dates on their own pages."
  - "All checked dates are booked out. Other centres may still have seats."
- **No staleness banners and no colour change for old data.** Microcopy uses no exclamation marks and means the same in DE and EN.
- **"How it works"** on About says the sites are read once a day and that distance is measured to the address where the test takes place.

## Cross-Story Dependencies

- The build order is 2.1 → 2.2 → 2.3/2.4 → 2.5 → 2.6 → 2.7 → 2.8. Stories 2.1–2.8 are implemented.
- Story 2.10 must land before 2.11. Until 2.11 lands, `web/` accepts schema v3 but may still measure from the centre.
- Story 2.9 sorts by each card's distance. It can land before or after 2.10 and 2.11.
- The rule for centres without coordinates comes from Epic 1 Story 1.12 and covers listings with null `lat`/`lon`.
- Epic 3 builds on this epic: the "New" badge uses `first_seen_at` and `baseline`, hide-booked-out uses status, and the system status uses `systems[]`.
