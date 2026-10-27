import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_AGENT } from '../pipeline/config.ts';
import type { FetchImpl, FetchResult } from '../pipeline/fetch/index.ts';
import { directorySchema, serializeDirectory, type Centre } from '../shared/directory.ts';
import { buildEntries, parseAddress, parseRtpartnerTable, parseSourceDate, runSeed } from '../tools/seed-directory.ts';
import { assessSite, detectReader, fetchSite, findTestLink, jsonLdAddresses, runVerify, type SitePages } from '../tools/verify-directory.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const tmp = (): string => mkdtempSync(join(tmpdir(), 'bgt-dir-'));
const quiet = { log: () => {}, error: () => {} };
const NOW = '2026-10-27T08:00:00.000Z';

const htmlResponse = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

/** Fake network from a URL → body/status map; records every request. */
function fakeNet(routes: Record<string, string | number>) {
	const calls: { url: string; userAgent: string | null }[] = [];
	const fetchImpl: FetchImpl = async (url, init) => {
		calls.push({ url, userAgent: new Headers(init.headers).get('user-agent') });
		const route = routes[url];
		if (route === undefined) return new Response('', { status: 404 });
		if (typeof route === 'number') return new Response('', { status: route });
		return htmlResponse(route);
	};
	return { calls, fetchImpl };
}

describe('seed: parseRtpartnerTable / buildEntries', () => {
	const rows = parseRtpartnerTable(fixture('rtpartner-table.html'));

	it('reads one row per table row, without phone or e-mail', () => {
		expect(rows).toHaveLength(5);
		expect(rows[0]).toEqual({
			name: 'Euro-Schulen Nordbayern',
			street: 'Herzogenstr. 8',
			postcode: '97070',
			city: 'Würzburg',
			website: 'https://www.eso.de/',
		});
		expect(JSON.stringify(rows)).not.toMatch(/0931|mailto|@example/);
	});

	it('splits an address at the postcode, keeping commas in the street', () => {
		expect(rows[2]).toMatchObject({ street: 'Paul-Eber-Haus, Schulhof 1', postcode: '97318', city: 'Kitzingen' });
		expect(parseAddress('Georg-Pöschl-Straße 16, 84056  Rottenburg a.d.Laaber')).toEqual({
			street: 'Georg-Pöschl-Straße 16',
			postcode: '84056',
			city: 'Rottenburg a.d.Laaber',
		});
		expect(parseAddress('no postcode here')).toBeNull();
	});

	it('normalises websites and leaves an empty cell null', () => {
		expect(rows[1]!.website).toBe('https://www.vhs-fuerth.de/');
		expect(rows[3]!.website).toBeNull();
	});

	it('builds seeded entries with unique ids: name, then -<city>, then -2', () => {
		const entries = buildEntries(rows);
		expect(entries.map((e) => e.centre_id)).toEqual([
			'euro-schulen-nordbayern',
			'volkshochschule',
			'volkshochschule-kitzingen',
			'volkshochschule-2',
			'volkshochschule-3',
		]);
		for (const e of entries) {
			expect(e).toMatchObject({ source: 'rtpartner', verified_at: null, reader: 'none', lat: null, lon: null, opted_out: false });
		}
		expect(directorySchema.safeParse(entries).success).toBe(true);
	});

	it('reads the source date stamp', () => {
		expect(parseSourceDate(fixture('rtpartner-table.html'))).toBe('2026-04-16 07:48');
	});

	it('throws on a page without the table', () => {
		expect(() => parseRtpartnerTable(fixture('no-table.html'))).toThrow(/myTable/);
	});
});

describe('seed: runSeed', () => {
	const SOURCE = 'https://src.example/table';

	it('writes a sorted centres.json and the source section', async () => {
		const dir = tmp();
		const net = fakeNet({ [SOURCE]: fixture('rtpartner-table.html') });
		expect(await runSeed({ sourceUrl: SOURCE, force: false, dir, fetchImpl: net.fetchImpl, ...quiet })).toBe(0);
		const text = readFileSync(join(dir, 'centres.json'), 'utf8');
		expect(text).toBe(serializeDirectory(directorySchema.parse(JSON.parse(text))));
		expect(text.startsWith('[\n\t{')).toBe(true);
		const note = readFileSync(join(dir, 'review-note.md'), 'utf8');
		expect(note).toContain(`Source URL: ${SOURCE}`);
		expect(note).toContain('Source date: 2026-04-16 07:48');
		expect(net.calls.every((c) => c.userAgent === USER_AGENT)).toBe(true);
	});

	it('exits non-zero and writes nothing when the page has no table', async () => {
		const dir = tmp();
		const net = fakeNet({ [SOURCE]: fixture('no-table.html') });
		expect(await runSeed({ sourceUrl: SOURCE, force: false, dir, fetchImpl: net.fetchImpl, ...quiet })).toBe(1);
		expect(existsSync(join(dir, 'centres.json'))).toBe(false);
		expect(existsSync(join(dir, 'review-note.md'))).toBe(false);
	});

	it('refuses to overwrite a non-empty directory unless --force', async () => {
		const dir = tmp();
		writeFileSync(join(dir, 'centres.json'), '[{"centre_id":"x"}]\n');
		const net = fakeNet({ [SOURCE]: fixture('rtpartner-table.html') });
		expect(await runSeed({ sourceUrl: SOURCE, force: false, dir, fetchImpl: net.fetchImpl, ...quiet })).toBe(1);
		expect(net.calls).toHaveLength(0);
		expect(await runSeed({ sourceUrl: SOURCE, force: true, dir, fetchImpl: net.fetchImpl, ...quiet })).toBe(0);
		expect(JSON.parse(readFileSync(join(dir, 'centres.json'), 'utf8'))).toHaveLength(5);
	});
});

const entry = (overrides: Partial<Centre> = {}): Centre => ({
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

const ok = (url: string, text: string): FetchResult => ({ ok: true, status: 200, url, contentType: 'text/html', text });
const HOME = 'https://www.vhs-fuerth.de/';
const TEST = 'https://www.vhs-fuerth.de/einbuergerungstest';

describe('verify: page helpers', () => {
	it('finds the first test link on the host or a subdomain, fragment dropped', () => {
		expect(findTestLink(fixture('site-home.html'), HOME, ['vhs-fuerth.de'])).toBe(
			'https://kurse.vhs-fuerth.de/einbuergerungstest',
		);
		expect(findTestLink('<a href="/kurse/einb%C3%BCrgerung-test">x</a><a href="/k">Einbuergerungstest</a>', HOME, ['vhs-fuerth.de'])).toBe(
			'https://www.vhs-fuerth.de/k',
		);
		expect(findTestLink('<a href="https://other.example/einbuergerungstest">Einbürgerungstest</a>', HOME, ['vhs-fuerth.de'])).toBeNull();
	});

	it('detects reader fingerprints; both or neither → none', () => {
		expect(detectReader(['<link href="/fileadmin/kuferweb/webbasys/x.css">'])).toBe('kuferweb');
		expect(detectReader(['<a href="/p/einbuergerungstest-123-CAT-KAT7">'])).toBe('itemkg');
		expect(detectReader(['typo3conf/ext/itemkg_x', '/fileadmin/kuferweb/webbasys/'])).toBe('none');
		expect(detectReader(['<p>plain</p>'])).toBe('none');
	});

	it('reads JSON-LD PostalAddresses at any depth with their holder name', () => {
		expect(jsonLdAddresses(fixture('site-home.html'))).toEqual([
			{ postalCode: '90762', streetAddress: 'Hirschenstraße 27/29', addressLocality: 'Fürth', holderName: 'Volkshochschule Fürth gGmbH' },
		]);
	});
});

describe('verify: assessSite', () => {
	const home = ok(HOME, fixture('site-home.html'));
	const testPage = ok(TEST, fixture('site-test-page.html'));
	const confirmed: SitePages = { home, testLink: TEST, testPage };

	it('confirms a reachable site with a test page and the postcode, applying JSON-LD corrections', () => {
		const result = assessSite(entry(), confirmed, NOW);
		expect(result.reason).toBeNull();
		expect(result.entry).toMatchObject({
			test_page_url: TEST,
			verified_at: NOW,
			reader: 'itemkg',
			name: 'Volkshochschule Fürth gGmbH',
			address: { street: 'Hirschenstraße 27/29', postcode: '90762', city: 'Fürth' },
		});
		expect(result.changes.map((c) => c.field).sort()).toEqual(
			['address.street', 'name', 'reader', 'test_page_url', 'verified_at'].sort(),
		);
		expect(result.changes.find((c) => c.field === 'address.street')).toEqual({
			field: 'address.street',
			from: 'Hirschenstr. 27/29',
			to: 'Hirschenstraße 27/29',
		});
	});

	it('never applies a different JSON-LD postcode, but notes it', () => {
		const result = assessSite(entry({ address: { street: 'Markt 1', postcode: '90763', city: 'Fürth' } }), confirmed, NOW);
		expect(result.entry.address).toEqual({ street: 'Markt 1', postcode: '90763', city: 'Fürth' });
		expect(result.entry.name).toBe('VHS Fürth gGmbH');
		expect(result.notes).toEqual(['site JSON-LD states postcode 90762 (not applied)']);
		expect(result.reason).toBe('postcode not on site');
		expect(result.entry.verified_at).toBeNull();
	});

	it.each<[string, Partial<Centre>, SitePages | null, string]>([
		['no website', { website: null }, null, 'no website'],
		[
			'robots-disallowed',
			{},
			{ home: { ok: false, reason: 'robots-disallowed', url: HOME, status: null }, testLink: null, testPage: null },
			'robots-disallowed',
		],
		[
			'unreachable',
			{},
			{ home: { ok: false, reason: 'http-error', url: HOME, status: 503 }, testLink: null, testPage: null },
			'unreachable: http-error 503',
		],
		['no test link', {}, { home: ok(HOME, '<p>90762 Fürth</p>'), testLink: null, testPage: null }, 'no test page link'],
		[
			'test page unreachable',
			{},
			{ home, testLink: TEST, testPage: { ok: false, reason: 'timeout', url: TEST, status: null } },
			'test page not reachable',
		],
		[
			'postcode absent',
			{ address: { street: 'X 1', postcode: '12345', city: 'Fürth' } },
			confirmed,
			'postcode not on site',
		],
	])('leaves verified_at null when %s', (_, overrides, pages, reason) => {
		const result = assessSite(entry({ verified_at: NOW, ...overrides }), pages, NOW);
		expect(result.reason).toBe(reason);
		expect(result.entry.verified_at).toBeNull();
		expect(result.changes).toContainEqual({ field: 'verified_at', from: NOW, to: null });
	});

	it('defaults reader to none when no fingerprint matches', () => {
		const result = assessSite(entry({ reader: 'kuferweb' }), { home: ok(HOME, '<p>x</p>'), testLink: null, testPage: null }, NOW);
		expect(result.entry.reader).toBe('none');
	});
});

describe('verify: fetchSite', () => {
	it('makes no second request when the homepage is the test page', async () => {
		const requested: string[] = [];
		const page = '<a href="/">Einbürgerungstest</a><p>90762</p>';
		const pages = await fetchSite(async (url) => {
			requested.push(url);
			return ok(url, page);
		}, HOME);
		expect(requested).toEqual([HOME]);
		expect(pages.testPage).toBe(pages.home);
		expect(assessSite(entry(), pages, NOW).reason).toBeNull();
	});
});

describe('verify: runVerify', () => {
	it('fetches each host once, stays within robots + 2 pages per host, and writes the review note', async () => {
		const dir = tmp();
		const centres = buildEntries([
			{ name: 'VHS Fürth', street: 'Hirschenstr. 27/29', postcode: '90762', city: 'Fürth', website: 'https://www.vhs-fuerth.de/' },
			{ name: 'Euro-Schulen Nordbayern', street: 'Herzogenstr. 8', postcode: '97070', city: 'Würzburg', website: 'https://www.eso.de/' },
			{ name: 'Euro-Schulen Aschaffenburg', street: 'Goldbacher Str. 6', postcode: '63739', city: 'Aschaffenburg', website: 'https://www.eso.de/' },
			{ name: 'VHS Ohne Seite', street: 'Markt 1', postcode: '86633', city: 'Neuburg', website: null },
			{ name: 'VHS Blocked', street: 'Markt 2', postcode: '86529', city: 'Schrobenhausen', website: 'https://blocked.example/' },
			{ name: 'VHS Down', street: 'Markt 3', postcode: '86530', city: 'Irgendwo', website: 'https://down.example/' },
			{ name: 'Kolping Moved', street: 'Johannesstr. 11', postcode: '85049', city: 'Ingolstadt', website: 'https://old.example/' },
		]);
		writeFileSync(join(dir, 'centres.json'), serializeDirectory(centres));
		writeFileSync(join(dir, 'review-note.md'), '# Directory review note\n\n## Source\n\n- Source URL: https://src.example/\n- Source date: 2026-04-16 07:48\n\n## Verification run\n\nNot run yet.\n');

		const net = fakeNet({
			'https://www.vhs-fuerth.de/robots.txt': 404,
			'https://www.vhs-fuerth.de/': fixture('site-home.html'),
			'https://kurse.vhs-fuerth.de/robots.txt': 404,
			'https://kurse.vhs-fuerth.de/einbuergerungstest': fixture('site-test-page.html'),
			'https://www.eso.de/robots.txt': 404,
			'https://www.eso.de/': '<a href="/standorte/einbuergerungstest">Einbürgerungstest</a> 97070 Würzburg',
			'https://www.eso.de/standorte/einbuergerungstest': '<h1>Einbürgerungstest</h1>',
			'https://blocked.example/robots.txt': 'User-agent: *\nDisallow: /\n',
			'https://down.example/robots.txt': 503,
			'https://new.example/robots.txt': 404,
			'https://new.example/': '<a href="https://new.example/einbuergerungstest">Test</a> 85049 Ingolstadt',
			'https://new.example/einbuergerungstest': '<h1>Einbuergerungstest</h1>',
		});
		const moved = net.fetchImpl;
		net.fetchImpl = async (url, init) =>
			url.startsWith('https://old.example/')
				? (await moved(url, init), new Response(null, { status: 301, headers: { location: url.replace('old.example', 'new.example') } }))
				: moved(url, init);
		expect(await runVerify({ dir, fetchImpl: net.fetchImpl, delayMs: 0, ...quiet })).toBe(0);

		const hosts = new Map<string, number>();
		for (const c of net.calls) hosts.set(new URL(c.url).host, (hosts.get(new URL(c.url).host) ?? 0) + 1);
		expect(Math.max(...hosts.values())).toBeLessThanOrEqual(3);
		expect(hosts.get('www.eso.de')).toBe(3);
		expect(net.calls.every((c) => c.userAgent === USER_AGENT)).toBe(true);

		const out = directorySchema.parse(JSON.parse(readFileSync(join(dir, 'centres.json'), 'utf8')));
		const byId = Object.fromEntries(out.map((c) => [c.centre_id, c]));
		expect(byId['vhs-fuerth']!.verified_at).not.toBeNull();
		expect(byId['vhs-fuerth']!.test_page_url).toBe('https://kurse.vhs-fuerth.de/einbuergerungstest');
		expect(byId['euro-schulen-nordbayern']!.verified_at).not.toBeNull();
		expect(byId['euro-schulen-aschaffenburg']!.verified_at).toBeNull();
		expect(byId['kolping-moved']!.test_page_url).toBe('https://new.example/einbuergerungstest');
		expect(byId['kolping-moved']!.verified_at).not.toBeNull();

		const note = readFileSync(join(dir, 'review-note.md'), 'utf8');
		expect(note).toContain('- Source URL: https://src.example/');
		expect(note).toContain('- Source date: 2026-04-16 07:48');
		expect(note).toMatch(/- Run at: \d{4}-\d{2}-\d{2}T/);
		expect(note).toContain('- Verified: 3');
		expect(note).toContain('- Unverified: 4');
		expect(note).toContain('- Reader kuferweb: 0, itemkg: 1, none: 6');
		expect(note).toContain('- vhs-down (https://down.example/): robots-disallowed (robots.txt unavailable: HTTP 503)');
		expect(note).toContain('- `address.street`: Hirschenstr. 27/29 → Hirschenstraße 27/29');
		expect(note).toContain('- euro-schulen-aschaffenburg (https://www.eso.de/): postcode not on site');
		expect(note).toContain('- vhs-ohne-seite (no website): no website');
		expect(note).toContain('- vhs-blocked (https://blocked.example/): robots-disallowed');
		expect(note).not.toContain('Not run yet');
	});
});
