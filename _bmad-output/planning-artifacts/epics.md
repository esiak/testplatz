---
status: final
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/specs/spec-einbuergerungstest-search/SPEC.md
  - _bmad-output/specs/spec-einbuergerungstest-search/data-sources.md
  - _bmad-output/planning-artifacts/architecture/architecture-bgtsearch-2026-10-25/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/EXPERIENCE.md
---

# bgtsearch - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for bgtsearch, decomposing the requirements from the spec (SPEC.md + data-sources.md, standing in for the PRD), the UX design contract (DESIGN.md + EXPERIENCE.md), and the architecture spine into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: A user can search by Bavarian town name or postcode, matched against a built-in place table, with a radius of 10 / 20 / 40 / 60 / 100 km (default 40). (CAP-1)
FR2: Results contain one result card for every current date whose test-address coordinates are within the radius, plus one no-dates or uncovered card for every centre without current dates whose own coordinates are within it; distance is straight-line. A date uses its centre's coordinates only when it has no test address or the address cannot be located. A covered centre whose current dates all lie outside the radius does not appear. (CAP-1, CAP-4, CAP-10)
FR3: Results sort by Soonest (default: dated cards by date then distance, then a "No dates to show" section with no-dates and uncovered cards by distance) or Nearest (all cards by distance, then date); applied on change. (CAP-1)
FR4: Each card shows its distance in km (to the test address on result cards, to the centre on other cards) and a "Map ↗" link that opens Google Maps for the test address in a new tab; nothing loads from Google until tapped. (CAP-1)
FR5: Past test dates are never listed. (CAP-1)
FR6: Each test date shows date/time, centre, full test address (falls back to the centre address), status (Free seats / Booked out / Booked out · Waitlist / Status unknown), registration deadline (date / "Passed" / "unknown"), registration method (Online / Email / Post / In person / see website), and links to the provider's page for that date. (CAP-2)
FR7: Missing source fields show as "unknown", never guessed. (CAP-2)
FR8: If a date's deep link was unreachable at the last check, the card opens the centre's test page instead and the destination line says "Opens the centre's test page". (CAP-2)
FR9: Test dates are collected automatically from KuferWeb and ITEM KG centres once a day; every covered centre's data is no older than 36 h, and a new published date appears within 36 h. (CAP-3)
FR10: Provider status is mapped per data-sources.md: waitlist offer → waitlist; KuferWeb "AUSGEBUCHT"/full light → booked out, free light → free, none → unknown; ITEM KG bookable true → free, false → booked out, absent or in-person-only → unknown. (CAP-2, CAP-3)
FR11: Centres with no reader, or opted out, appear as uncovered cards: "Not checked automatically. See the centre's page.", linking to the centre's test page, with a "Why?" link to About the data. (CAP-4, CAP-8)
FR12: A covered centre whose last check failed or never ran and that has no dates left appears as an uncovered card with "Not checked right now. See the centre's page." — never as "No dates listed". (CAP-4, CAP-5)
FR13: Every result card and no-dates card shows its centre's last successful check: relative ("Checked 2 h ago") under 36 h, exact time with ◷ ("◷ Checked Tue 14:00") when older. (CAP-5)
FR14: When a centre's collection fails or finds no expected page structure, its previous dates stay listed and age visibly (stale), rather than being removed or shown as empty. (CAP-5)
FR15: The About the data page shows one row per booking system with centres covered, last successful run, and "Working" or "Not updated since <time>". (CAP-5)
FR16: Dates first seen within the last 24 h show a "New" badge; first-seen time is stored once and survives later checks; dates found in a centre's first successful check are not marked new. (CAP-6)
FR17: The centre directory contains every BAMF-listed Bavarian test centre with name, address, coordinates, website, test page URL, reader type (KuferWeb / ITEM KG / none), opted-out flag, source and verified-at date; its count matches the BAMF Bavaria list. (CAP-7)
FR18: v1 directory is seeded from the rtpartner.de Bavaria list, with each entry verified against the centre's own website before going live. (CAP-7)
FR19: Centre coordinates are geocoded once via Nominatim (≤ 1 req/s) and stored; only changed addresses are re-geocoded. (CAP-7)
FR20: The directory is checked monthly for added or removed centres; differences are reported to the operator, not applied automatically. (CAP-7)
FR21: The official test-centre list is requested from BAMF (email, then IFG via FragDenStaat) and the directory source is switched when it arrives. (CAP-7)
FR22: An operator can mark a centre opted out; afterwards no request goes to its site and it shows as "not checked automatically". (CAP-8)
FR23: A user can switch the UI between German and English; it switches immediately, keeps search and sort, and updates the link; the initial language follows the browser. All UI strings, statuses and registration methods come from translation files; provider free text is shown as published. (CAP-9)
FR24: A covered centre whose last check succeeded but found no current dates appears as a no-dates card "No dates listed" with its last successful check time and a link to its test page. (CAP-10)
FR25: Place suggestions: after 2 characters, up to 6 matching towns/postcodes, case- and umlaut-insensitive ("Gunzburg", "Guenzburg" → Günzburg); same-name towns show postcode and district; picking one runs the search. Enter without a pick: one match or exact postcode → search; several → "Several places match. Pick one."; none → place-not-found.
FR26: "Use my location" (hidden without browser geolocation) finds the nearest Bavarian town in the table, fills the field with "Near <town>", and runs the search; the link uses that town. Denied/failed → "Error: Location not shared. Type a town or postcode instead."
FR27: A place or device location outside Bavaria shows "Error: This site covers Bavaria only. You can only take the test in your own state."
FR28: Search state (place, radius, sort, language) is carried in the URL fragment (`#q=…&r=…&sort=…&lang=…`) so a link can be shared; never coordinates, never the query string. An unknown radius snaps to the nearest allowed value; an unknown place shows place-not-found with the text filled in.
FR29: A "Hide booked-out" toggle hides only "Booked out" dates (never waitlist, unknown, no-dates or uncovered cards) and shows "N booked-out dates hidden · Show".
FR30: A count line reads "N dates and M unchecked centres within R km" (N includes hidden booked-out dates) and updates after search and toggle.
FR31: Search and result states per EXPERIENCE.md: place not found (with up to 3 "Did you mean …?" links), several places match, outside Bavaria, location denied, loading (up to 3 static skeletons), no centres in radius ("Search 40 km" button), only unchecked/no-dates centres, all dates booked out, everything hidden by the toggle, whole data load fails ("Try again").
FR32: Results never re-sort or refresh while the page is open; reloading fetches new data.
FR33: The About the data page has six sections: how it works; booking systems status; centres not checked automatically (`#not-checked`, including why: unreadable system, opt-out, or failed check); sources; attribution (OSM/ODbL, Nominatim); contact for centres to be removed.
FR34: Impressum and Privacy pages exist before public launch, linked from the footer; in private beta the links are hidden.
FR35: Each test date from a covered centre shows who may register (e.g. MVHS: Munich residents only), extracted by the reader verbatim in German from the date page, else the centre's test page; when none is found the card reads "Who may register: not stated, check the provider page", never "open to all". Display text only: never matched against the searched place, never hides or flags a centre. Documents, fees and payment rules are out of scope. (CAP-11)
FR36: Each test date's address is geocoded by the pipeline with Nominatim (structured search, ≤ 1 req/s, only addresses not yet cached, capped per run); hits and misses are cached in bot-owned state; a date whose address is missing or cannot be located takes its centre's coordinates and is marked `location: centre`. A lookup failure never fails the run. (CAP-1, CAP-2)

### NonFunctional Requirements

NFR1: Cost: €0/month running cost; no paid APIs; no always-on infrastructure; no monetisation.
NFR2: Privacy: the user's typed place and location never leave the browser; no analytics, cookies, tracking or third-party requests at page load; referrer policy no-referrer.
NFR3: Polite collection: identified bot user agent, robots.txt respected, at most 4 visits per site per rolling 24 h (including manual reruns), serial requests per host with delay and timeout.
NFR4: Data minimisation: only date, time, place, status, deadline, registration method, eligibility text and link are stored; no personal data (e.g. instructor names).
NFR5: Honesty: a gap in data must never read as "nothing available".
NFR6: Freshness: covered centres' data ≤ 36 h old under normal operation (one run a day plus slack for a late or failed run).
NFR7: Scope: Bavaria only; search only (no booking, no provider accounts, no form submission on provider sites).
NFR8: Accessibility: WCAG AA (text contrast ≥ 4.5:1, non-text ≥ 3:1), full keyboard access, screen-reader semantics, ≥ 44 px targets, reflow at 320 px / 200% zoom with longest German strings and WCAG text-spacing overrides.
NFR9: Platform: phone-first responsive site in any modern browser, including WhatsApp and Instagram in-app browsers on iOS and Android (new tabs and the way back must work).
NFR10: Localisation: adding a language means adding a translation file; no hard-coded UI text.
NFR11: Attribution: visible ODbL attribution for OpenStreetMap-derived data; Nominatim credited.
NFR12: Legal: public launch requires an Impressum (named operator, postal address) and a privacy policy naming GitHub Pages as host; private beta may run without, unlisted and `noindex`.
NFR13: Reliability: a failed run never breaks the live site (last good site stays deployed); failures are visible to the operator.

### Additional Requirements

From ARCHITECTURE-SPINE.md:

- **Starter template (Epic 1 Story 1):** scaffold the web app with `npm create preact` (Vite + Preact, without its ESLint option), single root `package.json` (no workspaces), `.nvmrc` pinning Node 26.
- Stack: Node 26 LTS, TypeScript 6.0 (no project code imports `typescript`), Vite 8.3, Preact 11.0, @preact/preset-vite 2.10, cheerio 1.2, zod 4.6, Vitest 5.0.
- Repo layout per spine: `shared/`, `pipeline/{fetch,readers/<system>,stages}`, `pipeline/config.ts`, `web/` (with `src/i18n/{de,en}.json`), `tools/`, `data/{directory,state,public}`, `.github/workflows/`; import directions enforced (readers never import fetch/stages; web never imports pipeline/tools).
- Static snapshot, no backend (AD-1): browser fetches only `snapshot.json` and `places.json`, same-origin.
- Search state in URL fragment; distance via haversine in the browser, from each listing's coordinates for result cards and from centre coordinates otherwise (AD-2).
- Reader contract (AD-3): `plan(centre)` + pure `parse(pages, centre, ctx)` returning ok/failed; `RawListing` zod schema in `shared/`; shared `mapStatus` with precedence waitlist > booked_out > free > unknown; `null` for absent fields; cheerio `load()` only; failing schema validation fails only that centre.
- Zero-dates proof (AD-4): each reader defines its expected-structure check with a "structure missing" fixture that returns failed; non-2xx list page → failed without parsing.
- Single polite HTTP path (AD-5) in `pipeline/fetch`, also used by `tools/`; Nominatim allowed only from `tools/geocode` (centres, manual) and `pipeline/stages/locate` (new test addresses, cached, capped); per-host visit log in `data/state/`; `link_ok` from detail-page fetches only; charset decoding.
- Run outcome and merge rules (AD-6): ok / failed / skipped; only merge writes state; tombstones (`removed_at`) until `starts_at` passes; `first_seen_at` immutable; baseline listings not new.
- Listing identity (AD-7): `<centre_id>@<YYYY-MM-DDTHH:mm>` with `#n` suffix for same-minute sessions, built only in normalise.
- Directory human-owned (AD-8) with typed `reader_config`; publish emits every centre with `coverage`; card type derived coverage-first.
- Two zod contracts (AD-9): `snapshot.json` `{schemaVersion, generated_at, systems[], centres[], listings[]}` and `places.json` (all German municipalities/postcodes with state code + simplified Bavaria boundary); publish refuses invalid output; app reloads once on `schemaVersion` mismatch.
- Codes in data, words in translation files (AD-10); CI fails on missing/extra i18n keys.
- Time rules (AD-11): Berlin-offset ISO `starts_at`, local-date `deadline` or null, UTC run timestamps; 36 h freshness / 24 h "New" thresholds as shared constants; publish drops `starts_at ≤ runAt`.
- Git as database (AD-12): one commit per run for `data/state/` + `data/public/`, atomic writes; rebase-conflict handling by re-running merge+publish; deploy only from pushed SHA via `actions/deploy-pages`; `pipeline.yml` on schedule (daily 05:17 UTC), push to main and dispatch; one concurrency group, no cancel-in-progress; `ci.yml` ignores `data/state/**` and `data/public/**` but validates `data/directory/**`.
- Monitoring: any failed run opens/updates a GitHub issue; each run pings an external dead-man check (provider chosen at setup); monthly `directory-monthly.yml` runs directory-diff and opens an issue.
- Fallback: home-machine cron running `npm run pipeline` and pushing with a fine-grained token; no self-hosted runner.
- Testing: readers against committed HTML fixtures; merge tests for tombstones, baseline, same-minute ids.
- Logging: one line per centre per run (id, reader, outcome, count, duration), no page content.
- Places table built offline by `tools/build-places` from an OSM-derived dataset (dataset choice open), committed as static asset.
- `noindex` during private beta.

### UX Design Requirements

UX-DR1: Design tokens as CSS custom properties from DESIGN.md frontmatter: all colours (light + dark variants, switched by `prefers-color-scheme`), typography (title, section, card-date, body, fact, meta; system font stack; rem sizes), spacing scale 4–32 px, gutter 16 px, content max 720 px, target-min 44 px, fact-cell-min 9em, radii sm/md/full.
UX-DR2: Focus ring: 2 px `action` outline, 2 px offset on every focusable element; ring around the whole card when the card link has focus; only around "Map ↗"/"Why?" when those have focus.
UX-DR3: Search bar: field + native radius select + `button-primary` submit; "Use my location" 44×44 icon button inside the field's right end; one row on desktop, field then radius+button rows on phones; not sticky; focus stays in the field on submit.
UX-DR4: Place suggestions as an ARIA 1.2 combobox (`role=combobox`, `aria-expanded`, `aria-controls` → listbox, `aria-activedescendant`), ↑/↓/Enter/Escape, rows ≥ 44 px showing town (body) + postcode · district (meta), highlight on `surface-muted`, polite status "3 suggestions".
UX-DR5: Field message: meta in `error` colour, error icon + "Error" prefix, `role=alert`, linked via `aria-describedby`, sets `aria-invalid`; up to three "Did you mean …?" links; input and focus kept.
UX-DR6: Count line (body) and notice line (body, ink-primary, no background) components.
UX-DR7: Sort control: radio group "Sort by" styled as two segments "Soonest | Nearest", selected filled `ink-primary`; shares a row with the toggle when it fits, else wraps.
UX-DR8: Hide booked-out toggle: native checkbox with `accent-color: action`; "4 booked-out dates hidden · Show" in meta; focus stays on the checkbox.
UX-DR9: Result card: whole card one stretched link (new tab, `rel=noopener noreferrer`); top row date (card-date) + "New" badge + status chip (wraps); centre name; address line; key-facts row; optional registration note; bottom row destination line + freshness line. Address and registration note sit above the link layer (selectable, no tap action). No nested links.
UX-DR10: Address line: address in meta + "Map ↗" (action colour, 44×44 target, 8 px dead zone around it); link name "Map: <address> (Google Maps, new tab)".
UX-DR11: Destination line: target domain + ↗ in action colour, meta; not a separate link; `aria-hidden` (included in the card link name).
UX-DR12: Key-facts row as `dl/dt/dd`: Distance, Status, Deadline, Registration in fixed order on `surface-muted`; four across when cells ≥ 9em, otherwise 2×2; values wrap.
UX-DR13: Status chip: pill with word + tint per variant (free / booked / unknown); "Booked out · Waitlist" spoken "Booked out, waitlist open"; "No dates listed" (booked tint), "Not checked" (unknown tint); `aria-hidden` on result cards (in link name).
UX-DR14: "New" badge: ink-primary on surface-muted pill after the date; not blue.
UX-DR15: Freshness line: meta, ink-secondary, `<time datetime>`, "h" spoken as "hours"; relative under 36 h, "◷ Checked Tue 14:00" when older; no banner, no colour change.
UX-DR16: No-dates card: result-card layout with centre name in card-date style, "No dates listed" chip, address line, key-facts (Distance; Status "No dates listed"; Deadline "unknown"; Registration as known), destination to test page, freshness line; whole card opens the test page.
UX-DR17: Uncovered card: result-card layout with centre name, "Not checked" chip, address line, explanation line ("Not checked automatically. See the centre's page." or "Not checked right now. See the centre's page."), key-facts (Distance; Status "Not checked"; Deadline and Registration "see website"), destination line and "Why?" link (44 px, own target, name "Why is <centre> not checked?"); no freshness line; whole card opens the test page.
UX-DR18: Section heading h2 "No dates to show" (Soonest sort only); heading structure h1 page task, h2 sections, h3 date/centre per card; results as a `<ul>` of cards.
UX-DR19: Skeleton cards: up to 3 static card outlines with grey bars; list `aria-busy`; static under `prefers-reduced-motion` (and no shimmer at all).
UX-DR20: Retry / next-radius buttons: `button-secondary`, full width on phones.
UX-DR21: Language switch "DE | EN" in the header, 44 px targets, `lang` and `aria-current` on the active link; `<html lang>` follows the choice; German provider text marked `lang="de"` in English UI.
UX-DR22: Footer on every page: About the data, Impressum, Privacy (hidden in beta), "Place data © OpenStreetMap contributors (ODbL)".
UX-DR23: Card link name begins with the visible date: "<date, time>, new, <centre>, <status>, opens <domain> in a new tab"; glyphs ↗ ◷ · `aria-hidden`.
UX-DR24: One `role=status` live region present from page load announcing the count line after search, "Sorted by soonest/nearest", "N booked-out dates hidden/shown", and "Loading dates…" once; load errors `role=alert`.
UX-DR25: Responsive: single column, 16 px gutters on phones, centred max 720 px on wider screens; `min-height` (never fixed height) on all controls; reflow at 320 px / 200% zoom with WCAG text-spacing.
UX-DR26: Voice and tone: all microcopy from the EXPERIENCE.md Do column, same meaning in DE and EN, no exclamation marks; the strings seed the translation files.
UX-DR27: First visit: field focused; h1 "Find Einbürgerungstest dates near you in Bavaria."
UX-DR28: Verify Flow 1 in WhatsApp and Instagram in-app browsers on iOS and Android.
UX-DR30 (revised 2026-10-30, supersedes UX-DR9, 11, 12, 13, 16, 17 and the card parts of UX-DR1, 10, 14, 23): Result cards use variant B "date tile": date tile left (month, day in `tile-day`, weekday), address in `card-address` with map pin, meta lines "time · distance · deadline", centre name, freshness; status, registration and missing-eligibility icons stacked right; eligibility rule as a full-width line. No key-facts row, status chip or destination line; unknown values still read "unknown" (FR7). No-dates and uncovered cards use the same layout with an icon in the tile. Tokens per DESIGN.md frontmatter (card-address, tile-day, date-tile, status-icon, info-icon, icon-label, eligibility-line, card-meta).
UX-DR31: Card icons are toggletip buttons: distinct shape per value, `aria-label`, label on hover / focus / tap, one open at a time, Escape or tapping elsewhere closes, never opens the card; visual 28 px, target 36 px.
UX-DR29: Banned patterns enforced: no filters that drop items with missing data, no separate "Open this date" buttons, no nested links, no infinite scroll, no pop-ups or cookie walls, no carousels, no staleness banners, no custom pickers where a native control exists.

### FR Coverage Map

FR1: Epic 1 - Search by town or postcode with radius
FR2: Epic 1 (all centres as cards) + Epic 2 (result and no-dates cards, per-date location)
FR3: Epic 2 - Soonest / Nearest sort (Epic 1 ships distance order only)
FR4: Epic 1 - Distance and Google Maps link
FR5: Epic 2 - Past dates never listed
FR6: Epic 2 - Date fields on result cards
FR7: Epic 2 - Missing fields shown as unknown
FR8: Epic 2 - Dead deep link falls back to test page
FR9: Epic 2 - Automatic collection once a day (KuferWeb and ITEM KG)
FR10: Epic 2 - Status mapping per system
FR11: Epic 1 - Uncovered cards for unchecked centres
FR12: Epic 2 - Failing centre shows "Not checked right now"
FR13: Epic 2 - Freshness line per centre
FR14: Epic 2 - Failed collection keeps stale dates
FR15: Epic 3 - Booking-system status on About page
FR16: Epic 3 - "New" badge
FR17: Epic 1 - Complete centre directory
FR18: Epic 1 - Seed from rtpartner.de, verify each entry
FR19: Epic 1 - Geocode centres once via Nominatim
FR20: Epic 3 - Monthly directory check
FR21: Epic 4 - Official BAMF list request and source switch
FR22: Epic 1 (opt-out flag shows not checked) + Epic 2 (no requests to opted-out sites)
FR23: Epic 1 - German / English switch
FR24: Epic 2 - No-dates card
FR25: Epic 1 - Place suggestions
FR26: Epic 1 - Use my location
FR27: Epic 1 - Bavaria-only message
FR28: Epic 1 - Shareable fragment link
FR29: Epic 3 - Hide booked-out toggle
FR30: Epic 1 (unchecked count) + Epic 2 (date count)
FR31: Epic 1 (search, loading, no-centres, load-fail states) + Epic 2 (date-related notices) + Epic 3 (everything-hidden notice)
FR32: Epic 1 - No live refresh while open
FR33: Epic 1 (About page sections) + Epic 3 (system status section)
FR34: Epic 4 - Impressum and Privacy
FR35: Epic 2 - Eligibility (who may register) on result cards
FR36: Epic 2 - Test-address coordinates

## Epic List

### Epic 1: Find every test centre near me
A user enters a Bavarian town, postcode or their location, picks a radius, and sees every BAMF test centre in range: distance, address, map link and a direct link to each centre's test page. Works in German and English, shareable by link, deployed for €0. Every centre shows as "Not checked automatically" for now, which already saves opening 5–10 sites to find out where you can test.
**FRs covered:** FR1, FR2 (uncovered cards), FR4, FR11, FR17, FR18, FR19, FR22 (flag), FR23, FR25, FR26, FR27, FR28, FR30 (unchecked count), FR31 (search, loading, no-centres, load-fail), FR32, FR33 (static sections)
**Notes:** Story 1 is the `npm create preact` scaffold, repo layout, shared schemas and the GitHub Pages deploy. Builds the places table, directory, snapshot publish (centres only), and the uncovered card. Story 1.11 completes the place table that Story 1.5 shipped partially; it must land before 1.8's "Bavaria only" error and 1.10. **Deferred 2026-10-28 (operator decision):** Stories 1.10 and 1.11 are taken out of Epic 1 and left for later, because the public Overpass run behind 1.11 is very slow and fails; 1.10 needs 1.11's Bavaria boundary. Epic 1 closes with Stories 1.1–1.9 plus Story 1.12, which fixes the search bugs the retrospective found; see `implementation-artifacts/deferred-work.md` and the Epic 1 retrospective. Covers UX-DR1–7, 10, 11, 12 (Distance), 17, 18–22, 24–27, 29.

### Epic 2: See current test dates from KuferWeb and ITEM KG centres
About 55 centres switch from "not checked" to real dates with status, deadline, registration method, who may register and a deep link, refreshed once a day and honest about freshness and failures.
**FRs covered:** FR2 (result and no-dates cards), FR3, FR5, FR6, FR7, FR8, FR9, FR10, FR12, FR13, FR14, FR22 (fetch skips), FR24, FR30 (date count), FR31 (date notices), FR35, FR36
**Notes:** Polite fetch, the reader contract, normalise and merge with history, then the scheduled run that commits and deploys, built with the KuferWeb reader first, end to end. The ITEM KG reader follows as its own story. Result card, no-dates card, freshness line, status chip, key-facts row. Covers UX-DR9, 12–13, 15, 16, 23. Stories 2.10–2.11 (added 2026-10-30, sprint change proposal) locate each date by its own test address and make search and distance use it; build 2.10 before 2.11. 2.9 sorts by each card's distance and can land before or after them.

### Epic 3: Spot new chances fast, and keep the data trustworthy
Users see what's new since yesterday and can hide booked-out dates. The operator sees each booking system's health and gets alerted when anything breaks, so stale data gets fixed rather than left unnoticed.
**FRs covered:** FR15, FR16, FR20, FR29, FR31 (everything-hidden notice), FR33 (system status section)
**Notes:** "New" badge with baseline rule, hide-booked-out toggle, booking-system status on About, failed-run issues, dead-man ping, monthly directory diff, compact date-tile cards (Stories 3.6–3.7, build before 3.1). Covers UX-DR8, 14, 30, 31. Stories 3.8–3.13 (added 2026-10-31) carry the Epic 2 retrospective's open items (`implementation-artifacts/epic-2-retro-2026-10-31.md`): stable same-minute ids (3.8, build before 3.1), status unless in person only (3.9), dates without a published time for MVHS (3.10, after 3.6), collect only once a day (3.11), every covered centre checked (3.12, after 3.11), and coordinates for the last 8 centres (3.13). Story 3.4 also gained two alert criteria from that retrospective.

### Epic 4: Launch publicly
The site can be announced: legal pages are live, it's indexable, it's tested in the in-app browsers people use to open shared links, and the directory moves to the official BAMF source.
**FRs covered:** FR21, FR34
**Notes:** Impressum and Privacy (needs the operator decision), remove `noindex`, show the footer legal links, test Flow 1 in WhatsApp and Instagram browsers (UX-DR28), BAMF email and freedom-of-information request.

## Epic 1: Find every test centre near me

A user enters a Bavarian town, postcode or their location, picks a radius, and sees every BAMF test centre in range with distance, address, map link and a direct link to its test page, in German or English, shareable by link, deployed for €0.

### Story 1.1: Scaffold the project and deploy an empty site

As the operator,
I want the repository scaffolded on the agreed stack and auto-deployed to GitHub Pages,
So that every later story ships to a live URL at no cost.

**Acceptance Criteria:**

**Given** the public GitHub repository `esiak/testplatz` (operator confirms it is public, sets Pages to deploy from GitHub Actions, and allows workflows to push to `main`)
**When** the project is scaffolded with `npm create preact` (no ESLint option)
**Then** there is one root `package.json`, `.nvmrc` pins Node 26, TypeScript is pinned to 6.0, and Vite 8.3, Preact 11.0, @preact/preset-vite 2.10, zod 4.6, cheerio 1.2 and Vitest 5.0 are installed
**And** the folders `shared/`, `pipeline/{fetch,readers,stages}`, `web/`, `tools/`, `data/{directory,state,public}` exist per the architecture spine

**Given** the scaffold
**When** `npm test` runs
**Then** Vitest runs and passes, and an import-direction check fails the run if `pipeline/readers` imports `pipeline/fetch` or `pipeline/stages`, or `web/` imports `pipeline/` or `tools/`, or any project file imports `typescript`

**Given** a push to `main`
**When** `ci.yml` runs
**Then** it runs tests and type-checks, and ignores changes limited to `data/state/**` and `data/public/**`

**Given** a push to `main` or a manual dispatch
**When** `pipeline.yml` runs
**Then** it builds `web/` and deploys it to GitHub Pages with `actions/deploy-pages` from the pushed SHA, in a single concurrency group with `cancel-in-progress: false`
**And** the site is served at `https://esiak.github.io/testplatz/` (Vite `base` set to match), and this URL's About page is the one named in the bot's user agent
**And** the deployed page carries `<meta name="robots" content="noindex">` and `<meta name="referrer" content="no-referrer">`, and loads no third-party resource
**And** hosting, build and deploy use only free tiers of a public repository, with no paid service or secret beyond the default workflow token (NFR1)

### Story 1.2: Bilingual page shell with design tokens

As a user who prefers English or German,
I want the site in my language with a clear, readable layout in light or dark mode,
So that I can use it comfortably from the first visit.

**Acceptance Criteria:**

**Given** DESIGN.md frontmatter
**When** the shell is built
**Then** all colours (light and dark, switched by `prefers-color-scheme`), typography (system font stack, rem sizes), spacing, radii and component tokens exist as CSS custom properties, and no component uses a literal colour or px font size
**And** every focusable element shows the 2 px `action` focus ring with 2 px offset (UX-DR1, UX-DR2)

**Given** a first visit with a German or English browser language
**When** the page loads
**Then** the UI appears in that language (German for any other language), `<html lang>` matches, and the h1 reads "Find Einbürgerungstest dates near you in Bavaria." (or its German translation) (FR23, UX-DR27)

**Given** the header language switch "DE | EN"
**When** the user picks the other language
**Then** all text switches immediately without a reload, `lang` in the URL fragment updates, focus stays on the switch, and the active link has `aria-current` and its own `lang` (UX-DR21)

**Given** `web/src/i18n/de.json` and `en.json`
**When** CI runs
**Then** it fails if either file has a key the other lacks, or if a component renders text not taken from these files (FR23, NFR10)
**And** the initial strings are the Do-column microcopy from EXPERIENCE.md Voice and Tone, same meaning in DE and EN, no exclamation marks (UX-DR26)

**Given** any page
**When** it renders
**Then** the footer shows About the data and "Place data © OpenStreetMap contributors (ODbL)"; Impressum and Privacy links are hidden (beta) (UX-DR22)
**And** layout is a single column with 16 px gutters, centred at max 720 px on wide screens, with no horizontal scroll at 320 px or 200% zoom (UX-DR25)

### Story 1.3: Seed and verify the centre directory

As a user,
I want the site to know every BAMF test centre in Bavaria,
So that no centre near me is missing.

**Acceptance Criteria:**

**Given** the directory schema in `shared/`
**When** it is defined
**Then** each entry has `centre_id` (stable slug), name, address, lat/lon (nullable until geocoded), website, `test_page_url`, `reader` (`kuferweb` / `itemkg` / `none`), optional typed `reader_config`, `opted_out`, `source` and `verified_at` (FR17)

**Given** the rtpartner.de "Prüfstellen für den Einbürgerungstest in Bayern" list
**When** `data/directory/centres.json` is seeded
**Then** it contains one entry per listed centre (~116) with `source: "rtpartner"`, and the entry count is recorded in the commit message (FR18)

**Given** the shared HTTP client in `pipeline/fetch`
**When** it is created
**Then** every request sends `User-Agent: bgtsearch-bot/<version> (+<About page URL>)`, requests to one host run one at a time with a configurable delay and timeout, robots.txt is checked once per host per run and disallowed paths are never requested, and responses are decoded to text by their charset (AD-5)

**Given** a seeded entry
**When** it is checked against the centre's own website (one visit per site, through `pipeline/fetch`)
**Then** name, address and `test_page_url` are corrected from that site and `verified_at` is set; entries that can't be confirmed keep `verified_at: null` and are listed in a review note for the operator
**And** `reader` is set from the page fingerprints in data-sources.md, defaulting to `none` when unsure

**Given** a change to `data/directory/**`
**When** CI runs
**Then** the file is validated against the schema and duplicate `centre_id`s fail the run

### Story 1.4: Geocode centre addresses

As a user,
I want each centre placed correctly on the map,
So that distances are right.

**Acceptance Criteria:**

**Given** `tools/geocode` run by the operator
**When** it processes the directory
**Then** it geocodes only entries with missing coordinates or a changed address via Nominatim, at most 1 request per second, through `pipeline/fetch`, caching results so a rerun makes no repeat requests (FR19)
**And** it writes coordinates back to `centres.json` for the operator to review and commit

**Given** a Nominatim result outside Bavaria or with no match
**When** geocoding finishes
**Then** that entry is reported and left without coordinates rather than given a guess

### Story 1.5: Build the place table

As a user,
I want to type my town or postcode and have it recognised,
So that I can search without an address lookup service.

**Acceptance Criteria:**

**Given** an OSM-derived dataset of German municipalities and postcodes (dataset chosen and recorded in this story)
**When** `tools/build-places` runs
**Then** it writes `data/public/places.json` with rows `{key, name, postcodes[], district, state, lat, lon}` for all of Germany and a simplified Bavaria boundary polygon, validated by the places zod schema (AD-9)
**And** it makes no runtime or network call to a geocoder, and the output size is recorded (flag if > 300 KB gzipped)

**Given** the shared normaliser in `shared/`
**When** names are matched
**Then** case, umlauts and ß are folded so "Gunzburg", "Guenzburg" and "günzburg" all match Günzburg, with unit tests

**Given** two towns with the same name
**When** they are in the table
**Then** each row has its district, so the UI can tell them apart

### Story 1.6: Publish a snapshot of all centres

As a user,
I want the site's data to come from one published file,
So that the page loads fast and nothing about my search leaves the browser.

**Acceptance Criteria:**

**Given** the directory
**When** `npm run pipeline` runs the publish stage
**Then** it writes `data/public/snapshot.json` with `{schemaVersion: 1, generated_at, systems: [], centres[], listings: []}` (listing entries are defined in Epic 2), every directory centre included once with `coverage: "not_checked"` (no readers exist yet) and `last_result`, `last_checked_at`, `last_success_at` as `null` (AD-8, AD-9)
**And** an opted-out centre is published as `not_checked` (FR22)

**Given** a snapshot that fails the zod schema
**When** publish runs
**Then** the run fails, nothing is committed, and the live site stays as it was

**Given** `pipeline.yml`
**When** it runs
**Then** it commits `data/public/` in one commit if changed, pushes, and deploys the site with `snapshot.json` and `places.json` from the pushed SHA (AD-12)

### Story 1.7: About the data page

As a user deciding whether to trust the results,
I want to read how the data is gathered and why some centres aren't checked,
So that I know when to check a centre's own page.

**Acceptance Criteria:**

**Given** the footer link
**When** I open About the data
**Then** I see, in the chosen language: how it works ("we read the centres' websites once a day; always check the centre's page before you register"); centres not checked automatically at `#not-checked` with the reasons (system we can't read yet, centre asked not to be checked, or our last check failed) and the list of those centres with links; sources (BAMF list, each centre's website); attribution (OSM/ODbL, Nominatim); and, for centres asking to be removed, a link that opens a new GitHub issue in `esiak/testplatz` from an "Opt-out request" issue template (centre name, website, contact) (FR33, NFR11)

**Given** the About page
**When** it renders
**Then** headings are h1 for the page and h2 per section, and it passes the same reflow and contrast rules as the search page

### Story 1.8: Search a place and see every centre in range

As a person applying for citizenship,
I want to enter my town or postcode and a radius and see every test centre nearby,
So that I know where I can take the test without searching each site.

**Acceptance Criteria:**

**Given** the search page
**When** I type a Bavarian town or postcode, choose a radius from 10 / 20 / 40 / 60 / 100 km (default 40) and submit
**Then** every centre within that straight-line distance appears exactly once as an uncovered card, nearest first, and focus stays in the field (FR1, FR2, FR11)
**And** the search bar is the field, a native radius select and a primary button, on one row on wide screens and field then radius + button on phones, not sticky (UX-DR3)

**Given** an uncovered card
**When** it renders
**Then** it shows the centre name, "Not checked" chip, address with "Map ↗" (Google Maps, new tab, 44 px target, nothing loaded until tapped), "Not checked automatically. See the centre's page.", key facts Distance "24 km" / Status "Not checked" / Deadline and Registration "see website", destination domain and a "Why?" link to About `#not-checked`; the whole card opens the test page in a new tab with `rel="noopener noreferrer"`, with no nested links (FR4, UX-DR9–12, UX-DR17)

**Given** results
**When** they render
**Then** the count line reads "0 dates and M unchecked centres within R km", the notice "No dates found nearby. These centres may still have dates on their own pages." is shown, and a `role=status` region announces the count; both lines use body text, the notice in ink-primary with no background (FR30, UX-DR6, UX-DR24)

**Given** a search
**When** the URL updates
**Then** it holds `#q=<town>&r=<km>&lang=<lang>` in the fragment only, never coordinates; opening that link reproduces the search; an unknown `r` snaps to the nearest allowed radius and an unknown `q` shows place-not-found with the text filled in (FR28)

**Given** input that matches no place, or a non-Bavarian place
**When** I submit
**Then** I see "Error: We don't know this place. Try a Bavarian town or postcode." with up to three "Did you mean …?" links, or "Error: This site covers Bavaria only. You can only take the test in your own state.", as a `role=alert` field message with `aria-invalid` and input kept (FR27, FR31, UX-DR5)

**Given** a radius with no centres
**When** results load
**Then** I see "No test centres within 20 km." and a "Search 40 km" button that reruns with the next radius (FR31, UX-DR20)

**Given** the data is loading or fails to load
**When** I search
**Then** up to 3 static skeleton cards show with `aria-busy` and "Loading dates…" announced once; on failure "We couldn't load test dates. Try again." with a "Try again" button; a `schemaVersion` mismatch reloads once, then shows that error (FR31, UX-DR19)

**Given** the page is open
**When** time passes
**Then** results never refresh or re-sort by themselves (FR32)
**And** the only network requests are same-origin `snapshot.json` and `places.json` (NFR2)
**And** the page offers no booking, account or form submission to provider sites, and none of the banned patterns (filters that drop items with missing data, separate "Open this date" buttons, nested links, infinite scroll, pop-ups or cookie walls, carousels, staleness banners, custom pickers replacing native controls) (NFR7, UX-DR29)

**Given** "Why?" on an uncovered card
**When** I tap it
**Then** the About page opens scrolled to `#not-checked`, and the browser back button returns to my results with the search intact

### Story 1.9: Place suggestions while typing

As a user on a phone,
I want matching towns suggested as I type,
So that I pick the right place quickly, even with spelling variants.

**Acceptance Criteria:**

**Given** the search field
**When** I type 2 or more characters
**Then** up to 6 matching Bavarian towns or postcodes appear (case- and umlaut-insensitive via the shared normaliser), same-name towns show "town · postcode · district", and a polite status announces "N suggestions" (FR25, UX-DR4)

**Given** suggestions are open
**When** I use ↓/↑, Enter or Escape
**Then** the highlight moves, Enter picks the highlighted row and runs the search, Escape closes the list; the field is an ARIA 1.2 combobox with `aria-expanded`, `aria-controls` and `aria-activedescendant`, and rows are at least 44 px tall

**Given** I press Enter without picking
**When** exactly one place or an exact postcode matches
**Then** the search runs for it
**And** when several match, the list stays open with "Several places match. Pick one."; when none match, the place-not-found message shows

### Story 1.10: Search from my location

> **Deferred 2026-10-28 (operator decision).** Not part of Epic 1 any more; see `implementation-artifacts/deferred-work.md`.

As a user at a bus stop,
I want to use my phone's location instead of typing,
So that I see nearby centres in one tap.

**Acceptance Criteria:**

**Given** a browser without geolocation
**When** the page loads
**Then** the "Use my location" button is not shown

**Given** I tap "Use my location" (44×44 button inside the field)
**When** I allow location and I am in Bavaria
**Then** "Finding your location…" is announced, the nearest Bavarian town from the place table fills the field as "Near <town>", the search runs, and the URL fragment holds that town, never coordinates (FR26, NFR2)

**Given** my location is outside the Bavaria boundary
**When** it is found
**Then** I see "Error: This site covers Bavaria only. You can only take the test in your own state." (FR27)

**Given** I deny location or it fails
**When** the browser responds
**Then** I see "Error: Location not shared. Type a town or postcode instead." and the field is focused
**And** coordinates are never sent, stored or put in a URL

### Story 1.11: Complete the place table

> **Deferred 2026-10-28 (operator decision).** Not part of Epic 1 any more; see `implementation-artifacts/deferred-work.md`.

As a user outside Bavaria, or using my location near its border,
I want the place table to cover all of Germany and the Bavaria boundary,
So that a non-Bavarian town shows "Bavaria only" instead of "not found", and my location is checked against the real boundary.

**Context:** Story 1.5 shipped `tools/build-places` and a partial `places.json` (`complete: false`). It holds Bavaria, Schleswig-Holstein and Hamburg. The full Overpass run was stopped because the public server was too busy (about 25 minutes for 2 of 38 queries). The `ags-09*` cache files were seeded from a single whole-Bavaria probe of 2026-10-27, with the same query shape. `places-note.md` lists the 29 missing `ags-*` queries and the missing `bavaria` boundary. **Must land before Story 1.8 ships the "Bavaria only" error and before Story 1.10.**

**Acceptance Criteria:**

**Given** the cache in `data/places/cache/`
**When** the operator runs `npm run build:places` (no `--cached-only`) at a quiet time, resuming from the cache if interrupted
**Then** every missing `ags-*` query and the `bavaria` query are fetched through `pipeline/fetch` (AD-5 Overpass exemption), and `places.json` is written with `complete: true` and `missing: []`
**And** the committed-data tests run unskipped: all 16 states present, and a boundary that contains Munich and excludes Berlin

**Given** the seeded `ags-09*` files
**When** the full run is done
**Then** they are either kept (and recorded as such in `places-note.md`) or refreshed with `--refresh`, and the choice is recorded

**Given** the full file
**When** its size is recorded
**Then** the note shows the gzipped size, flagged if over 300 KB (AD-9)

### Story 1.12: Search shows every centre and the right place

As a person searching for a test centre near me,
I want every centre in range to show, and my town to be recognised correctly,
So that I never miss a centre because of a gap in the data, and never get another town's results.

**Context:** The Epic 1 retrospective (`implementation-artifacts/epic-1-retro-2026-10-28.md`, findings F1–F3, F5) found three bugs on the live site. Each comes from two stories that no single session saw together.

1. **Centres without coordinates disappear.**
   - Story 1.4 left 8 centres without coordinates. Story 1.8 skips them (`web/src/search/search.ts:269`), with no hint.
   - Kitzingen and Kronach at 10 km say "No test centres within 10 km", though each has a VHS test centre. München at 20 km leaves out Münchner Volkshochschule.
   - The operator's fix is to set coordinates by hand, but that breaks `npm test` (`tests/directory.test.ts:204`). `npm test` gates publishing.
2. **A Bavarian town gets "Bavaria only".**
   - "Lindau" matches Lindau (Schleswig-Holstein) exactly, so it gets "Bavaria only". The Bavarian row is "Lindau (Bodensee)".
   - "88131 Lindau" gets "not found".
   - The same is likely for Landsberg, Weiden, Neuburg and Pfaffenhofen once more states are known.
3. **Non-Bavarian cities become Bavarian towns.**
   - "Essen" searches Essenbach, "Hamm" Hammelburg, "Siegen" Siegenburg and "Halle" Hallerndorf. The field and the link are rewritten to the Bavarian name.
   - Cause: `places.json` is partial (`complete: false`, Story 1.11 deferred), and Story 1.9 searches a single suggestion directly.

The cached Overpass `index` (`data/places/cache/index.json`, from Story 1.5) already lists all 10,940 German municipalities with names and official codes. So fix 3 needs no new Overpass request.

**Acceptance Criteria:**

*Fix 1: centres without coordinates (FR2, FR7, NFR5)*

**Given** a search for a Bavarian place
**When** a centre has no coordinates and its postcode is one of the place's postcodes, or its city matches the place's name (shared normaliser)
**Then** it appears once as an uncovered card with Distance "unknown" (never a guessed number), after the cards with a distance, and it counts in the count line

**Given** any search result state, including "No test centres within N km"
**When** the snapshot has centres without coordinates that were not shown as cards
**Then** a notice line says how many centres have no map position yet and may be nearby, and links to About `#no-location`; the line is absent when every centre has coordinates

**Given** the About page
**When** it renders
**Then** it lists the centres without coordinates under `#no-location`, with the reason "we don't know where this centre is yet", whatever their coverage (so a centre covered in Epic 2 cannot drop off every page)

**Given** the operator sets a centre's coordinates by hand in `centres.json` (no geocode-cache record, as `tools/geocode.ts` documents)
**When** `npm test` runs
**Then** it passes; the cache-consistency test checks only centres that have a cache record

*Fix 2: Bavarian towns with a qualifier in their name (FR27, FR25)*

**Given** input that names no Bavarian place exactly
**When** Bavarian rows start with the input as whole words (normalised: "Lindau" → "Lindau (Bodensee)", "Weiden" → "Weiden in der Oberpfalz"; "Neuburg" and "Pfaffenhofen" → several)
**Then** one such row is searched and several give "Several places match. Pick one." with the list, before any exact match outside Bavaria is considered

**Given** the qualified form "<postcode> <name>" (e.g. "88131 Lindau")
**When** a row with that postcode starts with the name as whole words
**Then** that row is searched

*Fix 3: places outside Bavaria (FR27)*

**Given** `tools/build-places`
**When** it builds `places.json` (including `--cached-only`)
**Then** it adds the names of every German municipality from the cached `index`, with state code from the official code, for states whose rows are missing; the places schema accepts them (name and state only, no coordinates or postcodes), and the size is recorded in the note (flag if > 300 KB gzipped)

**Given** input that matches no Bavarian place exactly or as whole words (Fix 2)
**When** it exactly matches a place outside Bavaria, including those name-only entries
**Then** "Error: This site covers Bavaria only. You can only take the test in your own state." shows, and no Bavarian town is searched in its place: "Essen", "Hamm", "Siegen", "Halle", "Gera", "Berlin" and "Kiel" all give this message

**Given** input that matches nothing exactly anywhere
**When** exactly one Bavarian suggestion matches ("Augs")
**Then** Story 1.9's rule still applies and that place is searched

*Tests and CI*

**Given** the committed `places.json` and `snapshot.json`
**When** `npm test` runs
**Then** committed-data tests assert all of the following, with expectations derived from the files and never failing on a legitimate data change:
- the cities named above give "Bavaria only";
- "Lindau" resolves to Lindau (Bodensee);
- no Bavarian row with a qualifier resolves to "Bavaria only" from its first word(s);
- every centre without coordinates is listed on About under `#no-location`.

**Given** `ci.yml`
**When** a commit changes `data/public/places.json`
**Then** CI runs: only `data/state/**` and `data/public/snapshot.json` are ignored, and `tests/workflows.test.ts` matches

**Given** the deployed site after this story
**When** the operator checks München 20 km, Kitzingen 10 km, Lindau, Essen and Augs in a browser
**Then** each shows the behaviour above, and the check is repeated after any review patch that changes behaviour

**Notes:** Operator data task alongside (not part of the code ACs): fix the 8 addresses or set coordinates by hand, as listed in `data/directory/geocode-note.md`.

## Epic 2: See current test dates from KuferWeb and ITEM KG centres

About 55 centres switch from "not checked" to real dates with status, deadline, registration method, who may register and a deep link, refreshed once a day and honest about freshness and failures.

### Story 2.1: Shared listing shape and reader contract

As a developer adding a booking-system reader,
I want one fixed listing shape, status mapping and reader interface,
So that every reader produces data the rest of the pipeline accepts without special cases.

**Acceptance Criteria:**

**Given** `shared/`
**When** the contract is defined
**Then** `RawListing` is a zod schema with local wall-clock date and time, place, address, status code, deadline (local date), registration method code, eligibility text, source URL, and `null` for every absent field; it has no field for personal data (AD-3, NFR4, FR35)
**And** status codes are `free`, `booked_out`, `waitlist`, `unknown`; registration codes are `online`, `email`, `post`, `in_person`

**Given** the shared `mapStatus`
**When** it receives signals from a page
**Then** it returns one code by precedence `waitlist` > `booked_out` > `free` > `unknown`, with unit tests for each case in data-sources.md (FR10)

**Given** the reader interface
**When** a reader is written
**Then** it exports `plan(centre)` (list-page URLs, how to pick detail pages, and a per-centre page cap) and `parse(pages, centre, ctx)` returning `{kind: 'ok', listings}` or `{kind: 'failed', reason}`, where `ctx.runAt` is its only time source
**And** a test helper runs a reader against saved HTML fixtures with no network

**Given** a reader returns listings that fail `RawListing` validation
**When** the pipeline checks them
**Then** only that centre is marked `failed('schema')`

### Story 2.2: Polite collection rules

As a test centre,
I want the bot to respect my site's rules and opt-out,
So that collection never burdens or ignores me.

**Acceptance Criteria:**

**Given** a centre with `opted_out: true` or `reader: none`
**When** a run starts
**Then** no request is sent to its site and its outcome is `skipped` (FR22, AD-5)

**Given** a host whose robots.txt disallows the test page path for the bot
**When** a run starts
**Then** robots.txt is fetched once per host per run and the centre's outcome is `skipped` with reason `robots`

**Given** a host already visited 4 times in the last 24 hours (per the visit log in `data/state/`, which fetch reads but never writes; fetch returns this run's visits with its results)
**When** any run starts, including a manual or local one
**Then** the host is not contacted and the centre is `skipped` (NFR3)

**Given** a reader's `plan`
**When** fetch runs it
**Then** list pages are fetched first, then at most the capped number of detail pages, serially per host with delay and timeout; each page carries its HTTP status
**And** a non-2xx or timed-out list page makes the centre `failed` without calling `parse` (AD-4)

### Story 2.3: KuferWeb reader

As a user near a KuferWeb centre,
I want its test dates read automatically,
So that I see them without visiting the site.

**Acceptance Criteria:**

**Given** saved test pages from at least three KuferWeb centres (committed under `pipeline/readers/kuferweb/fixtures/`)
**When** the reader parses them
**Then** each Einbürgerungstest date yields a `RawListing` with date, time, place, address, status, deadline, registration method, eligibility and source URL, matching the page by hand-check (FR6)

**Given** a page stating who may register (keywords such as "Wohnsitz", "wohnhaft", "Hauptwohnsitz", "nur für", "Teilnehmende")
**When** parsed
**Then** `eligibility` holds that paragraph verbatim, length-capped, from the date page or else the centre's test page; a page with no such rule gives `null`, never a guess
**And** the fixtures include at least one page with a rule and one without (FR35)

**Given** KuferWeb status signals
**When** they are mapped
**Then** "AUSGEBUCHT" or a full traffic light gives `booked_out`, a free light gives `free`, a waitlist offer gives `waitlist`, and no indicator gives `unknown` (FR10)

**Given** a page with the expected course list but no test dates
**When** parsed
**Then** the result is `ok` with zero listings

**Given** a page without the expected structure (fixture "structure missing")
**When** parsed
**Then** the result is `failed`, never `ok` with zero listings (AD-4)
**And** the reader uses cheerio `load()` only and does no I/O

**Given** the directory
**When** this story is done
**Then** each KuferWeb centre has a verified `test_page_url` and any needed `reader_config`, and the list of centres confirmed as KuferWeb is recorded

### Story 2.4: ITEM KG reader

As a user near an ITEM KG centre (for example MVHS, Würzburg, Fürth, Erding, Bad Kissingen),
I want its test dates read automatically,
So that these centres show real dates too.

**Acceptance Criteria:**

**Given** saved test pages from at least three ITEM KG centres (`pipeline/readers/itemkg/fixtures/`)
**When** the reader parses them
**Then** each test date yields a valid `RawListing`, matching the page by hand-check (FR6)

**Given** a page stating who may register (e.g. MVHS: Munich residents only)
**When** parsed
**Then** `eligibility` holds that paragraph verbatim, length-capped, from the detail page or else the centre's test page; no rule gives `null`
**And** the fixtures include the MVHS residence rule and at least one page without a rule (FR35)

**Given** ITEM KG flags
**When** they are mapped
**Then** `bookable` true gives `free`, false gives `booked_out`, a waitlist offer gives `waitlist`, and an absent flag or in-person-only registration gives `unknown`; Bad Kissingen's in-person, cash-only registration yields `in_person` (FR10)

**Given** list pages and detail pages (`/p/<slug>-<NNN>-CAT-KAT<n>`)
**When** the reader plans the crawl
**Then** it stays within the per-centre page cap and returns `failed` when the expected category structure is missing (AD-4)

**Given** the directory
**When** this story is done
**Then** each ITEM KG centre has a verified `test_page_url` and `reader_config`, and the list of centres confirmed as ITEM KG is recorded

### Story 2.5: Normalise and merge with history

As a user,
I want each test date to keep its identity and history across checks,
So that dates don't vanish on a glitch and "new" will mean new.

**Acceptance Criteria:**

**Given** raw listings
**When** normalise runs
**Then** `starts_at` gets its Europe/Berlin offset, a missing address falls back to the centre address, the id is `<centre_id>@<YYYY-MM-DDTHH:mm>` with `#2`, `#3` for same-minute sessions ordered by place, and `link_ok` comes from this run's detail-page fetch (AD-7, FR8)

**Given** a centre outcome
**When** merge runs
**Then** `ok` sets `last_checked_at`, `last_success_at`, `last_result=ok` and replaces current listings; `failed` sets `last_checked_at` and `last_result=failed` and keeps previous listings; `skipped` sets nothing (AD-6, FR14)

**Given** a listing that disappears in an `ok` run and later reappears
**When** merge runs
**Then** it gets `removed_at`, stays in state until its `starts_at` passes, and on return keeps its original `first_seen_at`

**Given** a centre's first `ok` run
**When** its listings are stored
**Then** they are marked `baseline`; `first_seen_at` is set once and never changed (FR16 foundation)

**Given** `data/state/`
**When** merge writes it
**Then** only merge writes state, files are written atomically, and the state is validated against its own schema with a `stateVersion`
**And** merge appends this run's visits (returned by fetch) to the per-host visit log and drops entries older than 24 h (AD-5)
**And** merge tests cover tombstones, baseline, same-minute ids and failed-run retention

### Story 2.6: Scheduled collection run

As a user,
I want dates refreshed every day without anyone pressing a button,
So that what I see is never more than about a day old.

**Acceptance Criteria:**

**Given** `npm run pipeline`
**When** it runs
**Then** it executes fetch → parse → normalise → merge → publish, logging one line per centre (id, reader, outcome, count, duration) and no page content

**Given** publish
**When** it writes `snapshot.json`
**Then** centres with a working reader have `coverage: covered` and their `last_result`, `last_checked_at`, `last_success_at`; `systems[]` lists each reader with `centres_covered`, `centres_ok`, `centres_failed`, `last_success_at`; `schemaVersion` becomes 2 now that listings carry entries, with `web/` updated in the same commit (AD-9); centres skipped for opt-out, reader `none` or robots are published as `not_checked`; listings with `starts_at ≤ runAt`, removed listings and `not_checked` centres' listings are excluded (FR5, AD-8, AD-9)

**Given** `pipeline.yml`
**When** the daily schedule fires at 05:17 UTC
**Then** the run commits `data/state/` and `data/public/` in one commit, pushes, and deploys from the pushed SHA; if the push fails, nothing is deployed (FR9, AD-12)
**And** under normal operation every covered centre's `last_success_at` is less than 36 h old (NFR6)

**Given** the About page "How it works" text
**When** it renders in either language
**Then** it says the centres' websites are read once a day (FR33)

**Given** a push rejected because `main` moved
**When** the bot pulls
**Then** if only its own folders conflict it rebases; if anything else changed (for example the directory) it re-runs merge and publish from this run's saved reader results on the new upstream, without refetching, then pushes

**Given** the pipeline on a home machine
**When** it runs with a fine-grained token
**Then** it produces the same commit and GitHub deploys it (architecture fallback)

### Story 2.7: Result cards with test dates

As a person looking for a test date,
I want each date shown with its status, deadline and how to register, linking to its exact page,
So that I can decide and book in one tap.

**Acceptance Criteria:**

**Given** a snapshot with listings
**When** I search
**Then** each current date is one result card: date and time (card-date), status chip, centre name, address line with "Map ↗", key facts Distance / Status / Deadline / Registration as a `dl`, optional registration note, eligibility line, destination domain and freshness line (FR6, UX-DR9, UX-DR12, UX-DR13)

**Given** a listing's `eligibility`
**When** the card renders
**Then** a rule shows as "Who may register: <provider text>" as published, marked `lang="de"` in the English UI and selectable above the link layer like the registration note; `null` reads "Who may register: not stated, check the provider page"
**And** the rule never hides, reorders or flags a card based on the searched place (FR35, UX-DR21)

**Given** field values
**When** they render
**Then** a missing value reads "unknown", a deadline before today reads "Passed" and the card stays, registration shows Online / Email / Post / In person, and "Booked out · Waitlist" is spoken "Booked out, waitlist open" (FR7)

**Given** a listing with `link_ok: true`
**When** I tap the card
**Then** the provider's page for that date opens in a new tab
**And** with `link_ok: false`, the destination line reads "Opens the centre's test page" and the card opens `test_page_url` (FR8)

**Given** the freshness line
**When** the centre's `last_success_at` is under 36 h old
**Then** it reads "Checked 2 h ago"; when older, "◷ Checked Tue 14:00", same grey, no banner, using `<time datetime>` (FR13, UX-DR15)

**Given** a card
**When** read by a screen reader
**Then** its link name starts with the date: "<date, time>, <centre>, <status>, opens <domain> in a new tab"; chip, destination and glyphs are `aria-hidden` (UX-DR23)

**Given** results with dates
**When** the count line renders
**Then** it reads "N dates and M unchecked centres within R km", and dates with `starts_at` before now are hidden client-side (FR30, FR5)

### Story 2.8: No-dates and not-checked-right-now cards

As a user,
I want to see when a centre really has no dates, and when the site simply couldn't check it,
So that a gap never looks like "nothing available".

**Acceptance Criteria:**

**Given** a covered centre with no current listings and `last_result: ok`
**When** results render
**Then** it shows a no-dates card: centre name, "No dates listed" chip, address line, key facts (Distance; Status "No dates listed"; Deadline "unknown"; Registration as known), destination to its test page, freshness line; the card opens the test page (FR24, UX-DR16)

**Given** a covered centre with no current listings and `last_result` `failed` or `null`
**When** results render
**Then** it shows an uncovered card with "Not checked right now. See the centre's page." and never "No dates listed" (FR12, NFR5)

**Given** a covered centre whose last run failed but which still has listings
**When** results render
**Then** its result cards stay, and their freshness line ages to the exact-time form after 36 h (FR14)

**Given** only no-dates and uncovered cards in range
**When** results render
**Then** the count line reads "0 dates and M unchecked centres within R km" and the notice "No dates found nearby. These centres may still have dates on their own pages." shows (FR31)

### Story 2.9: Sort by soonest or nearest

As a user,
I want to sort by the earliest date or by distance,
So that I can trade travel for an earlier test.

**Acceptance Criteria:**

**Given** results
**When** they first load
**Then** a radio group "Sort by" shows Soonest (selected) and Nearest as two segments; Soonest lists dated cards by date then distance, followed by an h2 "No dates to show" with no-dates and uncovered cards by distance (FR3, UX-DR7, UX-DR18)

**Given** I choose Nearest
**When** the order changes
**Then** all cards are ordered by distance then date, the section heading disappears, "Sorted by nearest" is announced, and `sort` updates in the URL fragment

**Given** every checked date in range is booked out
**When** results render
**Then** the notice "All checked dates are booked out. Other centres may still have seats." shows (FR31)

### Story 2.10: Locate each test date

As a user,
I want each test date placed at the address where the test happens,
So that distance and the radius reflect where I actually have to go.

**Acceptance Criteria:**

**Given** the Nominatim lookup in `tools/geocode.ts`
**When** this story is done
**Then** the structured `/search` request, the `NominatimHit` parsing and the acceptance rules (street-level, inside Bavaria, matching postcode) live in `pipeline/fetch/nominatim.ts`, `tools/geocode.ts` uses them unchanged in behaviour, and its tests still pass

**Given** normalised listings in a run
**When** the new stage `pipeline/stages/locate` runs (after normalise, before merge)
**Then** each listing gets `lat`, `lon` and `location`:
- a provider address that matches its centre's formatted address (after the shared address normaliser: case, "Str." / "Straße", whitespace) takes the centre's coordinates with `location: venue`, no request;
- an address found in `data/state/venues.json` uses the cached result, no request;
- otherwise an address of the form "street, NNNNN city" is looked up once via Nominatim; an accepted hit gives `location: venue`
(FR36)

**Given** a listing whose address came from the centre fallback, does not parse as "street, NNNNN city", or has no accepted Nominatim hit
**When** locate runs
**Then** it takes its centre's `lat`/`lon` (which may be `null`) with `location: centre`; nothing is guessed, and the run log lists each such address once with its reason

**Given** Nominatim lookups in a run
**When** locate sends them
**Then** they go through `pipeline/fetch` with the Nominatim exemption only, serially, ≥ 1 s apart, at most `LOCATE_MAX_LOOKUPS_PER_RUN` (in `pipeline/config.ts`, default 50); addresses beyond the cap fall back to the centre this run and are tried next run
**And** a timeout, non-2xx or invalid response caches nothing, falls back to the centre, and never fails the run or a centre (AD-5)

**Given** this run's lookups
**When** merge runs
**Then** it writes them to `data/state/venues.json` (keyed by the normalised address; hit or miss with `fetched_at`), validated by its own schema; a cached miss is retried after 30 days; locate never writes state (AD-6)

**Given** publish
**When** it writes `snapshot.json`
**Then** every listing carries `lat`, `lon` and `location`, `schemaVersion` becomes 3, and `web/` is updated in the same commit to accept it (it may keep measuring from the centre until Story 2.11) (AD-9)

**Given** the current snapshot's addresses
**When** tests run
**Then** fixtures cover: same-as-centre address (no request), cached hit, new hit, rejected hit (wrong postcode), unparseable address, Nominatim down, cap reached, centre without coordinates

### Story 2.11: Search by test location

As a person searching near my town,
I want dates to count as nearby when the test is held nearby,
So that I find dates held in my town by a centre based elsewhere, and don't see faraway dates as close.

**Acceptance Criteria:**

**Given** a search with place and radius
**When** results are selected
**Then** each current listing of a covered centre is a result card if its own `lat`/`lon` lie within the radius, with Distance measured from them; a centre without current listings is selected by its own coordinates as today (FR2, AD-2, AD-8)

**Given** a covered centre whose own address is in range but whose current dates are all at addresses outside the radius
**When** results render
**Then** the centre does not appear (no result, no-dates or uncovered card)

**Given** a covered centre whose own address is outside the radius but which has a date at an address inside it (e.g. VHS Starnberger See's Herrsching dates for a search from Herrsching, 10 km)
**When** results render
**Then** that date appears as a result card with its distance to the Herrsching address

**Given** a listing with `lat`/`lon` `null` (neither venue nor centre located)
**When** results are selected
**Then** it follows Story 1.12's rule for its centre (shown with Distance "unknown" when the centre's postcode or city matches the place), so it never disappears silently (NFR5)

**Given** the count line, the "No test centres within R km" state and the date notices
**When** they compute
**Then** they count the cards actually selected (dates in range plus centres without dates in range)

**Given** the result card's "Map ↗"
**When** tapped
**Then** it still opens the listing's `address` (unchanged); the About page "How it works" text says, in DE and EN, that distance is measured to the address where the test takes place

## Epic 3: Spot new chances fast, and keep the data trustworthy

Users see what's new since yesterday and can hide booked-out dates; the operator sees each booking system's health and is alerted when anything breaks, so stale data gets fixed rather than left unnoticed.

### Story 3.1: "New" badge on fresh dates

**Depends on:** Stories 3.6 and 3.7 (the badge sits in the new card layout) and Story 3.8 (dates must keep their `first_seen_at`).

As a user checking back every day,
I want dates that appeared since yesterday marked "New",
So that I spot new chances without comparing lists.

**Acceptance Criteria:**

**Given** a listing whose `first_seen_at` is less than 24 h before now and that is not `baseline`
**When** its result card renders
**Then** a "New" badge (ink-primary on surface-muted pill, not blue) appears after the address, and the card's link name includes "new" after the date (FR16, UX-DR14, UX-DR23)

**Given** a listing first seen 24 h or more ago, or found in its centre's first successful check
**When** its card renders
**Then** no badge shows

**Given** a date that disappeared and came back
**When** its card renders
**Then** the badge follows its original `first_seen_at`, so a reappearing date is not shown as new
**And** the 24 h threshold comes from the shared constant, compared against the browser's current time

### Story 3.2: Hide booked-out dates

**Default ticked** (operator decision 2026-10-31, after the story was built): booked-out dates are hidden on the first search, and unticking shows them.

As a user who only wants dates I can still book,
I want to hide booked-out dates with one switch,
So that the list shows my real options without losing anything.

**Acceptance Criteria:**

**Given** results with booked-out dates
**When** I tick "Hide booked-out" (native checkbox)
**Then** only "Booked out" cards are hidden; "Booked out · Waitlist", "Status unknown", no-dates and uncovered cards always stay (FR29, UX-DR8)
**And** "4 booked-out dates hidden · Show" appears, "Show" unticks the toggle, and focus stays on the checkbox

**Given** the toggle changes
**When** the list updates
**Then** the count line still counts all dates including hidden ones, and the status region announces "4 booked-out dates hidden" or "shown" (FR30, UX-DR24)

**Given** every date in range is booked out and hidden
**When** results render
**Then** the notice "All 4 dates here are booked out and hidden." shows with a "Show them" link (FR31)

**Given** narrow screens
**When** the sort control and toggle don't fit on one row
**Then** the toggle wraps below the sort control without horizontal scroll (UX-DR7)

### Story 3.3: Booking-system status on About the data

As a user wondering whether the data is current,
I want to see whether each booking system is being read successfully,
So that I know how far to trust the dates.

**Acceptance Criteria:**

**Given** `systems[]` in the snapshot
**When** About the data renders
**Then** a "Booking systems" section shows one row per system (KuferWeb, ITEM KG) with centres covered, last successful run, and status "Working" (FR15, FR33)

**Given** a system whose `last_success_at` is more than 36 h before now
**When** the row renders
**Then** status reads "Not updated since Tue 14:00", in text, with no colour-only signal (AD-11)

**Given** the table
**When** read by a screen reader or at 320 px width
**Then** it is a real table with header cells and reflows or scrolls within its own container, never the page

### Story 3.4: Alert the operator when collection breaks

As the operator,
I want to be told when a run fails or stops running,
So that I can fix a broken reader before users notice.

**Acceptance Criteria:**

**Given** any `pipeline.yml` run that fails (fetch, publish validation, push or deploy)
**When** the failure happens
**Then** a step opens a GitHub issue titled with the failing stage, or adds a comment to the open one, so GitHub emails the operator (NFR13)

**Given** a run in which a reader system has `centres_ok = 0` for more than 24 h
**When** the run finishes
**Then** an issue for that system is opened or updated, and closed automatically after its next successful run

**Given** each successful run
**When** it finishes
**Then** it pings an external dead-man check (free provider chosen and recorded in this story) that alerts the operator if no ping arrives for 13 h; the ping URL is stored as a repository secret

**Given** the operator's notes in the repo
**When** read
**Then** they explain re-enabling the schedule via `workflow_dispatch` or the Actions tab after GitHub's 60-day inactivity disable, and switching to the home-machine fallback if sites block GitHub's IPs

**Given** a run in which every centre that was fetched ends `failed` (added 2026-10-31, Epic 2 retrospective F14)
**When** the run finishes
**Then** the run is marked failed and alerts the operator like any other failed run, even though `run.ts` itself completed

**Given** a centre that had current listings and now returns `ok` with zero listings while its list page still has the expected structure (added 2026-10-31, Epic 2 retrospective F14)
**When** the run finishes
**Then** the issue for its reader system names the centre as "dates disappeared, check the page", so a redesigned page is not taken for "no dates"

### Story 3.5: Monthly directory check

As the operator,
I want a monthly report of test centres added to or removed from the source list,
So that the directory stays complete without manual searching.

**Acceptance Criteria:**

**Given** `directory-monthly.yml`
**When** it runs on the 1st of each month (or by manual dispatch)
**Then** `tools/directory-diff` compares the source list (rtpartner.de, or BAMF once switched) with `data/directory/centres.json` through `pipeline/fetch` (FR20)

**Given** differences
**When** the diff finishes
**Then** it opens a GitHub issue listing added, removed and changed centres (name, address, website), and never edits `centres.json` itself (AD-8)

**Given** no differences
**When** the diff finishes
**Then** no issue is opened and the run log says so

### Story 3.6: Compact date-tile result cards

**Build before Story 3.1.** UX reference: DESIGN.md Components (Result card, Address line, Eligibility line, No-dates card, Uncovered card), EXPERIENCE.md Result Card Variants, `ux-designs/ux-bgtsearch-2026-10-25/mockups/card-b-states.html`.

As a person scanning dates on a phone,
I want each card short, with the date and address easy to see,
So that I can compare dates and places without reading through repeated facts.

**Acceptance Criteria:**

**Given** DESIGN.md frontmatter (revised 2026-10-30)
**When** `tests/design-tokens.test.ts` runs
**Then** `web/src/styles/tokens.css` holds every new token (card-address, tile-day, date-tile, status-icon, info-icon, icon-label, eligibility-line, card-meta, tile-width, icon-size, icon-target) and none of the removed ones (card-date, fact, key-facts-row, status-chip, destination-line, fact-cell-min), and the test passes (UX-DR30)

**Given** a current listing
**When** its result card renders
**Then** it shows a date tile (month, day, weekday), the address in `card-address` with a map-pin link, a meta line "14:00 · 14 km" plus " · Deadline 13 Nov", the centre name, and the freshness line; there is no key-facts row, status chip, destination line or registration note (UX-DR30)
**And** the card is still one stretched link to the date's page, new tab, and the map pin keeps its own 44 px target and link name "Map: <address> (Google Maps, new tab)"

**Given** a deadline before today, an unknown deadline or an unknown distance
**When** the card renders
**Then** it reads "Deadline passed" in the unknown status colour, "Deadline unknown", or "distance unknown"; the card stays (FR7)

**Given** a listing with `link_ok: false`
**When** the card renders
**Then** a last meta line "Opens the centre's test page" in action colour shows and the card opens `test_page_url` (FR8)

**Given** a listing with `eligibility` text
**When** the card renders
**Then** a full-width line below the columns shows a house icon and the rule as published, `lang="de"`, selectable above the link layer, with visually hidden "Who may register:" before it; it never hides, reorders or flags a card (FR35, CAP-11)

**Given** a no-dates or uncovered centre
**When** its card renders
**Then** it uses the same layout with a calendar icon (no-dates) or question-mark tile on the unknown tint (uncovered) in place of the date; the meta line reads "No dates listed · 32 km" or "Not checked automatically" / "Not checked right now" · distance; uncovered cards keep "Why?" (44 px) and have no freshness line (FR12, FR24)

**Given** a card
**When** read by a screen reader
**Then** the link name reads "<date, time>, [new,] <address>, <centre>, <status>, <registration>, opens <domain> in a new tab"; the tile's visible text and glyphs are `aria-hidden` (UX-DR23 revised)

**Given** a 320 px wide screen at 200 % zoom with the longest German strings
**When** results render
**Then** tile, text and icon columns stay side by side, the address and meta lines wrap inside the text column, and nothing scrolls sideways (UX-DR25)

**Given** the old card strings and code
**When** this story is done
**Then** unused translation keys (key-facts labels, "card.destination", "card.eligibility_unknown", "card.deadline_passed" = "Passed", "card.fact.distance_unknown" = "unknown") are replaced in DE and EN, and the tests for Stories 2.7 and 2.8 are updated to the new layout

### Story 3.7: Status, registration and eligibility icons

**Build together with or right after Story 3.6.**

As a person scanning dates,
I want status, registration and missing eligibility shown as small icons I can tap for their meaning,
So that each card says it once, without a block of repeated words.

**Acceptance Criteria:**

**Given** a result card
**When** it renders
**Then** icons are stacked top-right in this order: status, registration, and the eligibility icon only when `eligibility` is `null` (UX-DR30)

**Given** status values
**When** the status icon renders
**Then** each has its own shape and tint: tick "Free seats" (free), slashed circle "Booked out" (booked), clock "Booked out · Waitlist" (booked), question mark "Status unknown" (unknown); colour is never the only difference (UX-DR31)

**Given** registration values
**When** the registration icon renders
**Then** screen "Register online", envelope "Register by email", mailbox "Register by post", person "Register in person", form with question mark "Registration: see website" when `null`

**Given** a listing with `eligibility: null`
**When** the card renders
**Then** a person-with-question-mark icon labelled "Who may register: not stated" shows; nothing on the card suggests "open to all" (FR35, CAP-11)

**Given** an icon
**When** I hover it, focus it with the keyboard, or tap it
**Then** its label appears above it (icon-label tokens); tap or Enter/Space toggles it, Escape or tapping elsewhere closes it, opening another label closes the first, and tapping an icon never opens the card (UX-DR31)

**Given** a screen reader or keyboard user
**When** they reach an icon
**Then** it is a `<button>` with `aria-label` set to its label and `aria-expanded`; the opened label is announced politely; the focus ring sits on the icon only (UX-DR2)

**Given** the icon targets
**When** measured
**Then** each is at least 36 × 36 px with the visible icon at 28 px, and targets don't overlap the map pin or each other (WCAG 2.5.8)

**Given** DE and EN
**When** labels render
**Then** every label comes from the translation files, with the same meaning in both languages (UX-DR26)

### Story 3.8: Same-minute dates keep their history

**Build before Story 3.1.** Added 2026-10-31 from the Epic 2 retrospective (`implementation-artifacts/epic-2-retro-2026-10-31.md`, finding F7, action item 5).

As a user checking back every day,
I want each date to keep its own history when another date at the same minute appears or disappears,
So that "New" never marks an old date and never hides a new one.

**Context:** Normalise numbers same-minute sessions `#2`, `#3` by their position in this run (`pipeline/stages/normalise.ts:131-136`), and merge keys `first_seen_at`, `baseline` and tombstones by id (`pipeline/stages/merge.ts:42-51`). When a sibling appears or disappears, a surviving date takes another date's id and history.

**Acceptance Criteria:**

**Given** a centre whose stored state has two or more listings at the same minute
**When** an `ok` run returns that minute with one sibling removed, one added, or the order of places changed
**Then** each date that is still listed keeps its stored id, `first_seen_at` and `baseline`, matched to the stored listing by `source_url`, then by place; only a date with no match gets a new id and a new `first_seen_at` (AD-7, FR16)
**And** only the date that is really gone gets `removed_at`

**Given** a new id is needed at a minute where earlier ids are taken (live or tombstoned)
**When** normalise assigns it
**Then** it takes the lowest free `#n`, so no id is ever reused by a different date while its tombstone is in state

**Given** `tests/normalise.test.ts` and `tests/merge.test.ts`
**When** they run
**Then** they cover: sibling removed, sibling added before an existing one, two siblings swapping places, and a same-minute date that disappears and returns

### Story 3.9: Status shown unless registration is in person only

Added 2026-10-31 from the Epic 2 retrospective (findings F3, F14, F15, action items 3 and 8).

As a person looking for a test date,
I want a date's booking status shown whenever the provider gives one,
So that "Status unknown" means the provider really says nothing, not that it also accepts in-person registration.

**Context:** 73 of 100 published dates read "Status unknown" because the ITEM KG reader drops every status signal when the registration method is `in_person` (`pipeline/readers/itemkg/index.ts:186-197,222`), even on pages that also accept email (VHS Fichtelgebirge: "Die Anmeldung erfolgt persönlich … Alternativ ist auch eine Anmeldung per E-Mail möglich"). Story 2.4 asks for `unknown` only for in-person-only registration. The two readers also keep separate rules for registration wording (`pipeline/readers/kuferweb/index.ts:406`) and preparation courses (ITEM KG excludes them at `itemkg/index.ts:22,129`; KuferWeb's `TEST_TITLE` at `kuferweb/index.ts:22` does not).

**Acceptance Criteria:**

**Given** `shared/`
**When** this story is done
**Then** one helper decides the registration method and whether registration is in person only, and one helper decides whether a course title is a preparation course; both readers use them, and neither keeps its own copy (FR10, FR35)

**Given** a page whose registration text names in-person registration and another method (e-mail, post, online)
**When** a reader parses it
**Then** `registration_method` is the first method named, as today, but the status comes from the page's booking signals; only a page saying registration is in person only ("nur persönlich", "ausschließlich persönlich", or in person with no other method named) gives `unknown` (FR10)

**Given** the VHS Fichtelgebirge Marktredwitz test page, saved as a fixture under `pipeline/readers/itemkg/fixtures/fichtelgebirge/`
**When** the ITEM KG reader parses it
**Then** its dates carry the status their booking flags give, and the Bad Kissingen in-person, cash-only fixture still gives `in_person` / `unknown`

**Given** a KuferWeb list page with a preparation course whose title names the Einbürgerungstest (new fixture)
**When** the reader parses it
**Then** the preparation course is not a listing

**Given** the snapshot after the first daily run with this change
**When** the operator compares it with 2026-10-30's (81 of 100 dates `unknown`)
**Then** the spec's run result records the new count of `unknown` dates per reader

### Story 3.10: Dates whose start time is not published yet

**Build after Story 3.6** (the card wording uses the date-tile layout). Added 2026-10-31 from the Epic 2 retrospective (finding F2, action item 2).

As a person in Munich,
I want MVHS test dates shown even before MVHS publishes the exact start time,
So that the biggest test centre in Bavaria is no longer "Not checked right now".

**Context:** MVHS lists each test with a date only and sends the exact times 10 days before the test (`data/directory/itemkg-note.md`, "MVHS (München)"). `RawListing` requires a time, so the ITEM KG reader fails MVHS with `date-unparseable` on every run, and a search for "München", 10 km shows 0 dates.

**Acceptance Criteria:**

**Given** `shared/listing.ts`
**When** the contract changes
**Then** `RawListing.time` may be `null` only when the page states a date with no time (an "00:00 - 23:59" placeholder counts as no time); a reader never invents a time (AD-3, FR6)

**Given** a raw listing with no time
**When** normalise runs
**Then** `starts_at` is that day at 00:00 Europe/Berlin, `time_known` is `false`, and the id is `<centre_id>@<YYYY-MM-DD>` (with `#2`, `#3` as in Story 3.8 when several untimed dates share a day) (AD-7)
**And** a date with no time stays current until the end of its day, in publish and in the browser (FR5)

**Given** publish
**When** it writes `snapshot.json`
**Then** every listing carries `time_known`, `schemaVersion` becomes 4, and `web/` accepts it in the same commit (AD-9)

**Given** a listing with `time_known: false`
**When** its result card renders
**Then** the meta line reads "Time not published yet" (DE: "Uhrzeit noch nicht veröffentlicht") in place of the time, and the screen-reader link name says the same after the date (UX-DR23)
**And** Soonest sorts it by its date, before timed dates of the same day

**Given** the MVHS category page and a detail page (fixtures under `pipeline/readers/itemkg/fixtures/mvhs/`)
**When** the ITEM KG reader parses them
**Then** MVHS returns `ok` with one listing per test date and `time: null`, and the "Deutsch Geschichte und Politik von A-Z" course is not a listing

**Given** a search for "München", 10 km after the next daily run
**When** results render
**Then** MVHS shows its dates as result cards, not "Not checked right now" (needs MVHS's coordinates from Story 3.13; until then its distance reads "unknown")

### Story 3.11: Collect only once a day

Added 2026-10-31 from the Epic 2 retrospective (findings F6, F10, action item 4).

As a test centre,
I want the bot to read my site once a day, not on every code change,
So that its visits stay within the promised limit.

**Context:** `pipeline.yml` collects on every push to `main` (`.github/workflows/pipeline.yml:7-8`), so each push uses one of each site's 4 visits per 24 h; after the 10/29–10/30 runs every host was at 4/4. The publish job checks out `${{ github.sha }}` (`pipeline.yml:34`), so a run queued behind another reads a visit log without that run's visits. A run that fails after merge never commits its visits (`pipeline/stages/run.ts:171-190`).

**Acceptance Criteria:**

**Given** a push to `main` (code, directory or data)
**When** `pipeline.yml` runs
**Then** no provider site and no Nominatim request is sent; the site is built and deployed from the pushed SHA with the committed data (FR9, NFR3)

**Given** the 05:17 UTC schedule or a manual `workflow_dispatch`
**When** the run collects
**Then** it first checks out the current tip of `main`, so the visit log and venue cache include every earlier run (NFR3, AD-5)

**Given** a collecting run that fails after it contacted any site (collect throws, publish fails, tests fail, push is rejected for good)
**When** the job ends
**Then** this run's visits are still committed to `data/state/visits.json` on `main`, and nothing else from the failed run is

**Given** `tests/workflows.test.ts`
**When** it runs
**Then** it asserts the triggers that collect, the checkout ref of the collecting job, and the visits-on-failure step

**Given** the About page "How it works" text
**When** this story is done
**Then** it still truthfully says the websites are read once a day, in DE and EN (FR33)

### Story 3.12: Every covered centre gets checked

**Build after Story 3.11.** Added 2026-10-31 from the Epic 2 retrospective (finding F1, action item 1).

As a person near Würzburg, Erding, Cham, Straubing or Kelheim,
I want my centre's dates read like everyone else's,
So that I don't see "Not checked right now" for a site that works.

**Context:** These five ITEM KG centres have no entry in `data/state/state.json`, yet each host had 4 visits on 10/29–10/30. On 2026-10-31 each list page answered 200 with no redirect and robots.txt allows it. Merge stores nothing for a `skipped` outcome (`pipeline/stages/merge.ts:70`), so the reason is only in the CI run logs.

**Acceptance Criteria:**

**Given** the CI logs of the runs on 2026-10-29 and 2026-10-30
**When** the operator and dev read the five centres' log lines
**Then** the cause is recorded in `data/directory/itemkg-note.md` and fixed, or the centre is set to `reader: none` with the reason

**Given** a run in which a covered centre is skipped
**When** merge writes state
**Then** the centre records `last_skip_reason` (`robots`, `budget`, `opted-out`, `no-reader`) and `last_skip_at`, without touching its listings or `last_result`; the state schema and `stateVersion` change with it (AD-6 amended)

**Given** a centre whose last outcome was a robots skip
**When** a later run publishes without reaching it
**Then** it is still published as `not_checked`, not as covered with no result (FR12)

**Given** the first daily run after the fix
**When** the snapshot is written
**Then** each of the five centres has `last_result` `ok` or `failed`, or is `not_checked` with its recorded reason, and the ITEM KG system line adds up (`centres_ok` + `centres_failed` + skipped = `centres_covered`) (NFR6)

### Story 3.13: Coordinates for every centre, and data tests that follow the data

Added 2026-10-31 from the Epic 2 retrospective (Epic 1 follow-through, action item 9). Carries Epic 1 retrospective action items 2, 6 and P2.

As a person searching near any centre,
I want every centre placed on the map,
So that none is left as "distance unknown" or "may be nearby".

**Context:** 8 centres still have no coordinates (`bayerisches-rotes-kreuz`, `muenchner-vhs-gmbh`, `vhs-der-gemeinden-im-landkreis-roth`, `vhs-fichtelgebirge`, `vhs-kaufering`, `vhs-kreis-kronach-e-v`, `volkshochschule-eching-e-v`, `volkshochschule-kitzingen`; `data/directory/geocode-note.md`). `tests/directory.test.ts:190` still pins `toHaveLength(119)`, and `deferred-work.md` asks for a named allowlist of hand-set coordinates.

**Acceptance Criteria:**

**Given** the 8 centres
**When** this story is done
**Then** each has coordinates, either from a corrected address geocoded by `tools/geocode` or set by hand by the operator from the map, and `geocode-note.md` lists which were set by hand

**Given** `tests/directory.test.ts`
**When** it runs
**Then** a centre without a geocode-cache record passes only if it is on a named allowlist of hand-set centres, and the centre count is checked against the data (for example unique ids, every snapshot centre in the directory), not a fixed number

**Given** the search page
**When** a search runs after this story
**Then** the "N centres have no map position yet" notice no longer shows, because no centre lacks coordinates

**Given** the repository's agent instructions (AGENTS.md, set up with `bmad-project-context`)
**When** this story is done
**Then** they state: "`npm test` gates publishing. Committed-data tests derive their expectations from the files and never fail on a legitimate data change."

## Epic 4: Launch publicly

The site can be announced: legal pages are live, it's indexable, it's tested in the in-app browsers people use to open shared links, and the directory moves to the official BAMF source.

### Story 4.1: Request the official test-centre list from BAMF

As the operator,
I want the official list of Bavarian test centres from BAMF,
So that the directory rests on the authoritative source rather than a republication.

**Acceptance Criteria:**

**Given** no machine-readable BAMF list is published
**When** this story starts
**Then** an email to BAMF requesting the current list of Einbürgerungstest centres in Bavaria (ideally machine-readable) is drafted, approved by the operator and sent by the operator (FR21)

**Given** no useful answer within 4 weeks
**When** the deadline passes
**Then** an IFG request is filed via FragDenStaat, and its link is recorded in the repo

**Given** each step
**When** it happens
**Then** the date, channel and outcome are logged in the repo's operator notes, so the request can be followed up

### Story 4.2: Switch the directory to the BAMF list

As a user,
I want the directory to match BAMF's own list,
So that every official centre is included and none that closed linger.

**Acceptance Criteria:**

**Given** the official list has been received
**When** it is compared with `centres.json`
**Then** a report lists centres only in BAMF's list, only in the directory, and with differing details (FR21)

**Given** the operator reviews the report
**When** changes are applied
**Then** new centres are added (verified against their own site, geocoded via `tools/geocode`), removed centres are deleted, and each entry's `source` becomes `"bamf"` with a fresh `verified_at`; `centre_id`s of existing centres never change (AD-8)

**Given** the switch is done
**When** `tools/directory-diff` runs monthly
**Then** it compares against the BAMF source from then on (FR20)
**And** the About page's Sources section names the BAMF list

### Story 4.3: Impressum and privacy policy

As a visitor in Germany,
I want to know who runs the site and what happens to my data,
So that I can trust it, and the site meets German legal requirements.

**Acceptance Criteria:**

**Given** the operator has chosen the named operator and a deliverable postal address (blocking: SPEC open question)
**When** the Impressum page is written
**Then** it shows name, postal address and contact email in DE and EN, from translation files (FR34, NFR12)

**Given** the privacy policy page
**When** written
**Then** it states, in DE and EN: GitHub Pages hosts the site and processes visitor IP addresses; no cookies, analytics or tracking; the typed place and device location stay in the browser and are never sent (the place is kept after `#` in links, which browsers don't send); Google Maps is contacted only when "Map ↗" is tapped; centre websites open in new tabs under their own policies

**Given** both pages
**When** they exist
**Then** the footer shows Impressum and Privacy links on every page (UX-DR22)

### Story 4.4: Go live

As a person who gets the link from a friend on WhatsApp,
I want the site to work in my app's built-in browser and be findable on search engines,
So that I can use it however I arrive.

**Acceptance Criteria:**

**Given** Story 4.3 is done
**When** the site is launched
**Then** the `noindex` meta is removed, and the site is reachable at its final URL (custom domain optional) with the bot user agent's About URL still valid (NFR12, AD-5)

**Given** Flow 1 in EXPERIENCE.md (search by postcode, pick a suggestion, open "Map ↗", come back, open a result card)
**When** tested in the WhatsApp and Instagram in-app browsers on iOS and Android
**Then** it completes; new tabs open and the way back returns to the results with the search intact; any failure is fixed or recorded with a workaround (NFR9, UX-DR28)

**Given** the search, results and About pages
**When** checked before launch
**Then** they pass a WCAG AA review: contrast, keyboard-only use of Flows 1–4, screen-reader names per UX-DR23, live-region announcements, 44 px targets, reflow at 320 px / 200% zoom with the longest German strings and text-spacing overrides (NFR8)
**And** a check of network requests on page load shows only same-origin files (NFR2)
