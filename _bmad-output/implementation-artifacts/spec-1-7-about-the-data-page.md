---
title: 'Story 1.7: About the data page'
type: 'feature'
created: '2026-10-28'
status: 'done'
review_loop_iteration: 1
baseline_commit: '9fb4bc80946edba656e65249dadb6e834c301712'
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The About page (`web/about/`) shows only its h1. Users cannot learn how the data is gathered, why centres are not checked, where the data comes from or who to credit, and centres have no way to ask to be removed (FR33 Epic 1 part, NFR11, CAP-8).

**Approach:** Fill `AboutPage` with five sections from the i18n catalogues. The "not checked" section loads same-origin `snapshot.json`, validates it with `snapshotSchema` and lists those centres with links. Add a GitHub issue form `.github/ISSUE_TEMPLATE/opt-out-request.yml` and link to it.

## Boundaries & Constraints

**Always:**
- One h1 (`about.heading`), then exactly these h2 sections in order, all text from `web/src/i18n/{de,en}.json` (same keys, formal "Sie", no `!`):
  1. **How it works** — EN body exactly: "We read the centres' websites several times a day. Always check the centre's page before you register."
  2. **Centres not checked automatically** — the `<section>` (or its h2) has `id="not-checked"`. A reasons intro, then a `<ul>` of the three reasons: their website uses a system we can't read yet; the centre asked us not to check it; our last check of their site failed. Then the centre list (below).
  3. **Sources** — the list of approved test centres in Bavaria (based on BAMF, taken from rtpartner.de until BAMF sends its own list); each centre's own website.
  4. **Attribution** — "Place data © OpenStreetMap contributors (ODbL)" with a link to `https://www.openstreetmap.org/copyright`; "Centre locations found with Nominatim" with a link to `https://nominatim.org/`.
  5. **For test centres** — one sentence plus a link "Ask to be removed" to `https://github.com/esiak/testplatz/issues/new?template=opt-out-request.yml`.
- Centre list = snapshot centres where `coverage === 'not_checked'` or `last_result !== 'ok'`, sorted by `name` with `localeCompare(…, 'de')`. Each item links to `test_page_url ?? website`; if both are null, the name is plain text. The name is wrapped in `lang="de"`.
- Every external link (centres, OSM, Nominatim, GitHub) has `target="_blank"`, `rel="noopener noreferrer"`, a visible `↗` that is `aria-hidden`, and an `aria-label` from `link.new_tab` ("{label} (opens in a new tab)" / "{label} (öffnet in einem neuen Tab)") whose `{label}` is the visible text.
- Snapshot load: one `fetch(\`${import.meta.env.BASE_URL}snapshot.json\`)` after mount, then `snapshotSchema.safeParse`. States inside the not-checked section only (other sections render immediately):
  - loading: list container `aria-busy="true"` with "Loading centres…";
  - loaded: count line "{count} centres are not checked automatically.", then the list; zero matches → "Every centre is checked automatically right now." and no list;
  - failed (network error, non-2xx, bad JSON, schema or `schemaVersion` mismatch): `role="alert"` "We couldn't load the list of centres." plus a "Try again" `<button>` that re-fetches.
- Fragment targeting: if the fragment has a `not-checked` key (bare `#not-checked`, or `#not-checked=&lang=en` after a language switch), scroll the `#not-checked` section into view on mount and on `hashchange`. Language detection and the switch keep working as in Story 1.2.
- Issue form `.github/ISSUE_TEMPLATE/opt-out-request.yml`: `name: Opt-out request`, a `description`, `title: "Opt-out request: "`, required `input` fields with ids `centre_name`, `website`, `contact`. No `labels`.
- Styles only via tokens in `web/src/styles/base.css` (h2 uses `--font-section`); links ≥ 44 px target height; long names wrap at 320 px. The design-tokens literal scanner must still pass.

**Never:**
- No booking-system status table (Story 3.3), no reload-once on version mismatch (Story 1.8), no new dependencies, no third-party requests at page load, no `web` import outside `shared`.
- No hard-coded UI text in components; centre names are the only non-catalogue text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Epic 1 data | 119 centres, all `not_checked` | count 119; 114 links, 5 plain names; sorted by name | N/A |
| Fallback link | `test_page_url: null`, `website` set | links to `website` | N/A |
| Covered, ok | `covered`, `last_result: 'ok'` | not listed | N/A |
| Covered, failed or never run | `covered`, `last_result: 'failed'` or `null` | listed | N/A |
| None unchecked | every centre covered + ok | "Every centre is checked automatically right now.", no `<ul>` | N/A |
| Fetch fails | network error / 500 / invalid JSON / `schemaVersion: 2` | alert + Try again; other sections intact | button re-fetches; success replaces the alert with the list |
| Deep link | `about/#not-checked` or `#not-checked=&lang=en` | section scrolled into view; lang from fragment or browser | N/A |

</intent-contract>

## Code Map

- `web/src/about-page.tsx` -- today renders only `<h1>{t('about.heading')}</h1>` inside `I18nProvider titleKey="about.title"` + `PageShell page="about"`. Keep `AboutPage({ catalogues })` signature (tests inject sentinel catalogues).
- `web/src/i18n/i18n.tsx` -- `useI18n()` gives `{ lang, hash, t, setLang }`; `hash` updates on hashchange and switch — use it for fragment targeting. `MessageKey = keyof en.json`, so new keys must be in both JSONs (typecheck + `tests/i18n.test.ts`).
- `web/src/fragment.ts` -- `parseFragment(hash)` returns `URLSearchParams`; `#not-checked` parses to key `not-checked`. `withLang` serialises it as `not-checked=&lang=xx`.
- `shared/snapshot.ts` -- `snapshotSchema`, `SnapshotCentre`. `web → shared` is allowed by `tests/import-rules.test.ts`.
- New `web/src/data/snapshot.ts` -- `loadSnapshot(fetchImpl = fetch): Promise<Snapshot>` (throws on any failure) and `uncheckedCentres(snapshot): SnapshotCentre[]` (filter + sort). Story 1.8 will reuse the loader.
- `web/src/styles/base.css` -- add `.about` section/h2/list rules with tokens only; `tests/design-tokens.test.ts` scans every `web/` css/ts/tsx/html for literals.
- `tests/shell.test.tsx` -- sentinel "no hard-coded UI text" loop renders About with `catalogues`; it must now stub `fetch` (pending promise for loading, rejection for error, a fixture for loaded with centre names filtered out of the leftovers). The About-h1 test (`h1Text()`) stays valid.
- `data/public/snapshot.json` -- real data: 119 centres, 55 without `test_page_url`, 5 without either URL, longest name 89 chars.
- `tests/workflows.test.ts` -- already checks `dist/about/index.html`; no change.

## Tasks & Acceptance

**Execution:**
- [x] `web/src/i18n/en.json`, `web/src/i18n/de.json` -- add `about.*` section headings/bodies, reasons, sources, attribution, opt-out sentence and link text, list states (loading, count with `{count}`, none, error, retry), and `link.new_tab` with `{label}` -- all copy from translation files.
- [x] `web/src/data/snapshot.ts` -- `loadSnapshot` and `uncheckedCentres` as in Code Map -- shared loading and filtering.
- [x] `web/src/about-page.tsx` -- the five sections, the not-checked list states, external-link pattern, fragment targeting -- the page.
- [x] `web/src/styles/base.css` -- About styles (tokens only, 44 px link targets, wrapping). Centre-name spans and external-link label spans get `min-width: 0` and `overflow-wrap: anywhere`, so one long unbroken word cannot widen the page at 320 px -- reflow and contrast parity.
- [x] `.github/ISSUE_TEMPLATE/opt-out-request.yml` -- the issue form. Its description and text promise only that we stop checking the centre's website; never "remove it from the list" (an opted-out centre stays listed as not checked, FR22) -- opt-out channel.
- [x] `tests/about.test.tsx` (happy-dom, stubbed `fetch`) -- headings h1 + five h2 in order in both languages; `id="not-checked"`; every matrix row (the "Epic 1 data" row feeds the committed `data/public/snapshot.json` through the stub and derives every expected number — count, linked items, plain items — from that file, never hard-coded 119/114/5); external link attributes and `aria-label`s; opt-out href; `lang="de"` on names; scroll-into-view called for both deep-link forms (spy on `Element.prototype.scrollIntoView`); retry flow.
- [x] `tests/snapshot-loader.test.ts` -- `loadSnapshot` rejects non-2xx, bad JSON, wrong version; `uncheckedCentres` filter and sort; `uncheckedCentres` on the committed `data/public/snapshot.json` (read with `node:fs`) parses, is sorted, and every returned centre satisfies the rule — never "returns every centre" or a fixed count. `npm test` runs before `npm run pipeline` in the publish job, so a test pinned to today's data blocks the pipeline after its next data commit.
- [x] `tests/site-config.test.ts` -- assert the production snapshot URL: with `BASE_URL` stubbed to `viteConfig.base` (`vi.stubEnv` + `vi.resetModules` + dynamic import of `web/src/data/snapshot.ts`), `SNAPSHOT_URL` equals `/testplatz/snapshot.json`; vitest's own base is `/`, so the other tests never see the production value.
- [x] `tests/opt-out-template.test.ts` -- parse the YAML with `yaml`; assert name, title, the three required input ids, no labels; assert the filename matches the `template=` in the About link.
- [x] `tests/shell.test.tsx` -- stub `fetch` in the sentinel loop and add the loading, loaded and error states of About to it.

**Acceptance Criteria:**
- Given the built site, when I follow the footer "About the data" link in either language, then I see the five sections in that language with the copy and links listed under Always, and the not-checked list shows every directory centre (Epic 1 data).
- Given the About page, when it renders, then it has one h1 and one h2 per section, and at 320 px and at 1280 px with 200% zoom there is no horizontal scroll (`scrollWidth <= clientWidth`) in German, light and dark.
- Given `about/#not-checked`, when the page loads, then the not-checked section is scrolled into view.
- Given the page at load, when I inspect network requests, then the only data request is same-origin `/testplatz/snapshot.json`.

## Spec Change Log

### 2026-10-28 — Review loop 1: data-independent tests, production snapshot URL
- **Trigger:** review found (1) `tests/about.test.tsx` hard-coded the live snapshot's 119/114/5 and `tests/snapshot-loader.test.ts` asserted every committed centre is unchecked; the publish job runs `npm test` before `npm run pipeline`, so the first data commit that changes the directory or covers a centre fails every later push and blocks publishing (same root cause as Story 1.6 loop 1); (2) no test checks the `/testplatz/` prefix of `SNAPSHOT_URL` — vitest's base is `/`, so a wrong URL passes CI and 404s in production; (3) a long unbroken name can overflow at 320 px (flex items keep min-content width); (4) the issue form promised "remove it from the list" while opted-out centres stay listed.
- **Amended (Tasks only, outside the intent contract):** committed-data tests derive expectations from the file; a production-base `SNAPSHOT_URL` test in `site-config.test.ts`; `min-width: 0` + `overflow-wrap: anywhere` on name/label spans; issue form copy promises only to stop checking.
- **Avoids:** a pipeline blocked by its own data commit; a silently broken snapshot URL in production; horizontal scroll from one long word; an opt-out promise the page does not keep.
- **KEEP:** everything else in attempt 1 (`_bmad-output/implementation-artifacts/spec-1-7-attempt-1.patch`, applies cleanly with `git apply` on the baseline): `web/src/data/snapshot.ts` (`SNAPSHOT_URL`, `loadSnapshot`, `uncheckedCentres`); `web/src/about-page.tsx` (`ExternalLink`, `CentreList` states, `useNotCheckedTarget` with its own hashchange listener, exported `OPT_OUT_URL` and `NOT_CHECKED_ID`); the 23 i18n keys incl. `link.external_mark`; the `.about` CSS; the issue form fields and bilingual labels; `tests/fixtures/snapshot.ts`; `tests/about.test.tsx`, `tests/snapshot-loader.test.ts`, `tests/opt-out-template.test.ts` and the `tests/shell.test.tsx` changes. Apply the patch, then make only the amendments above.

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 35 findings — high 0, medium 4, low 19, false 12, maybe-false 0
- findings:
  - `[low]` `[reject]` Count line has no singular ("1 centres…") (BH) — real, but the count is 119 in Epic 1 and stays large until most centres are covered; a fix adds a plural branch and key.
  - `[low]` `[bad_spec]` Issue form promises "remove it from the list" while opted-out centres stay listed and linked (BH) — confirmed in the form description; FR22 keeps opted-out centres as not checked, so the copy is wrong, not the list. Amendment: form copy promises only to stop checking.
  - `[low]` `[reject]` "How it works" claims checks that do not run yet (BH) — the copy is quoted verbatim in the story AC; Epic 2 makes it true.
  - `[low]` `[reject]` No per-centre reason in the list (BH) — the AC asks for the reasons and the list, not a reason per row; in Epic 1 every centre shares "no reader yet".
  - `[low]` `[reject]` Opt-out form puts contact data in a public issue and needs a GitHub account (BH) — the AC fixes a GitHub issue with a contact field; the form warns the issue is public.
  - `[low]` `[reject]` Form has no labels, so requests cannot be filtered (BH) — opt-outs are rare and read by one operator; labels that do not exist on the repo are not applied anyway.
  - `[false]` `[reject]` Filter clause is redundant / ignores stale `ok` results (BH) — the explicit `not_checked` clause harms nothing; freshness is per centre (AD-11) and arrives with Epic 2 cards.
  - `[low]` `[reject]` Focus falls to body after Try again; no announcement when the list arrives; deep link does not move focus (BH) — real, but only on a load failure; the fix adds refs and focus effects.
  - `[false]` `[reject]` Links and the retry button have no focus style (BH) — `base.css` has a global `:focus-visible` ring from the focus-ring tokens.
  - `[low]` `[reject]` `aria-label` overrides the `lang="de"` name span (BH) — real; affects pronunciation only; the fix replaces the specified aria-label pattern with new hidden-text CSS.
  - `[low]` `[reject]` Sources are not linked; open-ended "until BAMF sends" wording (BH) — rtpartner's live page is broken (review-note.md); the wording states the plan in data-sources.md.
  - `[medium]` `[bad_spec]` UI test hard-codes 119/114/5 of the live snapshot (BH) — grouped with the VG pipeline-block row: the spec told the tests to pin today's data. Amendment: derive expectations from the file.
  - `[false]` `[reject]` `OPT_OUT_URL` hard-codes `esiak/testplatz` (BH) — the AC names that repo, and it is the origin remote.
  - `[low]` `[reject]` Fetch never aborted, no timeout (BH) — a hung same-origin static file is unlikely on Pages; adding a timeout adds a parameter and a branch.
  - `[false]` `[reject]` The spec is not in the diff (BH) — by design: the review diff excludes `_bmad-output/`; the spec goes to the edge-case layer as the claims file.
  - `[low]` `[reject]` Singular count wording (ECH) — same as the BH row.
  - `[false]` `[reject]` Language switch on a deep link re-scrolls via hashchange (ECH) — the switch calls `replaceState`, which fires no `hashchange`; a test covers the switch on a deep link.
  - `[low]` `[reject]` Try again unmount drops focus (ECH) — same as the BH focus row.
  - `[low]` `[reject]` `aria-label` hides `lang="de"` (ECH) — same as the BH row.
  - `[low]` `[bad_spec]` One long unbroken word can overflow at 320 px (ECH) — confirmed: flex items keep min-content width, and `overflow-wrap: break-word` does not shrink it. Amendment: `min-width: 0` + `overflow-wrap: anywhere` on name/label spans.
  - `[low]` `[reject]` A covered centre that never ran matches none of the three reasons (ECH) — only between adding a reader and its first run (one scheduled run); a fourth reason adds copy for a minutes-long state.
  - `[low]` `[bad_spec]` Opted-out centres still linked (ECH) — grouped with the BH promise row: listing them with links is what the AC asks; the form copy is what changes.
  - `[low]` `[reject]` Hung snapshot fetch shows loading forever (ECH) — same as the BH fetch row.
  - `[false]` `[reject]` Mount-time scroll runs before the list arrives, so content shifts (ECH) — everything above the section is static text in system fonts; the list sits below the heading.
  - `[low]` `[reject]` Claim: never-run centres fall under no listed reason (ECH) — same as the ECH never-run row.
  - `[medium]` `[bad_spec]` Snapshot URL's `/testplatz/` prefix is never tested (VG, pre-verified) — vitest's base is `/`; a wrong URL passes CI and 404s in production. Amendment: production-base `SNAPSHOT_URL` test in `site-config.test.ts`.
  - `[medium]` `[bad_spec]` Committed-data tests block the pipeline after its next data commit (VG other) — confirmed: `npm test` precedes `npm run pipeline` in the publish job and the retry; the loader test asserts every centre is unchecked and the UI test pins 119/114/5. Amendment as the BH row.
  - `[low]` `[reject]` Singular count wording (VG other) — same as the BH row.
  - `[false]` `[reject]` Footer-to-page navigation is not tested on the built site (IA) — the footer href is tested in `shell.test.tsx`, `site-config.test.ts` checks the About entry, and the pipeline checks `dist/about/index.html`.
  - `[medium]` `[bad_spec]` Deployed snapshot fetch path not exercised (IA) — same root cause as the VG URL row.
  - `[false]` `[reject]` The GitHub issue form is not exercised on GitHub (IA) — it starts working when the YAML reaches `main`; the local test ties the filename to the link.
  - `[false]` `[reject]` Reflow and contrast are not measured by tests (IA) — the spec checks them manually (Verification); the implementer reported 320 px / 640 px with no scroll, light and dark; a browser runner is new infrastructure (Story 1.2 decision).
  - `[false]` `[reject]` "How it works" split into two sentences (IA) — same words and meaning as the AC's quote.
  - `[false]` `[reject]` Sources copy names rtpartner.de, not only "BAMF list" (IA) — deliberate (Design Notes): the directory comes from rtpartner's BAMF-based list.
  - `[false]` `[reject]` No per-centre reasons (IA) — same reading question as the BH row; the AC's wording fits a reasons list plus a centre list.

### 2026-10-28 — Review pass (loop 1 re-derivation)
- verdicts: 28 findings — high 0, medium 0, low 18, false 10, maybe-false 0
- findings:
  - `[low]` `[reject]` Count line has no singular (BH) — carried: count is 119 in Epic 1; fix adds a plural branch and key.
  - `[low]` `[reject]` No per-centre reason (BH) — carried: the AC asks for the reasons and the list.
  - `[low]` `[reject]` Contact data in a public issue (BH) — carried: the AC fixes a GitHub issue with a contact field; the form warns it is public.
  - `[low]` `[reject]` Opt-out needs a GitHub account, no email fallback (BH) — carried: same row as the public-contact finding; the AC names the GitHub issue as the channel.
  - `[low]` `[patch]` Page body "ask us to remove it" disagrees with the form and FR22 (BH) — confirmed in `about.opt_out.body`; patched: both catalogues now ask us to stop checking; the link text stays as the AC phrases it.
  - `[false]` `[reject]` Rule ignores stale `ok` results and `opted_out` (BH) — carried for staleness (AD-11, Epic 2); `snapshotCentreSchema` rejects `covered` for an opted-out centre, so a covered opted-out centre cannot reach the filter.
  - `[low]` `[reject]` No fetch timeout or abort (BH) — carried: a hung same-origin static file is unlikely; adds a parameter and a branch.
  - `[low]` `[reject]` Focus lost after Try again; no announcement; deep link does not move focus (BH) — carried.
  - `[low]` `[reject]` `aria-label` overrides `lang="de"` (BH) — carried.
  - `[low]` `[reject]` Page does not show `generated_at` (BH) — not in the AC; freshness shown to users is per centre (AD-11), and an unchanged snapshot keeps an old `generated_at` (Story 1.6 Design Notes), so showing it would mislead.
  - `[low]` `[reject]` Sources not linked; plan wording in copy (BH) — carried.
  - `[false]` `[reject]` Committed-data tests pass vacuously on an empty list (BH) — the empty branch asserts the "none" message and no list; the loader test asserts every left-out centre is covered with `ok`; neither checks nothing.
  - `[low]` `[reject]` `settle`/`stubFetch` duplicated; labels forbidden (BH) — duplication is two short test helpers with no divergence risk named; labels carried.
  - `[low]` `[patch]` Page body still promises removal (VG other) — same root cause as the BH wording row; same patch.
  - `[low]` `[reject]` `aria-label` hides `lang="de"` (VG other) — carried.
  - `[false]` `[reject]` Footer-to-page navigation untested on the built site (IA) — carried.
  - `[false]` `[reject]` Production snapshot serving not exercised (IA) — `site-config.test.ts` now asserts `/testplatz/snapshot.json` and `publicDir`; the pipeline checks `dist/snapshot.json`.
  - `[false]` `[reject]` GitHub form not exercised on GitHub (IA) — carried.
  - `[false]` `[reject]` Reflow and contrast not measured by tests (IA) — carried; the re-derivation also checked 320 px with a 150-character unbroken name, light and dark.
  - `[false]` `[reject]` List includes covered failed/never-run centres beyond the literal AC (IA) — deliberate (Design Notes); no visible difference in Epic 1 data.
  - `[false]` `[reject]` No per-centre reasons (IA) — carried.
  - `[low]` `[patch]` Opt-out copy mixes "remove" and "stop checking" (IA) — same root cause as the BH wording row; same patch.
  - `[false]` `[reject]` Sources wording names rtpartner.de (IA) — carried.
  - `[low]` `[reject]` Singular count (ECH) — carried.
  - `[low]` `[reject]` Hung fetch shows loading forever (ECH) — carried.
  - `[low]` `[reject]` Try again drops focus (ECH) — carried.
  - `[low]` `[reject]` `aria-label` hides `lang="de"` (ECH) — carried.
  - `[false]` `[reject]` Deep-link scroll runs before the list loads (ECH) — carried: static text above the section, list below the heading.

## Design Notes

**Why the list filter includes covered centres whose last check is not `ok`:** the reasons name "our last check failed", and the uncovered card (UX) also covers a covered centre whose check failed or never ran. In Epic 1 every centre is `not_checked`, so the list is the whole directory either way.

**Why the Sources copy names rtpartner.de:** the directory was seeded from rtpartner.de's Bavarian list (which cites BAMF); no machine-readable BAMF list exists yet (data-sources.md). Saying only "BAMF list" would overstate the source.

**Fragment coexistence:** the page state lives in the fragment as params (`lang=…`), so a plain `#not-checked` anchor cannot rely on native scrolling after a language switch, and native scrolling also fires before Preact renders. Treat `not-checked` as a fragment key and scroll in an effect.

## Verification

**Commands:**
- `npm run typecheck && npm test && npm run build` -- expected: all exit 0.

**Manual checks (if no CLI):**
- `npm run preview`, open `/testplatz/about/#lang=de` in the browser pane: five h2 sections, 119 listed centres; at 320 px and 1280 px/200% zoom, light and dark, `document.documentElement.scrollWidth <= clientWidth`; network shows only same-origin requests; `/testplatz/about/#not-checked` lands on the section.

## Auto Run Result

- **Summary:** The About page now has its five sections in German and English: how it works, centres not checked automatically (`#not-checked`), sources, attribution (OSM/ODbL, Nominatim) and an opt-out link for test centres. The not-checked section loads the same-origin `snapshot.json`, validates it with `snapshotSchema` and lists those centres sorted by name, each linked to its test page (or website). It has loading, empty and error/Try-again states. Deep links `#not-checked` and `#not-checked=&lang=…` scroll to the section. A GitHub issue form, "Opt-out request" (centre name, website, contact), backs the opt-out link.
- **Files changed:**
  - `web/src/about-page.tsx`: the five sections, `ExternalLink`, `CentreList` states, `#not-checked` targeting, `OPT_OUT_URL`.
  - `web/src/data/snapshot.ts`: new; `SNAPSHOT_URL`, `loadSnapshot`, `uncheckedCentres` (Story 1.8 can reuse the loader).
  - `web/src/i18n/en.json`, `de.json`: 23 About and link keys.
  - `web/src/styles/base.css`: `.about` styles, tokens only; 44 px link targets; long words wrap.
  - `.github/ISSUE_TEMPLATE/opt-out-request.yml`: new bilingual issue form.
  - `tests/about.test.tsx`, `tests/snapshot-loader.test.ts`, `tests/opt-out-template.test.ts`, `tests/fixtures/snapshot.ts`: new.
  - `tests/shell.test.tsx`: sentinel checks cover About's loading, loaded, empty and error states.
  - `tests/site-config.test.ts`: production snapshot URL is `/testplatz/snapshot.json`.
  - `_bmad-output/implementation-artifacts/spec-1-7-attempt-1.patch`: the pre-loopback attempt (KEEP reference).
- **Review:** 2 passes, 1 spec loopback, 63 findings (high 0, medium 4, low 37, false 22).
  - **Loop 1 (spec amended):** committed-data tests derive expectations from the file instead of pinning 119/114/5, so a data commit cannot block the pipeline; a test pins the production snapshot URL; long names wrap at 320 px; the issue form promises only to stop checking.
  - **Pass 2, patched (1, low):** the page's opt-out sentence now asks us to stop checking instead of promising removal.
  - **Deferred:** none.
  - **Rejected:** every other finding, with reasons in the Review Triage Log. Main groups: no singular count form (count is 119); no fetch timeout; focus after Try again; `aria-label` overriding `lang="de"` on centre links; per-centre reasons (not in the AC); the public contact field (the AC fixes a GitHub issue); "How it works" copy (quoted in the AC).
- **Follow-up review recommended:** false. The last pass patched high 0, medium 0, low 1.
- **Verification:**
  - `npm run typecheck`, `npm run build`: exit 0.
  - `npm test`: 466 passed, 1 skipped (the Story 1.5 boundary test, until Story 1.11).
  - Every I/O-matrix row has a passing test in `tests/about.test.tsx`.
  - Implementation agents checked `vite preview` in the browser pane: five h2 sections, 119 centres; no horizontal scroll at 320 px (also with a 150-character unbroken name), light and dark; links ≥ 44 px; only same-origin requests (`/testplatz/snapshot.json` plus the page's own assets); `#not-checked` lands on the section. Not repeated after the final copy-only patch.
- **Residual risks:**
  - The opt-out issue form works only once it is on `main` of `esiak/testplatz`; GitHub's rendering of it is unchecked.
  - The About bundle now includes zod (about 26 KB gzipped).
  - "How it works" describes checks that start in Epic 2.
  - Screen readers may read linked German centre names with English pronunciation (the `aria-label` replaces the `lang="de"` span).

