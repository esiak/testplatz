# bgtsearch — UX Design Validation Report

The pair is lean, in the right shape, and easy to extract: every token reference resolves, every colour has a light/dark pair, and all text pairs pass AA (re-computed independently by both reviewers; lowest 4.73:1). The core result card is fully specified in both files.

The gaps sit at the edges of the main path, and both reviewers converged on the same ones: the place-suggestion field every visit starts with has no spec; there is no focus style; control borders are 1.3:1, below the 3:1 non-text minimum; and the card layout does not reflow at 320 px. The rubric adds two coverage holes: a covered centre with no current dates silently disappears (breaking CAP-4/CAP-5), and About the data has no content or states. Fix the 7 high findings and the pair is ready to finalize; most mediums are one-line additions.

| # | Category | Verdict |
|---|---|---|
| 1 | Flow coverage | adequate |
| 2 | Token completeness | adequate |
| 3 | Component coverage | thin |
| 4 | State coverage | thin |
| 5 | Visual reference coverage | adequate |
| 6 | Bloat & overspecification | strong |
| 7 | Inheritance discipline | adequate |
| 8 | Shape fit | strong |

## 1. Flow coverage — adequate

All three flows have a named protagonist, numbered steps and a climax. CAP-1, 2, 4, 5, 6 and 9 are served; CAP-3 and CAP-7 are back-end, surfacing as freshness and About the data.

- **high** Covered centre with no current dates drops out of results (EXPERIENCE Component/State Patterns; DESIGN Components). One card per date means a centre whose reader works but lists nothing, or returned nothing, has no card. Breaks CAP-4 (never absent) and CAP-5 (flagged, not empty). *Fix:* Add a 'No dates listed' card variant (uncovered-card layout, chip, freshness line) and a 'reader failing' variant; say where each sorts.
- **medium** CAP-4 marker missing on uncovered cards in Nearest sort (EXPERIENCE Sort control; DESIGN uncovered card). The 'Not checked automatically' wording only exists as a Soonest section heading. *Fix:* Put the full marker text on the card itself.
- **medium** CAP-8 opt-out never mentioned (EXPERIENCE Uncovered card). Spec says opted-out centres show as not checked. *Fix:* Uncovered card covers reader type none and opted-out centres; decide whether 'Why?' differs.
- **medium** Registration method 'post' dropped (DESIGN key-facts row). data-sources lists online/email/post/in_person. *Fix:* Add 'Post' (and DE string) or log a mapping.
- **low** Flow 2 has no failure path; Nearest, toggle, use-my-location and Why? are unexercised (EXPERIENCE Key Flows). *Fix:* Add a failure line to Flow 2; optional short Flow 4.
- **low** Flow 1 link/typing mismatch (EXPERIENCE Flow 1 steps 1-2). A shared results link would not need typing. *Fix:* Say 'a link to the site'.

## 2. Token completeness — adequate

30 colour tokens (15 paired), 5 type roles, 3 radii, 8 spacing, 9 component blocks; every reference resolves.

- **medium** No focus-ring token (DESIGN frontmatter; EXPERIENCE Accessibility Floor). 'Visible focus on the whole card' has nothing behind it. *Fix:* Add focus-ring tokens (width, offset) and a Components line.
- **medium** Control borders 1.31:1 light / 1.43:1 dark (WCAG 1.4.11) (DESIGN search-bar, sort-control). Contrast statement covers text only. *Fix:* Add a control-border token ≥ 3:1; widen the contrast statement to non-text pairs.
- **low** Missing component tokens (DESIGN frontmatter). No status-chip variants, new-badge, button-primary blocks. *Fix:* Add them.
- **low** px font sizes contradict 'text scales with browser font size' (DESIGN Typography). *Fix:* Implement tokens as rem.
- **low** Key-facts label style undefined (DESIGN key-facts row). Mock uses 12px, below meta. *Fix:* Name the label role (meta, ink-secondary).

## 3. Component coverage — thin

The core card family has identical names and real rules in both files; edge elements are named without rows.

- **high** Place-suggestion list has no spec (EXPERIENCE Search bar; DESIGN Elevation). No keyboard/combobox rules, no disambiguation of duplicate towns ('Neustadt'), no rule for Enter without a pick, no max items. Contradicts 'the only overlay is the radius picker'. *Fix:* Add a 'Place suggestions' row to both files with ARIA combobox rules; fix the Elevation sentence.
- **medium** Named elements without rows (EXPERIENCE State Patterns; DESIGN Shapes). Skeleton card, retry button, next-radius button, section heading, notice line, inline field messages, header/footer; 'banners' mentioned in Shapes but banned. *Fix:* Add one-line rows; drop 'banners'.
- **medium** Status cell wording differs from chip (DESIGN key-facts row). Mock: Free / Waitlist / not checked; chip: Free seats / Booked out · Waitlist / Not checked. *Fix:* List exact strings or replace the Status cell.
- **low** Count line has no behaviour row (EXPERIENCE Component Patterns). Live region, plural and zero rules scattered. *Fix:* Add a row; say whether hidden dates count.
- **low** 'Why?' position and freshness scope inconsistent (DESIGN uncovered card). *Fix:* Pick one position; say 'every result card' for freshness.

## 4. State coverage — thin

Search and Results states are mostly covered; About the data and Impressum/Privacy have none.

- **high** About the data has no content or states (EXPERIENCE IA). Only place that shows per-reader status (CAP-5) and the target of 'Why?'. *Fix:* Specify per-system rows (last run, centres, failing wording), the uncovered/opted-out anchor, sources, attribution.
- **medium** Deadline passed / past dates unhandled (EXPERIENCE State Patterns). Mock shows a passed deadline. *Fix:* 'Deadline passed: cell reads passed; card stays'; 'past dates not listed'.
- **medium** Missing Results states (EXPERIENCE State Patterns). 0 dates but N unchecked centres; all cards hidden by toggle. *Fix:* Add both rows with copy.
- **medium** Missing Search states (EXPERIENCE State Patterns; IA). Several towns match; Enter without pick; geolocation unsupported or outside Bavaria; what q becomes after 'use my location'. *Fix:* Decide q (e.g. nearest table town, 'Near Neu-Ulm') and add rows.
- **medium** ODbL attribution placement on results page not stated (EXPERIENCE; DESIGN). Spec requires visible attribution. *Fix:* Footer attribution line on Results.
- **low** Impressum/Privacy and invalid URL params have no states (EXPERIENCE). *Fix:* One row each.

## 5. Visual reference coverage — adequate

One mock in .working/, linked once from EXPERIENCE with 'spines win on conflict'; no orphans.

- **low** DESIGN.md does not link the mock; it lives in scratch space (DESIGN Components). *Fix:* Promote to mockups/ at finalize and link from both files.
- **low** Mock drift (key-results-phone.html). 'Register' vs 'Registration', leftover .updated style, 'Why?' position, state name. *Fix:* Tidy at promotion.

## 6. Bloat & overspecification — strong

Both files are tight; nearly every line is a rule or a string a builder needs.

- **low** Unused stale tokens (DESIGN Colors). Defined then declared unused. *Fix:* Drop them.

## 7. Inheritance discipline — adequate

Sources resolve; CAP IDs cited; status words match data-sources; component names identical.

- **medium** Unlisted spec delta: dead-link fallback (EXPERIENCE Result card; data-sources.md). Needs link checking and a fallback/test-page URL per centre that data-sources lacks. *Fix:* Add link_ok / fallback_url fields to the spec-delta list.
- **low** CAP-4 marker string drift (Voice; key-facts cells). 'see website' vs 'See the centre's page.' *Fix:* Settle one string.
- **low** CAP-3 and CAP-8 not cited (EXPERIENCE). *Fix:* Cite on Freshness line and Uncovered card.

## 8. Shape fit — strong

DESIGN in canonical order; EXPERIENCE has every required section plus triggered Responsive and Inspiration.


## Accessibility review

Adversarial voice preserved. The colour math is honest: every text pair passes AA in both modes. Everything around it is thinner: the hard parts are one-line promises ('works at 200% zoom', 'live region', 'suggests as you type') and the mock shows some won't hold. Nothing blocks the whole site, but the place field is where every visit starts, and anxious, phone-first, second-language users are the ones who will hit these gaps. 0 critical, 4 high, 11 medium, 6 low.

- **high** Reflow fails at 320 px / 200% zoom (1.4.10) (DESIGN key-facts row, status chip; EXPERIENCE Responsive). Fixed 4-column facts row leaves ~50 px per cell; no-wrap chip overflows; sort and toggle forced onto one row. *Fix:* 4 columns only when each cell ≥ 9em, else 2×2; chip may wrap below date; toggle wraps; verify with longest German strings.
- **high** Control borders fail non-text contrast (1.4.11) (DESIGN Colors, search-bar, sort-control). Border 1.31:1 light, 1.43:1 dark; field and radius identified only by it. *Fix:* control-border token ≥ 3:1 for field, radius, segments, checkbox; keep pale border for cards.
- **high** No focus indicator (2.4.7, 2.4.11) (DESIGN; EXPERIENCE Accessibility Floor). Nothing for card, Map, Why?, segments, DE|EN, suggestions; a sticky bar could cover focus. *Fix:* 2px action ring, 2px offset; card ring via :focus-within/:has; state whether search bar is sticky (scroll-padding-top).
- **high** Typeahead has no combobox spec; conflicts with 'Enter submits' (4.1.2, 1.3.1, 2.1.1) (EXPERIENCE Search bar). *Fix:* ARIA 1.2 combobox; arrows/Enter/Escape defined; polite suggestion count; umlaut-tolerant matching; ≤ 6 suggestions, ≥ 44 px each.
- **medium** Card link name noisy and duplicated (1.3.1, 2.4.4) (EXPERIENCE Accessibility Floor). Status announced three times; ↗ ◷ · read aloud; new tab not conveyed. *Fix:* Link name starting with visible date incl. 'opens … in a new tab'; aria-hidden on chip/destination/glyphs; Status cell wording matches chip.
- **medium** 'Map ↗' and 'Why?' ambiguous and easy to miss (2.4.4, 2.5.8) (EXPERIENCE Address line). Identical names; 13 px inline target inside the card tap area. *Fix:* Descriptive accessible names; 44×44 (or 24 + spacing) target with 8 px dead zone.
- **medium** Overlay blocks copying the address and registration note (EXPERIENCE Result card). *Fix:* Layer address and note above the overlay; taps there do nothing.
- **medium** New tabs inside in-app browsers (G201) (EXPERIENCE Interaction Primitives, Flow 1). WhatsApp/Instagram webviews may lose the way back. *Fix:* Say 'new tab' in names; rel=noopener; test Flow 1 in in-app browsers.
- **medium** Live region underspecified (4.1.3) (EXPERIENCE Accessibility Floor). Re-rendered regions don't announce; sort/toggle/loading/errors undefined. *Fix:* One persistent role=status; announce count, sort, toggle, loading; errors role=alert.
- **medium** Field errors not tied to the field (3.3.1, 3.3.3) (EXPERIENCE State Patterns). *Fix:* aria-describedby + aria-invalid, alert, keep focus, offer up to 3 near matches, 'Error' prefix in error colour.
- **medium** Headings and focus after search undefined (2.4.3, 1.3.1) (EXPERIENCE). *Fix:* h1 site/task, h3 per card, h2 section; focus stays in field; results as a list.
- **medium** Sort control and radius overlay lack semantics (4.1.2) (DESIGN Elevation; EXPERIENCE Foundation). Custom overlay contradicts 'native controls'; segments 36 px. *Fix:* Native select for radius; sort as fieldset + radios, min-height 44 px.
- **medium** Language switch unclear (3.1.2, 2.5.8) (DESIGN Language switch). 14 px 'DE | EN' links. *Fix:* Accessible names 'Deutsch'/'English' with lang, aria-current, ≥ 44 px.
- **medium** 'Use my location' unlabelled glyph (DESIGN Search bar). *Fix:* Real button 'Use my location', 44×44, progress and denied announcements.
- **medium** Fixed heights and px fonts (1.4.4, 1.4.12) (DESIGN Typography, Components). *Fix:* rem type; min-height instead of height; test text-spacing with German strings.
- **low** Key-facts row should be a description list (1.3.1) (DESIGN key-facts row). *Fix:* dl/dt/dd; align 'Registration' label.
- **low** Freshness has no machine-readable time (DESIGN freshness line). *Fix:* <time datetime>, spoken 'hours'.
- **low** 'New' badge and destination line look like separate links (DESIGN). *Fix:* 'New' in ink-primary; include 'New' in link name.
- **low** Card boundary 1.31:1 hides tappability (DESIGN result-card). Passes 1.4.11 via text. *Fix:* Acceptable with focus/hover ring.
- **low** Reduced motion and auto-update not stated (EXPERIENCE). *Fix:* Static skeletons under reduced motion; results never refresh while open.
- **low** Focus when toggle hides cards (EXPERIENCE). *Fix:* Focus stays on the checkbox, which sits above the list.

## Mechanical notes

- Name drift: 'Registration' (DESIGN) vs 'Register' (mock); sort labels 'Soonest | Nearest' vs 'Soonest first' in memlog; uncovered marker strings vary.
- Component count: memlog says 12; DESIGN prose 13, frontmatter 9, EXPERIENCE 12 (no Count line).
- DESIGN Elevation says the only overlay is the radius picker; EXPERIENCE has a suggestion list and native controls.
- Contrast verified for text (min 4.73:1 light, 6.15:1 dark); non-text pairs and focus not covered.

Sources: review-rubric.md, review-accessibility.md. Generated 2026-10-25.
