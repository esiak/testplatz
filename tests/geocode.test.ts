import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOMINATIM_DELAY_MS, NOMINATIM_SEARCH_URL, USER_AGENT } from '../pipeline/config.ts';
import type { FetchImpl } from '../pipeline/fetch/index.ts';
import { serializeDirectory, type Centre } from '../shared/directory.ts';
import {
	assessResult,
	geocodeNote,
	loadCache,
	parseNominatim,
	queryKey,
	runGeocode,
	searchUrl,
	serializeCache,
	type GeocodeCache,
	type NominatimHit,
} from '../tools/geocode.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'bgt-geo-'));
const quiet = { log: () => {}, error: () => {} };
const NOW = new Date('2026-10-27T08:00:00.000Z');

const centre = (overrides: Partial<Centre> = {}): Centre => ({
	centre_id: 'vhs-fuerth',
	name: 'VHS Fürth gGmbH',
	address: { street: 'Hirschenstr. 27/29', postcode: '90762', city: 'Fürth' },
	lat: null,
	lon: null,
	website: 'https://www.vhs-fuerth.de/',
	test_page_url: null,
	reader: 'none',
	reader_config: null,
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...overrides,
});

const hit = (overrides: Partial<NominatimHit> = {}): NominatimHit => ({
	lat: 49.4771234567,
	lon: 10.9887654321,
	state_code: 'DE-BY',
	postcode: '90762',
	place_rank: 30,
	display_name: 'Hirschenstraße 27, Fürth',
	...overrides,
});

/** A raw Nominatim jsonv2 item for a hit. */
const raw = (h: NominatimHit) => ({
	lat: String(h.lat),
	lon: String(h.lon),
	place_rank: h.place_rank,
	display_name: h.display_name,
	address: {
		...(h.state_code !== null ? { 'ISO3166-2-lvl4': h.state_code } : {}),
		...(h.postcode !== null ? { postcode: h.postcode } : {}),
	},
});

type Route = NominatimHit[] | number | string;

/** Fake Nominatim: routes by `street` param; records every request. */
function fakeNominatim(byStreet: Record<string, Route>) {
	const calls: { url: string; userAgent: string | null; at: number }[] = [];
	const fetchImpl: FetchImpl = async (url, init) => {
		calls.push({ url, userAgent: new Headers(init.headers).get('user-agent'), at: performance.now() });
		const street = new URL(url).searchParams.get('street') ?? '';
		const route = byStreet[street];
		if (route === undefined) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
		if (typeof route === 'number') return new Response('', { status: route });
		if (typeof route === 'string') return new Response(route, { status: 200, headers: { 'content-type': 'application/json' } });
		return new Response(JSON.stringify(route.map(raw)), { status: 200, headers: { 'content-type': 'application/json' } });
	};
	return { calls, fetchImpl };
}

function setup(centres: Centre[], cache?: GeocodeCache): string {
	const dir = tmp();
	writeFileSync(join(dir, 'centres.json'), serializeDirectory(centres));
	if (cache) writeFileSync(join(dir, 'geocode-cache.json'), serializeCache(cache));
	return dir;
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');
const readCentres = (dir: string): Centre[] => JSON.parse(read(dir, 'centres.json')) as Centre[];
const readCache = (dir: string): GeocodeCache => JSON.parse(read(dir, 'geocode-cache.json')) as GeocodeCache;
const run = (dir: string, fetchImpl: FetchImpl, delayMs = 0) => runGeocode({ dir, fetchImpl, delayMs, now: () => NOW, ...quiet });

const KEY = 'Hirschenstr. 27/29, 90762 Fürth';

describe('queryKey / searchUrl', () => {
	it('builds the cache key and the structured search URL', () => {
		const address = { street: 'Königstr. 2 & 4', postcode: '90402', city: 'Nürnberg' };
		expect(queryKey(address)).toBe('Königstr. 2 & 4, 90402 Nürnberg');
		const url = new URL(searchUrl(address));
		expect(url.origin + url.pathname).toBe(NOMINATIM_SEARCH_URL);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			street: 'Königstr. 2 & 4',
			postalcode: '90402',
			city: 'Nürnberg',
			country: 'Germany',
			format: 'jsonv2',
			addressdetails: '1',
			limit: '1',
		});
	});
});

describe('parseNominatim', () => {
	it('reads the first match', () => {
		expect(parseNominatim(JSON.stringify([raw(hit())]))).toEqual({ result: hit() });
	});

	it('maps an empty array to no match', () => {
		expect(parseNominatim('[]')).toEqual({ result: null });
	});

	it('returns null for an unusable body', () => {
		expect(parseNominatim('<html>busy</html>')).toBeNull();
		expect(parseNominatim('{"error":"x"}')).toBeNull();
		expect(parseNominatim('[{"lat":"x","lon":"1","place_rank":30}]')).toBeNull();
		expect(parseNominatim('[null]')).toBeNull();
	});

	it('keeps missing state and postcode as null', () => {
		expect(parseNominatim(JSON.stringify([{ lat: '48.1', lon: '11.5', place_rank: 30, display_name: 'x' }]))).toEqual({
			result: { lat: 48.1, lon: 11.5, state_code: null, postcode: null, place_rank: 30, display_name: 'x' },
		});
	});
});

describe('assessResult', () => {
	it('accepts a Bavarian street-level match, rounded to 6 decimals', () => {
		expect(assessResult(hit(), centre())).toEqual({ ok: true, lat: 49.477123, lon: 10.988765 });
		expect(assessResult(hit({ postcode: null }), centre())).toMatchObject({ ok: true });
	});

	it.each([
		['no match', null, 'no match'],
		['another state', hit({ state_code: 'DE-BW' }), 'outside Bavaria'],
		['no state', hit({ state_code: null }), 'outside Bavaria'],
		['a point outside the box', hit({ lat: 51.2 }), 'outside Bavaria'],
		['a city-level match', hit({ place_rank: 16 }), 'imprecise match (place_rank 16)'],
		['another postcode', hit({ postcode: '90763' }), 'postcode mismatch (90763)'],
	])('rejects %s', (_, result, reason) => {
		expect(assessResult(result, centre())).toEqual({ ok: false, reason });
	});

	it('applies the rules in order', () => {
		expect(assessResult(hit({ state_code: 'DE-BW', place_rank: 16, postcode: '1' }), centre())).toEqual({ ok: false, reason: 'outside Bavaria' });
		expect(assessResult(hit({ place_rank: 16, postcode: '1' }), centre())).toEqual({ ok: false, reason: 'imprecise match (place_rank 16)' });
	});
});

describe('cache file', () => {
	it('round-trips with sorted keys, tabs and a trailing newline', () => {
		const dir = tmp();
		const cache: GeocodeCache = {
			queries: {
				'b, 90762 Fürth': { fetched_at: NOW.toISOString(), result: null },
				'a, 90762 Fürth': { fetched_at: NOW.toISOString(), result: hit() },
			},
			centres: { z: { query: 'a, 90762 Fürth', lat: 49.4, lon: 10.9 } },
		};
		const text = serializeCache(cache);
		expect(text.endsWith('}\n')).toBe(true);
		expect(text).toContain('\n\t"centres"');
		expect(text.indexOf('"a, 90762')).toBeLessThan(text.indexOf('"b, 90762'));
		expect(text.indexOf('"display_name"')).toBeLessThan(text.indexOf('"state_code"'));
		writeFileSync(join(dir, 'c.json'), text);
		const loaded = loadCache(join(dir, 'c.json'));
		expect(loaded).toEqual({ ok: true, cache });
		expect(serializeCache((loaded as { cache: GeocodeCache }).cache)).toBe(text);
	});

	it('treats a missing file as empty and an invalid one as an error', () => {
		const dir = tmp();
		expect(loadCache(join(dir, 'none.json'))).toEqual({ ok: true, cache: { queries: {}, centres: {} } });
		writeFileSync(join(dir, 'bad.json'), '{"queries":[]}');
		expect(loadCache(join(dir, 'bad.json')).ok).toBe(false);
		writeFileSync(join(dir, 'bad2.json'), 'nope');
		expect(loadCache(join(dir, 'bad2.json')).ok).toBe(false);
	});
});

describe('runGeocode', () => {
	it('geocodes a new entry with one request and records it', async () => {
		const dir = setup([centre()]);
		const net = fakeNominatim({ 'Hirschenstr. 27/29': [hit()] });
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(net.calls).toHaveLength(1);
		expect(net.calls[0]!.url.startsWith(`${NOMINATIM_SEARCH_URL}?`)).toBe(true);
		expect(net.calls[0]!.userAgent).toBe(USER_AGENT);
		expect(readCentres(dir)[0]).toMatchObject({ lat: 49.477123, lon: 10.988765 });
		const cache = readCache(dir);
		expect(cache.queries[KEY]).toEqual({ fetched_at: NOW.toISOString(), result: hit() });
		expect(cache.centres['vhs-fuerth']).toEqual({ query: KEY, lat: 49.477123, lon: 10.988765 });
		expect(read(dir, 'centres.json')).toBe(serializeDirectory(readCentres(dir)));
		const note = read(dir, 'geocode-note.md');
		expect(note).toContain('- Requests sent: 1');
		expect(note).toContain('- Accepted: 1');
		expect(note).toMatch(/User-Agent .*: yes/);
	});

	it('sends no request on a rerun and leaves every file byte-identical', async () => {
		const dir = setup([centre(), centre({ centre_id: 'nowhere', address: { street: 'Nirgendwo 1', postcode: '90000', city: 'X' } })]);
		const first = fakeNominatim({ 'Hirschenstr. 27/29': [hit()] });
		await run(dir, first.fetchImpl);
		expect(first.calls).toHaveLength(2);
		const before = ['centres.json', 'geocode-cache.json', 'geocode-note.md'].map((f) => read(dir, f));
		const second = fakeNominatim({});
		const lines: string[] = [];
		expect(await runGeocode({ dir, fetchImpl: second.fetchImpl, delayMs: 0, log: (l) => lines.push(l), error: () => {} })).toBe(0);
		expect(second.calls).toHaveLength(0);
		expect(lines[0]).toMatch(/^0 requests sent/);
		expect(['centres.json', 'geocode-cache.json', 'geocode-note.md'].map((f) => read(dir, f))).toEqual(before);
	});

	it('leaves an unchanged geocoded entry alone', async () => {
		const done = centre({ lat: 49.5, lon: 11 });
		const dir = setup([done], { queries: {}, centres: { 'vhs-fuerth': { query: KEY, lat: 49.5, lon: 11 } } });
		const net = fakeNominatim({});
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(net.calls).toHaveLength(0);
		expect(readCentres(dir)[0]).toEqual(done);
	});

	it('re-geocodes a changed address and clears coordinates on rejection', async () => {
		const moved = centre({ lat: 49.5, lon: 11, address: { street: 'Neue Str. 1', postcode: '90762', city: 'Fürth' } });
		const dir = setup([moved], { queries: {}, centres: { 'vhs-fuerth': { query: KEY, lat: 49.5, lon: 11 } } });
		const net = fakeNominatim({ 'Neue Str. 1': [hit({ place_rank: 16 })] });
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(net.calls).toHaveLength(1);
		expect(readCentres(dir)[0]).toMatchObject({ lat: null, lon: null });
		expect(readCache(dir).centres['vhs-fuerth']).toBeUndefined();
		expect(read(dir, 'geocode-note.md')).toContain('- vhs-fuerth (Neue Str. 1, 90762 Fürth): imprecise match (place_rank 16)');
	});

	it('re-geocodes a changed address from the cache and accepts the new point', async () => {
		const moved = centre({ lat: 49.5, lon: 11, address: { street: 'Neue Str. 1', postcode: '90762', city: 'Fürth' } });
		const newKey = 'Neue Str. 1, 90762 Fürth';
		const dir = setup([moved], {
			queries: { [newKey]: { fetched_at: NOW.toISOString(), result: hit({ lat: 49.48, lon: 10.99 }) } },
			centres: { 'vhs-fuerth': { query: KEY, lat: 49.5, lon: 11 } },
		});
		const net = fakeNominatim({});
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(net.calls).toHaveLength(0);
		expect(readCentres(dir)[0]).toMatchObject({ lat: 49.48, lon: 10.99 });
		expect(readCache(dir).centres['vhs-fuerth']).toEqual({ query: newKey, lat: 49.48, lon: 10.99 });
	});

	it('leaves hand-set coordinates alone and lists them', async () => {
		const manual = centre({ lat: 49.1, lon: 11.1 });
		const dir = setup([manual]);
		const net = fakeNominatim({});
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(net.calls).toHaveLength(0);
		expect(readCentres(dir)[0]).toEqual(manual);
		expect(read(dir, 'geocode-note.md')).toContain('## Coordinates set by hand (left alone)\n\n- vhs-fuerth');
	});

	it('treats coordinates that differ from the geocode record as hand-set, even after an address change', async () => {
		const edited = centre({ lat: 49.2, lon: 11.2 });
		const dir = setup([edited], { queries: {}, centres: { 'vhs-fuerth': { query: KEY, lat: 49.5, lon: 11 } } });
		const net = fakeNominatim({});
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(readCentres(dir)[0]).toEqual(edited);
		const note = read(dir, 'geocode-note.md');
		expect(note).toContain('- Coordinates set by hand: 1');
		expect(note).toContain('- Unchanged (already geocoded, same address): 0');
		expect(note).toContain(`- vhs-fuerth (${KEY}): coordinates differ from the geocode record`);

		const moved = { ...edited, address: { street: 'Neue Str. 1', postcode: '90762', city: 'Fürth' } };
		writeFileSync(join(dir, 'centres.json'), serializeDirectory([moved]));
		const again = fakeNominatim({ 'Neue Str. 1': [hit({ place_rank: 16 })] });
		expect(await run(dir, again.fetchImpl)).toBe(0);
		expect(again.calls).toHaveLength(0);
		expect(readCentres(dir)[0]).toEqual(moved);
	});

	it('sends one request for a shared address', async () => {
		const dir = setup([centre(), centre({ centre_id: 'other' })]);
		const net = fakeNominatim({ 'Hirschenstr. 27/29': [hit()] });
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(net.calls).toHaveLength(1);
		expect(readCentres(dir).map((c) => c.lat)).toEqual([49.477123, 49.477123]);
		expect(read(dir, 'geocode-note.md')).toContain('- Cache hits: 1');
	});

	it.each([
		['no match', [] as NominatimHit[], 'no match'],
		['a match in another state', [hit({ state_code: 'DE-BW', lat: 48.78, lon: 9.18 })], 'outside Bavaria'],
		['a point outside the box', [hit({ lat: 52.5 })], 'outside Bavaria'],
		['a city-level match', [hit({ place_rank: 16 })], 'imprecise match (place_rank 16)'],
	])('reports %s, leaves coordinates null and caches the result', async (_, route, reason) => {
		const dir = setup([centre()]);
		const net = fakeNominatim({ 'Hirschenstr. 27/29': route });
		expect(await run(dir, net.fetchImpl)).toBe(0);
		expect(readCentres(dir)[0]).toMatchObject({ lat: null, lon: null });
		expect(readCache(dir).queries[KEY]).toBeDefined();
		expect(read(dir, 'geocode-note.md')).toContain(`- vhs-fuerth (${KEY}): ${reason}`);
		const again = fakeNominatim({});
		await run(dir, again.fetchImpl);
		expect(again.calls).toHaveLength(0);
	});

	it.each([
		['an HTTP 503', 503, 'http-error 503'],
		['a non-JSON body', '<html>busy</html>', 'invalid response body'],
		['a non-array body', '{"error":"x"}', 'invalid response body'],
	])('on %s leaves the entry unchanged, does not cache and exits 1', async (_, route, reason) => {
		const dir = setup([centre()]);
		const net = fakeNominatim({ 'Hirschenstr. 27/29': route });
		expect(await run(dir, net.fetchImpl)).toBe(1);
		expect(readCentres(dir)[0]).toEqual(centre());
		expect(readCache(dir)).toEqual({ queries: {}, centres: {} });
		expect(read(dir, 'geocode-note.md')).toContain(`## Failures (entry unchanged, rerun to retry)\n\n- vhs-fuerth (${KEY}): ${reason}`);
	});

	it('on a timeout leaves the entry unchanged and exits 1', async () => {
		const dir = setup([centre()]);
		const hang: FetchImpl = (_url, init) =>
			new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
		expect(await runGeocode({ dir, fetchImpl: hang, delayMs: 0, timeoutMs: 20, ...quiet })).toBe(1);
		expect(readCentres(dir)[0]).toEqual(centre());
		expect(read(dir, 'geocode-note.md')).toContain(': timeout');
	});

	it('keeps the old coordinates when re-geocoding a changed address fails', async () => {
		const moved = centre({ lat: 49.5, lon: 11, address: { street: 'Neue Str. 1', postcode: '90762', city: 'Fürth' } });
		const dir = setup([moved], { queries: {}, centres: { 'vhs-fuerth': { query: KEY, lat: 49.5, lon: 11 } } });
		const net = fakeNominatim({ 'Neue Str. 1': 503 });
		expect(await run(dir, net.fetchImpl)).toBe(1);
		expect(readCentres(dir)[0]).toEqual(moved);
	});

	it('spaces requests at least the delay apart, all with the bot User-Agent', async () => {
		const dir = setup([
			centre({ centre_id: 'a', address: { street: 'A 1', postcode: '90762', city: 'Fürth' } }),
			centre({ centre_id: 'b', address: { street: 'B 1', postcode: '90762', city: 'Fürth' } }),
			centre({ centre_id: 'c', address: { street: 'C 1', postcode: '90762', city: 'Fürth' } }),
		]);
		const net = fakeNominatim({});
		expect(await run(dir, net.fetchImpl, 60)).toBe(0);
		expect(net.calls).toHaveLength(3);
		expect(net.calls.every((c) => c.userAgent === USER_AGENT)).toBe(true);
		for (let i = 1; i < net.calls.length; i++) expect(net.calls[i]!.at - net.calls[i - 1]!.at).toBeGreaterThanOrEqual(59);
		expect(net.calls.some((c) => c.url.includes('robots.txt'))).toBe(false);
		expect(read(dir, 'geocode-note.md')).toMatch(/Smallest gap between two requests: \d+ ms/);
	});

	it('exits 1 on an invalid centres.json or cache, writing nothing', async () => {
		const dir = tmp();
		writeFileSync(join(dir, 'centres.json'), '[{"centre_id":"x"}]');
		const net = fakeNominatim({});
		expect(await run(dir, net.fetchImpl)).toBe(1);
		expect(existsSync(join(dir, 'geocode-note.md'))).toBe(false);

		const dir2 = setup([centre()]);
		writeFileSync(join(dir2, 'geocode-cache.json'), '{"queries":{},"centres":[]}');
		expect(await run(dir2, net.fetchImpl)).toBe(1);
		expect(net.calls).toHaveLength(0);
		expect(existsSync(join(dir2, 'geocode-note.md'))).toBe(false);
	});
});

describe('geocodeNote', () => {
	it('flags failed self-checks and a run with fewer than two requests', () => {
		const note = geocodeNote({
			runAt: NOW.toISOString(),
			centres: 1,
			counts: { requests: 1, cacheHits: 0, accepted: 1, rejected: 0, unchanged: 0, handSet: 0, failed: 0 },
			rejected: [],
			failures: [],
			handSet: [],
			allWithUserAgent: false,
			allToSearch: false,
			minGapMs: null,
		});
		expect(note).toContain(`- Every request sent User-Agent \`${USER_AGENT}\`: NO`);
		expect(note).toContain(`- Every request went to ${NOMINATIM_SEARCH_URL}: NO`);
		expect(note).toContain('- Smallest gap between two requests: n/a (fewer than two requests)');
	});
});

describe('NOMINATIM_DELAY_MS', () => {
	it('keeps Nominatim at no more than 1 request per second', () => {
		expect(NOMINATIM_DELAY_MS).toBeGreaterThanOrEqual(1000);
	});
});
