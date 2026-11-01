<!-- bmad:context -->
<!-- Verified 2026-11-01 against 0cfa872cf5fafd10a9bb107e7e89603304a6b281. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## bgtsearch

Finds Einbürgerungstest dates near you in Bavaria: a static Preact site on GitHub Pages, fed by a Node pipeline that reads test centres' pages into `data/public/snapshot.json`. TypeScript throughout, run directly by Node (version in `.nvmrc`), built with Vite, tested with Vitest. Planning lives in `_bmad-output/planning-artifacts/` (`epics.md`, `architecture/`), story specs in `_bmad-output/implementation-artifacts/`, operator runbook in `docs/operations.md`.

## Running and verifying

- Run `npm run typecheck` and `npm test` before calling a change done; CI (`.github/workflows/ci.yml`) also runs `npm run check:directory` and `npm run build`.
- `npm test` gates publishing. Committed-data tests derive their expectations from the files and never fail on a legitimate data change.
- Run one file while iterating: `npx vitest run tests/<name>.test.ts`.
- Run `npm run geocode` after changing a centre address in `data/directory/centres.json`. Set coordinates by hand only when Nominatim cannot find the correct address, and then add the centre to `HAND_SET_CENTRES` in `tests/directory.test.ts`.

<!-- /bmad:context -->
