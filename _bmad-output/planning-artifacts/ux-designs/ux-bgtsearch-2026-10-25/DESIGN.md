---
name: bgtsearch
description: Einbürgerungstest date search for Bavaria. Plain, factual, phone-first. Every fact shows how fresh it is.
status: final
updated: 2026-10-30
colors:
  surface-base: '#FFFFFF'
  surface-muted: '#F4F5F7'
  ink-primary: '#1B1F24'
  ink-secondary: '#5A6370'
  border: '#DDE1E6'
  control-border: '#7A838F'
  action: '#0B5CAD'
  status-free: '#1E7A3E'
  status-free-bg: '#E6F4EA'
  status-booked: '#5A6370'
  status-booked-bg: '#EEF0F2'
  status-unknown: '#8A5A00'
  status-unknown-bg: '#FFF4D6'
  error: '#B3261E'
  surface-base-dark: '#14171B'
  surface-muted-dark: '#1E2227'
  ink-primary-dark: '#ECEEF1'
  ink-secondary-dark: '#A3ABB5'
  border-dark: '#2E343B'
  control-border-dark: '#737C88'
  action-dark: '#7DB7F5'
  status-free-dark: '#7BD596'
  status-free-bg-dark: '#16301F'
  status-booked-dark: '#A3ABB5'
  status-booked-bg-dark: '#262B31'
  status-unknown-dark: '#F2C86B'
  status-unknown-bg-dark: '#3A2E10'
  error-dark: '#F2B8B5'
typography:
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: 1.375rem
    fontWeight: 600
    lineHeight: 1.3
  section:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.4
  card-address:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.3
  tile-day:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 1.375rem
    fontWeight: 700
    lineHeight: 1.1
  body:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: 6px
  md: 10px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  gutter-mobile: 16px
  content-max: 720px
  target-min: 44px
  tile-width: 3.25rem
  icon-size: 28px
  icon-target: 36px
components:
  focus-ring:
    color: '{colors.action}'
    width: 2px
    offset: 2px
  search-bar:
    background: '{colors.surface-base}'
    field-border: '{colors.control-border}'
    rounded: '{rounded.md}'
    min-height: '{spacing.target-min}'
  place-suggestions:
    background: '{colors.surface-base}'
    border: '{colors.control-border}'
    highlight-background: '{colors.surface-muted}'
    item-min-height: '{spacing.target-min}'
    rounded: '{rounded.sm}'
    max-items: 6
  button-primary:
    background: '{colors.action}'
    color: '{colors.surface-base}'
    rounded: '{rounded.sm}'
    min-height: '{spacing.target-min}'
  button-secondary:
    background: '{colors.surface-base}'
    color: '{colors.action}'
    border: '{colors.control-border}'
    rounded: '{rounded.sm}'
    min-height: '{spacing.target-min}'
  result-card:
    background: '{colors.surface-base}'
    border: '{colors.border}'
    rounded: '{rounded.md}'
    padding: '{spacing.3}'
  date-tile:
    background: '{colors.surface-muted}'
    rounded: '{rounded.sm}'
    width: '{spacing.tile-width}'
    day-typography: '{typography.tile-day}'
    label-typography: '{typography.meta}'
    label-color: '{colors.ink-secondary}'
  status-icon:
    size: '{spacing.icon-size}'
    target: '{spacing.icon-target}'
    rounded: '{rounded.full}'
    variants:
      free: { color: '{colors.status-free}', background: '{colors.status-free-bg}' }
      booked: { color: '{colors.status-booked}', background: '{colors.status-booked-bg}' }
      unknown: { color: '{colors.status-unknown}', background: '{colors.status-unknown-bg}' }
  info-icon:
    size: '{spacing.icon-size}'
    target: '{spacing.icon-target}'
    rounded: '{rounded.full}'
    color: '{colors.ink-secondary}'
    background: '{colors.surface-muted}'
  icon-label:
    color: '{colors.surface-base}'
    background: '{colors.ink-primary}'
    rounded: '{rounded.sm}'
    typography: '{typography.meta}'
  eligibility-line:
    color: '{colors.ink-primary}'
    background: '{colors.surface-muted}'
    rounded: '{rounded.sm}'
    typography: '{typography.body}'
  new-badge:
    color: '{colors.ink-primary}'
    background: '{colors.surface-muted}'
    rounded: '{rounded.full}'
    typography: '{typography.meta}'
  freshness-line:
    typography: '{typography.meta}'
    color: '{colors.ink-secondary}'
  address-line:
    typography: '{typography.card-address}'
    color: '{colors.ink-primary}'
    link-color: '{colors.action}'
  card-meta:
    typography: '{typography.meta}'
    color: '{colors.ink-secondary}'
  sort-control:
    border: '{colors.control-border}'
    selected-background: '{colors.ink-primary}'
    selected-color: '{colors.surface-base}'
    rounded: '{rounded.sm}'
    min-height: '{spacing.target-min}'
  notice-line:
    typography: '{typography.body}'
    color: '{colors.ink-primary}'
  field-message:
    typography: '{typography.meta}'
    color: '{colors.error}'
---

## Brand & Style

A public utility, not a product pitch. People arrive anxious about a deadline and want one answer: where is there a date near me, and is it real? The look is plain and factual, close to a timetable. [ASSUMPTION] No illustrations, no marketing hero, no brand colour competing with the status colours. Trust comes from showing what is known, what isn't, and how old each fact is.

## Colors

[ASSUMPTION] All hex values are a neutral starting palette; Eleni has not chosen colours.

- **Surface (`#FFFFFF` / `#14171B`)** and **Muted (`#F4F5F7` / `#1E2227`)**: page, date tile, eligibility line and icon backgrounds.
- **Ink primary / secondary**: text. Secondary only for meta (time, distance, centre name, freshness), never for the date or the address.
- **Border (`#DDE1E6` / `#2E343B`)**: card outlines and dividers only. Never the only boundary of a control.
- **Control border (`#7A838F` / `#737C88`)**: outline of every input, select, checkbox and segmented control.
- **Action (`#0B5CAD` / `#7DB7F5`)**: primary button, focus ring, map-pin and "Why?" links, "Opens the centre's test page".
- **Status colours**: free (green), booked out (grey), unknown (amber). Each has a tinted background for the status icon. Status is never colour-only: each status has its own icon shape and a text label (see Components). Amber also marks "Deadline passed" and the not-checked tile.
- **Error (`#B3261E` / `#F2B8B5`)**: field messages ("place not found") and "we couldn't load results". Never used for "booked out".

Contrast, checked 2026-10-25, both modes:
- Text pairs meet AA (≥ 4.5:1); lowest is free on free-bg at 4.73:1.
- Control border meets non-text 3:1: 3.84 / 3.52 (light, on base / muted), 4.25 / 3.78 (dark).
- Focus ring (action) is ≥ 6.1:1 on every surface.

Re-check if any value changes.

Avoid: red for booked out (it's normal, not an error), gradients, more than one accent, amber for staleness.

## Typography

System font stack: fast on phones, no web-font cost. [ASSUMPTION] Sizes are in rem (1rem = 16px default) so they follow the browser's font-size setting.

- `title`: page heading (h1) only.
- `section`: section headings (h2), e.g. "No dates to show".
- `tile-day`: the day number in the date tile; the largest text on a card.
- `card-address`: the test address, the main text line on every card.
- `body`: explanations, eligibility line, notice line.
- `meta`: tile month and weekday, time, distance, centre name, freshness, icon labels, field messages, attribution.

## Layout & Spacing

Scale 4 / 8 / 12 / 16 / 24 / 32 px. Single column on phones with `{spacing.gutter-mobile}` side margins; on wider screens the same column, centred, max `{spacing.content-max}`. [ASSUMPTION] No second column or map in v1.

The search bar sits at the top of the page and scrolls away with it; it is not sticky [ASSUMPTION].

Every control uses `min-height`, never a fixed height, so text can wrap and grow. Interactive targets are at least `{spacing.target-min}`.

Reflow at 320 px with the longest German strings is required; rules in `EXPERIENCE.md` Accessibility Floor and Responsive & Platform.

## Elevation & Depth

Flat. Cards are separated by `{colors.border}` and spacing, not shadow. The only overlay is the place-suggestions list under the search field. The radius picker is a native select, so phones show their own picker.

## Shapes

`{rounded.md}` for cards and the search bar, `{rounded.sm}` for the date tile, eligibility line, icon labels, buttons and the suggestions list, `{rounded.full}` for card icons and the "New" badge only.

## Components

- **Focus ring**: `{components.focus-ring}`: 2px `{colors.action}` outline with 2px offset on every focusable element. On a card, the ring is drawn around the whole card while the card's link has focus; when the map pin, a card icon or "Why?" has focus, only that element gets the ring.
- **Search bar**: place or postcode field, radius select (km), search button (`button-primary`). "Use my location" is an icon button inside the right end of the field, 44 × 44 px, with the field's right padding widened to match.
- **Place suggestions**: list directly under the field, `{components.place-suggestions}`. Each row: town in `body`, then postcode and district in `meta` ("Neustadt a.d.Aisch · 91413 · Neustadt/Aisch-Bad Windsheim"). Highlighted row uses `highlight-background`.
- **Field message**: `meta` in `{colors.error}` under the field, prefixed by an error icon and the word "Error". Up to three "Did you mean …?" links below it.
- **Count line**: `body` above the list: "12 dates and 3 unchecked centres within 40 km".
- **Notice line**: `body`, `{colors.ink-primary}`, no background. Used for "All checked dates are booked out…" and similar.
- **Sort control**: two segments, "Soonest | Nearest", built as styled radio buttons; selected segment filled `{colors.ink-primary}`. Sits beside the hide-booked-out toggle when both fit; otherwise the toggle wraps below.
- **Hide booked-out toggle**: native checkbox (`accent-color: {colors.action}`) with label; when on, adds "4 booked-out dates hidden" in `meta` with a "Show" link.
- **Result card** (variant B, "date tile", chosen 2026-10-30): one per test date; the whole card is the link. Three columns:
  1. **Date tile** (`{components.date-tile}`): month ("Dec") and weekday ("Wed") in `meta`, day number in `tile-day`.
  2. **Text**: address line; then a meta line "14:00 · 14 km", plus " · Deadline 13 Nov", " · Deadline passed" (amber, `{colors.status-unknown}`) or " · Deadline unknown"; then the centre name; then the freshness line. All three meta lines use `{components.card-meta}`. When the date link was dead, a last line "Opens the centre's test page" in `{colors.action}`.
  3. **Icons**, stacked top-right: status icon, registration icon, and the eligibility icon when no rule was found.

  When an eligibility rule was found, the eligibility line spans the full card width below the three columns. No key-facts row, no status chip, no domain line.
- **Address line**: full test address in `card-address`, `{colors.ink-primary}` ("Krankenhausstr. 40, 89312 Günzburg"), followed by a map-pin icon in `{colors.action}` that opens Google Maps (44 × 44 px target). Address text is selectable. A "New" badge follows the pin when the date is new.
- **Status icon** (`{components.status-icon}`): tinted circle with a distinct shape per status, so colour is never the only cue: tick = "Free seats" (free), slashed circle = "Booked out" (booked), clock = "Booked out · Waitlist" (booked), question mark = "Status unknown" (unknown).
- **Registration icon** (`{components.info-icon}`): screen = "Register online", envelope = "Register by email", mailbox = "Register by post", person = "Register in person", form with question mark = "Registration: see website".
- **Eligibility icon** (`{components.info-icon}`): person with question mark = "Who may register: not stated". Shown only when no rule was found; never shown as "open to all" (CAP-11).
- **Icon label** (`{components.icon-label}`): the icon's words in a small dark label above the icon, on hover, keyboard focus or tap.
- **Eligibility line** (`{components.eligibility-line}`): full-width row at the bottom of the card, house icon then the provider's rule verbatim in German ("Die Teilnahme ist nur mit Hauptwohnsitz in München möglich."). Always visible, never in a label only.
- **"New" badge**: "New" in `{colors.ink-primary}` on `{colors.surface-muted}`, `{rounded.full}`, after the address. Not blue, so it doesn't look like a link.
- **Freshness line**: on every result card and no-dates card, `meta`, `{colors.ink-secondary}`: "Checked 2 h ago". Older than 36 h: "◷ Checked Tue 14:00", same colour. No banner, no amber.
- **No-dates card**: a covered centre with no current dates. Same layout; the tile shows a calendar icon instead of a date. Address line (the centre's address); meta line "No dates listed · 32 km"; centre name; freshness line. No icons.
- **Uncovered card**: a centre with no automatic check, or a checked centre whose last check failed and has no dates left. Same layout; the tile shows a question mark on `{colors.status-unknown-bg}`. Address line; meta line "Not checked automatically" (or "Not checked right now") in `{colors.status-unknown}` · distance; centre name; "Why?" link (44 px target). No freshness line, no icons.
- **Section heading**: `section` style, h2: "No dates to show" (Soonest sort only).
- **Skeleton card**: result-card outline with three grey bars in `{colors.surface-muted}`; static, no shimmer.
- **Retry / next-radius buttons**: `button-secondary`, full width on phones.
- **Language switch**: "DE | EN" in the header; each a 44 px target; active one in `{colors.ink-primary}` and bold, inactive in `{colors.action}`.
- **Footer**: `meta`. Links to About the data, Impressum, Privacy; attribution line "Place data © OpenStreetMap contributors (ODbL)".

→ Visual reference: [`mockups/card-b-states.html`](mockups/card-b-states.html) for every card state; [`mockups/key-results-phone.html`](mockups/key-results-phone.html) for the page around the cards (its cards show the earlier design). Spines win on conflict.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Give every status icon its own shape and a text label | Use colour alone for status, or two icons with the same shape |
| Show "Deadline unknown" and "distance unknown", "see website" for unknown registration and "not stated" for unknown eligibility | Guess, or let a missing rule read as "open to all" |
| Make the whole card the link; its name says where it opens | Use generic "More info" links or separate link buttons |
| Keep booked-out dates visible, in grey | Hide them by default, or show them in red |
| Show every centre in range as a card, in the same layout | Leave a centre out because it has no dates or isn't checked |
| Quiet last-checked time on every card | Banners or amber warnings for staleness |
| Control border on every input and control | The pale card border as a control's only outline |
| `min-height` and rem | Fixed heights and px font sizes |
