---
title: 'Story 1.2: Bilingual page shell with design tokens'
type: 'feature'
created: '2026-10-26'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'faf5765dd3f13f9ebac5a6ead2c3f688dc4063aa'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The site is a bare English placeholder. There are no design tokens, no translations, no header or footer, and later stories (1.7–1.10) need all of these to build on.

**Approach:** Turn every DESIGN.md frontmatter token into a CSS custom property (light and dark). Add DE/EN translation files with a small translator and a language switch that keeps its state in the URL fragment. Wrap both pages (search and About) in one shared shell: header with "DE | EN", a single 720 px column, and a footer with the About link and the OSM attribution.

## Boundaries & Constraints

**Always:**
- All UI text, including `document.title` and accessible names, comes from `web/src/i18n/{de,en}.json`. Both files have the same keys and the same `{placeholder}` names for each key. No value contains `!`.
- Only `web/src/styles/tokens.css` may hold literal colours, px sizes or font sizes. Everything else uses `var(--…)`. Controls use `min-height`, never `height`. Nothing may remove the focus outline.
- Language order: a valid `lang` (`de`/`en`) in the fragment, then the browser's first language (`en*` → English, anything else → German). `<html lang>` and `document.title` follow the active language.
- The language switch rewrites only the `lang` parameter of the fragment and keeps every other parameter (`q`, `r`, `sort`, unknown ones), using `history.replaceState` (no new history entry). It never touches the query string.
- Same-origin only. No new runtime dependencies. Dev dependencies added: `happy-dom` ~21.0 and `yaml` ~2.9 (tests only).

**Never:**
- No search bar, results, About content, place data or snapshot loading. Those are Stories 1.5–1.10.
- No Impressum or Privacy links (hidden in the beta). No cookies, no `localStorage` and no analytics for the language choice.
- No web fonts, icon fonts or CSS frameworks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| English browser | `navigator.languages = ['en-GB','de']`, no fragment | English UI, `<html lang="en">`, h1 "Find Einbürgerungstest dates near you in Bavaria." | N/A |
| Other browser language | `['fr-FR']` | German UI, `<html lang="de">` | N/A |
| Shared link | `#q=Fürth&r=20&lang=en`, German browser | English UI. Fragment left unchanged on load | N/A |
| Bad `lang` | `#lang=xx` | Falls back to browser language; fragment not rewritten on load | ignore value |
| Switch DE→EN | `#q=F%C3%BCrth&r=20&lang=de`, click EN | Text switches without reload; fragment has `lang=en` and the same `q`, `r`; focus still on the EN link; EN link has `aria-current="true"` and `lang="en"` | N/A |
| Switch with empty fragment | no fragment, click EN | fragment becomes `#lang=en` | N/A |
| Manual fragment edit | `hashchange` to `#lang=de` | UI switches to German | invalid `lang` ignored |
| Missing key | key in `en.json` but not `de.json` | `npm test` fails and names the key | test fails |
| Hard-coded text | a component renders a literal string | `npm test` fails and names the text | test fails |

</intent-contract>

## Code Map

- `web/src/app.tsx`, `web/src/main.tsx` -- Story 1.1 placeholder app; `main.tsx` mounts into `#app` in `web/index.html`. The h1 is currently hard-coded English.
- `web/about/index.html` -- static HTML with no script today; it must become a Preact entry (`#app` + `../src/about-main.tsx`) so it shares the shell. It is already a Vite input (`vite.config.ts`), and `tests/site-config.test.ts` checks it exists. Keep the robots/referrer/`color-scheme` metas and `<link rel="icon" href="data:,">` in both HTML files.
- `vitest.config.ts` -- node environment, includes `**/*.test.{ts,tsx}`. DOM tests opt in per file with `// @vitest-environment happy-dom`. It has no Preact plugin; add `@preact/preset-vite` (or matching JSX options) so `.tsx` tests compile against Preact.
- `tests/import-rules.test.ts` -- scans `web/**` for imports; `web → shared` only. All new web code must stay inside `web/`.
- `tsconfig.json` -- `resolveJsonModule` is on, so the JSON catalogues can be imported and typed (`keyof typeof en`).
- DESIGN.md frontmatter (`_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md`) -- token source. `*-dark` colour keys are the dark values of the same token. Values reference others as `{group.key}`; component typography refs (`{typography.meta}`) point to a whole style.
- EXPERIENCE.md Voice and Tone table (same folder) -- the Do column holds the initial microcopy, as quoted strings.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json` -- add dev deps `happy-dom` ~21.0 and `yaml` ~2.9 -- DOM rendering and frontmatter parsing in tests.
- [x] `web/src/styles/tokens.css` -- `:root` custom properties named by fixed rules: `colors.X` → `--color-X` (light in `:root`, `X-dark` under `@media (prefers-color-scheme: dark) { :root { … } }`); `typography.N` → `--font-N-family/-size/-weight/-line-height` plus shorthand `--font-N` (`weight size/line-height family`); `rounded.K` → `--radius-K`; `spacing.K` → `--space-K`; `components.C.P` → `--C-P` (variants: `--status-chip-<variant>-<prop>`), whose values are `var()` references to the tokens they name (typography refs → `var(--font-N)`). Also `color-scheme: light dark`.
- [x] `web/src/styles/base.css` -- box-sizing, body uses `--font-body` and surface/ink colours, `overflow-wrap: break-word`. Global `:focus-visible` outline `var(--focus-ring-width) solid var(--focus-ring-color)` with `outline-offset: var(--focus-ring-offset)`. Page column: max `--space-content-max`, centred, `--space-gutter-mobile` inline padding. Header language-switch and footer styles (meta type, 44 px `min-height`/`min-width` targets, active link `--color-ink-primary` + bold, inactive `--color-action`, divider drawn as a border, not text).
- [x] `web/src/i18n/en.json`, `web/src/i18n/de.json` -- flat dotted keys. Shell strings (page titles, h1, About h1, nav label, language names "Deutsch"/"English" and codes "DE"/"EN" identical in both files, footer About link, attribution "Place data © OpenStreetMap contributors (ODbL)" / "Ortsdaten © OpenStreetMap-Mitwirkende (ODbL)"). Plus every Do-column string from EXPERIENCE.md Voice and Tone, with numbers, domains and times as `{placeholders}` (e.g. "Checked {hours} h ago", "No test centres within {radius} km. Try {next} km."). German uses formal "Sie".
- [x] `web/src/i18n/i18n.tsx` -- `detectLanguage(fragment, navigatorLanguages)`, `translate(catalogue, key, params?)`, an `I18nProvider` (optional `catalogues` prop so tests can inject sentinels) and a `useI18n()` hook returning `{ lang, t, setLang }`. The provider keeps `<html lang>` and `document.title` in sync and listens to `hashchange`.
- [x] `web/src/fragment.ts` -- parse and serialise the fragment with `URLSearchParams`; `withLang(hash, lang)` replaces only `lang`.
- [x] `web/src/shell/page-shell.tsx`, `language-switch.tsx`, `site-footer.tsx` -- header `<nav>` (named from i18n) with two links: visible code, `aria-label` = language name, `lang`/`hreflang`, `href` = fragment with that `lang`; the active one has `aria-current="true"`. A click calls `preventDefault`, sets the language and `replaceState`s the fragment. Elements are keyed so the focused link keeps focus. `<main>` with the page content. Footer: About link (`about/` from the search page, `./` on About, with `#lang=<lang>`; `aria-current="page"` on About) and the attribution line.
- [x] `web/src/app.tsx`, `web/src/main.tsx`, `web/src/about-page.tsx`, `web/src/about-main.tsx`, `web/about/index.html` -- both pages render inside `I18nProvider` + `PageShell` with an i18n h1. Entry files import `tokens.css` then `base.css`.
- [x] `tests/design-tokens.test.ts` -- parse DESIGN.md frontmatter with `yaml`, resolve `{…}` refs, parse `tokens.css` `:root` and dark blocks, resolve `var()` chains, and assert every token by the naming rules above (hex compared case-insensitively, whitespace normalised). Scan every other file under `web/` (`.css`, `.ts`, `.tsx`, `.html`): no hex colours, colour functions (`rgb(`, `hsl(`, `oklch(` …) or common named colours in CSS values; no `px` in `font`/`font-size`; no `height:` declarations; no `outline: none|0`; no `style=` in TSX. Assert the `:focus-visible` rule above exists.
- [x] `tests/i18n.test.ts` -- same key set and same placeholders per key in both files (failure names the key); no `!`; every Do-column quoted string from EXPERIENCE.md matches some `en.json` value, with `{x}` treated as a wildcard; unit tests for `detectLanguage` and `withLang` covering the matrix rows.
- [x] `tests/shell.test.tsx` (happy-dom) -- render both pages with sentinel catalogues (`[[key]]` values) and assert that every text node and every `aria-label`/`title`/`alt`/`placeholder` and `document.title` consist only of sentinels. With real catalogues: the matrix rows for initial language, `<html lang>`, the switch (text, fragment, focus, `aria-current`, `lang`) and `hashchange`; the footer has the About link and attribution and no Impressum/Privacy link.

**Acceptance Criteria:**
- Given `npm ci && npm run typecheck && npm test && npm run build`, when run, then all pass and `dist/index.html` and `dist/about/index.html` both load the built CSS and JS from `/testplatz/assets/`.
- Given the built site in a browser at 320 px wide, and again at 1280 px with 200% zoom, when either page is open, then there is no horizontal scroll (`scrollWidth <= clientWidth`) and on wide screens the column is centred and at most 720 px wide.
- Given the built site with dark mode emulated, when the page renders, then the body background is `#14171B` and the text colour is `#ECEEF1`.
- Given keyboard focus on a language link or the footer About link, when it is focused, then a 2 px solid outline in the action colour with a 2 px offset is drawn.

## Spec Change Log

## Review Triage Log

### 2026-10-26 — Review pass
- verdicts: 32 findings — high 0, medium 0, low 27, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` `withLang` re-encodes other params (`%20`→`+`, `ü`→`%C3%BC`, `#flag`→`flag=`) (BH) — decoded values are unchanged, so shares still resolve to the same search; byte-identity needs a hand-written splicer. Unlikely to matter.
  - `[low]` `[patch]` Language-link hrefs go stale after a `hashchange` that edits only `q`/`r` (BH) — provider now keeps `hash` in state (updated on every `hashchange` and `setLang`), links build hrefs from it; shell test added.
  - `[low]` `[reject]` About page has no link back to search; About link drops `q`/`r` (BH) — browser back returns to the search (Story 1.7 owns About navigation); a home link would add a surface not in the intent.
  - `[low]` `[reject]` "DE"/"EN" visible vs "Deutsch"/"English" accessible name, WCAG 2.5.3 (BH) — names are prescribed by the EXPERIENCE.md Accessibility Floor and start with the visible letters; changing them contradicts the UX spec.
  - `[false]` `[reject]` Glyphs ◷/↗ inside catalogue strings are read aloud (BH) — neither string is rendered yet; the stories that render them decide the markup.
  - `[low]` `[reject]` OSM attribution has no link to /copyright (BH) — plain-text attribution is what DESIGN.md and the epic specify; an external link is new surface.
  - `[low]` `[reject]` Static HTML keeps English `<title>`/`lang="en"` before JS; blank page without JS (BH) — the layout effect sets both before first paint; the app needs JS by design; pages are `noindex`.
  - `[low]` `[patch]` Literal-value scanner only flags px in `font`/`font-size` (BH) — scanner now flags any `px` in non-custom-property declarations (CSS and HTML `<style>`); unit test extended. `font-weight: bold` is not a colour, px or font size and stays.
  - `[false]` `[reject]` Autonym test only compares the two files (BH) — `tests/shell.test.tsx` asserts the exact `DE`/`EN` text and `Deutsch`/`English` names.
  - `[false]` `[reject]` `translate` does not format decimals per locale (BH) — no decimal parameter exists yet; nothing renders "2.5".
  - `[low]` `[reject]` Layout (720 px, 16 px gutters, no scroll at 320 px/200%) has no automated test (IA) — checked in the browser during implementation; a browser test runner is new infrastructure.
  - `[low]` `[reject]` Dark mode checked on source text, not computed style (IA) — checked in the browser during implementation; same reason.
  - `[low]` `[reject]` Focus ring checked on source text, not rendered state (IA) — checked in the browser during implementation; same reason.
  - `[low]` `[reject]` Served HTML has `lang="en"` and English titles (IA) — same root cause and reason as the static-HTML row.
  - `[low]` `[reject]` Sentinel check does not cover the HTML `<title>` (IA) — same root cause as the static-HTML row; JS replaces it.
  - `[low]` `[reject]` German "same meaning" is not checked mechanically (IA) — a translation-quality judgement; recorded as a residual risk.
  - `[false]` `[reject]` Key-facts values ("Online", "Passed"…) missing (IA) — they sit below the Voice and Tone table, not in its Do column, which is what the intent names.
  - `[low]` `[patch]` Nothing checks that each page loads its entry and the token/base CSS (VG gap) — `tests/site-config.test.ts` now asserts each HTML's module script and each entry's CSS imports in order.
  - `[low]` `[patch]` Stale hrefs after `hashchange` (VG other) — same fix as the stale-href row.
  - `[low]` `[patch]` Stale hrefs when `q`/`r` change (ECH) — same fix as the stale-href row.
  - `[low]` `[patch]` Stale hrefs when `lang` is removed or invalid (ECH) — same fix; `hash` updates on every `hashchange`.
  - `[low]` `[patch]` Ctrl/Cmd/Shift/Alt or middle click on a language link is swallowed (ECH) — handler returns early without `preventDefault`; shell test added.
  - `[low]` `[reject]` `withLang` re-encodes bare keys and `%20` (ECH) — same root cause and reason as the first row.
  - `[low]` `[patch]` `#lang=EN` is ignored (ECH) — `fragmentLang()` lower-cases before `isLang`; `detectLanguage` tests added.
  - `[false]` `[reject]` About link 404s when served without a trailing slash (ECH) — GitHub Pages redirects a directory URL without the slash to the slashed one.
  - `[low]` `[reject]` Token test: missing `{colors.X}` gives a confusing message (ECH) — it still fails loudly; DESIGN.md has no such ref; the fix adds guards.
  - `[low]` `[reject]` Token test: missing group key throws a TypeError (ECH) — fails loudly; same reason.
  - `[low]` `[reject]` Token test: missing typography prop compares against "undefined" (ECH) — fails loudly; same reason.
  - `[low]` `[reject]` Token test: a colour defined as a ref would compare unresolved (ECH) — no colour in DESIGN.md is a ref; fails loudly if one appears.
  - `[low]` `[reject]` i18n test: Voice and Tone as the last section breaks the regex (ECH) — it is not the last section; fails loudly.
  - `[low]` `[reject]` i18n test: escaped pipe or moved Do column (ECH) — none exist; fails loudly or is caught in review.
  - `[low]` `[reject]` `withLang` "replaces only lang" claim vs re-encoding (ECH claim) — same root cause and reason as the first row.

## Design Notes

- The naming rules are mechanical so the token test can derive every expected property from DESIGN.md. If DESIGN.md changes, the test fails until `tokens.css` is updated by hand. There is no generator; the file is small and readable.
- Sentinel rendering (`[[key]]`) is how the test proves "no hard-coded text": anything left over after removing sentinels is literal text. Each later story adds its new surfaces and states to `tests/shell.test.tsx`.
- Language codes and names are autonyms ("Deutsch", "English"), so their values are the same in both files. That still passes the parity check.

## Verification

**Commands:**
- `npm ci && npm run typecheck && npm test && npm run build` -- expected: all exit 0.
- `grep -o '/testplatz/assets/[^"]*' dist/index.html dist/about/index.html` -- expected: a `.css` and a `.js` asset for each page.
- `grep -rEo '(src|href)="https?://[^"]+"|url\(https?://[^)]+\)' dist` -- expected: no output.

**Manual checks (if no CLI):**
- Run `npm run preview` and open the site in the browser pane. At 320 px and in dark mode, check the layout, scroll and colour ACs with `document.documentElement.scrollWidth`, `clientWidth` and `getComputedStyle`. Tab to a language link and read its computed `outline`. Click EN/DE and check the text, the fragment and `document.activeElement`.

## Auto Run Result

- **Summary:** Both pages now render inside one bilingual shell: a "DE | EN" header switch kept in the URL fragment, a single 720 px column, and a footer with the About link and the OSM attribution. Every DESIGN.md token is a CSS custom property (light and dark). All UI text comes from `web/src/i18n/{de,en}.json`, seeded with the EXPERIENCE.md Do-column microcopy.
- **Files changed:**
  - `package.json`, `package-lock.json` — dev deps `happy-dom` ~21.0.4, `yaml` ~2.9.1.
  - `vitest.config.ts` — Preact plugin so `.tsx` tests compile.
  - `web/src/styles/tokens.css` — all tokens; dark colours under `prefers-color-scheme: dark`.
  - `web/src/styles/base.css` — base styles, global `:focus-visible` ring, column, switch and footer.
  - `web/src/i18n/en.json`, `de.json` — shell strings plus the 12 Do-column strings (formal "Sie").
  - `web/src/i18n/i18n.tsx` — language detection, `translate`, `I18nProvider`, `useI18n`.
  - `web/src/fragment.ts` — fragment parse/serialise and `withLang`.
  - `web/src/shell/page-shell.tsx`, `language-switch.tsx`, `site-footer.tsx` — the shell.
  - `web/src/app.tsx`, `main.tsx`, `about-page.tsx`, `about-main.tsx`, `web/about/index.html` — both pages in the shell; About is now a Preact entry.
  - `tests/design-tokens.test.ts`, `tests/i18n.test.ts`, `tests/shell.test.tsx`, `tests/site-config.test.ts` — token, literal-value, catalogue, rendering and entry-wiring tests.
- **Review:** 32 findings (0 high, 0 medium, 27 low, 5 false). Patched 5 entries (all low): stale language-link hrefs, modifier/middle clicks, upper-case `lang`, px anywhere in CSS, entry/CSS wiring test. Deferred: none. Rejected: 22 low and 5 false, each with its reason in the Review Triage Log above.
- **Follow-up review recommended:** false. Patched counts by verdict: high 0, medium 0, low 5.
- **Verification:** `npm ci`, `npm run typecheck`, `npm test` (6 files, 180 tests) and `npm run build` all exit 0. Both `dist` pages load a `.css` and `.js` from `/testplatz/assets/`; no external resource URLs in `dist`. The implementation agent reported browser checks with `vite preview`: no horizontal scroll at 320 px and at 1280 px/200% zoom, 720 px centred column, dark body `#14171B` on `#ECEEF1`, 2 px action-colour focus ring with 2 px offset on the language and footer links, and the DE→EN switch keeping `q`/`r`, focus and history length. Those browser checks were not repeated after the review patches, which changed no CSS.
- **Residual risks:** the German copy was written without a native-speaker review; static HTML shows English `<title>` and `lang="en"` until JS runs; layout, dark mode and focus ring have no automated browser test; `withLang` normalises the encoding of other fragment params.
