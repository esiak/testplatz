/**
 * Geocodes the centre addresses in data/directory/centres.json with Nominatim's structured `/search`.
 *
 *   node tools/geocode.ts
 *
 * Manual, serial, cached and ≤ 1 req/s (AD-5). Every successful lookup is cached by query in
 * geocode-cache.json, so a rerun sends no requests. Only street-level matches inside Bavaria whose
 * postcode agrees are accepted; anything else is reported in geocode-note.md and left without
 * coordinates (never a guess). Coordinates with no record in the cache were set by hand and are
 * left alone. Writes only data/directory/; the operator reviews and commits.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createFetchClient, nativeFetch, type FetchImpl } from '../pipeline/fetch/index.ts';
import { assessHit, hitSchema, parseNominatim, searchUrl, type Assessment, type NominatimHit } from '../pipeline/fetch/nominatim.ts';
import { NOMINATIM_DELAY_MS, NOMINATIM_ROBOTS_EXEMPT, NOMINATIM_SEARCH_URL, USER_AGENT } from '../pipeline/config.ts';
import { directorySchema, serializeDirectory, type Address, type Centre } from '../shared/directory.ts';
import { CENTRES_FILE, DIRECTORY_DIR, GEOCODE_CACHE_FILE, GEOCODE_NOTE_FILE } from './paths.ts';

export { MIN_PLACE_RANK, parseNominatim, searchUrl, type Assessment, type NominatimHit } from '../pipeline/fetch/nominatim.ts';

export const cacheSchema = z.strictObject({
	queries: z.record(z.string(), z.strictObject({ fetched_at: z.iso.datetime(), result: hitSchema.nullable() })),
	centres: z.record(z.string(), z.strictObject({ query: z.string(), lat: z.number(), lon: z.number() })),
});

export type GeocodeCache = z.infer<typeof cacheSchema>;

/** The cache key for one address: `"<street>, <postcode> <city>"`. */
export const queryKey = (address: Address): string => `${address.street}, ${address.postcode} ${address.city}`;

/** Pure: the shared acceptance rules (pipeline/fetch/nominatim) for a centre's address. */
export const assessResult = (result: NominatimHit | null, entry: Centre): Assessment => assessHit(result, entry.address.postcode);

const sortKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value === null || typeof value !== 'object') return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.sort()
			.map((key) => [key, sortKeys(record[key])]),
	);
};

/** The canonical cache file text: keys sorted at every level, tab-indented, trailing newline. */
export const serializeCache = (cache: GeocodeCache): string => `${JSON.stringify(sortKeys(cache), null, '\t')}\n`;

/** A missing file is an empty cache; an unreadable or invalid one is an error. */
export function loadCache(path: string): { ok: true; cache: GeocodeCache } | { ok: false; message: string } {
	if (!existsSync(path)) return { ok: true, cache: { queries: {}, centres: {} } };
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (caught) {
		return { ok: false, message: `${path} is not valid JSON: ${(caught as Error).message}` };
	}
	const parsed = cacheSchema.safeParse(data);
	if (!parsed.success) return { ok: false, message: `${path} is invalid:\n${parsed.error.message}` };
	return { ok: true, cache: parsed.data };
}

function loadDirectory(path: string): { ok: true; centres: Centre[] } | { ok: false; message: string } {
	if (!existsSync(path)) return { ok: false, message: `${path} not found; run npm run seed:directory first` };
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (caught) {
		return { ok: false, message: `${path} is not valid JSON: ${(caught as Error).message}` };
	}
	const parsed = directorySchema.safeParse(data);
	if (!parsed.success) return { ok: false, message: `${path} is invalid; run npm run check:directory for details` };
	return { ok: true, centres: parsed.data };
}

export interface ListedEntry {
	centre_id: string;
	query: string;
	reason: string;
}

export interface GeocodeCounts {
	requests: number;
	cacheHits: number;
	accepted: number;
	rejected: number;
	unchanged: number;
	handSet: number;
	failed: number;
}

export interface GeocodeNoteInput {
	runAt: string;
	centres: number;
	counts: GeocodeCounts;
	rejected: readonly ListedEntry[];
	failures: readonly ListedEntry[];
	handSet: readonly ListedEntry[];
	allWithUserAgent: boolean;
	allToSearch: boolean;
	/** Smallest gap between the starts of two requests in ms, or null with fewer than two requests. */
	minGapMs: number | null;
}

export function geocodeNote(input: GeocodeNoteInput): string {
	const { counts } = input;
	const list = (title: string, entries: readonly ListedEntry[]): string[] => [
		`## ${title}`,
		'',
		...(entries.length === 0 ? ['None.'] : entries.map((e) => `- ${e.centre_id} (${e.query}): ${e.reason}`)),
		'',
	];
	const lines = [
		'# Geocoding note',
		'',
		'Coordinates from Nominatim structured search. Data © OpenStreetMap contributors (ODbL).',
		'',
		'## Run',
		'',
		`- Run at: ${input.runAt}`,
		`- Centres in directory: ${input.centres}`,
		`- Requests sent: ${counts.requests}`,
		`- Cache hits: ${counts.cacheHits}`,
		`- Accepted: ${counts.accepted}`,
		`- Rejected: ${counts.rejected}`,
		`- Unchanged (already geocoded, same address): ${counts.unchanged}`,
		`- Coordinates set by hand: ${counts.handSet}`,
		`- Failed: ${counts.failed}`,
		`- Every request sent User-Agent \`${USER_AGENT}\`: ${input.allWithUserAgent ? 'yes' : 'NO'}`,
		`- Every request went to ${NOMINATIM_SEARCH_URL}: ${input.allToSearch ? 'yes' : 'NO'}`,
		`- Smallest gap between two requests: ${input.minGapMs === null ? 'n/a (fewer than two requests)' : `${input.minGapMs} ms`}`,
		'',
		...list('Rejected (no coordinates)', input.rejected),
		...list('Failures (entry unchanged, rerun to retry)', input.failures),
		...list('Coordinates set by hand (left alone)', input.handSet),
	];
	return `${lines.join('\n').trimEnd()}\n`;
}

export interface GeocodeOptions {
	/** Directory holding centres.json, geocode-cache.json and geocode-note.md. */
	dir?: string;
	fetchImpl?: FetchImpl;
	delayMs?: number;
	timeoutMs?: number;
	now?: () => Date;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

const searchUrlPrefix = `${NOMINATIM_SEARCH_URL}?`;

/** Geocodes what needs it, writes centres.json, geocode-cache.json and geocode-note.md; returns the exit code. */
export async function runGeocode(options: GeocodeOptions = {}): Promise<number> {
	const { dir = DIRECTORY_DIR, now = () => new Date(), log = console.log, error = console.error } = options;
	const centresPath = join(dir, CENTRES_FILE);
	const cachePath = join(dir, GEOCODE_CACHE_FILE);
	const notePath = join(dir, GEOCODE_NOTE_FILE);
	const runAt = now().toISOString();

	const loaded = loadDirectory(centresPath);
	if (!loaded.ok) {
		error(loaded.message);
		return 1;
	}
	const loadedCache = loadCache(cachePath);
	if (!loadedCache.ok) {
		error(loadedCache.message);
		return 1;
	}
	const centres = loaded.centres;
	const cache: GeocodeCache = structuredClone(loadedCache.cache);
	const cacheBefore = serializeCache(loadedCache.cache);

	const baseFetch = options.fetchImpl ?? nativeFetch;
	let allWithUserAgent = true;
	let allToSearch = true;
	const starts: number[] = [];
	const checkedFetch: FetchImpl = (url, init) => {
		starts.push(performance.now());
		if (new Headers(init.headers).get('user-agent') !== USER_AGENT) allWithUserAgent = false;
		if (!url.startsWith(searchUrlPrefix)) allToSearch = false;
		return baseFetch(url, init);
	};
	const client = createFetchClient({
		fetchImpl: checkedFetch,
		delayMs: options.delayMs ?? NOMINATIM_DELAY_MS,
		timeoutMs: options.timeoutMs,
		robotsExempt: [NOMINATIM_ROBOTS_EXEMPT],
	});

	const counts: GeocodeCounts = { requests: 0, cacheHits: 0, accepted: 0, rejected: 0, unchanged: 0, handSet: 0, failed: 0 };
	const rejected: ListedEntry[] = [];
	const failures: ListedEntry[] = [];
	const handSet: ListedEntry[] = [];
	const next: Centre[] = [];

	for (const centre of centres) {
		const query = queryKey(centre.address);
		const record = cache.centres[centre.centre_id];
		if (centre.lat !== null && (record === undefined || record.lat !== centre.lat || record.lon !== centre.lon)) {
			counts.handSet++;
			handSet.push({
				centre_id: centre.centre_id,
				query,
				reason: record === undefined ? 'no geocode record' : 'coordinates differ from the geocode record',
			});
			next.push(centre);
			continue;
		}
		if (centre.lat !== null && record !== undefined && record.query === query) {
			counts.unchanged++;
			next.push(centre);
			continue;
		}

		let cached = cache.queries[query];
		if (cached !== undefined) {
			counts.cacheHits++;
		} else {
			counts.requests++;
			const response = await client.get(searchUrl(centre.address));
			const parsed = response.ok ? parseNominatim(response.text) : null;
			if (parsed === null) {
				const reason = !response.ok
					? `${response.reason}${response.status !== null ? ` ${response.status}` : ''}`
					: 'invalid response body';
				log(`[${counts.requests}] ${query} → failed: ${reason}`);
				counts.failed++;
				failures.push({ centre_id: centre.centre_id, query, reason });
				next.push(centre);
				continue;
			}
			cached = { fetched_at: now().toISOString(), result: parsed.result };
			cache.queries[query] = cached;
			log(`[${counts.requests}] ${query} → ${parsed.result === null ? 'no match' : parsed.result.display_name}`);
		}

		const verdict = assessResult(cached.result, centre);
		if (verdict.ok) {
			counts.accepted++;
			cache.centres[centre.centre_id] = { query, lat: verdict.lat, lon: verdict.lon };
			next.push({ ...centre, lat: verdict.lat, lon: verdict.lon });
		} else {
			counts.rejected++;
			delete cache.centres[centre.centre_id];
			rejected.push({ centre_id: centre.centre_id, query, reason: verdict.reason });
			next.push({ ...centre, lat: null, lon: null });
		}
	}

	const validated = directorySchema.safeParse(next);
	if (!validated.success) {
		error(`geocoded directory fails the schema, nothing written:\n${validated.error.message}`);
		return 1;
	}

	const summary = `${counts.requests} requests sent, ${counts.cacheHits} cache hits, ${counts.accepted} accepted, ${counts.rejected} rejected, ${counts.unchanged} unchanged, ${counts.handSet} hand-set, ${counts.failed} failed`;
	const centresText = serializeDirectory(validated.data);
	const cacheText = serializeCache(cache);
	const nothingChanged =
		counts.requests === 0 && centresText === readFileSync(centresPath, 'utf8') && cacheText === cacheBefore && existsSync(notePath);
	if (nothingChanged) {
		log(summary);
		log('nothing changed; files left as they are');
		return 0;
	}

	const gaps = starts.slice(1).map((start, i) => start - starts[i]!);
	const note = geocodeNote({
		runAt,
		centres: centres.length,
		counts,
		rejected,
		failures,
		handSet,
		allWithUserAgent,
		allToSearch,
		minGapMs: gaps.length === 0 ? null : Math.floor(Math.min(...gaps)),
	});
	// Cache first: a crash before centres.json leaves records for coordinates not yet written,
	// which the next run re-applies, never coordinates without a record (read as hand-set).
	writeFileSync(cachePath, cacheText);
	writeFileSync(centresPath, centresText);
	writeFileSync(notePath, note);
	log(summary);
	log(`see ${notePath}`);
	return counts.failed > 0 ? 1 : 0;
}

if (import.meta.main) process.exitCode = await runGeocode();
