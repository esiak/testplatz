---
name: bgtsearch
status: final
updated: 2026-10-25
sources:
  - ../../../specs/spec-einbuergerungstest-search/SPEC.md
  - ../../../specs/spec-einbuergerungstest-search/data-sources.md
  - ../../../forge/einbuergerungstest-search/forged-idea.md
---

# bgtsearch: Experience Spine

## Foundation

Responsive website, phone first. Also used on a home computer and by a friend helping on either. No UI system named [ASSUMPTION]; plain HTML controls with native behaviour. `DESIGN.md` is the visual identity reference. German and English from v1 (CAP-9); all UI text from translation files. Light and dark follow the device setting [ASSUMPTION].

Audience: foreigners who have lived in Germany for a while, B1+ German, many more comfortable in English.

## Information Architecture

| Surface | Reached from | Purpose | Spec |
|---|---|---|---|
| Search | Site open | Enter place or postcode + radius | CAP-1 |
| Results | Search submit; shared URL | Every centre in range: test dates, no-dates cards, uncovered cards; sortable | CAP-1, 2, 4, 5, 6 |
| About the data | Footer; "Why?" on an uncovered card (`#not-checked`) | How it works, per-system status, unchecked centres, sources, attribution, opt-out contact | CAP-5, 7, 8 |
| Impressum / Privacy | Footer | Legal pages (required before public launch) | SPEC constraint |

Search and Results are one page. No detail page per date: the card opens the provider's page for that date [ASSUMPTION].

Every centre in the directory within the radius appears exactly once, as one of three card types: one **result card** per current test date; a **no-dates card** if its reader's last check succeeded and found no current dates; an **uncovered card** if it has no reader, opted out (CAP-8), or its reader's last check failed (or never ran) and no dates are left to show. Past test dates are not listed.

Results URL carries place, radius, sort and language in the fragment (`#q=Neu-Ulm&r=40&sort=soonest&lang=en`) so a friend can send a link. Never the query string (the fragment never reaches the server), never coordinates. After "use my location", `q` becomes the nearest town in the built-in table, the field reads "Near Neu-Ulm", and the shareable link uses that town.

→ Composition reference: [`mockups/key-results-phone.html`](mockups/key-results-phone.html). Spines win on conflict.

### About the data: content

1. **How it works**: one paragraph: we read the centres' websites once a day; always check the centre's page before you register.
2. **Booking systems**: table, one row per system (KuferWeb, ITEM KG): centres covered, last successful run, status "Working" or "Not updated since Tue 14:00" (CAP-5).
3. **Centres not checked automatically** (`#not-checked`): why (their website uses a system we can't read yet, the centre asked us not to check it, or our last check of their site failed), then the list of those centres with links.
4. **Sources**: BAMF list of test centres; each centre's own website.
5. **Attribution**: "Place data © OpenStreetMap contributors (ODbL)"; Nominatim for centre locations.
6. **For test centres**: contact address to ask to be removed (CAP-8).

## Voice and Tone

Microcopy. Plain words, short sentences, no exclamation marks. Same meaning in DE and EN. These strings are the source for the translation files.

| Do | Don't |
|---|---|
| "Free seats" / "Booked out" / "Booked out · Waitlist" / "Status unknown" | "Hurry, only a few left!" |
| "No dates listed" | "0 results" |
| "Not checked automatically. See the centre's page." | "Not supported" |
| "Not checked right now. See the centre's page." (reader failing, no dates left) | "No dates listed" / "Error" |
| "Checked 2 h ago" / "◷ Checked Tue 14:00" | "Live" / "Warning: outdated data" |
| "vhs-guenzburg.de ↗" | "More info" / "Click here" |
| "No test centres within 20 km. Try 40 km." | "No results" |
| "Error: We don't know this place. Try a Bavarian town or postcode." | "Invalid input" |

Key-facts values: Distance "24 km" (straight line to the test address; for no-dates and uncovered cards, to the centre); Status = chip word; Deadline "11 Nov" / "Passed" / "unknown"; Registration "Online" / "Email" / "Post" / "In person" / "see website".

## Component Patterns

Behavioural. Visual specs in `DESIGN.md.Components`.

| Component | Behavioural rules |
|---|---|
| Search bar | Field accepts town name or postcode. Radius is a native select: 10 / 20 / 40 / 60 / 100 km, default 40 [ASSUMPTION]. Submit runs the search; focus stays in the field. |
| Place suggestions | ARIA 1.2 combobox on the field (`role=combobox`, `aria-expanded`, `aria-controls` → listbox, `aria-activedescendant`). Opens after 2 characters. Matches town names and postcodes from the built-in table; ignores case and umlaut spelling ("Gunzburg", "Guenzburg" → Günzburg). Max 6 rows; same-name towns show postcode and district. ↓/↑ move; Enter on a highlighted row picks it and runs the search; Escape closes. A polite status announces "3 suggestions". |
| Enter without a pick | Exactly one match (or an exact postcode) → search it. Several matches → list stays open with "Several places match. Pick one." None → place-not-found message. |
| Use my location | Hidden if the browser has no geolocation. Tap → announces "Finding your location…"; success fills the field per the IA rule and runs the search; failure → location-denied message. Location never leaves the device. |
| Result card | The whole card is one link (stretched-link) to the provider's page for that date, new tab. If the deep link was dead at last check, the card opens the centre's test page and the destination line says "Opens the centre's test page". Address line and registration note sit above the link layer: selectable, taps do nothing. |
| Address line | "Map ↗" opens Google Maps for the address, new tab. Own target, above the card link, with 8 px around it where nothing else responds. Nothing loads from Google until tapped. |
| Destination line | Shows the domain the card opens. Not a separate link. |
| Key-facts row | Four cells in fixed order: Distance, Status, Deadline, Registration. Values: see Voice and Tone. Deadline passed → "Passed"; card stays. |
| Status chip | Read-only. "Booked out · Waitlist" when the provider offers a waitlist. |
| "New" badge | On result cards first seen in the last 24 h (CAP-6). |
| Freshness line | On every result card and no-dates card: last successful check of that centre's source (CAP-3, CAP-5). Relative under 36 h; exact time with ◷ when older. The card stays in the list. |
| Count line | "N dates and M unchecked centres within R km". N counts all dates, including hidden booked-out ones. Updates after search and toggle. |
| Sort control | Radio group "Sort by": Soonest (default) and Nearest; applies on change. Soonest: dated cards by date, then distance; then section "No dates to show" with no-dates and uncovered cards by distance. Nearest: all cards by distance, then date. |
| Hide booked-out toggle | Hides only "Booked out". Never hides "Booked out · Waitlist" [ASSUMPTION], "Status unknown", no-dates or uncovered cards. Shows "4 booked-out dates hidden · Show". Focus stays on the checkbox. |
| No-dates card | Whole card opens the centre's test page. |
| Uncovered card | Whole card opens the centre's test page. "Why?" opens About the data `#not-checked`, own target. Covers reader type none and opted-out centres (CAP-8) with "Not checked automatically. See the centre's page." Also covers a covered centre whose last check failed or never ran and has no dates left, with "Not checked right now. See the centre's page." Never shows "No dates listed" for those. |
| Language switch | Switches immediately, keeps search and sort, updates `lang` in the URL fragment; focus stays on the switch. |
| Footer | On every page: About the data, Impressum, Privacy, OSM attribution. Impressum / Privacy links appear once those pages exist [ASSUMPTION: hidden in private beta]. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| First visit | Search | Field focused; h1 "Find Einbürgerungstest dates near you in Bavaria." Language from browser, switchable. |
| Place not found | Search | Field message "Error: We don't know this place. Try a Bavarian town or postcode." plus up to three "Did you mean …?" links. Keep input and focus. |
| Several places match | Search | Suggestions stay open; "Several places match. Pick one." |
| Place outside Bavaria | Search | Field message "Error: This site covers Bavaria only. You can only take the test in your own state." Same for a device location outside Bavaria. |
| Location denied / failed | Search | Field message "Error: Location not shared. Type a town or postcode instead." |
| Invalid URL | Search | Unknown `r` → nearest allowed radius. Unknown `q` → place-not-found with the text filled in. |
| Loading | Results | Up to 3 static skeleton cards; list `aria-busy`; status announces "Loading dates…" once. |
| Results | Results | Count line, sort and toggle, then cards. |
| Only unchecked or no-dates centres | Results | Count line "0 dates and 3 unchecked centres within 40 km"; notice "No dates found nearby. These centres may still have dates on their own pages." |
| No centres in radius | Results | "No test centres within 20 km." `button-secondary` "Search 40 km". |
| All dates booked out | Results | Booked-out cards shown; notice "All checked dates are booked out. Other centres may still have seats." |
| Everything hidden by toggle | Results | Notice "All 4 dates here are booked out and hidden." with "Show them". |
| Card older than 36 h | Results | Freshness line switches to exact time with ◷; no banner, no colour change. |
| Whole data load fails | Results | "We couldn't load test dates. Try again." `button-secondary` "Try again". Error colour. |
| System failing | About the data | That system's row reads "Not updated since Tue 14:00". |
| Offline | Any | Browser default; no custom offline mode in v1 [ASSUMPTION]. |

Results never re-sort or refresh while the page is open; reloading fetches new data.

## Interaction Primitives

- Tap / click a card to open its page. "Map ↗" and "Why?" are their own targets.
- External links open in a new tab, marked ↗ and announced as "new tab"; `rel="noopener"`.
- **Banned:** filters that drop items with missing data; separate "Open this date" buttons; nested links; infinite scroll that hides the count; pop-ups or cookie walls (no tracking, so none needed [ASSUMPTION]); carousels; staleness banners; custom pickers where a native control exists.

## Accessibility Floor

- Status, staleness and "new" carry text, never colour or icon alone.
- **Headings:** h1 page task; h2 "No dates to show" and About-page sections; h3 the date (or centre name) on each card. Results are a `<ul>` of cards.
- **Card link name** starts with the visible date: "Wed 9 Dec, 10:00, new, vhs Günzburg, free seats, opens vhs-guenzburg.de in a new tab". Chip and destination line are `aria-hidden` (they're in the link name). Glyphs ↗ ◷ · are `aria-hidden`; "Booked out · Waitlist" is spoken "Booked out, waitlist open".
- **Other link names:** "Map: Krankenhausstr. 40, Günzburg (Google Maps, new tab)"; "Why is Kolping Bildungswerk not checked?"; language links "Deutsch" / "English" with `lang` and `aria-current` on the active one; "Use my location" button.
- **Key-facts row** is a description list (`dl` / `dt` / `dd`). Freshness uses `<time datetime>`; "h" spoken as "hours".
- **Live regions:** one `role="status"` present from page load announces the count line after search, "Sorted by soonest/nearest" after sort, "4 booked-out dates hidden/shown" after toggle, and "Loading dates…". Field and load errors use `role="alert"`; field messages are linked with `aria-describedby` and set `aria-invalid`.
- **Keyboard:** every control reachable; focus ring per `{components.focus-ring}`; ring around the whole card when its link has focus.
- Tap targets ≥ 44 px (Map ↗, Why?, language links, segments, suggestions).
- **Reflow:** works at 320 px / 200% zoom and with WCAG text-spacing overrides, using the longest German strings.
- Skeletons are static under `prefers-reduced-motion`.
- `lang` follows the chosen language; German provider text inside English UI marked `lang="de"`.

## Responsive & Platform

- Phone (< 600 px): single column; search field on one row, radius + button on the next; sort and toggle share a row when they fit, otherwise wrap; key-facts 2 × 2 when cells would be narrower than 9em.
- Tablet / desktop: same single column, centred, max `{spacing.content-max}`; search bar on one row.
- No app; works in any modern browser. Test Flow 1 inside the WhatsApp and Instagram in-app browsers (iOS, Android): new tabs and the way back must work.

## Inspiration & Anti-patterns

- **From ImmoScout24:** the key-facts row under each listing; one search bar with location and radius (Umkreis); the whole listing is clickable.
- **Not taken from ImmoScout24:** map, filter panel, photos.
- **Rejected (from Eleni's experience):** dead links; links to a provider's homepage or site search instead of the date's page; filters that silently drop half the results because data is missing; loud warnings for old data.

## Key Flows

### Flow 1: Find a date on the train (Aylin, Neu-Ulm, phone, 7:40 on her commute)

1. Aylin opens a link to the site a friend sent; it opens in English.
2. She types "89231"; the list suggests "Neu-Ulm · 89231"; she picks it and keeps 40 km.
3. Results: "9 dates and 2 unchecked centres within 40 km".
4. Sorted Soonest (default): vhs Neu-Ulm 12 Nov, Booked out; Illertissen 27 Nov, Booked out · Waitlist; Krumbach 1 Dec; then Günzburg 9 Dec, 24 km, **Free seats**, deadline 11 Nov, registration online, "New".
5. She taps "Map ↗" to see where Günzburg's test room is, then comes back.
6. She taps the Günzburg card.
7. **Climax:** the Günzburg page for exactly that test opens, with its booking button. She didn't have to search the VHS site.

Failure: Günzburg's deep link was dead at last check → the destination line says "Opens the centre's test page" and the card goes there.

### Flow 2: A friend helps at home (Tomás and his colleague Jana, laptop, evening)

1. Jana opens the site in German; Tomás switches it to English.
2. They search "Fürth", 20 km, and see 4 dates.
3. All checked dates are booked out; one shows "Booked out · Waitlist". The notice says other centres may still have seats.
4. They open the waitlist date and put Tomás on the list.
5. Under "No dates to show" they see bfz Fürth, 6 km, "Not checked".
6. Jana taps it, opens the bfz page, and finds a date by phone.
7. **Climax:** the site told them where to look next instead of "nothing available".

Failure: the bfz page lists no dates either → Jana taps "Why?" and reads that bfz isn't checked automatically; they note to try again next week.

### Flow 3: One source is behind (Aylin, two days later)

1. Aylin reopens her saved link.
2. Most cards say "Checked 1 h ago"; the Krumbach card says "◷ Checked Tue 14:00".
3. She taps the Krumbach card and checks the page directly.
4. **Climax:** she can tell which card might be out of date, without the page shouting at her.

### Flow 4: Search by location on a phone (Mehmet, Fürth, at the bus stop)

1. Mehmet taps "Use my location"; the browser asks; he allows.
2. The field reads "Near Fürth"; results load.
3. He switches to "Nearest". vhs Fürth shows "No dates listed", checked 1 h ago.
4. **Climax:** he knows his nearest centre has nothing right now, and the next card, Erlangen, 18 km, has free seats.

Failure: he denies location → "Error: Location not shared. Type a town or postcode instead." and the field is focused.
