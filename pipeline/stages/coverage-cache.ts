/**
 * The coverage script's page cache (Story 4.2): one JSON file per URL in `data/coverage/cache/`
 * (gitignored), named by the SHA-256 of the URL. Only `coverage-script.ts --fetch` writes it; the
 * offline parse only reads it.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';

/** What fetching a URL came to: `ok` (2xx, body kept), `unreachable`, `robots` (disallowed) or `budget` (host over budget). */
export const CACHE_RESULTS = ['ok', 'unreachable', 'robots', 'budget'] as const;
export type CacheResult = (typeof CACHE_RESULTS)[number];

export const cacheEntrySchema = z
	.strictObject({
		url: z.string().min(1),
		fetched_at: z.iso.datetime(),
		result: z.enum(CACHE_RESULTS),
		/** HTTP status; `null` when no response was received. */
		status: z.number().int().nullable(),
		/** The URL after redirects; `null` when no response was received. */
		final_url: z.string().nullable(),
		/** The decoded body; set only when `result` is `ok`. */
		html: z.string().nullable(),
	})
	.refine((entry) => (entry.result === 'ok') === (entry.html !== null), { message: 'html must be set exactly when result is "ok"', path: ['html'] });

export type CacheEntry = z.infer<typeof cacheEntrySchema>;

/** The cache file name for `url`: the hex SHA-256 of the URL plus `.json`. */
export const cacheFileName = (url: string): string => `${createHash('sha256').update(url).digest('hex')}.json`;

/** The cached entry for `url` in `dir`, or `null` when there is none. Throws, naming the file, when it is unreadable or invalid. */
export function readCacheEntry(dir: string, url: string): CacheEntry | null {
	const path = join(dir, cacheFileName(url));
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (caught) {
		if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw new Error(`cannot read cache entry ${path}: ${(caught as Error).message}`);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (caught) {
		throw new Error(`cache entry ${path} is not valid JSON (delete it or refetch with --fetch --refresh): ${(caught as Error).message}`);
	}
	const parsed = cacheEntrySchema.safeParse(data);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new Error(`cache entry ${path} is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
	}
	if (parsed.data.url !== url) throw new Error(`cache entry ${path} holds ${parsed.data.url}, not ${url}`);
	return parsed.data;
}

/** Validates `entry` and writes it atomically to its file in `dir`. */
export function writeCacheEntry(dir: string, entry: CacheEntry): void {
	writeJsonAtomic(join(dir, cacheFileName(entry.url)), cacheEntrySchema.parse(entry));
}

/** Writes `value` as tab-indented JSON to `path` via a temp file in the same directory and a rename. */
export function writeJsonAtomic(path: string, value: unknown): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });
	const temp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
	try {
		writeFileSync(temp, `${JSON.stringify(value, null, '\t')}\n`);
		renameSync(temp, path);
	} catch (caught) {
		rmSync(temp, { force: true });
		throw caught;
	}
}
