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
		['pdf_only with a reader', { reader: 'kuferweb', reader_config: { list_url: 'https://x.de/' }, pdf_only: true }, 'pdf_only'],
		['pdf_only false', { pdf_only: false }, 'pdf_only'],
	])('rejects %s', (_, overrides, field) => {
		const result = centreSchema.safeParse({ ...centre(), ...overrides });
		expect(result.success).toBe(false);
		expect(result.error!.issues.map((i) => i.path.join('.'))).toContain(field);
	});

	it('accepts pdf_only: true with reader none (Story 4.1)', () => {
		expect(centreSchema.safeParse({ ...centre(), test_page_url: 'https://www.vhs-fuerth.de/termine', pdf_only: true }).success).toBe(true);
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

	// The snapshot is not compared with the directory: a centre added or removed here is a legitimate
	// data change, and the snapshot catches up on the next collecting run.
	it('has unique ids and every coordinate that is set lies inside Bavaria', () => {
		const centres = directorySchema.parse(JSON.parse(text));
		const ids = centres.map((c) => c.centre_id);
		expect(duplicateIds(ids)).toEqual([]);
		expect(centres.every((c) => c.source === 'rtpartner')).toBe(true);
		expect(centres.filter((c) => c.lat !== null && !isInBavariaBox(c.lat, c.lon!)).map((c) => c.centre_id)).toEqual([]);
	});

	it('agrees with the committed geocode cache (only allowlisted centres are set by hand)', () => {
		const centres = directorySchema.parse(JSON.parse(text));
		const loaded = loadCache(GEOCODE_CACHE_PATH);
		expect(loaded.ok).toBe(true);
		const { cache } = loaded as Extract<typeof loaded, { ok: true }>;
		expect(serializeCache(cache)).toBe(readFileSync(GEOCODE_CACHE_PATH, 'utf8'));
		expect(cacheDisagreements(centres, cache.centres, HAND_SET_CENTRES)).toEqual([]);
	});
});

type CacheCentres = Extract<ReturnType<typeof loadCache>, { ok: true }>['cache']['centres'];

/**
 * Centres whose coordinates were set by hand rather than geocoded: they have coordinates and no
 * geocode-cache record. Each needs a one-line reason; add one only after `npm run geocode` cannot
 * find the correct address.
 */
const HAND_SET_CENTRES: readonly string[] = [
	// No Kulmbacher Str. 1 in Kronach in OSM (Nominatim only finds Weißenbrunn 96369); operator-approved 2026-11-01 position of the OSM "Volkshochschule", Rodacher Straße 1, Kronach (Story 3.13).
	'vhs-kreis-kronach-e-v',
];

/** Ids that occur more than once, each named once. */
function duplicateIds(ids: readonly string[]): string[] {
	return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

/**
 * Centres (and allowlist ids) that disagree with the geocode cache: a centre without coordinates
 * must have no record; a centre with coordinates and no record must be on `handSet`; a record that
 * exists must match the address and coordinates; every `handSet` id must be a directory centre
 * with coordinates and no record.
 */
function cacheDisagreements(centres: readonly Centre[], records: CacheCentres, handSet: readonly string[]): string[] {
	const allowed = new Set(handSet);
	const flagged = centres
		.filter((c) => {
			const record = records[c.centre_id];
			if (c.lat === null) return record !== undefined;
			if (record === undefined) return !allowed.has(c.centre_id);
			return record.query !== queryKey(c.address) || record.lat !== c.lat || record.lon !== c.lon;
		})
		.map((c) => c.centre_id);
	const byId = new Map(centres.map((c) => [c.centre_id, c]));
	const stale = handSet.filter((id) => {
		const c = byId.get(id);
		return c === undefined || c.lat === null || records[id] !== undefined;
	});
	return [...new Set([...flagged, ...stale])];
}

describe('geocode cache agreement', () => {
	const geocoded = centre({ centre_id: 'geocoded', lat: 49.47, lon: 10.99 });
	const record = { query: queryKey(geocoded.address), lat: 49.47, lon: 10.99 };

	it('accepts coordinates set by hand, with no cache record, when the centre is on the allowlist', () => {
		const handSet = centre({ centre_id: 'hand-set', lat: 48.14, lon: 11.58 });
		const centres = [geocoded, handSet, centre({ centre_id: 'none' })];
		expect(cacheDisagreements(centres, { geocoded: record } as CacheCentres, ['hand-set'])).toEqual([]);
	});

	it('names a hand-set centre that is not on the allowlist', () => {
		const handSet = centre({ centre_id: 'hand-set', lat: 48.14, lon: 11.58 });
		expect(cacheDisagreements([geocoded, handSet], { geocoded: record } as CacheCentres, [])).toEqual(['hand-set']);
	});

	it.each([
		['has a cache record', [geocoded], 'geocoded'],
		['has no coordinates', [centre({ centre_id: 'none' })], 'none'],
		['is not in the directory', [geocoded], 'gone'],
	])('names a stale allowlist entry that %s', (_, centres, id) => {
		expect(cacheDisagreements(centres, { geocoded: record } as CacheCentres, [id])).toEqual([id]);
	});

	it('flags a record that disagrees, and a record for a centre without coordinates', () => {
		const moved = centre({ centre_id: 'geocoded', lat: 49.5, lon: 10.99 });
		expect(cacheDisagreements([moved], { geocoded: record } as CacheCentres, [])).toEqual(['geocoded']);
		expect(cacheDisagreements([centre({ centre_id: 'geocoded' })], { geocoded: record } as CacheCentres, [])).toEqual(['geocoded']);
	});

	it('flags a record whose query is not the current address', () => {
		const readdressed = centre({ centre_id: 'geocoded', lat: 49.47, lon: 10.99, address: { street: 'Neue Str. 1', postcode: '90762', city: 'Fürth' } });
		expect(cacheDisagreements([readdressed], { geocoded: record } as CacheCentres, [])).toEqual(['geocoded']);
	});
});

describe('committed-data id checks', () => {
	it('names duplicate ids and passes when ids are unique, whatever the count', () => {
		expect(duplicateIds(['a', 'b', 'a', 'c', 'a'])).toEqual(['a']);
		expect(duplicateIds(['a', 'b'])).toEqual([]);
		expect(duplicateIds(Array.from({ length: 250 }, (_, i) => `c${i}`))).toEqual([]);
	});
});
