---
title: 'Story 1.1: Scaffold the project and deploy an empty site'
type: 'chore'
created: '2026-10-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '3b1b742cd7c6d52bf9d01ffa4be2a5bbb13641ad'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repo has only planning docs. No later story can ship until there is a scaffold on the agreed stack and a free path from a push to `main` to a live URL.

**Approach:** Use the Preact starter (`npm create preact`, no ESLint) to scaffold one root package with the pinned stack and the architecture's folder layout. Add an import-direction test, a `ci.yml` (tests + type-check) and a `pipeline.yml` that builds `web/` and deploys it to GitHub Pages at `https://esiak.github.io/testplatz/`.

## Boundaries & Constraints

**Always:**
- One root `package.json`, no workspaces. `.nvmrc` = `26`. Versions are pinned with `~`: typescript ~6.0, vite ~8.3, preact ~11.0, @preact/preset-vite ~2.10, zod ~4.6, cheerio ~1.2, vitest ~5.0. Commit `package-lock.json`.
- Vite `base` = `/testplatz/`. Every HTML page has `<meta name="robots" content="noindex">` and `<meta name="referrer" content="no-referrer">` and loads nothing from another origin.
- About URL = `https://esiak.github.io/testplatz/about/`. A placeholder page is served there now, and Story 1.7 fills it in. `pipeline/config.ts` exports `USER_AGENT` = `bgtsearch-bot/<package.json version> (+<About URL>)`.
- Workflows use only the default `GITHUB_TOKEN` and the free hosted runners.
- kebab-case file names.

**Never:**
- No ESLint, analytics, web fonts, CDN links or starter demo assets (logos, external links).
- No schemas, i18n, design tokens, fetch client or data files. Those belong to Stories 1.2–1.6.
- Do not push to `main` or trigger a deploy from this session; the operator does that.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean tree | `npm test` | Vitest passes, including the import check | N/A |
| Reader imports fetch | `pipeline/readers/x/index.ts` imports `../../fetch/...` | import check fails and names the file + import | test fails |
| Web imports pipeline/tools | any `web/**` file imports `pipeline/` or `tools/` path | import check fails | test fails |
| `typescript` imported | any project `.ts/.tsx` imports `'typescript'` | import check fails | test fails |
| Data-only push | push touches only `data/state/**` / `data/public/**` | `ci.yml` does not run | N/A |

</frozen-after-approval>

## Code Map

- Greenfield: only `.gitignore` and `_bmad-output/` are tracked. Keep the existing `.gitignore` entries (`.claude/`, `_bmad/`) and add `node_modules/` and `dist/`.
- `_bmad-output/planning-artifacts/architecture/architecture-bgtsearch-2026-10-25/ARCHITECTURE-SPINE.md` — the source tree (Structural Seed), the stack table, AD-12 (workflows) and the import rules (line 67).
- Toolchain: local Node v26.12.1 and npm 11.20; there is no `gh` CLI. Remote `origin` = `git@github.com:esiak/testplatz.git`.
- `create-preact` 0.6.0 is interactive and scaffolds its own folder. Run it in the scratchpad (TypeScript, no router, no ESLint), then move the source into `web/` and merge its dependencies into the root package at the pinned versions above.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json`, `.nvmrc` — root package (`private`, `type: module`, version `0.1.0`). Scripts: `dev`, `build`, `preview`, `test` (`vitest run`), `typecheck` (`tsc --noEmit`). Dev deps: @types/node ~26 and the starter's @babel/core peer.
- [x] `tsconfig.json` — strict, `moduleResolution: bundler`, `jsx: react-jsx`, `jsxImportSource: preact`, `noEmit`. Includes `shared`, `pipeline`, `web/src`, `tools`, `tests` and the root `*.config.ts`.
- [x] `vite.config.ts` — `root: 'web'`, `base: '/testplatz/'`, the preact preset, `build.outDir` = root `dist/` (emptyOutDir), and multi-page input `web/index.html` + `web/about/index.html`.
- [x] `vitest.config.ts` — its own config with root `.` (so tests are not rooted in `web/`), node environment, `**/*.test.{ts,tsx}`; `exclude` = `[...configDefaults.exclude, 'dist/**', '_bmad/**', '.claude/**']` (an explicit `exclude` replaces Vitest's defaults).
- [x] `web/index.html`, `web/about/index.html`, `web/src/main.tsx`, `web/src/app.tsx` — minimal pages with `lang="en"` (their placeholder copy is English; Story 1.2 makes `lang` follow the chosen language) and both meta tags. App renders a `<main>` with the h1 "Find Einbürgerungstest dates near you in Bavaria." The About placeholder has the h1 "About the data".
- [x] `pipeline/config.ts` — exports `SITE_URL`, `ABOUT_URL` and `USER_AGENT` (version read from `package.json`).
- [x] `shared/`, `pipeline/fetch/`, `pipeline/readers/`, `pipeline/stages/`, `tools/`, `data/directory/`, `data/state/`, `data/public/` — create each with `.gitkeep`.
- [x] `tests/import-rules.test.ts` — scans every `.[mc]?[jt]sx?` file under `shared`, `pipeline`, `web` and `tools` (skipping `node_modules`), resolves relative and bare specifiers (static `import`/`export … from`/dynamic `import()`), and enforces the spine's arrow graph as an allowlist, since "arrows are the only allowed imports": `web → shared`; `pipeline/stages → shared, pipeline/readers, pipeline/fetch`; `pipeline/readers → shared`; `pipeline/fetch → shared`; `tools → pipeline/fetch, shared`; `shared →` nothing. Imports within the same layer are allowed. `pipeline/config.ts` is a pipeline-root module that `stages`, `fetch` and `tools` may import. Any project file importing `typescript` fails. Violation messages name the file, the specifier and the broken rule, keeping the three named spine rules as the wording where they apply. Its pure checker function is unit-tested on in-memory fixtures for each matrix row, plus `shared → pipeline` and `tools → pipeline/stages` (both must fail).
- [x] `tests/site-config.test.ts` — `USER_AGENT` matches `^bgtsearch-bot/\d+\.\d+\.\d+ \(\+https://esiak\.github\.io/testplatz/about/\)$`, and the Vite `base` equals the path of `SITE_URL`. The Vite `build.rollupOptions.input` has an entry resolving to `web/about/index.html`, that file exists, and its path relative to `web/` (`about/`) equals `ABOUT_URL` relative to `SITE_URL`.
- [x] `.github/workflows/ci.yml` — runs on `push` to `main` and on `pull_request` (so a PR branch is not checked twice), both with `paths-ignore` for `data/state/**` and `data/public/**`. Steps: checkout, setup-node (`node-version-file: .nvmrc`, npm cache), `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
- [x] `.github/workflows/pipeline.yml` — runs on `push` to `main` and `workflow_dispatch`, with `concurrency: { group: pipeline, cancel-in-progress: false }`. Workflow-level permissions: `contents: read` only. `pages: write` and `id-token: write` are granted on the deploy job alone, so `npm ci` install scripts in the build job never hold a Pages/OIDC token. Build job: checkout `ref: ${{ github.sha }}`, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, then fail unless `dist/index.html` and `dist/about/index.html` both exist, `actions/upload-pages-artifact` (`dist`). Deploy job: `actions/deploy-pages` in the `github-pages` environment. Use current major versions of each action.
- [x] `tests/workflows.test.ts` — keep: asserts `ci.yml` `paths-ignore` (`data/state/**`, `data/public/**`) on both triggers, and the `pipeline.yml` triggers, concurrency, `ref: ${{ github.sha }}`, deploy action, and that the build job runs typecheck + tests before the build. Normalise CRLF before matching.
- [x] `README.md` — a short note listing the operator prerequisites: the repo is public, Pages source is "GitHub Actions", and workflows are allowed to push to `main`.

**Acceptance Criteria:**
- Given a fresh clone, when `npm ci && npm run typecheck && npm test && npm run build` run, then all succeed, and `dist/index.html` and `dist/about/index.html` reference assets under `/testplatz/`.
- Given the built `dist/`, when its HTML/JS/CSS are searched for `http(s)://` resource URLs (`src=`, `href=` on link/script, `url(`, `import`), then none point to another origin.
- Given the operator prerequisites are met, when the branch is merged to `main`, then `pipeline.yml` deploys and `https://esiak.github.io/testplatz/` serves the page with both meta tags. This is verified by the operator after merge.

## Implementation Notes

- `create-preact` 0.6.0 (TS, no router, no prerender, no ESLint) was run in the scratchpad. It pinned `typescript ^7`; the root package uses `~6.0` per the stack. Starter assets (logos, `style.css`, `vite.svg`, external links) were dropped.
- Pages set `<link rel="icon" href="data:,">` so browsers do not request `/favicon.ico`.
- `tsconfig.json` sets `types: ["node", "vite/client"]` (TS 6 no longer loads `@types/*` by default) and `allowImportingTsExtensions`, so Node 26 can run `pipeline/` and `tools/` with type stripping.
- The import checker lives in `tests/import-rules.test.ts`. It treats bare specifiers whose first segment is a project folder (`pipeline/…`, `tools/…`) and root-absolute `/…` paths as project paths, and skips commented-out imports.
- Actions: checkout@v7, setup-node@v7, upload-pages-artifact@v5, deploy-pages@v5 (latest major tags on 2026-10-26).
- Matrix audit: added `tests/workflows.test.ts` so the "data-only push" row is covered. It asserts `ci.yml` `paths-ignore` on push and pull_request, plus the `pipeline.yml` triggers and concurrency settings.

## Spec Change Log

- **Loop 1 (review of iteration 0).** *Trigger:* the import checker enforced only the three named rules, but the spine says "arrows are the only allowed imports", so e.g. `shared → pipeline` or `tools → pipeline/stages` passed (medium). The spec also prescribed `lang="de"` on English placeholder pages (low). *Amended:* the import-rules task (full arrow allowlist, wider scan), the page task (`lang="en"`), plus the accepted patch-level findings folded into tasks: tests gate deploy in `pipeline.yml`, Pages/OIDC permissions only on the deploy job, CI `push` limited to `main`, About page build output asserted in tests and in the workflow, Vitest default excludes kept and `.test.tsx` included, `.mts/.js` files scanned. *Avoids:* layering violations going undetected in later stories; deploying code with failing tests; the bot UA pointing at a 404 without any check failing. *KEEP:* iteration 0's code is backed up at `/private/tmp/claude-502/-Users-eleni-Workspace-bgtsearch/1a0c928f-ff1f-4a85-882e-d55c5c624f80/scratchpad/impl-1-1-iter0/`. Reuse it as the starting point (copy it back, then apply the amended tasks) instead of re-running `create-preact`: its `package.json` pins, `package-lock.json` (includes Linux bindings for CI), `tsconfig.json` (`types: ["node","vite/client"]`, `allowImportingTsExtensions`), `vite.config.ts`, `pipeline/config.ts`, the pages (incl. `<link rel="icon" href="data:,">`), the `.gitkeep` folders, `README.md`, the action major versions (checkout@v7, setup-node@v7, upload-pages-artifact@v5, deploy-pages@v5) and `tests/workflows.test.ts` were all correct.

## Review Triage Log

| # | Finding (source) | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | About page not asserted as a build output (VG) | medium | Removing the `about` rollup input left tests, typecheck and build green while the UA URL would 404. | folded into loop 1 |
| 2 | `pipeline.yml` deploys without typecheck/tests (VG, BH, EC) | medium | Build job ran only `npm ci` + `build`; `ci.yml` runs independently and does not gate deploy. | folded into loop 1 |
| 3 | Vitest explicit `exclude` drops default excludes (VG, BH, EC) | low | `exclude` replaces `configDefaults.exclude`, and the root include would collect tests in ignored tool folders; none exist today, but the fix is a direct correction. | folded into loop 1 |
| 4 | Workflow tests only match text (VG) | false | Reviewer raised no defect; static config text is what these tests are for. | reject |
| 5 | Pages/OIDC permissions granted to the build job (BH) | medium | Workflow-level `pages: write` / `id-token: write` applied to the job that runs third-party install scripts. | folded into loop 1 |
| 6 | `paths-ignore` can block required PR checks (BH) | maybe-false | Only matters if `check` becomes a required status; no branch protection is configured, and if true it would be low. | reject |
| 7 | CI runs twice per PR (BH) | low | `push` on every branch + `pull_request` both fire for a PR branch; direct fix. | folded into loop 1 |
| 8 | Block-comment stripping ignores string literals (BH, EC) | low | A `'/*'` in a string before a later `*/` erases the code between; imports sit at the top so this is unlikely, and the fix needs a string-aware scanner. | reject |
| 9 | `require` / `import = require` / template imports not detected (BH, EC) | low | ESM package with `verbatimModuleSyntax`: `import x = require` is a compile error and `require` is undefined; unlikely, and the fix adds patterns. | reject |
| 10 | Only three rules enforced; spine says arrows are the only allowed imports (BH) | medium | Spine §Invariants: "Arrows are the only allowed imports." `shared → pipeline` and `tools → pipeline/stages` pass the checker. | bad_spec → loop 1 |
| 11 | One tsconfig mixes Node and DOM types (BH) | low | Web code could typecheck against `node:fs`, but Vite's browser build would still fail; the fix (project references) is structural. | reject |
| 12 | `.test.tsx` not collected / node env (BH) | low | The include pattern skips `.test.tsx`, which Story 1.2+ component tests need; widening the include is direct. The DOM environment is not needed until web tests exist. | folded into loop 1 (include only) |
| 13 | Site path defined in two places (BH) | false | `tests/site-config.test.ts` fails if `base` and `SITE_URL` diverge. | reject |
| 14 | About stub published as the bot's contact page (BH) | false | No outbound request is made until Story 1.3; Story 1.7 fills the page. | reject |
| 15 | `lang="de"` on English copy (BH) | low | Both pages declare German while their title and h1 are English, so screen readers mispronounce them. The spec prescribed it. | bad_spec → loop 1 |
| 16 | Main page is `noindex` (BH) | false | Required by the frozen intent for the private beta. | reject |
| 17 | No `engines` field (BH) | low | `.nvmrc` and CI pin Node 26; adding a guard is not a direct correction. | reject |
| 18 | `cheerio`/`zod` unused (BH) | false | Story 1.1 AC requires them installed. | reject |
| 19 | Workflow test regexes are fragile / CRLF (BH, EC) | low | Unlikely on macOS/Linux; CRLF normalisation is cheap, so it is folded into the kept workflow test. | reject (normalise kept) |
| 20 | Actions not SHA-pinned, no configure-pages, no Dependabot (BH) | low | Hardening and a new feature; `deploy-pages` works without `configure-pages`. | reject |
| 21 | `.gitignore` gaps; README omits env branch rule (BH) | low | No coverage tool or env files exist. GitHub creates `github-pages` with default-branch deploys when the Pages source is Actions. | reject |
| 22 | Reader can reach fetch through a barrel re-export (EC) | low | No barrel exists; the allowlist in loop 1 forbids readers importing any `pipeline/*` outside `readers`. | reject |
| 23 | `readdirSync` errors swallowed (EC) | low | A renamed or missing dir is ENOENT anyway; other errors are unlikely. | reject |
| 24 | `.mts/.cts/.js/.jsx` files not scanned (EC) | low | Direct regex widening. | folded into loop 1 |
| 25 | `workflow_dispatch` from a non-main branch deploys (EC) | maybe-false | GitHub's `github-pages` environment normally allows only the default branch; settle by checking the env's deployment-branch rule. If true, medium. | defer |
| 26 | Pending runs in the concurrency group are superseded (EC) | low | GitHub keeps one pending run per group; each deploy uses its own pushed SHA, so the latest code still ships. Revisit with Story 2.6 data commits. | reject |
| 27 | `main.tsx` silent if `#app` is missing (EC) | false | `web/index.html` contains `<div id="app">`; unreachable. | reject |
| 28 | UA regex rejects prerelease versions (EC) | low | Version is `0.1.0`; a prerelease bump is unlikely and the test would fail loudly. | reject |
| 29 | `web/**` outside `web/src` not scanned (EC) | low | `SCANNED_DIRS` held only `web/src` while the matrix says any `web/**` file; direct fix. | folded into loop 1 |
| 30 | `USER_AGENT` version not tied to `package.json` by any assertion (VG r2) | low | `site-config.test.ts` accepts any semver, so a hardcoded version would pass while `package.json` moves on; a one-line exact-equality assertion fixes it. | patch |
| 31 | Block-comment stripping ignores string literals (VG, BH, EC r2) | low | carried #8: code unchanged at `stripComments`. | reject |
| 32 | Trailing `// import …` comment reported as an import (BH, EC r2) | low | True: only whole-line `//` comments are dropped. It fails loudly (a false positive in the test, not a missed violation), it is unlikely, and stripping trailing comments safely needs string awareness. | reject |
| 33 | `require` / `import = require` / template / `vi.mock` / `new URL` loads not detected (BH, EC r2) | low | carried #9: same patterns. `new URL(…, import.meta.url)` and `vi.mock` do not import a module into the layer graph. | reject |
| 34 | Package imports not restricted per layer, e.g. readers using `node:http` (BH r2) | low | No reader exists. The spine's arrows govern project layers only, and Story 1.3's fetch client is the intended I/O path. A per-layer package policy would be new rules. | reject |
| 35 | Pipeline entry file directly under `pipeline/` has no layer (BH r2) | false | It fails loudly, and the test asserts that on purpose. Where the entry point lives is decided when Story 2.6 creates it. | reject |
| 36 | One tsconfig for Node and DOM (BH r2) | low | carried #11. | reject |
| 37 | No `erasableSyntaxOnly`, no Node run of `pipeline/`, target/lib mismatch (BH r2) | low | Nothing runs `pipeline/` under Node until Story 2.6, and no enums or namespaces exist. Revisit when the pipeline script lands. | reject |
| 38 | `actions/checkout` persists `GITHUB_TOKEN` while install scripts run (BH r2) | low | The build-job token is `contents: read` on a public repo, so it grants nothing beyond public read. Story 1.6 needs a push token in that job anyway. | reject |
| 39 | Actions on major tags, no `timeout-minutes` (BH r2) | low | carried #20. The default job timeout applies. | reject |
| 40 | `ci.yml` has no concurrency group; duplicate checks on `main` with `pipeline.yml` (BH r2) | low | Free runners and correct results; the duplicate check on `main` is the deploy gate from loop 1. | reject |
| 41 | Workflow tests regex-based, `ci.yml` under-tested, trailing-newline edge (BH, EC r2) | low | carried #19. All current files end in a newline, and any drift fails loudly. | reject |
| 42 | About page empty while the UA names it (BH r2) | false | carried #14. | reject |
| 43 | `noindex`, `lang="en"`, bgtsearch vs testplatz naming (BH r2) | false | `noindex` is required by the frozen intent. `lang` matches the English placeholder copy until Story 1.2. Naming comes from the spine (package/bot `bgtsearch`, repo `testplatz`). | reject |
| 44 | No `engines` field (BH r2) | low | carried #17. | reject |
| 45 | `#…` / `@/…` aliases treated as packages (EC r2) | false | No `imports` map or tsconfig `paths` exist, so such a specifier would fail the build loudly. | reject |
| 46 | Root-absolute `/…` in web resolved from repo root, not `web/` (EC r2) | low | Real mismatch, but every resulting error is loud (flagged, or Vite fails to resolve), and web code uses relative imports. | reject |
| 47 | `readdirSync` errors swallowed (EC r2) | low | carried #23. | reject |
| 48 | Directory named like a source file causes EISDIR (EC r2) | low | Fails loudly; no such directory is plausible. | reject |
| 49 | `paths-ignore` can block a required PR check (EC r2) | maybe-false | carried #6. | reject |
| 50 | `workflow_dispatch` from a non-main branch deploys (EC r2) | maybe-false | carried #25: already in `deferred-work.md`; not deferred again. | carried defer |
| 51 | `main.tsx` silent if `#app` is missing (EC r2) | false | carried #27. | reject |
| 52 | UA regex rejects prerelease versions (EC r2) | low | carried #28. | reject |

## Design Notes

- Use a separate `vitest.config.ts`. If Vitest picked up `vite.config.ts`, its `root: 'web'` would hide the `tests/`, `pipeline/` and `shared/` test files.
- The About page is a real path (`/about/`), not a fragment, because the fragment carries search state (`#q=…&r=…`). That keeps the bot UA URL stable through later stories and launch.
- `pipeline.yml` deploys the pushed SHA now. Story 1.6 inserts the "commit `data/public/` once, then deploy that SHA" step, and the job split (build → deploy) is kept so that step slots in before the build.

## Verification

**Commands:**
- `npm ci && npm run typecheck && npm test && npm run build` — expected: all exit 0.
- `grep -rEo '(src|href)="https?://[^"]+"|url\(https?://[^)]+\)' dist` — expected: no output.
- `grep -c 'name="robots" content="noindex"' dist/index.html dist/about/index.html` — expected: 1 each.
- Temporarily add `import '../../fetch/x'` to a reader file, run `npm test`, expect it to fail, then revert.
