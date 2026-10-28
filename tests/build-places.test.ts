import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OVERPASS_INTERPRETER_URL, USER_AGENT } from '../pipeline/config.ts';
import type { FetchImpl } from '../pipeline/fetch/index.ts';
import { placesSchema, type Places } from '../shared/places.ts';
import {
	areaPostcode,
	bavariaQuery,
	bavariaRings,
	buildPlaces,
	indexQuery,
	parseIndex,
	parseOverpass,
	parsePrefixResponse,
	pickPoint,
	placesNote,
	prefixQuery,
	queryUrl,
	RETRY_DELAYS_MS,
	runBuildPlaces,
	simplifyRing,
	stitchRings,
	type MunicipalityInput,
	type OverpassElement,
	type OverpassResponse,
	type Point,
} from '../tools/build-places.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'bgt-places-'));
const quiet = { log: () => {}, error: () => {} };
const TS = '2026-10-27T07:00:00Z';

// ---------------------------------------------------------------------------------------------
// Fixture Overpass data

const muni = (id: number, ags: string, name: string | null, extra: Partial<OverpassElement> = {}): OverpassElement => ({
	type: 'relation',
	id,
	tags: {
		boundary: 'administrative',
		admin_level: ags.endsWith('000') ? '6' : '8',
		'de:amtlicher_gemeindeschluessel': ags,
		...(name !== null ? { name } : {}),
	},
	members: [],
	center: { lat: 48, lon: 11 },
	...extra,
});
const district = (id: number, ags: string, name: string): OverpassElement => ({
	type: 'relation',
	id,
	tags: { boundary: 'administrative', admin_level: '6', 'de:amtlicher_gemeindeschluessel': ags, name },
});
const marker = (id: number): OverpassElement => ({ type: 'relation', id });
const place = (id: number, name: string, cls: string, lat: number, lon: number): OverpassElement => ({
	type: 'node',
	id,
	lat,
	lon,
	tags: { place: cls, name },
});
const postcode = (id: number, code: string, key = 'postal_code'): OverpassElement => ({
	type: 'area',
	id,
	tags: { boundary: 'postal_code', [key]: code },
});
const response = (elements: OverpassElement[], timestamp = TS): string =>
	JSON.stringify({ version: 0.6, osm3s: { timestamp_osm_base: timestamp }, elements });

const MUC = muni(10, '09162000', 'München', {
	members: [{ type: 'node', ref: 100, role: 'admin_centre' }],
	center: { lat: 48.15, lon: 11.54 },
});
const AMMERSEE = muni(20, '09188451', 'Ammersee', { center: { lat: 47.99, lon: 11.13 } });
const HAUSEN_KEH = muni(30, '09273133', 'Hausen', {
	members: [{ type: 'node', ref: 300, role: 'label' }],
	center: { lat: 48.86, lon: 12.0 },
});
const HAUSEN_FO = muni(40, '09474132', 'Hausen', { center: { lat: 49.7, lon: 11.03 } });
const DUS = muni(50, '05111000', 'Düsseldorf', {
	members: [{ type: 'node', ref: 500, role: 'admin_centre' }],
	center: { lat: 51.24, lon: 6.8 },
});

const INDEX = response([
	MUC,
	AMMERSEE,
	HAUSEN_KEH,
	HAUSEN_FO,
	DUS,
	district(1188, '09188', 'Landkreis Starnberg'),
	district(1273, '09273', 'Landkreis Kelheim'),
	district(1474, '09474', 'Landkreis Forchheim'),
]);

const PREFIX: Record<string, string> = {
	'051': response([DUS, marker(50), place(500, 'Düsseldorf', 'city', 51.2254, 6.7763), postcode(5001, '40213')]),
	'091': response([
		MUC,
		AMMERSEE,
		marker(10),
		place(101, 'Altstadt', 'suburb', 48.137, 11.576),
		place(100, 'München', 'city', 48.13743, 11.57549),
		postcode(1001, '80333', 'postal_code:DE'),
		postcode(1002, '80331'),
		postcode(1003, '6691'),
		postcode(1004, '80331'),
		marker(20),
	]),
	'092': response([
		HAUSEN_KEH,
		marker(30),
		place(300, 'Hausen', 'village', 48.8612, 11.9987),
		postcode(3001, '93345'),
	]),
	'094': response(
		[HAUSEN_FO, marker(40), place(401, 'Hausen', 'hamlet', 49.6, 11.1), place(400, 'Hausen', 'village', 49.6912, 11.0333), postcode(4001, '91353')],
		'2026-10-27T06:30:00Z',
	),
};

const way = (ref: number, role: string, points: Point[]) => ({
	type: 'way',
	ref,
	role,
	geometry: points.map(([lon, lat]) => ({ lat, lon })),
});
const BAVARIA = response([
	{
		type: 'relation',
		id: 2145268,
		tags: { boundary: 'administrative', admin_level: '4', 'ISO3166-2': 'DE-BY', name: 'Bayern' },
		members: [
			way(1, 'outer', [
				[9, 47],
				[14, 47],
				[14, 51],
			]),
			// Reversed: the stitcher must flip it.
			way(2, 'outer', [
				[9, 47],
				[9, 51],
				[14, 51],
			]),
			way(3, 'inner', [
				[12, 49],
				[12.5, 49],
				[12.5, 49.5],
				[12, 49.5],
				[12, 49],
			]),
			{ type: 'node', ref: 9, role: 'label', geometry: undefined } as never,
		],
	},
]);

type Route = string | number | 'hang' | (string | number | 'hang')[];

/** Which query a request carries: `index`, `bavaria` or `ags-<prefix>`. */
function queryName(url: string): string {
	const ql = new URL(url).searchParams.get('data') ?? '';
	if (ql.includes('ISO3166-2')) return 'bavaria';
	const prefix = /"\^(\d{3})\[0-9\]\{5\}\$"/.exec(ql);
	return prefix ? `ags-${prefix[1]}` : 'index';
}

/** Fake Overpass: routes by query name; an array route is consumed one entry per request. */
function fakeOverpass(overrides: Record<string, Route> = {}) {
	const routes: Record<string, Route> = {
		index: INDEX,
		bavaria: BAVARIA,
		...Object.fromEntries(Object.entries(PREFIX).map(([p, body]) => [`ags-${p}`, body])),
		...overrides,
	};
	const calls: { url: string; name: string; userAgent: string | null; at: number }[] = [];
	const fetchImpl: FetchImpl = async (url, init) => {
		const name = queryName(url);
		calls.push({ url, name, userAgent: new Headers(init.headers).get('user-agent'), at: performance.now() });
		let route = routes[name];
		if (Array.isArray(route)) route = route.length > 1 ? route.shift()! : route[0]!;
		if (route === undefined) return new Response('', { status: 404 });
		if (route === 'hang') return new Promise<Response>(() => {});
		if (typeof route === 'number') return new Response('busy', { status: route });
		return new Response(route, { status: 200, headers: { 'content-type': 'application/json' } });
	};
	return { calls, fetchImpl };
}

function dirs() {
	const root = tmp();
	return { root, dir: join(root, 'places'), publicDir: join(root, 'public') };
}

const noSleep = async (): Promise<void> => {};

function run(d: ReturnType<typeof dirs>, fetchImpl: FetchImpl, extra: Partial<Parameters<typeof runBuildPlaces>[0]> = {}) {
	return runBuildPlaces({ dir: d.dir, publicDir: d.publicDir, fetchImpl, delayMs: 0, sleep: noSleep, ...quiet, ...extra });
}

const readPlaces = (d: ReturnType<typeof dirs>): Places => placesSchema.parse(JSON.parse(readFileSync(join(d.publicDir, 'places.json'), 'utf8')));
const readNote = (d: ReturnType<typeof dirs>): string => readFileSync(join(d.dir, 'places-note.md'), 'utf8');
const parsed = (text: string): OverpassResponse => {
	const result = parseOverpass(text);
	if (!result.ok) throw new Error(result.message);
	return result.response;
};

// ---------------------------------------------------------------------------------------------

describe('queries', () => {
	it('builds GET URLs on the interpreter with the URL-encoded query', () => {
		const url = new URL(queryUrl(indexQuery()));
		expect(url.origin + url.pathname).toBe(OVERPASS_INTERPRETER_URL);
		expect(url.searchParams.get('data')).toBe(indexQuery());
		expect(indexQuery()).toContain('out tags;');
		expect(bavariaQuery()).toContain('out geom;');
	});

	it('builds a prefix query with the per-municipality groups', () => {
		const ql = prefixQuery('091');
		expect(ql).toMatch(/^\[out:json\]\[timeout:900\];/);
		expect(ql).toContain('"^091[0-9]{5}$"');
		expect(ql).toContain('.munis out body center qt;');
		expect(ql).toContain('map_to_area');
		expect(ql).toContain('area.in[boundary=postal_code]');
		expect(() => prefixQuery('09')).toThrow();
	});
});

describe('parseOverpass', () => {
	it('accepts a response and rejects unusable ones', () => {
		expect(parseOverpass(INDEX).ok).toBe(true);
		expect(parseOverpass('<html>').ok).toBe(false);
		expect(parseOverpass('[]').ok).toBe(false);
		expect(parseOverpass(JSON.stringify({ elements: [] })).ok).toBe(false);
		expect(parseOverpass(JSON.stringify({ osm3s: { timestamp_osm_base: TS } })).ok).toBe(false);
		const timedOut = JSON.stringify({
			osm3s: { timestamp_osm_base: TS },
			elements: [],
			remark: 'runtime error: Query timed out in "foreach" at line 4 after 901 seconds.',
		});
		expect(parseOverpass(timedOut)).toMatchObject({ ok: false, message: expect.stringContaining('runtime error') });
	});
});

describe('parseIndex', () => {
	it('lists the distinct 3-digit prefixes and the district names', () => {
		const index = parseIndex(parsed(INDEX));
		expect(index.prefixes).toEqual(['051', '091', '092', '094']);
		expect(index.districts.get('09273')).toBe('Landkreis Kelheim');
		expect(index.districts.has('09162')).toBe(false);
	});

	it('keeps the named municipalities (levels 4, 6 and 8), one per key, lower relation id first, sorted by key', () => {
		const index = parseIndex(parsed(INDEX));
		expect(index.municipalities).toEqual([
			{ key: '05111000', name: 'Düsseldorf' },
			{ key: '09162000', name: 'München' },
			{ key: '09188451', name: 'Ammersee' },
			{ key: '09273133', name: 'Hausen' },
			{ key: '09474132', name: 'Hausen' },
		]);
		const later = muni(1999, '05970040', 'Siegen (old)');
		const earlier = muni(1001, '05970040', 'Siegen');
		const unnamed = muni(1002, '05970044', null);
		const city = muni(1003, '11000000', 'Berlin', {
			tags: { boundary: 'administrative', admin_level: '4', 'de:amtlicher_gemeindeschluessel': '11000000', name: 'Berlin' },
		});
		for (const order of [
			[later, earlier, unnamed, city],
			[city, unnamed, earlier, later],
		]) {
			expect(parseIndex(parsed(response(order))).municipalities).toEqual([
				{ key: '05970040', name: 'Siegen' },
				{ key: '11000000', name: 'Berlin' },
			]);
		}
	});

	it('keeps a municipality name when an unnamed relation with a lower id shares its key', () => {
		const unnamedFirst = muni(1000, '05970040', null);
		const named = muni(1001, '05970040', 'Siegen');
		for (const order of [
			[unnamedFirst, named],
			[named, unnamedFirst],
		]) {
			expect(parseIndex(parsed(response(order))).municipalities).toEqual([{ key: '05970040', name: 'Siegen' }]);
		}
	});

	it('keeps the lower relation id when two districts share an AGS, whatever the order', () => {
		const later = district(1999, '09273', 'Kelheim (old)');
		const earlier = district(1001, '09273', 'Landkreis Kelheim');
		expect(parseIndex(parsed(response([MUC, later, earlier]))).districts.get('09273')).toBe('Landkreis Kelheim');
		expect(parseIndex(parsed(response([MUC, earlier, later]))).districts.get('09273')).toBe('Landkreis Kelheim');
	});
});

describe('parsePrefixResponse', () => {
	it('splits the header and the per-municipality groups', () => {
		const munis = parsePrefixResponse(parsed(PREFIX['091']!));
		expect(munis.map((m) => m.ags)).toEqual(['09162000', '09188451']);
		const muc = munis[0]!;
		expect(muc).toMatchObject({ id: 10, name: 'München', adminCentre: 100, label: null, center: { lat: 48.15, lon: 11.54 } });
		expect(muc.places.map((p) => p.id)).toEqual([101, 100]);
		// Deduplicated, sorted, `postal_code:DE` read, the 4-digit code ignored.
		expect(muc.postcodes).toEqual(['80331', '80333']);
		expect(munis[1]).toMatchObject({ places: [], postcodes: [] });
	});

	it('reads postal_code:DE before postal_code and only 5 digits', () => {
		expect(areaPostcode({ 'postal_code:DE': '80333', postal_code: '1' })).toBe('80333');
		expect(areaPostcode({ postal_code: '6691' })).toBeNull();
		expect(areaPostcode({ 'postal_code:DE': '', postal_code: '87491' })).toBe('87491');
		expect(areaPostcode({ 'postal_code:DE': 'x', postal_code: '87491' })).toBe('87491');
		expect(areaPostcode({ postal_code: '80331;80333' })).toBeNull();
		expect(areaPostcode(undefined)).toBeNull();
	});
});

describe('pickPoint', () => {
	const base: MunicipalityInput = {
		id: 1,
		ags: '09000001',
		name: 'Günzburg',
		adminCentre: null,
		label: null,
		center: { lat: 48.11111, lon: 10.22222 },
		places: [
			{ id: 7, name: 'Guenzburg', place: 'hamlet', lat: 48.3, lon: 10.3 },
			{ id: 8, name: 'Günzburg', place: 'town', lat: 48.45555, lon: 10.27777 },
			{ id: 9, name: 'Reisensburg', place: 'village', lat: 48.4, lon: 10.25 },
		],
		postcodes: [],
	};

	it('prefers admin_centre, then label, then a name-matched place node (highest class), then the bbox centre', () => {
		expect(pickPoint({ ...base, adminCentre: 9, label: 7 })).toEqual({ lat: 48.4, lon: 10.25 });
		expect(pickPoint({ ...base, label: 7 })).toEqual({ lat: 48.3, lon: 10.3 });
		expect(pickPoint({ ...base, adminCentre: 999 })).toEqual({ lat: 48.4556, lon: 10.2778 });
		expect(pickPoint({ ...base, places: [base.places[2]!] })).toEqual({ lat: 48.1111, lon: 10.2222 });
		expect(pickPoint({ ...base, places: [], center: null })).toBeNull();
	});
});

describe('stitchRings / simplifyRing / bavariaRings', () => {
	it('stitches ways in any order and direction into closed rings', () => {
		const rings = stitchRings([
			[
				[0, 0],
				[1, 0],
			],
			[
				[0, 1],
				[1, 1],
			],
			[
				[1, 1],
				[1, 0],
			],
			[
				[0, 1],
				[0, 0],
			],
		]);
		expect(rings).toEqual([
			[
				[0, 0],
				[1, 0],
				[1, 1],
				[0, 1],
				[0, 0],
			],
		]);
		expect(() =>
			stitchRings([
				[
					[0, 0],
					[1, 0],
				],
			]),
		).toThrow(/does not close/);
	});

	it('drops points within the tolerance and keeps the ring closed', () => {
		const ring: Point[] = [
			[0, 0],
			[0.5, 0.0005],
			[1, 0],
			[1, 1],
			[0.5, 1.5],
			[0, 1],
			[0, 0],
		];
		const simplified = simplifyRing(ring, 0.002);
		expect(simplified).toEqual([
			[0, 0],
			[1, 0],
			[1, 1],
			[0.5, 1.5],
			[0, 1],
			[0, 0],
		]);
	});

	it('reads the outer and inner rings of the Bavaria relation', () => {
		const rings = bavariaRings(parsed(BAVARIA));
		expect(rings).toHaveLength(2);
		for (const ring of rings) expect(ring[0]).toEqual(ring.at(-1));
		expect(() => bavariaRings(parsed(response([])))).toThrow(/no DE-BY/);
	});
});

describe('buildPlaces', () => {
	it('keeps the lower relation id on a duplicate AGS', () => {
		const index = parseIndex(parsed(INDEX));
		const munis = parsePrefixResponse(parsed(PREFIX['092']!));
		const twin: MunicipalityInput = { ...munis[0]!, id: 31, name: 'Hausen (twin)' };
		const result = buildPlaces({ index, municipalities: [twin, ...munis], bavaria: bavariaRings(parsed(BAVARIA)), missing: [], timestamps: [TS] });
		expect(result.file.places).toHaveLength(1);
		expect(result.file.places[0]!.name).toBe('Hausen');
		expect(result.duplicates).toEqual([{ key: '09273133', keptId: 30, droppedIds: [31] }]);
	});
});

describe('runBuildPlaces', () => {
	it('fresh build: index, one query per prefix, bavaria, in order, with the bot UA, no robots.txt', async () => {
		const d = dirs();
		const net = fakeOverpass();
		const lines: string[] = [];
		expect(await run(d, net.fetchImpl, { log: (l) => lines.push(l) })).toBe(0);
		expect(net.calls.map((c) => c.name)).toEqual(['index', 'ags-051', 'ags-091', 'ags-092', 'ags-094', 'bavaria']);
		expect(net.calls.every((c) => c.userAgent === USER_AGENT && c.url.startsWith(`${OVERPASS_INTERPRETER_URL}?data=`))).toBe(true);
		for (const name of ['index', 'ags-051', 'ags-091', 'ags-092', 'ags-094', 'bavaria']) {
			expect(existsSync(join(d.dir, 'cache', `${name}.json`))).toBe(true);
		}
		expect(lines.filter((l) => /^\[\d+\] /.test(l))).toHaveLength(6);

		const places = readPlaces(d);
		expect(places.data_timestamp).toBe('2026-10-27T06:30:00Z');
		expect(places.places.map((r) => r.key)).toEqual(['05111000', '09162000', '09273133', '09474132']);
		expect(places.attribution).toMatch(/OpenStreetMap contributors.*ODbL/);

		const note = readNote(d);
		expect(note).toContain('OpenStreetMap via the Overpass API');
		expect(note).toContain('ODbL');
		expect(note).toContain('- Requests sent: 6');
		expect(note).toContain('User-Agent');
		expect(note).toMatch(/: yes\n.*interpreter: yes/);
		expect(note).toContain('Data timestamp (oldest OSM base among the responses): 2026-10-27T06:30:00Z');
		expect(note).toMatch(/Rows per state: SH 0, HH 0, NI 0, HB 0, NW 1, .* BY 3/);
		expect(note).toMatch(/bytes gzipped\n/);
		expect(note).not.toContain('FLAG');
	});

	it('kreisfreie Stadt, same-name towns, postcodes and coordinates', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		const rows = readPlaces(d).places;
		expect(rows.find((r) => r.key === '09162000')).toEqual({
			key: '09162000',
			name: 'München',
			postcodes: ['80331', '80333'],
			district: 'München',
			state: 'BY',
			lat: 48.1374,
			lon: 11.5755,
		});
		const hausen = rows.filter((r) => r.name === 'Hausen');
		expect(hausen.map((r) => r.district)).toEqual(['Landkreis Kelheim', 'Landkreis Forchheim']);
		// Label node; then the name-matched village beats the hamlet.
		expect(hausen.map((r) => [r.lat, r.lon])).toEqual([
			[48.8612, 11.9987],
			[49.6912, 11.0333],
		]);
		expect(rows.find((r) => r.key === '05111000')).toMatchObject({ state: 'NW', district: 'Düsseldorf', postcodes: ['40213'] });
	});

	it('drops an uninhabited area and counts it in the note', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		expect(readPlaces(d).places.some((r) => r.name === 'Ammersee')).toBe(false);
		expect(readNote(d)).toContain('## Dropped: no place node and no postcode (1)\n\n- 09188451 Ammersee');
	});

	it('rerun with every cache file sends 0 requests and leaves both files byte-identical', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		const before = readFileSync(join(d.publicDir, 'places.json'), 'utf8');
		const noteBefore = readNote(d);
		const net = fakeOverpass();
		const lines: string[] = [];
		expect(await run(d, net.fetchImpl, { log: (l) => lines.push(l) })).toBe(0);
		expect(net.calls).toHaveLength(0);
		expect(lines.some((l) => l.startsWith('0 requests sent'))).toBe(true);
		expect(readFileSync(join(d.publicDir, 'places.json'), 'utf8')).toBe(before);
		expect(readNote(d)).toBe(noteBefore);
	});

	it('--refresh ignores the cache', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		const net = fakeOverpass();
		expect(await run(d, net.fetchImpl, { refresh: true })).toBe(0);
		expect(net.calls).toHaveLength(6);
	});

	it('partial cache: only the missing queries are sent', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		const before = readFileSync(join(d.publicDir, 'places.json'), 'utf8');
		rmSync(join(d.dir, 'cache', 'ags-092.json'));
		rmSync(join(d.dir, 'cache', 'bavaria.json'));
		const net = fakeOverpass();
		expect(await run(d, net.fetchImpl)).toBe(0);
		expect(net.calls.map((c) => c.name)).toEqual(['ags-092', 'bavaria']);
		expect(readFileSync(join(d.publicDir, 'places.json'), 'utf8')).toBe(before);
	});

	it('--cached-only: sends nothing and writes a partial file listing what is missing', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		rmSync(join(d.dir, 'cache', 'ags-092.json'));
		rmSync(join(d.dir, 'cache', 'bavaria.json'));
		const net = fakeOverpass();
		expect(await run(d, net.fetchImpl, { cachedOnly: true })).toBe(0);
		expect(net.calls).toHaveLength(0);
		const places = readPlaces(d);
		expect(places.complete).toBe(false);
		expect(places.missing).toEqual(['ags-092', 'bavaria']);
		expect(places.bavaria).toEqual([]);
		expect(places.places.map((r) => r.key)).toEqual(['05111000', '09162000', '09474132']);
		// A Bavarian prefix left out never becomes a name-only entry.
		expect(places.others).toEqual([]);
		const note = readNote(d);
		expect(note).toContain('- Other-state names (name only, from missing key prefixes): 0');
		expect(note).toContain('## PARTIAL BUILD: 2 queries not cached and left out');
		expect(note).toContain('- Complete: NO (2 queries missing)');
		expect(note).toContain('- Bavaria boundary: MISSING');
		expect(note).toContain('## Bavarian rows outside the boundary: not checked (boundary missing)');
		expect(note).toMatch(/User-Agent `[^`]+`: n\/a \(no requests\)/);
	});

	it('--cached-only: names the municipalities of a missing non-Bavarian prefix in others, and a rerun changes nothing', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		rmSync(join(d.dir, 'cache', 'ags-051.json'));
		const net = fakeOverpass();
		expect(await run(d, net.fetchImpl, { cachedOnly: true })).toBe(0);
		expect(net.calls).toHaveLength(0);
		const places = readPlaces(d);
		expect(places.missing).toEqual(['ags-051']);
		expect(places.places.map((r) => r.key)).toEqual(['09162000', '09273133', '09474132']);
		expect(places.others).toEqual([{ key: '05111000', name: 'Düsseldorf', state: 'NW' }]);
		expect(readNote(d)).toContain('- Other-state names (name only, from missing key prefixes): 1');
		const before = readFileSync(join(d.publicDir, 'places.json'), 'utf8');
		const note = readNote(d);
		const lines: string[] = [];
		expect(await run(d, net.fetchImpl, { cachedOnly: true, log: (l) => lines.push(l) })).toBe(0);
		expect(lines.at(-1)).toContain('nothing changed');
		expect(readFileSync(join(d.publicDir, 'places.json'), 'utf8')).toBe(before);
		expect(readNote(d)).toBe(note);
	});

	it('rewrites a note left by a failed run when the rebuilt file is unchanged', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		const before = readFileSync(join(d.publicDir, 'places.json'), 'utf8');
		rmSync(join(d.dir, 'cache', 'bavaria.json'));
		expect(await run(d, fakeOverpass({ bavaria: 400 }).fetchImpl)).toBe(1);
		expect(readNote(d)).not.toContain('## Output');
		writeFileSync(join(d.dir, 'cache', 'bavaria.json'), BAVARIA);
		expect(await run(d, fakeOverpass().fetchImpl)).toBe(0);
		expect(readFileSync(join(d.publicDir, 'places.json'), 'utf8')).toBe(before);
		expect(readNote(d)).toContain('## Output');
	});

	it('--cached-only with everything cached gives the same complete file as a normal run', async () => {
		const d = dirs();
		await run(d, fakeOverpass().fetchImpl);
		const before = readFileSync(join(d.publicDir, 'places.json'), 'utf8');
		expect(readPlaces(d)).toMatchObject({ complete: true, missing: [], others: [] });
		const net = fakeOverpass();
		expect(await run(d, net.fetchImpl, { cachedOnly: true })).toBe(0);
		expect(net.calls).toHaveLength(0);
		expect(readFileSync(join(d.publicDir, 'places.json'), 'utf8')).toBe(before);
	});

	it('--cached-only without a cached index or any municipality query writes no places.json', async () => {
		const empty = dirs();
		const net = fakeOverpass();
		expect(await run(empty, net.fetchImpl, { cachedOnly: true })).toBe(1);
		expect(net.calls).toHaveLength(0);
		expect(existsSync(join(empty.publicDir, 'places.json'))).toBe(false);

		const indexOnly = dirs();
		await run(indexOnly, fakeOverpass().fetchImpl);
		rmSync(join(indexOnly.publicDir, 'places.json'));
		for (const name of ['ags-051', 'ags-091', 'ags-092', 'ags-094']) rmSync(join(indexOnly.dir, 'cache', `${name}.json`));
		expect(await run(indexOnly, net.fetchImpl, { cachedOnly: true })).toBe(1);
		expect(existsSync(join(indexOnly.publicDir, 'places.json'))).toBe(false);
	});

	it('refuses --refresh together with --cached-only', async () => {
		const d = dirs();
		const net = fakeOverpass();
		expect(await run(d, net.fetchImpl, { refresh: true, cachedOnly: true })).toBe(1);
		expect(net.calls).toHaveLength(0);
	});

	it('busy server: retries a 502 after 60 s and caches the answer', async () => {
		const d = dirs();
		const net = fakeOverpass({ 'ags-091': [502, PREFIX['091']!] });
		const waits: number[] = [];
		expect(await run(d, net.fetchImpl, { sleep: async (ms) => void waits.push(ms) })).toBe(0);
		expect(waits).toEqual([60_000]);
		expect(net.calls.filter((c) => c.name === 'ags-091')).toHaveLength(2);
		expect(existsSync(join(d.dir, 'cache', 'ags-091.json'))).toBe(true);
		expect(readNote(d)).toContain('- Retries: 1');
	});

	it('retries a timeout and a 429', async () => {
		const d = dirs();
		const net = fakeOverpass({ index: ['hang', 429, INDEX] });
		const waits: number[] = [];
		expect(await run(d, net.fetchImpl, { timeoutMs: 20, sleep: async (ms) => void waits.push(ms) })).toBe(0);
		expect(waits).toEqual([60_000, 120_000]);
	});

	it('persistent failure: 4 × 504 fails that query, the others still run and cache, no places.json, exit 1', async () => {
		const d = dirs();
		const net = fakeOverpass({ 'ags-051': 504 });
		const waits: number[] = [];
		const errors: string[] = [];
		expect(await run(d, net.fetchImpl, { sleep: async (ms) => void waits.push(ms), error: (l) => errors.push(l) })).toBe(1);
		expect(waits).toEqual([...RETRY_DELAYS_MS]);
		expect(net.calls.filter((c) => c.name === 'ags-051')).toHaveLength(4);
		expect(existsSync(join(d.dir, 'cache', 'ags-051.json'))).toBe(false);
		for (const name of ['index', 'ags-091', 'ags-092', 'ags-094', 'bavaria']) {
			expect(existsSync(join(d.dir, 'cache', `${name}.json`))).toBe(true);
		}
		expect(existsSync(join(d.publicDir, 'places.json'))).toBe(false);
		expect(readNote(d)).toContain('- ags-051: http-error 504');
		expect(errors.join('\n')).toMatch(/places\.json not written/);
	});

	it('does not retry other failures and does not cache a runtime-error answer', async () => {
		const d = dirs();
		const remark = JSON.stringify({ osm3s: { timestamp_osm_base: TS }, elements: [], remark: 'runtime error: out of memory' });
		const net = fakeOverpass({ 'ags-092': 400, 'ags-094': remark });
		const waits: number[] = [];
		expect(await run(d, net.fetchImpl, { sleep: async (ms) => void waits.push(ms) })).toBe(1);
		expect(waits).toEqual([]);
		expect(existsSync(join(d.dir, 'cache', 'ags-094.json'))).toBe(false);
		expect(readNote(d)).toMatch(/- ags-092: http-error 400\n- ags-094: invalid response: server remark: runtime error/);
	});

	it('a failed index query still runs the bavaria query', async () => {
		const d = dirs();
		const net = fakeOverpass({ index: 400 });
		expect(await run(d, net.fetchImpl)).toBe(1);
		expect(net.calls.map((c) => c.name)).toEqual(['index', 'bavaria']);
	});

	it('spaces requests at least the delay apart', async () => {
		const d = dirs();
		const net = fakeOverpass();
		expect(await run(d, net.fetchImpl, { delayMs: 30 })).toBe(0);
		const gaps = net.calls.slice(1).map((c, i) => c.at - net.calls[i]!.at);
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(29);
		expect(readNote(d)).toMatch(/Smallest gap between two requests: (29|[3-9]\d|\d{3,}) ms/);
	});

	it('writes nothing and exits 1 when a row fails the schema', async () => {
		const d = dirs();
		const bad = muni(60, '09162001', 'Nowhere', { center: { lat: 60, lon: 11 } });
		const net = fakeOverpass({
			'ags-091': response([bad, marker(60), postcode(6001, '80331')]),
		});
		const errors: string[] = [];
		expect(await run(d, net.fetchImpl, { error: (l) => errors.push(l) })).toBe(1);
		expect(existsSync(join(d.publicDir, 'places.json'))).toBe(false);
		expect(existsSync(join(d.dir, 'places-note.md'))).toBe(false);
		expect(errors.join('\n')).toMatch(/fails the schema/);
	});

	it('a bad cache file is named, and nothing is sent or written', async () => {
		const d = dirs();
		mkdirSync(join(d.dir, 'cache'), { recursive: true });
		writeFileSync(join(d.dir, 'cache', 'ags-091.json'), '{"elements": [');
		const net = fakeOverpass();
		const errors: string[] = [];
		expect(await run(d, net.fetchImpl, { error: (l) => errors.push(l) })).toBe(1);
		expect(net.calls).toHaveLength(0);
		expect(errors.join('\n')).toContain(join(d.dir, 'cache', 'ags-091.json'));
		expect(existsSync(join(d.publicDir, 'places.json'))).toBe(false);
		expect(existsSync(join(d.dir, 'places-note.md'))).toBe(false);
	});

	it('lists duplicate AGS and Bavarian rows outside the boundary in the note', async () => {
		const d = dirs();
		const twin = muni(41, '09474132', 'Hausen (twin)', { center: { lat: 49.7, lon: 11.03 } });
		const outside = muni(70, '09162002', 'Grenzort', { center: { lat: 48, lon: 8.5 } });
		const net = fakeOverpass({
			'ags-094': response([HAUSEN_FO, twin, marker(40), place(400, 'Hausen', 'village', 49.69, 11.03), marker(41)]),
			'ags-091': response([outside, marker(70), place(700, 'Grenzort', 'village', 48, 8.5)]),
		});
		expect(await run(d, net.fetchImpl)).toBe(0);
		const note = readNote(d);
		expect(note).toContain('09474132: kept r40, dropped r41');
		expect(note).toContain('## Bavarian rows outside the boundary (1)\n\n- 09162002 Grenzort');
	});
});

describe('placesNote', () => {
	const result = buildPlaces({
		index: parseIndex(parsed(INDEX)),
		municipalities: parsePrefixResponse(parsed(PREFIX['092']!)),
		bavaria: bavariaRings(parsed(BAVARIA)),
		missing: [],
		timestamps: [TS],
	});
	const base = {
		requests: 0,
		cacheHits: 6,
		queries: 6,
		retries: 0,
		failures: [],
		missing: [],
		allWithUserAgent: true,
		allToInterpreter: true,
		minGapMs: null,
	};

	it('flags a file over 300 KB gzipped, and only then', () => {
		expect(placesNote({ ...base, build: { result, rawBytes: 2_000_000, gzipBytes: 307_201 } })).toContain(
			'2000000 bytes raw, 307201 bytes gzipped — FLAG: over 300 KB gzipped',
		);
		expect(placesNote({ ...base, build: { result, rawBytes: 1_000_000, gzipBytes: 307_200 } })).not.toContain('FLAG');
	});

	it('flags failed self-checks and a run with fewer than two requests', () => {
		const note = placesNote({ ...base, requests: 1, allWithUserAgent: false, allToInterpreter: false, build: null });
		expect(note).toMatch(/User-Agent `[^`]+`: NO/);
		expect(note).toMatch(/interpreter: NO/);
		expect(note).toContain('n/a (fewer than two requests)');
		expect(note).not.toContain('## Output');
	});
});
