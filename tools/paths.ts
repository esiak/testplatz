/** File locations shared by the directory tools. Tools read and write data files with `node:fs`. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIRECTORY_DIR = fileURLToPath(new URL('../data/directory/', import.meta.url));
export const CENTRES_FILE = 'centres.json';
export const REVIEW_NOTE_FILE = 'review-note.md';
export const CENTRES_PATH = join(DIRECTORY_DIR, CENTRES_FILE);
export const REVIEW_NOTE_PATH = join(DIRECTORY_DIR, REVIEW_NOTE_FILE);
