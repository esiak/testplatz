# Spine Pair Review — bgtsearch

Reviewed 2026-10-25: DESIGN.md (184 lines), EXPERIENCE.md (141 lines), .memlog.md (31 entries), .working/key-results-phone.html, against SPEC.md, data-sources.md, forged-idea.md. Known deltas (two sorts with Soonest default, waitlist status, address + Google Maps link) and the open [ASSUMPTION] tags are noted, not penalised.

## Overall verdict

The pair is lean, sits in the right shape, and is easy to extract: every token reference resolves, every colour has a light/dark pair, all text pairs pass AA (re-computed), and the core results card is fully specified in both files. The gaps are on the edges of the main path. Nothing says what a covered centre with no current dates looks like (this risks breaking CAP-4/CAP-5 "a gap never reads as nothing available"). "About the data" has a purpose but no content or states. The search-field suggestion list, which every flow starts with, has no behaviour or visual spec. Fix those three and the pair is ready to finalize.

## 1. Flow coverage — adequate

Checked: CAP-1..CAP-9, the SPEC constraints and the data-sources fields, against the Key Flows, Component Patterns and State Patterns. All three flows have a named protagonist, a context, numbered steps and a bold climax. CAP-1 (Flow 1), CAP-2 (card + key-facts row), CAP-4 (Flow 2), CAP-5 (Flow 3 + freshness line), CAP-6 ("New" badge, Flow 1) and CAP-9 (Flow 2 step 1, language switch) are served. CAP-3 and CAP-7 are back-end work; their UX side shows up as freshness and the About page. The location-never-leaves-the-browser constraint is served (Search bar, IA URL rule).

### Findings
- **high** Nothing covers a *covered* centre that currently has no listed dates, either because none are published or because its reader returned nothing. With one card per date, such a centre just drops out of the results. That breaks CAP-4 ("no directory centre within the radius is ever absent") and CAP-5 ("returns nothing unexpectedly → flagged stale rather than shown as … empty"). (EXPERIENCE.md Component Patterns, State Patterns; DESIGN.md Components.) *Fix:* add a "centre, no dates found" card variant: same layout as the uncovered card, a chip such as "No dates listed", and a freshness line. Add a second variant for "reader failing" (last successful check shown with ◷). Say where each sorts under Soonest and Nearest.
- **medium** In Nearest sort, the CAP-4 marker "not checked automatically, see website" is not on the card. The heading "Not checked automatically" only appears in Soonest (EXPERIENCE.md Sort control, line 61). In Nearest the uncovered cards sit between dated cards and carry only the "Not checked" chip (DESIGN.md line 166, 169). *Fix:* put the full marker text on the card itself (chip or a line under the facts), so it holds in both sorts.
- **medium** CAP-8 (opt-out) appears nowhere. The spec says an opted-out centre "shows as 'not checked automatically'". *Fix:* one line in Uncovered card patterns: "Covers reader type none and opted-out centres." Also say whether the "Why?" text differs between the two.
- **medium** CAP-2 registration method drops `post`. data-sources.md lists online / email / post / in_person, but the Key-facts row allows only "online / email / in person" (DESIGN.md line 165). *Fix:* add "Post" (and its DE string), or decide on purpose that post maps to something else and log it.
- **low** Flow 2 has no failure path (for example, the uncovered centre's page has no dates, or the waitlist link is dead). No flow exercises Nearest, the hide-booked-out toggle, "use my location", or "Why?" → About the data. *Fix:* add a failure line to Flow 2. Optionally add a short Flow 4 for "use my location" → Nearest → "Why?".
- **low** Flow 1 steps 1–2: the friend's link "opens in English", but Aylin then types her postcode. So the link was a home link carrying `lang`, not a results link. *Fix:* say "a link to the site", or start her on results.

## 2. Token completeness — adequate

Checked: 30 colour tokens (15 light + 15 `-dark`, all hex, all paired), 5 typography roles, 3 radii, 8 spacing tokens, 9 component token blocks. Every `{path}` reference resolves. In DESIGN prose: `{colors.ink-secondary}`, `{colors.border}`, `{colors.action}`, `{colors.ink-primary}`, `{colors.surface-muted}`, `{spacing.gutter-mobile}`, `{spacing.content-max}`, `{rounded.md|sm|full}`. In frontmatter: `{typography.title.fontFamily}` and all component refs. In EXPERIENCE: `{spacing.content-max}`. Text contrast was re-computed and the claim holds: the lowest pair is free/free-bg at 4.73:1, and dark mode is ≥ 6.15:1.

### Findings
- **medium** There is no focus-indicator token, even though the Accessibility Floor requires "visible focus on the whole card when its link has focus" (EXPERIENCE.md line 93). *Fix:* add `focus-ring` / `focus-ring-dark` (with width and offset) and a Components line saying the card outline uses it.
- **medium** `{colors.border}` is the only boundary for the search field, radius picker and sort control (DESIGN.md frontmatter `search-bar`, `sort-control`; mock `.field`, `.radius`, `.seg`). It measures 1.31:1 in light and 1.43:1 in dark, below the WCAG 1.4.11 minimum of 3:1 for control boundaries. The contrast statement (line 131) covers text pairs only. *Fix:* add a `border-control` token (≥ 3:1) for inputs and segments, and widen the contrast line to name the non-text pairs.
- **low** The `status-chip` frontmatter has no per-variant colour mapping (free / booked / unknown → token pairs). "New" badge, count line, hide-booked-out toggle, language switch and the buttons (search, retry, next radius; text-on-action colour) have no component tokens. *Fix:* add `variants` under `status-chip`, plus `new-badge` and `button-primary` blocks.
- **low** Font sizes are in px, but the prose says "Text scales with the browser's font size" (DESIGN.md line 145). px ignores the user's font-size setting. *Fix:* say tokens are implemented as rem (16px = 1rem).
- **low** The key-facts label style is undefined. The mock uses 12px, below the `meta` role. *Fix:* name the label role (`meta`, `{colors.ink-secondary}`).

## 3. Component coverage — thin

Checked: every component named in DESIGN Components (13), DESIGN frontmatter (9), EXPERIENCE Component Patterns (12), State Patterns, Accessibility, Flows and the mock. The core card family has identical names and real rules in both files. Around the edges, many elements are named but have no rows.

### Findings
- **high** The search-field suggestion list (EXPERIENCE.md line 53: "suggests matching Bavarian towns/postcodes … as you type") has no visual row and no behavioural rules. Missing: keyboard navigation and combobox semantics, how duplicate town names are disambiguated (Bavaria has many "Neustadt"s), what Enter does without a pick, and max items. Every flow starts here. It also contradicts "The only overlay is the radius picker" (DESIGN.md line 153), and the radius picker is meant to be a native control (EXPERIENCE Foundation). *Fix:* add a "Place suggestions" row to both files and an a11y line (ARIA combobox/listbox). Correct the Elevation sentence.
- **medium** These elements are named but have no visual or behavioural row: skeleton card (State Patterns line 80), retry button (line 77), next-radius button (line 74), the "Not checked automatically" section heading (line 61), the notice line "All checked dates are booked out…" (line 75), inline field messages (lines 71, 72, 78; colour unspecified, since error colour is "only here"), footer and header/site title. Shapes mentions "banners" (DESIGN.md line 157), but no banner component exists and banners are banned for staleness. *Fix:* add short rows. Most are one line each ("Notice line: `body`, `ink-primary`, no background").
- **medium** The Key-facts Status cell duplicates the chip with different, unspecified words. The mock shows "Free" / "Waitlist" / "not checked", the chips say "Free seats" / "Booked out · Waitlist" / "Not checked" (DESIGN.md line 165–166). Translators and story-dev need the exact strings. *Fix:* list the cell strings, or replace the Status cell with something not already on the card (the reading order already lists status once).
- **low** Count line has a DESIGN row but no EXPERIENCE Component Patterns row. Its live-region, pluralisation and zero-case rules are spread across State Patterns and the Accessibility Floor. *Fix:* add a row, including whether hidden booked-out dates count toward "12 dates".
- **low** Where "Why?" sits on the uncovered card: DESIGN says "sits under the facts" (line 169), the mock puts it in the bottom row where the freshness line goes. DESIGN also says the freshness line is "on every card" (line 167), but the uncovered card has none. *Fix:* pick one position, and say "every result card" for freshness.

## 4. State coverage — thin

Checked per surface. Search: first visit, not found, outside Bavaria, location denied. Results: loading, results, no centres, all booked out, stale card, load failure, offline. About the data: none. Impressum / Privacy: none.

### Findings
- **high** About the data has a purpose line only (EXPERIENCE.md line 25: "Coverage, per-system last check, sources, attribution"). It has no content structure and no states. It is the only place that serves CAP-5's "failing reader is shown as failing" and the forge's "last checked … per reader", and it is the target of "Why?". *Fix:* add a short section or State rows covering per-system rows (KuferWeb / ITEM KG: last successful run, centres covered, failing state wording), the uncovered and opted-out explanation that "Why?" lands on (anchor), sources, and ODbL / Nominatim attribution.
- **medium** No treatment for a date whose registration deadline has passed but whose test is still upcoming. The mock shows a 15 Oct deadline against a 25 Oct "today". Also unstated: past test dates disappear. *Fix:* add a State row, for example "Deadline passed: Deadline cell reads 'passed'; card stays", and "Past dates are not listed".
- **medium** Missing Results states: "0 dates and N unchecked centres" (only uncovered centres in range), and every card hidden by the toggle (empty list plus "4 booked-out dates hidden"). *Fix:* add both rows with copy.
- **medium** Missing Search states: a submitted text that matches several towns, Enter without picking a suggestion, geolocation unsupported, and geolocation result outside Bavaria. The IA (line 30) bans coordinates in the URL but does not say what `q` becomes after "use my location" (nearest town? no shareable URL?). That decides whether such a search can be shared. *Fix:* decide it: for example "`q` becomes the nearest table town; field shows 'Near Neu-Ulm'". Add the missing rows.
- **medium** The SPEC requires *visible* ODbL attribution. The spines put attribution only on About the data and in `meta` usage (DESIGN.md line 143), with no stated placement on the search/results page. *Fix:* put a footer attribution line on the Results page and describe it.
- **low** Impressum / Privacy have no states. Undecided: are the footer links hidden in private beta (SPEC allows launch without them)? What must Privacy mention (geolocation stays on the device, the Google Maps link loads nothing until tapped)? There is also no state for invalid shared-URL params (`r` not in the list, unknown `q`). *Fix:* one row each.

## 5. Visual reference coverage — adequate

The workspace has `.working/key-results-phone.html` only; there is no `mockups/`, `wireframes/` or `imports/`. EXPERIENCE.md links it inline once and states "Spines win on conflict" (line 32). No orphans.

### Findings
- **low** DESIGN.md never links the mock, although the mock's header says it governs DESIGN Components. The link points into `.working/`, which is scratch space. *Fix:* at finalize, promote it to `mockups/key-results-phone.html`, update the link, and add the same reference line to DESIGN.md Components.
- **low** The mock drifts from the spines. Its key-facts label says "Register" (spine: "Registration"), "Why?" is in the bottom row, the title says "revision 4" while the memlog says revision 2, a `.updated` style is left over from the dropped global line, and the header comment names the state "Card older than update" (spine: "Card older than 12 h"). The spines win, but a consumer copying from the mock would pick these up. *Fix:* tidy at promotion.

## 6. Bloat & overspecification — strong

Both files are tight. Nearly every line is a rule or a string a builder needs, and Flow mock data is kept to what the climax needs.

### Findings
- **low** The `stale` / `stale-bg` tokens (and `-dark`) are defined and then declared unused (DESIGN.md line 128). *Fix:* drop them; the memlog already records the decision.

## 7. Inheritance discipline — adequate

All three `sources:` paths resolve from the workspace. CAP IDs are cited in the IA table. Status words match data-sources (`free` / `booked_out` / `unknown`), with waitlist as a known delta. Component names are identical across DESIGN prose and EXPERIENCE, and all token refs resolve. CAP-1's "directions link" is now an address + Google Maps location link (known delta).

### Findings
- **medium** One delta that is not on the known list: the dead-deep-link fallback (EXPERIENCE.md line 54, Flow 1 failure path) assumes the collector checks each date's link and stores a fallback "centre test page" URL. data-sources.md has no such field (only `source_url`), and the memlog spec-impact note (line 28) does not list it. That is architecture work. *Fix:* add it to the spec-delta list: a `link_ok` / `fallback_url` field, plus a per-centre test-page URL in the directory.
- **low** The CAP-4 marker wording drifted: the spec says "not checked automatically, see website", Voice says "…See the centre's page.", and the key-facts cells say "see website". Memlog line 28 says CAP-5 freshness is "shown only when stale", which line 31 later overrides. Make sure the spec push uses the newest entry. *Fix:* settle one string. Note the line 31 override in the spec-push checklist.
- **low** CAP-3 and CAP-8 are not cited anywhere in EXPERIENCE. *Fix:* cite CAP-8 on Uncovered card and CAP-3 on Freshness line.

## 8. Shape fit — strong

DESIGN.md is in canonical order: Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts. Its frontmatter has name, description, colors, typography, rounded, spacing and components. EXPERIENCE.md has every required section (Foundation, Information Architecture, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows), plus Responsive & Platform (triggered: phone + desktop) and Inspiration & Anti-patterns (triggered: ImmoScout24), in the same order as the shadcn example. Frontmatter: name, status, updated, sources. No findings.

## Mechanical notes

- **Name drift:** "Registration" (DESIGN) vs "Register" (mock). Sort labels: "Soonest | Nearest" in the spines vs "Soonest first / Nearest first" in memlog lines 27 and 30 (the spines win, but confirm). Uncovered marker strings vary (see §7).
- **Component count:** the memlog says "12 components" (line 18). DESIGN prose has 13, frontmatter has 9, EXPERIENCE Component Patterns has 12 (no Count line). Frontmatter keys missing for: "New" badge, count line, hide-booked-out toggle, language switch.
- **Cross-refs:** all `{token}` refs resolve. "`DESIGN.md.Components`" (EXPERIENCE line 49) is fine as a pointer but is not a link. The `.working/` link resolves.
- **Frontmatter:** DESIGN.md has no `sources:` (the examples don't require one). Both files are `status: draft` and `updated: 2026-10-25`, consistent.
- **Contrast:** the text-pair claim was verified (min 4.73:1 light, 6.15:1 dark). Non-text pairs (border 1.31:1 / 1.43:1) and focus are not covered (§2).
- **Internal inconsistency:** DESIGN Elevation says "The only overlay is the radius picker". EXPERIENCE has a typed suggestion list and native controls (§3).
