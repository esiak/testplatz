import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BAVARIA_BBOX, centreSchema, directorySchema, isInBavariaBox, isPlausibleHostname, serializeDirectory, slugify, type Centre } from '../shared/directory.ts';
import { checkDirectoryText } from '../tools/check-directory.ts';
import { loadCache, queryKey, serializeCache } from '../tools/geocode.ts';
import { GEOCODE_CACHE_PATH } from '../tools/paths.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

describe('centreSchema', () => {
	it('accepts a seeded entry and a fully verified one', () => {
		expect(centreSchema.safeParse(centre()).success).toBe(true);
		const verified = centre({
			lat: 49.47,
			lon: 10.99,
			test_page_url: 'https://www.vhs-fuerth.de/einbuergerungstest',
			reader: 'itemkg',
			reader_config: { list_url: 'https://www.vhs-fuerth.de/p/x-123-CAT-KAT1' },
			verified_at: '2026-10-27T08:00:00.000Z',
		});
		expect(centreSchema.safeParse(verified).success).toBe(true);
	});

	it.each([
		['an unknown reader', { reader: 'foo' }, 'reader'],
		['a reader_config with reader none', { reader_config: { list_url: 'https://x.de/' } }, 'reader_config'],
		['lat without lon', { lat: 48.1 }, 'lon'],
		['a latitude north of Bavaria', { lat: 52.5, lon: 13.4 }, 'lat'],
		['a longitude west of Bavaria', { lat: 48.8, lon: 8.4 }, 'lon'],
		['a latitude south of Bavaria', { lat: 47.0, lon: 11 }, 'lat'],
		['a longitude east of Bavaria', { lat: 49, lon: 14.2 }, 'lon'],
		['a bad postcode', { address: { street: 'A 1', postcode: '9076', city: 'Fürth' } }, 'address.postcode'],
		['a non-http website', { website: 'ftp://x.de/' }, 'website'],
		['a website with a comma in the host', { website: 'http://www.vhs-kisshab,de/' }, 'website'],
		['a website host without a dot', { website: 'https://www.vhs-eching-de/' }, 'website'],
		['a test page on a numeric TLD', { test_page_url: 'https://10.0.0.1/' }, 'test_page_url'],
		['a non-UTC verified_at', { verified_at: '2026-10-27T08:00:00+02:00' }, 'verified_at'],
		['an id that is not a slug', { centre_id: 'VHS_Fürth' }, 'centre_id'],
		['a non-strict reader_config', { reader: 'kuferweb', reader_config: { list_url: 'https://x.de/', extra: 1 } }, 'reader_config'],
	])('rejects %s', (_, overrides, field) => {
		const result = centreSchema.safeParse({ ...centre(), ...overrides });
		expect(result.success).toBe(false);
		expect(result.error!.issues.map((i) => i.path.join('.'))).toContain(field);
	});

	it('rejects unknown keys and missing keys', () => {
		expect(centreSchema.safeParse({ ...centre(), phone: '0911' }).success).toBe(false);
		const { verified_at: _, ...missing } = centre();
		expect(centreSchema.safeParse(missing).success).toBe(false);
	});
});

describe('BAVARIA_BBOX', () => {
	it('contains Bavarian points (edges included) and excludes others', () => {
		expect(BAVARIA_BBOX).toEqual({ minLat: 47.2, maxLat: 50.6, minLon: 8.9, maxLon: 13.9 });
		expect(isInBavariaBox(48.137, 11.575)).toBe(true);
		expect(isInBavariaBox(47.2, 8.9)).toBe(true);
		expect(isInBavariaBox(50.6, 13.9)).toBe(true);
		expect(isInBavariaBox(52.52, 13.405)).toBe(false);
		expect(isInBavariaBox(48.78, 8.8)).toBe(false);
		expect(isInBavariaBox(47.1, 11)).toBe(false);
		expect(isInBavariaBox(49, 14)).toBe(false);
	});
});

describe('directorySchema', () => {
	it('fails on a duplicate id and names it', () => {
		const result = directorySchema.safeParse([centre(), centre()]);
		expect(result.success).toBe(false);
		expect(result.error!.issues[0]!.message).toContain('vhs-fuerth');
		expect(result.error!.issues[0]!.path).toEqual([1, 'centre_id']);
	});
});

describe('slugify', () => {
	it.each([
		['Fürth', 'fuerth'],
		['Hirschenstraße', 'hirschenstrasse'],
		['VHS Bad Kisingen und Hammelburg', 'vhs-bad-kisingen-und-hammelburg'],
		['Euro-Schulen Nordbayern', 'euro-schulen-nordbayern'],
		['VHS Alt-/Neuötting und Töging e. V.', 'vhs-alt-neuoetting-und-toeging-e-v'],
		['ÄÖÜ Crème brûlée  ', 'aeoeue-creme-brulee'],
		['Inlingua Sprachschule U.&C. Bernau GmbH', 'inlingua-sprachschule-u-c-bernau-gmbh'],
	])('%s → %s', (input, expected) => {
		expect(slugify(input)).toBe(expected);
	});

	it('cuts at a dash to at most 60 characters', () => {
		const slug = slugify('Berufliche Fortbildungszentren der Bayerischen Wirtschaft gGmbH, bfz-Donauwörth-Ulm-Aalen');
		expect(slug).toBe('berufliche-fortbildungszentren-der-bayerischen-wirtschaft');
		expect(slug.length).toBeLessThanOrEqual(60);
	});
});

describe('check-directory', () => {
	it('reports the count for a valid directory', () => {
		const text = serializeDirectory([centre({ centre_id: 'b' }), centre({ centre_id: 'a' })]);
		expect(checkDirectoryText(text)).toEqual({ ok: true, lines: ['2 centres OK'] });
	});

	it('names the duplicate id', () => {
		const result = checkDirectoryText(JSON.stringify([centre(), centre()]));
		expect(result.ok).toBe(false);
		expect(result.lines.join('\n')).toContain('vhs-fuerth');
	});

	it.each([
		[{ reader: 'foo' }, 'entry 0 (vhs-fuerth) reader'],
		[{ extra: true }, 'entry 0 (vhs-fuerth) extra'],
		[{ reader_config: { list_url: 'https://x.de/' } }, 'entry 0 (vhs-fuerth) reader_config'],
		[{ lat: 49.4 }, 'entry 0 (vhs-fuerth) lon'],
		[{ lat: 52.5, lon: 11 }, 'entry 0 (vhs-fuerth) lat'],
	])('names the entry index and field for %j', (overrides, expected) => {
		const result = checkDirectoryText(JSON.stringify([{ ...centre(), ...overrides }]));
		expect(result.ok).toBe(false);
		expect(result.lines.join('\n')).toContain(expected);
	});

	it('rejects a file that is not the canonical serialisation', () => {
		const entries = [centre({ centre_id: 'a' }), centre({ centre_id: 'b' })];
		expect(checkDirectoryText(JSON.stringify(entries, null, 2) + '\n').ok).toBe(false);
		expect(checkDirectoryText(serializeDirectory(entries).trimEnd()).ok).toBe(false);
		expect(checkDirectoryText(serializeDirectory(entries)).ok).toBe(true);
	});

	it('imports only shared/ and node: modules (no cheerio, no fetch client)', () => {
		const source = readFileSync(join(repoRoot, 'tools/check-directory.ts'), 'utf8');
		const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
		expect(specifiers.every((s) => s!.startsWith('node:') || s!.startsWith('../shared/') || s === './paths.ts')).toBe(true);
	});

	it('rejects an unsorted file', () => {
		const result = checkDirectoryText(JSON.stringify([centre({ centre_id: 'b' }), centre({ centre_id: 'a' })]));
		expect(result.ok).toBe(false);
	});

	it('accepts plausible hostnames only', () => {
		expect(isPlausibleHostname('www.vhs-fuerth.de')).toBe(true);
		expect(isPlausibleHostname('xn--vhs-frth-q9a.de')).toBe(true);
		expect(isPlausibleHostname('www.vhs-kisshab,de')).toBe(false);
		expect(isPlausibleHostname('www.vhs-eching-de')).toBe(false);
		expect(isPlausibleHostname('localhost')).toBe(false);
		expect(isPlausibleHostname('example.d3')).toBe(false);
	});

	it('exits non-zero from the CLI on an invalid file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bgt-check-'));
		const bad = join(dir, 'centres.json');
		writeFileSync(bad, JSON.stringify([centre(), centre()]));
		const run = spawnSync(process.execPath, ['tools/check-directory.ts', bad], { cwd: repoRoot, encoding: 'utf8' });
		expect(run.status).toBe(1);
		expect(run.stderr).toContain('vhs-fuerth');
	});
});

describe('committed data/directory/centres.json', () => {
	const text = readFileSync(join(repoRoot, 'data/directory/centres.json'), 'utf8');

	it('passes the schema and the check', () => {
		expect(directorySchema.safeParse(JSON.parse(text)).success).toBe(true);
		expect(checkDirectoryText(text).ok).toBe(true);
	});

	it('is the canonical serialisation (sorted, tabs, trailing newline)', () => {
		expect(serializeDirectory(directorySchema.parse(JSON.parse(text)))).toBe(text);
	});

	it('holds one rtpartner entry per source row, every coordinate inside Bavaria', () => {
		const centres = directorySchema.parse(JSON.parse(text));
		expect(centres).toHaveLength(119);
		expect(centres.every((c) => c.source === 'rtpartner')).toBe(true);
		expect(centres.every((c) => c.lat === null || isInBavariaBox(c.lat, c.lon!))).toBe(true);
	});

	it('agrees with the committed geocode cache', () => {
		const centres = directorySchema.parse(JSON.parse(text));
		const loaded = loadCache(GEOCODE_CACHE_PATH);
		expect(loaded.ok).toBe(true);
		const { cache } = loaded as Extract<typeof loaded, { ok: true }>;
		expect(serializeCache(cache)).toBe(readFileSync(GEOCODE_CACHE_PATH, 'utf8'));
		for (const c of centres) {
			const record = cache.centres[c.centre_id];
			if (c.lat === null) expect(record, c.centre_id).toBeUndefined();
			else expect(record, c.centre_id).toEqual({ query: queryKey(c.address), lat: c.lat, lon: c.lon });
		}
	});
});
