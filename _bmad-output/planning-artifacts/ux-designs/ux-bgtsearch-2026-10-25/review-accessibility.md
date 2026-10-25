# Accessibility Review — bgtsearch

## Verdict

The colour math is honest: every text pair really does pass AA in both modes. Everything around it is thinner. The spines put the hard parts in one-line promises ("works at 200% zoom", "live region", "suggests as you type") without saying how, and the mock shows that some of them won't hold: the four-column facts row and the no-wrap chips can't reflow at 320 px, the field borders are 1.3:1, there's no focus style, and the typeahead says nothing about combobox semantics while the spec also says "Enter submits". None of this blocks the whole site, but the place field is where every visit starts, and the anxious, phone-first, second-language users this site is for are the ones who'll hit these gaps.

## Findings

- **[high]** Reflow fails at 320 CSS px / 200% zoom (1.4.10). The key-facts row is a fixed 4-column grid (`repeat(4,1fr)`). At 320 px, with a 16 px gutter and 16 px card padding, each cell gets about 50 px of content width, which is too narrow for "Registration" (or the mock's "Register"), "see website" or "Booked out" at 15 px. The status chip is `white-space:nowrap` and sits beside an 18 px date, so "Fri 27 Nov, 09:00" plus "Booked out · Waitlist" (about 310 px) overflows the roughly 256 px available. The sort control and "Hide booked out" are also forced onto one row (EXPERIENCE.md, Responsive: "Sort control and toggle share one row"). The result is horizontal scroll or clipped values on exactly the cards that matter (DESIGN.md, Components: key-facts row, status chip; EXPERIENCE.md, Responsive & Platform; .working/key-results-phone.html `.facts`, `.chip`, `.controls`). *Fix:* in DESIGN.md, specify that the key-facts row is 4 columns only when each cell has ≥ 9 em, otherwise 2×2 (e.g. `repeat(auto-fit,minmax(9em,1fr))`). The chip may wrap below the date (the top row is `flex-wrap:wrap`) and the chip text may wrap. In EXPERIENCE.md, change the rule to "Sort control and toggle share a row when they fit; otherwise the toggle wraps below." Add a line to the Accessibility Floor: "Verified at 320 px wide with the longest DE strings" (German labels are longer: "Anmeldeschluss", "Ausgebucht · Warteliste").

- **[high]** Input, radius picker and segmented-control borders fail non-text contrast (1.4.11). `border` #DDE1E6 is 1.31:1 on white and 1.20:1 on muted; `border-dark` #2E343B is 1.43:1 on base. The place field and the radius picker are identified only by that border, so for low-vision users in sunlight on a phone the search field is invisible (DESIGN.md, Colors and Components: search-bar, sort-control). *Fix:* add a `control-border` token of about #7A838F light (≥ 3:1 on both surfaces; verify) and about #6B7480 dark (verify ≥ 3:1 on #14171B and #1E2227). Use it for the field, the radius picker, the segmented-control outline and the checkbox. Keep the pale `border` for card dividers only.

- **[high]** No focus indicator is specified anywhere (2.4.7, 2.4.11). EXPERIENCE.md promises "visible focus on the whole card", but DESIGN.md has no focus token, and the card border it would build on is 1.31:1. Nothing covers focus on Map ↗, Why?, the segments, DE|EN or the suggestions list either. "The search bar stays at the top of the results page" could also mean a sticky bar that covers focused cards while tabbing (DESIGN.md, Layout & Spacing; EXPERIENCE.md, Accessibility Floor). *Fix:* add a DESIGN.md token `focus-ring: 2px solid {colors.action}, offset 2px` (6.67:1 / 8.53:1 on base, ≥ 6:1 on muted). Card: `:has(a:focus-visible)` / `:focus-within` draws that ring on the card. Inner links get their own ring, and the card ring is suppressed while an inner link has focus. State in the spec whether the search bar is sticky. If it is, add `scroll-padding-top` equal to its height.

- **[high]** The place/postcode typeahead has no interaction or semantics spec, and it conflicts with "Enter submits the search" (4.1.2, 1.3.1, 2.1.1). Nothing says whether this is an ARIA 1.2 combobox, how suggestions are announced, how arrow keys and Escape behave, what Enter does while a suggestion is highlighted, or whether picking a suggestion runs the search. Screen-reader users on iOS and Android often hear nothing when suggestions appear. Keyboard users risk submitting a half-typed "8923" and landing on "place not found" (EXPERIENCE.md, Component Patterns: Search bar; Interaction Primitives). *Fix:* add to EXPERIENCE.md: "Place field is a combobox (`role=combobox`, `aria-expanded`, `aria-controls` → `listbox`, `aria-activedescendant`). Down/Up move through suggestions, Enter on a highlighted suggestion picks it and runs the search, Enter with none highlighted submits the typed text, Escape closes the list. A polite status message gives the suggestion count ('3 suggestions'). Matching ignores umlauts and the ue/ü spelling ('Gunzburg', 'Guenzburg' → Günzburg). At most 6 suggestions, each ≥ 44 px tall."

- **[medium]** The stretched-link card produces duplicate and noisy screen-reader output (1.3.1, 2.4.4). The link name "date, centre, status, opens vhs-guenzburg.de" is followed by the visible date, chip, centre, the Status cell (shown as "Free", not "Free seats") and the destination, so status is announced three times. The ↗, ◷ and · glyphs are read aloud ("north east arrow", "white circle with upper left quadrant", "middle dot"). "Opens in a new tab" is never conveyed (EXPERIENCE.md, Accessibility Floor; DESIGN.md, Components). *Fix:* the link's `aria-label` (or a visually hidden span) should be "Wed 9 Dec, 10:00, vhs Günzburg, free seats, opens vhs-guenzburg.de in a new tab". It must start with the visible date text to satisfy 2.5.3. Mark the chip and the destination line `aria-hidden="true"` because they are repeated in the link name. Keep the Status cell visible but make its wording match the chip. Wrap ↗, ◷ and · in `aria-hidden` spans, and use "Booked out, waitlist open" as the spoken text.

- **[medium]** "Map ↗" and "Why?" links are ambiguous in link lists and voice control, and a missed tap opens the wrong page (2.4.4, 2.5.8). Every card has an identical "Map ↗". "Why?" makes no sense out of context. Map ↗ is inline 13 px text inside the card's tap area, so a near-miss opens the provider page in a new tab. "Padded to 44 px" on an inline meta link will overlap the address and facts row lines (EXPERIENCE.md, Address line, Accessibility Floor; DESIGN.md, Address line). *Fix:* use accessible names "Map: Krankenhausstr. 40, Günzburg (Google Maps, new tab)" and "Why is Kolping Bildungswerk not checked?". Both start with the visible word, per 2.5.3. Put Map ↗ at the end of the address line as an inline-block of at least 44×44 px (or at least 24×24 px with 12 px clear of other text), and give it an 8 px dead zone where the card link doesn't respond (the underlying card stays a link, but nothing else clickable sits within 8 px of it).

- **[medium]** The stretched-link overlay blocks text selection and copying of the address and registration note. Users copying "Krankenhausstr. 40" into DB Navigator, or the German registration note into a translator, can't select it, and a long-press shows the link menu instead (EXPERIENCE.md, Result card). *Fix:* layer the address line and the registration note above the overlay (`position:relative; z-index:1`) so they aren't part of the link's hit area. Taps on them do nothing, and the rest of the card still opens the page.

- **[medium]** External links always open new tabs with no spoken warning, and Flow 1 starts in a friend-sent link, i.e. inside an in-app browser (G201, 3.2.5 advisory). In WhatsApp or Instagram webviews, `target=_blank` often replaces the view or hides the way back, which breaks "taps Map ↗, then comes back" (EXPERIENCE.md, Interaction Primitives, Flow 1). *Fix:* keep new tabs but say so in the accessible name ("new tab"). Add `rel="noopener"`. Test Flow 1 in the WhatsApp and Instagram in-app browsers on iOS and Android, and note the result in EXPERIENCE.md.

- **[medium]** The live-region spec is underspecified and likely to misfire (4.1.3). If the count line is re-rendered together with the results, it won't be announced. Sorting doesn't change the count, so announcing it again is just noise. The "4 booked-out dates hidden" line and the loading state aren't announced at all. Errors ("place not found", "couldn't load") aren't mentioned (EXPERIENCE.md, Accessibility Floor, State Patterns). *Fix:* use one persistent `role="status"` element present from page load. On search it announces the count line. On sort it announces "Sorted by soonest". On toggle it announces "4 booked-out dates hidden" or "shown". While loading it announces "Loading dates…" once, with `aria-busy` on the list. Errors use `role="alert"`.

- **[medium]** "Place not found" and "outside Bavaria" are not tied to the field (3.3.1, 3.3.3). "Keep input" is good, but there's no `aria-invalid`, no `aria-describedby`, no announcement, and no suggestion of near matches (EXPERIENCE.md, State Patterns). *Fix:* show the message under the field as `aria-describedby` text, set `aria-invalid="true"`, announce it through `role="alert"`, keep focus in the field, and offer up to three closest Bavarian places as links ("Did you mean Günzburg?"). Prefix the message with an icon plus the word "Error"/"Fehler" and the `error` colour, which passes 6.54:1 and 10.53:1. That extends the error colour's scope, which is fine because this is a real error.

- **[medium]** Focus and heading structure after a search are undefined (2.4.3, 1.3.1, 2.4.6). There's no h1, no rule for heading levels on the date heading, and "Not checked automatically" is a styled div in the mock. It's also not said where focus goes after submit or after a language switch reloads the strings (EXPERIENCE.md, State Patterns, Language switch; mock `.section`). *Fix:* specify: h1 is the site name or task line, each card date (or centre name on uncovered cards) is h3, and "Not checked automatically" is h2. Focus stays in the search field after submit, and the live region announces the count. A language switch keeps focus on the switch. Results are a `<ul>` of cards so SR users hear "list, 11 items".

- **[medium]** The segmented sort control and the radius picker overlay have no semantics (4.1.2, 2.1.1). A custom "overlay" radius picker on phones contradicts "plain HTML controls with native behaviour" (DESIGN.md, Elevation; EXPERIENCE.md, Foundation). *Fix:* use a native `<select>` for the radius, which also gives the native picker on phones, and drop the overlay. Build the sort control as a `fieldset` with legend "Sort by" and two radio inputs styled as segments, applied on change. Segments use min-height 44 px, not a fixed `height:36px`, to meet the spine's own 44 px floor.

- **[medium]** The language switch "DE | EN" is a pair of 14 px text links with unclear state and pronunciation (3.1.2, 4.1.2, 2.5.8). *Fix:* use links "Deutsch" `lang="de" hreflang="de"` and "English" `lang="en"`, with `aria-current="true"` on the active one, a ≥ 44 px target each, and a visible label that can stay "DE | EN" provided the accessible names are the full language names. That's still label-in-name-safe if the visible text is included ("DE, Deutsch").

- **[medium]** "Use my location" is an unlabelled glyph button inside the field, with undefined size and feedback (4.1.2, 2.5.8, 4.1.3). The mock uses a bare "⌖". *Fix:* a real `<button>` with name "Use my location", a 44×44 px hit area inside the 48 px field, and the field's right padding increased to match. While locating it announces "Finding your location…". On success the field reads "Your location", and the denied message is announced through the error pattern above.

- **[medium]** Fixed heights and px font sizes undermine text resize and text spacing (1.4.4, 1.4.12). The field and button are `height:48px` and the segments `height:36px`. The type tokens are in px, yet DESIGN.md claims "Text scales with the browser's font size", but px fonts ignore the browser's default font-size setting (DESIGN.md, Typography, Components). *Fix:* express type in rem (16px = 1rem). Change component `height` to `min-height` and let lines wrap. Test with the 1.4.12 bookmarklet (line-height 1.5, letter-spacing 0.12 em, word-spacing 0.16 em) on the German strings.

- **[low]** Key-facts row should be a description list (1.3.1). *Fix:* `<dl class="facts">` with `<div><dt>Distance</dt><dd>24 km</dd></div>` ×4. Labels come before values in the DOM, matching the visual. Align the label name across files: "Registration" (DESIGN.md) vs "Register" (mock). The Accessibility Floor reading order omits the Status cell, so either list it or state that it's spoken via the link name.

- **[low]** The freshness line has no machine-readable time, and "2 h" is read as "2 h" (1.3.1). *Fix:* use `<time datetime="2026-10-25T13:40">Checked 2 h ago</time>` with a visually hidden "2 hours", and in German "vor 2 Std." / "2 Stunden". For older entries use an exact weekday and time with `aria-hidden` on ◷. Spell out "Tue" in the accessible name only if testing shows confusion.

- **[low]** The "New" badge and the destination line use the link colour without being links. Blue "vhs-guenzburg.de ↗" and blue "New" look like separate tap targets, which makes users aim for them (affordance, not a WCAG fail). *Fix:* render the "New" badge in `ink-primary` on `surface-muted` (15.18:1). The destination line can stay blue, since tapping it opens the card's link anyway. Put "New" in the link name ("New: Wed 9 Dec…").

- **[low]** The card boundary is 1.31:1. That passes 1.4.11 because the date text identifies the link, but users don't see that the card is tappable. *Fix:* acceptable as is if the focus/hover state uses the focus ring. Optionally use `control-border` on hover.

- **[low]** Reduced motion and auto-update aren't stated (2.3.3 advisory, 2.2.2). Skeleton loaders often shimmer. *Fix:* add "Skeletons are static under `prefers-reduced-motion: reduce`" and "Results never re-sort or refresh while the page is open; reload to update" (which also means no timeouts, which is already true).

- **[low]** Hidden booked-out cards and focus. If a user turns on the toggle after tabbing into the list, it's undefined where focus goes. *Fix:* focus stays on the checkbox. The toggle is above the list, so state that it is never moved below the cards.

## Contrast table

Computed from the DESIGN.md hex values (WCAG 2.x relative luminance).

| Pair | Ratio | Needs | Result |
|---|---|---|---|
| L ink-primary #1B1F24 / base #FFFFFF | 16.56 | 4.5 | pass |
| L ink-primary / muted #F4F5F7 | 15.18 | 4.5 | pass |
| L ink-secondary #5A6370 / base | 6.08 | 4.5 | pass |
| L ink-secondary / muted (fact labels) | 5.57 | 4.5 | pass |
| L action #0B5CAD / base | 6.67 | 4.5 | pass |
| L action / muted ("New" badge) | 6.11 | 4.5 | pass |
| L base / action (Search button text) | 6.67 | 4.5 | pass |
| L free #1E7A3E / free-bg #E6F4EA | 4.73 | 4.5 | pass (lowest; author's figure confirmed) |
| L booked #5A6370 / booked-bg #EEF0F2 | 5.32 | 4.5 | pass |
| L unknown #8A5A00 / unknown-bg #FFF4D6 | 5.41 | 4.5 | pass |
| L error #B3261E / base | 6.54 | 4.5 | pass |
| L base / ink-primary (selected segment) | 16.56 | 4.5 | pass |
| D ink-primary #ECEEF1 / base #14171B | 15.47 | 4.5 | pass |
| D ink-primary / muted #1E2227 | 13.76 | 4.5 | pass |
| D ink-secondary #A3ABB5 / base | 7.75 | 4.5 | pass |
| D ink-secondary / muted | 6.89 | 4.5 | pass |
| D action #7DB7F5 / base | 8.53 | 4.5 | pass |
| D action / muted ("New") | 7.59 | 4.5 | pass |
| D base / action (Search button text) | 8.53 | 4.5 | pass |
| D free #7BD596 / free-bg #16301F | 7.99 | 4.5 | pass |
| D booked #A3ABB5 / booked-bg #262B31 | 6.15 | 4.5 | pass |
| D unknown #F2C86B / unknown-bg #3A2E10 | 8.40 | 4.5 | pass |
| D error #F2B8B5 / base | 10.53 | 4.5 | pass |
| D base / ink-primary (selected segment) | 15.47 | 4.5 | pass |
| **Non-text** | | | |
| L border #DDE1E6 / base (field, radius, segments, card) | 1.31 | 3.0 | **fail** for controls |
| L border / muted | 1.20 | 3.0 | **fail** |
| D border #2E343B / base | 1.43 | 3.0 | **fail** for controls |
| D border / muted | 1.27 | 3.0 | **fail** |
| L checkbox border (mock: ink-secondary) / base | 6.08 | 3.0 | pass (mock only; spec says native, so set `accent-color`) |
| D checkbox border (ink-secondary) / base | 7.75 | 3.0 | pass |
| L proposed focus ring (action) / base, muted | 6.67 / 6.11 | 3.0 | pass |
| D proposed focus ring (action) / base, muted | 8.53 / 7.59 | 3.0 | pass |
| L chip tint free-bg / base | 1.14 | n/a | chip tint is decorative; the word carries status, so OK |

## What's already good

- Every status has a word. Booked out is grey, not red. The error colour is reserved for real errors. Keep all three.
- All text pairs pass AA in both modes, including the tinted chips. The dark palette has comfortable margins.
- Stretched-link pattern with real, non-nested Map/Why links, and a defined SR reading order. Right pattern, it just needs the details above.
- `lang="de"` on German provider text inside the English UI is already called out.
- No cookie wall, no pop-ups, no timeouts, no infinite scroll, no carousels. Each of those is an accessibility trap avoided.
- Missing data reads "unknown" instead of a blank cell, which screen-reader users would otherwise hear as nothing.
- Shareable URL with language included, which helps the "friend helps" flow and assistive-tech users who re-open a known state.
