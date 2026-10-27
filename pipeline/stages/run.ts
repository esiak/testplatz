/**
 * The pipeline entry point (`npm run pipeline`). Epic 1 has no readers, so it only publishes
 * `data/public/snapshot.json` from the directory. Exits 1 when anything fails; nothing is written then.
 *
 *   node pipeline/stages/run.ts
 */
import { runPublish } from './publish.ts';

if (import.meta.main) {
	process.exitCode = runPublish();
}
