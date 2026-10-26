# Review — Verification lens (reality check of committed decisions)

- **Target:** `ARCHITECTURE-SPINE.md` (updated 2026-10-26) and `.memlog.md`
- **Reviewed:** 2026-10-26
- **Lens:** were the committed decisions (Stack versions, named tools, platform facts) checked against reality, or asserted from memory?
- **Method:** `npm view` for versions, release dates, peers and engines; inspected the `create-preact@0.6.0` tarball, unpacked but never run; nodejs.org `dist/index.json` and the `nodejs/Release` schedule; GitHub Docs, the GitHub product terms and action READMEs; the Nominatim usage policy; zod and cheerio docs; Vitest 5 release notes.

## Verdict

**Mostly sound, with one stack decision to fix before building.** Every version in the Stack table exists and is current. The library pairings fit together: Preact 11 ↔ preset-vite 2.10 ↔ Vite 8 ↔ Vitest 5. Most platform claims check out. But:

- **TypeScript 7.0 is the native Go compiler and ships no compiler API.** Anything that loads TypeScript as a library (typescript-eslint and similar) cannot use it.
- **Two operations claims are weaker than the spine states.** One is the claim that bot commits prevent the 60-day schedule disable. The other is the self-hosted runner fallback, which GitHub explicitly warns against for public repos.
- **Code changes may never deploy.** The pipeline workflow has no trigger for pushes by people, so nothing in the spine says how a code change reaches the site.

The memlog's `version` entries only cover Node, TS, Vite, cheerio and zod. Preact, preset-vite and Vitest are now verified here (see table).

## Verified facts (no action needed)

| Claim in spine | Reality (2026-10-26) | Source |
| --- | --- | --- |
| Vite 8.3 | `vite@8.3.5` latest (2026-10-21). Engines `^20.19 \|\| >=22.12`. Bundled with rolldown ~1.2. | npm |
| Preact 11.0 | `preact@11.0.2` latest (11.0.0 released 2026-09-30, stable, not beta). | npm |
| @preact/preset-vite 2.10 | `2.10.6` (2026-07-18). Peer `vite: 2.x … 8.x`, `@babel/core 7.x`. Its `@prefresh/vite` peers on `preact ^10.4 \|\| ^11.0.0-0`. Fits Preact 11 + Vite 8. | npm |
| `npm create preact` is the starter | `create-preact@0.6.0` (2026-09-30). Base template: `preact ^11.0.0`, `@preact/preset-vite ^2.10.6`, `vite ^8.3.1`. Prompts for TS / router / prerender / ESLint. | npm tarball |
| cheerio 1.2 | `cheerio@1.2.0` (2026-01-23), still latest. ESM + CJS + browser builds. Node ≥ 20.18.1. | npm, cheerio docs |
| zod 4.6 | `zod@4.6.7` (2026-10-12). `z.iso.datetime({ offset: true })` exists and fits AD-11's Berlin-offset strings. | npm, zod.dev/api |
| Vitest 5.0 | `vitest@5.0.5`. Peer `vite ^6.4 \|\| ^7 \|\| ^8`. Engines `^22.12 \|\| ^24 \|\| >=26`. 5.0 requires Node 22+ and Vite 6.4+. Fits. | npm, Vitest v5.0.0 release notes |
| Schedule can be delayed or dropped; runs on default branch only | Confirmed. Docs say runs "can be delayed during periods of high loads" and that some queued jobs "may be dropped". | GitHub Docs: events that trigger workflows |
| GITHUB_TOKEN pushes don't trigger other workflows | Confirmed: other GITHUB_TOKEN-triggered events "do not create workflow runs at all" (except `workflow_dispatch` / `repository_dispatch`). So there is no CI loop, and ci.yml would not run on bot commits even without `paths-ignore`. | GitHub Docs |
| Pages limits | 1 GB site; 100 GB/month soft bandwidth; 10-minute deploy timeout; 10 builds/h soft limit, which does **not** apply to custom Actions workflows. `upload-pages-artifact` tar must be < 10 GB (recommended < 1 GB). | GitHub Pages limits, upload-pages-artifact README |
| Standard runners free on public repos; self-hosted "free for public repos" | The Dec 2025 changelog adds a $0.002/min platform charge for self-hosted runners from 2026-03-01, but says public-repo usage "will remain free". | GitHub changelog 2025-12-16 |
| Nominatim ≤ 1 req/s | Correct as an absolute maximum. Other conditions apply (see F-8). | OSMF Nominatim usage policy |

## Findings

### HIGH

**F-1 — TypeScript 7.0 has no programmatic compiler API, so any lint or tool that imports `typescript` breaks.**

- **Evidence:**
  - `typescript@7.0.2` (GA 2026-07-08) is the Go port. It installs per-platform binaries (`@typescript/typescript-<os>-<arch>`).
  - Its package `exports["."]` is only `./lib/version.cjs`. Everything else sits under `./unstable/*`.
  - `typescript-eslint@8.72.0` has peer `typescript: >=4.8.4 <6.1.0`.
  - InfoQ and the TS 7 coverage report that the stable API is expected in 7.1 (currently `7.1.0-beta`). Tools that import the compiler should stay on 6.0, available as the `@typescript/typescript6` package (`6.0.2`).
- **What still works:**
  - Vite and Vitest do not type-check; they strip types with oxc/rolldown. Running `tsc --noEmit` from the TS 7 binary is fine.
  - Vitest's `typecheck` mode shells out to the `tsc` CLI. It probably works, but this is **unverified**.
  - Note also that options deprecated in TS 6.0 (`baseUrl`, `target: es5`, classic `moduleResolution`) are hard errors in 7.0.
- **What breaks:**
  - typescript-eslint, which also blocks type-aware ESLint rules.
  - `ts-morph` and any custom script that does `import ts from 'typescript'`.
  - Possibly editor plugins.
- **Fix:** pick one and record it as a decision:
  - **(a)** Pin `typescript@~6.0.3` for everything until 7.1 ships a stable API (simplest).
  - **(b)** Keep TS 7.0 for `tsc --noEmit` in CI, and add `"typescript6": "npm:@typescript/typescript6@6.0.2"` (or an equivalent alias) for library consumers. State in the spine that no project code may import `typescript`.

  Either way, change the Stack row to say "TypeScript 7.0 (CLI type-check only; no compiler API until 7.1)" or "6.0".
- **Sources:** npm (`typescript`, `typescript-eslint`, `@typescript/typescript6`); InfoQ "TypeScript 7 released" (2026-08); devblogs.microsoft.com "Announcing TypeScript 7.0 RC"; blog.openreplay.com/upgrade-typescript-7.

**F-2 — The self-hosted fallback on a public repo is a documented security anti-pattern, and the spine presents it as a free, easy swap.**

- **Evidence:**
  - GitHub Docs (Secure use reference): self-hosted runners "should almost never be used for public repositories". Anyone who can fork and open a PR can "compromise the self-hosted runner environment".
  - A runner on a home machine puts the operator's LAN and personal machine within reach of fork PRs.
- **Fix:** replace the fallback with one of these, and state the guardrails in the spine.
  - **Preferred: drop the runner.** Run `npm run pipeline` from a local cron/launchd job on the home machine. Push `data/` with a deploy key or a fine-grained PAT scoped to this repo. Let a `push` trigger (paths `data/public/**`) on `pipeline.yml` / `deploy.yml` build and deploy on a GitHub-hosted runner. Unlike GITHUB_TOKEN pushes, PAT/deploy-key pushes *do* trigger workflows. This keeps "one command, no cloud dependency" with no exposed runner.
  - **If a runner is kept:** use an ephemeral/JIT runner in a container or VM. Bind it only to `schedule` / `workflow_dispatch` jobs, never to `pull_request*`. Set "Require approval for all outside collaborators" on fork PR workflows. Give it no access to personal files.
- **Source:** docs.github.com/en/actions/reference/security/secure-use.

### MEDIUM

**F-3 — "Every run commits, which prevents the 60-day disable" is unproven for `github-actions[bot]` commits.**

- **Evidence:**
  - Docs say only that public-repo schedules are disabled "when no repository activity has occurred in 60 days". The disable/enable page does not define activity.
  - Commit-based keepalive tools exist and appear to work, which suggests bot pushes count. No GitHub source confirms this for GITHUB_TOKEN commits.
  - The most popular keepalive repo (`gautamkrishnar/keepalive-workflow`) is now "disabled by GitHub Staff due to a violation of GitHub's terms of service". So don't adopt a dummy-commit keepalive.
- **Also note:** the spine's real commits happen only when data changes, unless "every run commits" is enforced. AD-12 implies a commit every run (`last_checked_at` always changes), which is good. Keep that explicit.
- **Fix:**
  - Downgrade the memlog decision text to an *assumption*.
  - Add a watchdog that doesn't depend on the scheduled workflow itself, for example:
    - the operator's GitHub notification email before disable (GitHub warns before disabling);
    - a calendar reminder to push a real commit every ~50 days;
    - a `workflow_dispatch` path the operator can hit.
  - Note how to re-enable: `gh workflow enable pipeline.yml`.
  - Optionally have the job call `PUT /repos/{owner}/{repo}/actions/workflows/{id}/enable` with `actions: write`. It's harmless when already enabled. Whether it resets the timer is unverified.
- **Sources:** GitHub Docs (events that trigger workflows; disable-and-enable workflows); github.com/gautamkrishnar/keepalive-workflow (repo notice); npmjs.com/package/keepalive-workflow.

**F-4 — There is no deploy path for code changes made by people.**

- **Evidence:** `pipeline.yml` is "schedule + deploy" and `ci.yml` is code CI only. So a merged web/pipeline change isn't deployed until the next scheduled run, up to ~6 h later, or longer if a run is dropped. GitHub docs confirm the bot's own push can't trigger anything.
- **Fix:**
  - Give `pipeline.yml` (or a separate `deploy.yml`) a `push: branches: [main]` trigger with `paths-ignore: ['data/**']` for code, plus `workflow_dispatch`.
  - Put both in the same concurrency group as the pipeline so deploys never interleave with a run.
  - Add `concurrency: pages` (`cancel-in-progress: false`) around the deploy job, as the Pages starter workflows do.

**F-5 — The GitHub Actions terms put scheduled scraping in a grey zone; the spine doesn't acknowledge it.**

- **Evidence:** the Additional Product Terms say that on GitHub-hosted runners, Actions must not be used for "any other activity unrelated to the production, testing, deployment, or publication of the software project". They also bar using Actions "as part of a serverless application".
- **Assessment:** collecting data and publishing it as the project's own site is arguably "publication of the software project". This "git scraping" pattern is widely used and tolerated, but it is not explicitly blessed. Combined with F-3, the risk is GitHub disabling the workflow or repo, not a bill.
- **Fix:**
  - Record this as a known risk.
  - Keep request volume tiny (it already is).
  - Keep the "runs anywhere with one command" property, so the F-2 local-cron path is the documented exit.
- **Source:** docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features.

**F-6 — Node 24 entered Maintenance LTS six days ago; Node 26 becomes Active LTS on 2026-10-28.**

- **Evidence:** the nodejs/Release `schedule.json` lists:

  | Version | Active LTS | Maintenance | EOL |
  | --- | --- | --- | --- |
  | v24 (Krypton) | — | since 2026-10-20 | 2028-04-30 |
  | v26 | from 2026-10-28 | — | 2029-04-30 |

  Latest releases: `v24.22.1` and `v26.12.1`. The memlog's "26 not LTS yet" is true today and stale in two days.
- **Fix:** Node 24 is still a valid choice (security fixes until April 2028). For a project starting now, prefer Node 26 once it is LTS on 28 Oct, or record 24 deliberately. Pin it via `.nvmrc` / `engines` and `actions/setup-node` `node-version-file`. All stack packages support both versions.

### LOW

**F-7 — The `npm create preact` ESLint option is broken today; the starter is a standalone app, not a monorepo member.**

- **ESLint:**
  - The scaffolder installs `eslint@latest` (10.13.0), but `eslint-config-preact@2.0.0` peers on `eslint ^8.57.1 || ^9`.
  - The scaffolder writes a legacy `eslintConfig` key into package.json. Flat-config ESLint 9/10 ignores it.
- **TypeScript:** choosing TS renames `jsconfig.json` to `tsconfig.json` and installs `typescript@latest`, which is 7.0.2 (see F-1).
- **Layout:** the template generates its own `package.json` and `vite.config.js`. The spine has `shared/`, `pipeline/`, `web/` and `tools/` importing each other, so it needs either npm workspaces or a single root package. That isn't decided.
- **Vitest:** Vitest 5 no longer looks up config files in ancestor directories, which affects how tests are run across folders.
- **Fix:**
  - Scaffold with ESLint off and set up flat config yourself, using typescript-eslint against TS 6 (see F-1).
  - Add a "Repo layout" line: either one root package with Vitest `projects`, or workspaces.

**F-8 — Nominatim and OSM obligations go beyond "≤ 1 req/s".**

- **The policy also requires:**
  - an identifying User-Agent or Referer (library defaults are rejected);
  - caching of results;
  - single-thread, single-machine operation;
  - limits on periodic jobs: anything recurring or running over a day drops to 4 req/min.
- **It forbids:** systematic enumeration of postcodes, for example.
- **Data licence:** the data is ODbL, so attribution is needed.
- **For this project:** about 116 one-off lookups are fine.
- **Fix:**
  - Extend AD-7 to say `tools/geocode` sends a `bgtsearch` UA and caches results by query. It is operator-run, never scheduled.
  - Say `tools/build-places` must use an offline OSM extract, **never** Nominatim. Building a postcode table through Nominatim is "systematic querying".
  - Add "© OpenStreetMap contributors (ODbL)" to the site footer or About page.
- **Source:** operations.osmfoundation.org/policies/nominatim/.

**F-9 — The cheerio loading API matters for AD-3 and AD-5.**

- **Evidence:** `cheerio.fromURL()` does its own network I/O. `load()` takes already-decoded strings. Only `loadBuffer()` and `decodeStream()` sniff the charset; some VHS/KuferWeb pages may not be UTF-8.
- **Fix:**
  - State that readers may only call `load`/`loadBuffer`, and add a lint or grep check banning `fromURL`.
  - Define `FetchedPage` as raw bytes plus `content-type`, with readers using `loadBuffer`, or have fetch decode using the charset and readers using `load`.

**F-10 — Smaller accuracy notes.**

- **Concurrency:** by default (`queue: single`) a newer pending run *cancels* an older pending one, while a running job continues. That's the right behaviour here. Don't set `cancel-in-progress: true` on the pipeline, or a mid-commit run could be killed. The new `queue: max` option exists but isn't needed. The rebase-and-retry still matters for pushes by people racing the bot.
- **Branch protection:** rulesets that require PRs or status checks on `main` will reject the bot's direct push. Note that a bypass is needed (or no rule on `data/**`).
- **Permissions:** new repos default the workflow token to read-only. The workflow needs explicit `permissions: contents: write, pages: write, id-token: write, issues: write`. Deploy uses `actions/upload-pages-artifact@v5` + `actions/deploy-pages@v5` (latest v5.0.0 / v5.0.1) and the `github-pages` environment, which is protected to the default branch by default.
- **"Private beta":** a Pages site from a free public repo is publicly reachable. "Private beta" means unlisted, not access-controlled. Say so, so nobody assumes otherwise.
- **≤ 12 h freshness:** this is not guaranteed, because scheduled runs can be dropped. The UI's stale handling (AD-11) already covers it; just don't promise 12 h as an SLA.

## Suggested spine edits (summary)

1. **Stack:** change TypeScript to "6.0" or "7.0 (tsc CLI only)", with a rule that nothing imports `typescript` (F-1). Change Node to "26.x LTS (from 2026-10-28)" or keep 24 with its EOL noted (F-6).
2. **Deployment › Fallback:** replace the self-hosted runner with local cron + deploy-key push. If a runner stays, add its guardrails (F-2, F-5).
3. **AD-12 / Deployment:** add the push/dispatch deploy trigger, the shared concurrency group and the permissions block (F-4, F-10). Downgrade the 60-day claim to an assumption and add a watchdog (F-3).
4. **AD-7:** add the Nominatim UA, caching and "never scheduled" rules; `build-places` uses no Nominatim; OSM attribution (F-8).
5. **AD-3:** readers use `cheerio.load`/`loadBuffer` only; define charset handling in `FetchedPage` (F-9).
6. **Structural seed:** decide on workspaces or a single package; scaffold Preact without the ESLint option (F-7).

## Sources

- npm registry via `npm view` (2026-10-26): typescript, vite, preact, @preact/preset-vite, @prefresh/vite, cheerio, zod, vitest, create-preact (tarball inspected), eslint, eslint-config-preact, typescript-eslint, @typescript/typescript6
- https://nodejs.org/dist/index.json ; https://raw.githubusercontent.com/nodejs/Release/main/schedule.json ; https://nodejs.org/en/about/previous-releases
- https://infoq.com/news/2026/08/typescript-7-released/ ; https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-rc/ ; https://blog.openreplay.com/upgrade-typescript-7/
- https://github.com/vitest-dev/vitest/releases/tag/v5.0.0
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
- https://docs.github.com/en/actions/reference/security/secure-use
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features
- https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/
- https://github.com/actions/deploy-pages (README, v5.0.1) ; https://github.com/actions/upload-pages-artifact (README, v5.0.0)
- https://github.com/gautamkrishnar/keepalive-workflow (repo disabled notice) ; https://npmjs.com/package/keepalive-workflow
- https://operations.osmfoundation.org/policies/nominatim/
- https://zod.dev/api ; https://cheerio.js.org/docs/basics/loading/
