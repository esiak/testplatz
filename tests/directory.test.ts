import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { centreSchema, directorySchema, serializeDirectory, slugify, type Centre } from '../shared/directory.ts';
import { checkDirectoryText } from '../tools/check-directory.ts';

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
		['a bad postcode', { address: { street: 'A 1', postcode: '9076', city: 'Fürth' } }, 'address.postcode'],
		['a non-http website', { website: 'ftp://x.de/' }, 'website'],
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
	])('names the entry index and field for %j', (overrides, expected) => {
		const result = checkDirectoryText(JSON.stringify([{ ...centre(), ...overrides }]));
		expect(result.ok).toBe(false);
		expect(result.lines.join('\n')).toContain(expected);
	});

	it('rejects an unsorted file', () => {
		const result = checkDirectoryText(JSON.stringify([centre({ centre_id: 'b' }), centre({ centre_id: 'a' })]));
		expect(result.ok).toBe(false);
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

	it('holds one rtpartner entry per source row and no coordinates yet', () => {
		const centres = directorySchema.parse(JSON.parse(text));
		expect(centres).toHaveLength(120);
		expect(centres.every((c) => c.source === 'rtpartner' && c.lat === null && c.lon === null)).toBe(true);
	});
});
