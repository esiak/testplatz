/** File locations the pipeline stages read and write. Stages read data files with `node:fs`. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIRECTORY_PATH = fileURLToPath(new URL('../../data/directory/centres.json', import.meta.url));
export const PUBLIC_DIR = fileURLToPath(new URL('../../data/public', import.meta.url));
export const SNAPSHOT_FILE = 'snapshot.json';
export const SNAPSHOT_PATH = join(PUBLIC_DIR, SNAPSHOT_FILE);
export { VISIT_LOG_PATH } from '../fetch/visits.ts';
