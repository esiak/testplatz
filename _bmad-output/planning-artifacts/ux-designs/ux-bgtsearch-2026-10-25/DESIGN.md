---
name: bgtsearch
description: Einbürgerungstest date search for Bavaria. Plain, factual, phone-first. Every fact shows how fresh it is.
status: final
updated: 2026-10-25
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
  card-date:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  fact:
    fontFamily: '{typography.title.fontFamily}'
    fontSize: 0.9375rem
    fontWeight: 500
    lineHeight: 1.35
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
  fact-cell-min: 9em
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
    padding: '{spacing.4}'
  key-facts-row:
    background: '{colors.surface-muted}'
    label-typography: '{typography.meta}'
    label-color: '{colors.ink-secondary}'
    value-typography: '{typography.fact}'
    cell-min-width: '{spacing.fact-cell-min}'
    rounded: '{rounded.sm}'
  status-chip:
    rounded: '{rounded.full}'
    typography: '{typography.meta}'
    variants:
      free: { color: '{colors.status-free}', background: '{colors.status-free-bg}' }
      booked: { color: '{colors.status-booked}', background: '{colors.status-booked-bg}' }
      unknown: { color: '{colors.status-unknown}', background: '{colors.status-unknown-bg}' }
  new-badge:
    color: '{colors.ink-primary}'
    background: '{colors.surface-muted}'
    rounded: '{rounded.full}'
    typography: '{typography.meta}'
  freshness-line:
    typography: '{typography.meta}'
    color: '{colors.ink-secondary}'
  destination-line:
    typography: '{typography.meta}'
    color: '{colors.action}'
  address-line:
    typography: '{typography.meta}'
    color: '{colors.ink-secondary}'
    link-color: '{colors.action}'
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

- **Surface (`#FFFFFF` / `#14171B`)** and **Muted (`#F4F5F7` / `#1E2227`)**: page and key-facts background.
- **Ink primary / secondary**: text. Secondary only for meta (address, labels, freshness), never for the date itself.
- **Border (`#DDE1E6` / `#2E343B`)**: card outlines and dividers only. Never the only boundary of a control.
- **Control border (`#7A838F` / `#737C88`)**: outline of every input, select, checkbox and segmented control.
- **Action (`#0B5CAD` / `#7DB7F5`)**: primary button, focus ring, destination line, "Map ↗" and "Why?" links.
- **Status colours**: free (green), booked out (grey), unknown (amber). Each has a tinted background for the chip. Status is never colour-only: every chip carries its word.
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
- `card-date`: the test date (or centre name on cards without a date); the largest text on a card.
- `fact`: values in the key-facts row.
- `body`: explanations, registration note, notice line.
- `meta`: key-facts labels, address, freshness, destination, field messages, attribution.

## Layout & Spacing

Scale 4 / 8 / 12 / 16 / 24 / 32 px. Single column on phones with `{spacing.gutter-mobile}` side margins; on wider screens the same column, centred, max `{spacing.content-max}`. [ASSUMPTION] No second column or map in v1.

The search bar sits at the top of the page and scrolls away with it; it is not sticky [ASSUMPTION].

Every control uses `min-height`, never a fixed height, so text can wrap and grow. Interactive targets are at least `{spacing.target-min}`.

Reflow at 320 px with the longest German strings is required; rules in `EXPERIENCE.md` Accessibility Floor and Responsive & Platform.

## Elevation & Depth

Flat. Cards are separated by `{colors.border}` and spacing, not shadow. The only overlay is the place-suggestions list under the search field. The radius picker is a native select, so phones show their own picker.

## Shapes

`{rounded.md}` for cards and the search bar, `{rounded.sm}` for the key-facts row, buttons and the suggestions list, `{rounded.full}` for status chips and the "New" badge only.

## Components

- **Focus ring**: `{components.focus-ring}`: 2px `{colors.action}` outline with 2px offset on every focusable element. On a card, the ring is drawn around the whole card while the card's link has focus; when "Map ↗" or "Why?" has focus, only that link gets the ring.
- **Search bar**: place or postcode field, radius select (km), search button (`button-primary`). "Use my location" is an icon button inside the right end of the field, 44 × 44 px, with the field's right padding widened to match.
- **Place suggestions**: list directly under the field, `{components.place-suggestions}`. Each row: town in `body`, then postcode and district in `meta` ("Neustadt a.d.Aisch · 91413 · Neustadt/Aisch-Bad Windsheim"). Highlighted row uses `highlight-background`.
- **Field message**: `meta` in `{colors.error}` under the field, prefixed by an error icon and the word "Error". Up to three "Did you mean …?" links below it.
- **Count line**: `body` above the list: "12 dates and 3 unchecked centres within 40 km".
- **Notice line**: `body`, `{colors.ink-primary}`, no background. Used for "All checked dates are booked out…" and similar.
- **Sort control**: two segments, "Soonest | Nearest", built as styled radio buttons; selected segment filled `{colors.ink-primary}`. Sits beside the hide-booked-out toggle when both fit; otherwise the toggle wraps below.
- **Hide booked-out toggle**: native checkbox (`accent-color: {colors.action}`) with label; when on, adds "4 booked-out dates hidden" in `meta` with a "Show" link.
- **Result card**: one per test date; the whole card is the link. Top row (wraps): `card-date` (weekday, date, time), the "New" badge, then the status chip; the chip drops below the date when space is short. Then centre name in `body`, the address line, the key-facts row, and an optional registration note in `body`. Bottom row (wraps): destination line, freshness line.
- **Address line**: full test address in `meta` ("Krankenhausstr. 40, 89312 Günzburg"), then "Map ↗" in `{colors.action}` with a 44 × 44 px target. Address text is selectable.
- **Destination line**: "vhs-guenzburg.de ↗" in `{colors.action}`, `meta`. Tells the user where the card goes.
- **Key-facts row**: modelled on ImmoScout24's facts under the photo. Four cells, label (`meta`, `{colors.ink-secondary}`) above value (`fact`): **Distance** (km, to the test address), **Status**, **Deadline**, **Registration** (Online / Email / Post / In person). Four across when each cell gets at least `{spacing.fact-cell-min}`; otherwise 2 × 2. Values wrap. Status cell uses the same words as the chip. Missing values read "unknown"; a past deadline reads "Passed".
- **Status chip**: pill with word + tint (`{components.status-chip.variants}`): "Free seats" (free), "Booked out" (booked), "Booked out · Waitlist" (booked), "Status unknown" (unknown), "No dates listed" (booked), "Not checked" (unknown). Words in brackets name the colour variant.
- **"New" badge**: "New" in `{colors.ink-primary}` on `{colors.surface-muted}`, `{rounded.full}`, after the date. Not blue, so it doesn't look like a link.
- **Freshness line**: on every result card and no-dates card, `meta`, `{colors.ink-secondary}`: "Checked 2 h ago". Older than 36 h: "◷ Checked Tue 14:00", same colour. No banner, no amber.
- **No-dates card**: a covered centre with no current dates. Same layout as a result card. Top: centre name in `card-date` style and a "No dates listed" chip. Address line; key-facts row (Distance; Status "No dates listed"; Deadline "unknown"; Registration as known); destination line to the centre's test page; freshness line.
- **Uncovered card**: a centre with no automatic check, or a checked centre whose last check failed and has no dates left (then the line reads "Not checked right now. See the centre's page."). Same layout as a result card. Top: centre name in `card-date` style and a "Not checked" chip. Address line; the line "Not checked automatically. See the centre's page." in `body`; key-facts row (Distance; Status "Not checked"; Deadline and Registration "see website"); bottom row with destination line and "Why?" link (44 px target). No freshness line.
- **Section heading**: `section` style, h2: "No dates to show" (Soonest sort only).
- **Skeleton card**: result-card outline with three grey bars in `{colors.surface-muted}`; static, no shimmer.
- **Retry / next-radius buttons**: `button-secondary`, full width on phones.
- **Language switch**: "DE | EN" in the header; each a 44 px target; active one in `{colors.ink-primary}` and bold, inactive in `{colors.action}`.
- **Footer**: `meta`. Links to About the data, Impressum, Privacy; attribution line "Place data © OpenStreetMap contributors (ODbL)".

→ Visual reference: [`mockups/key-results-phone.html`](mockups/key-results-phone.html). Spines win on conflict.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Put a word on every status ("Booked out") | Use colour or icons alone for status |
| Show "unknown" when data is missing | Leave a cell blank or guess |
| Show the target domain on every card | Use generic "More info" links or separate link buttons |
| Keep booked-out dates visible, in grey | Hide them by default, or show them in red |
| Show every centre in range as a card, in the same layout | Leave a centre out because it has no dates or isn't checked |
| Quiet last-checked time on every card | Banners or amber warnings for staleness |
| Control border on every input and control | The pale card border as a control's only outline |
| `min-height` and rem | Fixed heights and px font sizes |
