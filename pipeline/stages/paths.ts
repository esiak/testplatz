/** File locations the pipeline stages read and write. Stages read data files with `node:fs`. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIRECTORY_PATH = fileURLToPath(new URL('../../data/directory/centres.json', import.meta.url));
export const PUBLIC_DIR = fileURLToPath(new URL('../../data/public', import.meta.url));
export const SNAPSHOT_FILE = 'snapshot.json';
export const SNAPSHOT_PATH = join(PUBLIC_DIR, SNAPSHOT_FILE);
export { VISIT_LOG_PATH } from '../fetch/visits.ts';
/** Merge's history file (AD-6); only `pipeline/stages/merge.ts` writes it. */
export const STATE_PATH = fileURLToPath(new URL('../../data/state/state.json', import.meta.url));
/** The venue cache (FR36); only `pipeline/stages/merge.ts` writes it. */
export const VENUES_PATH = fileURLToPath(new URL('../../data/state/venues.json', import.meta.url));
/** The local coverage script's working directory (Story 4.2); gitignored, never committed. */
export const COVERAGE_DIR = fileURLToPath(new URL('../../data/coverage', import.meta.url));
/** One JSON file per fetched URL, written only by `coverage-script.ts --fetch`. */
export const COVERAGE_CACHE_DIR = join(COVERAGE_DIR, 'cache');
/** Reader assignments proposed for reader-`none` centres, for operator review. */
export const READER_PROPOSALS_PATH = join(COVERAGE_DIR, 'reader-proposals.json');
/** Test pages proposed by `--discover` (Story 4.3) for centres without one, for operator review. */
export const TEST_PAGE_PROPOSALS_PATH = join(COVERAGE_DIR, 'test-page-proposals.json');
