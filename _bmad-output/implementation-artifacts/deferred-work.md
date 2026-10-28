- source_spec: `_bmad-output/planning-artifacts/epics.md` (Story 1.11)
  summary: Complete the place table — all 16 states plus the Bavaria boundary (`places.json` `complete: true`), and unskip the committed-data boundary test in `tests/places.test.ts` (remove the `runIf` guard, don't keep it).
  evidence: Deferred out of Epic 1 by the operator on 2026-10-28 — the public Overpass run in `tools/build-places` is very slow and fails (Story 1.5 managed 2 of 38 queries in about 25 minutes). `data/places/places-note.md` lists the 29 missing `ags-*` queries and the missing `bavaria` boundary. Worth reconsidering the data source (the spine leaves the dataset choice open) rather than retrying the same public server. Until it lands, search must handle `complete: false` itself — see Epic 1 retro action item 3 (Essen → Essenbach, Lindau → "Bavaria only").
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Story 1.10)
  summary: Search from my location ("Use my location", nearest Bavarian town, Bavaria-only and denied-location errors; FR26).
  evidence: Deferred out of Epic 1 by the operator on 2026-10-28 together with 1.11, which it depends on — the location check needs the Bavaria boundary that `places.json` does not have yet.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-6-publish-a-snapshot-of-all-centres.md`
  summary: No test executes the `npm run pipeline` entry point (`pipeline/stages/run.ts`) or checks its exit code.
  evidence: Low. Tests call `runPublish` directly; dropping the `process.exitCode` assignment would pass every test.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-9-place-suggestions-while-typing.md`
  summary: On touch or pen input, `preventDefault` on pointer-down may not keep focus in the field, so the suggestion list could close before a tapped row registers (`web/src/search/search-bar.tsx`).
  evidence: Medium if true, unverified. happy-dom and desktop Chrome keep focus; settle by tapping a suggestion on a real iOS and Android phone (Epic 1 retro action item 7).
