/** File locations shared by the directory tools. Tools read and write data files with `node:fs`. */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIRECTORY_DIR = fileURLToPath(new URL('../data/directory/', import.meta.url));
export const CENTRES_FILE = 'centres.json';
export const REVIEW_NOTE_FILE = 'review-note.md';
export const CENTRES_PATH = join(DIRECTORY_DIR, CENTRES_FILE);
export const REVIEW_NOTE_PATH = join(DIRECTORY_DIR, REVIEW_NOTE_FILE);
export const GEOCODE_CACHE_FILE = 'geocode-cache.json';
export const GEOCODE_NOTE_FILE = 'geocode-note.md';
export const GEOCODE_CACHE_PATH = join(DIRECTORY_DIR, GEOCODE_CACHE_FILE);
export const GEOCODE_NOTE_PATH = join(DIRECTORY_DIR, GEOCODE_NOTE_FILE);
export const PLACES_DIR = fileURLToPath(new URL('../data/places/', import.meta.url));
export const PLACES_CACHE_DIR = join(PLACES_DIR, 'cache');
export const PLACES_NOTE_FILE = 'places-note.md';
export const PLACES_NOTE_PATH = join(PLACES_DIR, PLACES_NOTE_FILE);
export const PUBLIC_DIR = fileURLToPath(new URL('../data/public/', import.meta.url));
export const PLACES_FILE = 'places.json';
export const PLACES_PATH = join(PUBLIC_DIR, PLACES_FILE);
