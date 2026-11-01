import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchImpl } from '../pipeline/fetch/index.ts';
import { DISCOVERY_REQUESTS_PER_HOST, discoverTestPages, fetchCoverage, formatDiscovery, parseCliArgs, runCoverage, type CoverageOptions, type TestPageProposal } from '../pipeline/stages/coverage-script.ts';
import { cacheFileName, readCacheEntry } from '../pipeline/stages/coverage-cache.ts';
import { checkDirectoryText } from '../tools/check-directory.ts';
import { serializeDirectory, sortDirectory, type Centre } from '../shared/directory.ts';
import { findSitemapLoc, findTestLink, DISCOVERY_PATTERNS } from '../shared/test-page.ts';
import type { Visit } from '../shared/visits.ts';

const RUN_AT = new Date('2026-11-01T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const centre = (id: string, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: `https://www.${id}.example.de/`,
	test_page_url: null,
	reader: 'none',
	reader_config: null,
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

const site = (id: string, path = '') => `https://www.${id}.example.de/${path}`;

const DIRECTORY: Centre[] = sortDirectory([
	centre('sitemap'),
	centre('home'),
	centre('follow'),
	centre('pref'),
	centre('offhost'),
	centre('nothing'),
	centre('noweb', { website: null }),
	centre('budget'),
	centre('robots'),
	centre('down'),
	centre('shared-a', { website: 'https://www.shared.example.de/a' }),
	centre('shared-b', { website: 'https://www.shared.example.de/b' }),
	centre('has', { test_page_url: site('has', 'test') }),
	centre('opted', { opted_out: true }),
	centre('pdf', { pdf_only: true }),
]);

const SCOPED = ['budget', 'down', 'follow', 'home', 'nothing', 'noweb', 'offhost', 'pref', 'robots', 'shared-a', 'shared-b', 'sitemap'];

const page = (body: string, title = 'Startseite') => () =>
	new Response(`<html><head><title>${title}</title></head><body>${body}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const xml = (locs: string[]) => () =>
	new Response(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`, {
		status: 200,
		headers: { 'content-type': 'application/xml' },
	});

const ROUTES: Record<string, () => Response> = {
	[site('sitemap', 'sitemap.xml')]: xml([site('sitemap', 'kontakt'), site('sitemap', 'kurse/einbuergerungstest#termine')]),
	[site('home')]: page('<a href="/kontakt">Kontakt</a><a href="/kurse/test-lid">Einbürgerungstest</a>'),
	[site('follow')]: page('<a href="/kontakt">Kontakt</a><a href="/deutsch">Deutsch &amp; Integration</a>'),
	[site('follow', 'deutsch')]: page('<a href="/deutsch/lid">Leben in Deutschland</a>', 'Deutsch und Integration'),
	[site('pref')]: page('<a href="/einbuergerung">Einbürgerung</a><a href="https://kurse.pref.example.de/x/123#a">Einbürgerungstest</a>'),
	[site('offhost')]: page('<a href="https://other.example.org/einbuergerungstest">Einbürgerungstest</a>'),
	[site('nothing', 'sitemap.xml')]: xml([site('nothing', 'impressum')]),
	[site('nothing')]: page('<a href="/kurse">Kurse</a>'),
	[site('nothing', 'kurse')]: page('<a href="/kurse/yoga">Yoga</a>'),
	[site('budget')]: page('<a href="/test">Einbürgerungstest</a>'),
	'https://www.robots.example.de/robots.txt': () => new Response('User-agent: *\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
	[site('down')]: () => new Response('down', { status: 503 }),
	'https://www.shared.example.de/a': page('<a href="/a/programm">Programm</a>'),
	'https://www.shared.example.de/a/programm': page('<p>nichts</p>'),
	'https://www.shared.example.de/b': page('<a href="/b/einbuergerungstest">Einbürgerungstest</a>'),
	[site('opted')]: page('<a href="/test">Einbürgerungstest</a>'),
	[site('pdf')]: page('<a href="/test">Einbürgerungstest</a>'),
};

/** www.budget.example.de has used its 4 visits in the last 24 h. */
const VISIT_LOG: Visit[] = [1, 2, 3, 4].map((h) => ({ host: 'www.budget.example.de', at: new Date(RUN_AT.getTime() - h * HOUR).toISOString() }));

function fakeNetwork(routes: Record<string, () => Response> = ROUTES) {
	const calls: string[] = [];
	const fetchImpl: FetchImpl = async (requested) => {
		calls.push(requested);
		return routes[requested]?.() ?? new Response('not found', { status: 404 });
	};
	/** Page requests (robots.txt excluded) per host. */
	const pageRequests = (): Record<string, number> => {
		const counts: Record<string, number> = {};
		for (const call of calls) {
			if (call.endsWith('/robots.txt')) continue;
			const host = new URL(call).host;
			counts[host] = (counts[host] ?? 0) + 1;
		}
		return counts;
	};
	return { calls, fetchImpl, pageRequests };
}

interface Paths {
	dir: string;
	directoryPath: string;
	cacheDir: string;
	visitLogPath: string;
	proposalsPath: string;
	testPageProposalsPath: string;
}

function setup(directory: Centre[] = DIRECTORY, log: Visit[] = VISIT_LOG): Paths {
	const dir = mkdtempSync(join(tmpdir(), 'bgt-discover-'));
	const paths = {
		dir,
		directoryPath: join(dir, 'directory', 'centres.json'),
		cacheDir: join(dir, 'coverage', 'cache'),
		visitLogPath: join(dir, 'state', 'visits.json'),
		proposalsPath: join(dir, 'coverage', 'reader-proposals.json'),
		testPageProposalsPath: join(dir, 'coverage', 'test-page-proposals.json'),
	};
	mkdirSync(join(dir, 'directory'));
	mkdirSync(join(dir, 'state'));
	writeFileSync(paths.directoryPath, serializeDirectory(directory));
	writeFileSync(paths.visitLogPath, `${JSON.stringify(log, null, '\t')}\n`);
	return paths;
}

const options = (paths: Paths, net: ReturnType<typeof fakeNetwork>, extra: Partial<CoverageOptions> = {}): CoverageOptions => ({
	directoryPath: paths.directoryPath,
	cacheDir: paths.cacheDir,
	visitLogPath: paths.visitLogPath,
	proposalsPath: paths.proposalsPath,
	testPageProposalsPath: paths.testPageProposalsPath,
	now: () => RUN_AT,
	readers: {},
	clientOptions: { fetchImpl: net.fetchImpl, delayMs: 0, timeoutMs: 1000, sleep: async () => {} },
	...extra,
});

const byId = (proposals: readonly TestPageProposal[]) => Object.fromEntries(proposals.map((p) => [p.centre_id, p]));
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

describe('discoverTestPages', () => {
	it('handles every matrix row', async () => {
		const paths = setup();
		const net = fakeNetwork();
		const { proposals } = await discoverTestPages(options(paths, net));
		const got = byId(proposals);
		const row = (id: string) => [got[id]!.proposed_url, got[id]!.source, got[id]!.evidence];
		expect(row('sitemap')).toEqual([site('sitemap', 'kurse/einbuergerungstest'), 'sitemap', site('sitemap', 'sitemap.xml')]);
		expect(row('home')).toEqual([site('home', 'kurse/test-lid'), 'website', 'Einbürgerungstest']);
		expect(row('follow')).toEqual([site('follow', 'deutsch/lid'), 'follow-up', 'Leben in Deutschland (on Deutsch und Integration)']);
		expect(row('pref')).toEqual(['https://kurse.pref.example.de/x/123', 'website', 'Einbürgerungstest']);
		expect(row('offhost')).toEqual([null, null, 'not found']);
		expect(row('nothing')).toEqual([null, null, 'not found']);
		expect(row('noweb')).toEqual([null, null, 'no website']);
		expect(row('budget')).toEqual([null, null, 'budget']);
		expect(row('robots')).toEqual([null, null, 'robots']);
		expect(row('down')).toEqual([null, null, 'unreachable']);
		expect(got['shared-a']).toMatchObject({ proposed_url: null, evidence: 'not found' });
		expect(got['shared-b']).toMatchObject({ proposed_url: null, evidence: 'budget' });
	});

	it('sends the matrix request counts per host', async () => {
		const paths = setup();
		const net = fakeNetwork();
		await discoverTestPages(options(paths, net));
		const counts = net.pageRequests();
		expect(counts['www.sitemap.example.de']).toBe(1);
		expect(counts['www.home.example.de']).toBe(2);
		expect(counts['www.follow.example.de']).toBe(3);
		expect(counts['www.nothing.example.de']).toBe(3);
	});

	it('never sends more than 3 page requests to a host, shared hosts included', async () => {
		const paths = setup();
		const net = fakeNetwork();
		await discoverTestPages(options(paths, net));
		const counts = net.pageRequests();
		expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(DISCOVERY_REQUESTS_PER_HOST);
		expect(counts['www.shared.example.de']).toBe(3);
	});

	it('never contacts other hosts, a host over budget or a centre without a website', async () => {
		const paths = setup();
		const net = fakeNetwork();
		await discoverTestPages(options(paths, net));
		const hosts = new Set(net.calls.map((c) => new URL(c).host));
		expect(hosts.has('other.example.org')).toBe(false);
		expect(hosts.has('kurse.pref.example.de')).toBe(false);
		expect(hosts.has('www.budget.example.de')).toBe(false);
		expect([...hosts].some((h) => h.includes('noweb') || h.includes('opted') || h.includes('pdf') || h.includes('www.has.'))).toBe(false);
	});

	it('writes one entry per scoped centre, sorted by centre_id', async () => {
		const paths = setup();
		await discoverTestPages(options(paths, fakeNetwork()));
		const file = readJson(paths.testPageProposalsPath) as TestPageProposal[];
		expect(file.map((p) => p.centre_id)).toEqual(SCOPED);
		for (const entry of file) expect(Object.keys(entry).sort()).toEqual(['centre_id', 'evidence', 'proposed_url', 'source', 'website']);
		expect(file.find((p) => p.centre_id === 'noweb')).toEqual({ centre_id: 'noweb', website: null, proposed_url: null, source: null, evidence: 'no website' });
	});

	it('records one visit per contacted host at runAt', async () => {
		const paths = setup();
		const net = fakeNetwork();
		const summary = await discoverTestPages(options(paths, net));
		const contacted = [...new Set(net.calls.map((c) => new URL(c).host))].sort();
		expect(summary.hosts).toEqual(contacted);
		const log = readJson(paths.visitLogPath) as Visit[];
		const fresh = log.filter((v) => v.at === RUN_AT.toISOString()).map((v) => v.host).sort();
		expect(fresh).toEqual(contacted);
	});

	it('sends no request for cached pages on a re-run', async () => {
		const paths = setup();
		const first = fakeNetwork();
		await discoverTestPages(options(paths, first));
		const second = fakeNetwork();
		const { proposals, cached } = await discoverTestPages(options(paths, second));
		const pages = (calls: string[]) => calls.filter((c) => !c.endsWith('/robots.txt'));
		expect(cached).toBeGreaterThan(0);
		expect(pages(second.calls).filter((c) => pages(first.calls).includes(c))).toEqual([]);
		// Only the page the request cap held back is new: shared-b's website page.
		expect(pages(second.calls)).toEqual(['https://www.shared.example.de/b']);
		expect(byId(proposals)['shared-b']).toMatchObject({ proposed_url: 'https://www.shared.example.de/b/einbuergerungstest', source: 'website' });
		expect(byId(proposals)['home']).toMatchObject({ proposed_url: site('home', 'kurse/test-lid') });
	});

	it('refetches cached pages with refresh', async () => {
		const paths = setup([centre('home')]);
		await discoverTestPages(options(paths, fakeNetwork()));
		const again = fakeNetwork();
		await discoverTestPages(options(paths, again, { refresh: true }));
		expect(again.calls.filter((c) => !c.endsWith('/robots.txt'))).toEqual([site('home', 'sitemap.xml'), site('home')]);
	});

	it('leaves the directory byte-identical', async () => {
		const paths = setup();
		const before = readFileSync(paths.directoryPath);
		const logs: string[] = [];
		const code = await runCoverage({ ...options(paths, fakeNetwork()), discover: true, log: (l) => logs.push(l), error: (l) => logs.push(l) });
		expect(code).toBe(0);
		expect(readFileSync(paths.directoryPath).equals(before)).toBe(true);
	});

	it('prints the table, the count line, then the offline report', async () => {
		const paths = setup();
		const logs: string[] = [];
		await runCoverage({ ...options(paths, fakeNetwork()), discover: true, log: (l) => logs.push(l), error: (l) => logs.push(l) });
		expect(logs[0]).toMatch(/^discover: \d+ requested, 0 from cache, \d+ hosts contacted$/);
		expect(logs[1]).toMatch(/^centre\s+source\s+proposed\s+evidence$/);
		expect(logs).toContain(`test pages proposed 4 of ${SCOPED.length} centres without one (written to ${paths.testPageProposalsPath})`);
		expect(logs.some((l) => l.startsWith('coverage '))).toBe(true);
	});

	it('applied proposals pass check:directory and the next --fetch requests the test page', async () => {
		const paths = setup();
		const { proposals } = await discoverTestPages(options(paths, fakeNetwork()));
		const proposed = new Map(proposals.filter((p) => p.proposed_url !== null).map((p) => [p.centre_id, p.proposed_url!]));
		const applied = DIRECTORY.map((c) => (proposed.has(c.centre_id) ? { ...c, test_page_url: proposed.get(c.centre_id)! } : c));
		const text = serializeDirectory(applied);
		expect(checkDirectoryText(text).ok).toBe(true);
		writeFileSync(paths.directoryPath, text);
		const net = fakeNetwork();
		await fetchCoverage(options(paths, net));
		for (const url of proposed.values()) expect(net.calls).toContain(url);
	});
});

const pagesOf = (calls: string[]) => calls.filter((c) => !c.endsWith('/robots.txt'));

describe('discoverTestPages: review fixes', () => {
	it('skips file links and language switchers, and never proposes an in-page anchor', async () => {
		const routes: Record<string, () => Response> = {
			[site('files', 'sitemap.xml')]: xml([site('files', 'downloads/einbuergerungstest.pdf')]),
			[site('files')]: page(
				'<a href="#einbuergerungstest">Einbürgerungstest</a><a href="/f/einbuergerungstest.pdf">Einbürgerungstest (PDF)</a><a href="/kurse.docx">Kurse</a><a href="/" hreflang="de">Deutsch</a><a href="/de/">Deutsch</a><a href="/integration">Deutsch &amp; Integration</a>',
			),
			[site('files', 'integration')]: page('<a href="/i/einbuergerungstest.pdf">Einbürgerungstest</a><a href="/i/lid">Leben in Deutschland</a>', 'Integration'),
		};
		const paths = setup([centre('files')]);
		const net = fakeNetwork(routes);
		const { proposals } = await discoverTestPages(options(paths, net));
		expect(proposals[0]).toMatchObject({ proposed_url: site('files', 'i/lid'), source: 'follow-up', evidence: 'Leben in Deutschland (on Integration)' });
		expect(pagesOf(net.calls)).toEqual([site('files', 'sitemap.xml'), site('files'), site('files', 'integration')]);
	});

	it('runs x.de and www.x.de centres one after another', async () => {
		const paths = setup([centre('wa', { website: 'https://xx.example.de/a' }), centre('wb', { website: 'https://www.xx.example.de/b' })]);
		const net = fakeNetwork({});
		await discoverTestPages(options(paths, net));
		expect(pagesOf(net.calls)).toEqual(['https://xx.example.de/sitemap.xml', 'https://xx.example.de/a', 'https://www.xx.example.de/sitemap.xml', 'https://www.xx.example.de/b']);
	});

	it('keeps a cached ok page when --refresh finds the host over budget', async () => {
		const paths = setup([centre('home')], []);
		await discoverTestPages(options(paths, fakeNetwork()));
		const log = [1, 2, 3, 4].map((h) => ({ host: 'www.home.example.de', at: new Date(RUN_AT.getTime() - h * HOUR).toISOString() }));
		writeFileSync(paths.visitLogPath, `${JSON.stringify(log, null, '\t')}\n`);
		const again = fakeNetwork();
		const { proposals } = await discoverTestPages(options(paths, again, { refresh: true }));
		expect(again.calls).toEqual([]);
		expect(readCacheEntry(paths.cacheDir, site('home'))).toMatchObject({ result: 'ok' });
		expect(proposals[0]).toMatchObject({ proposed_url: site('home', 'kurse/test-lid'), source: 'website' });
	});

	it('retries a cached budget entry once the host has budget again', async () => {
		const paths = setup([centre('budget')]);
		const first = await discoverTestPages(options(paths, fakeNetwork()));
		expect(first.proposals[0]!.evidence).toBe('budget');
		expect(readCacheEntry(paths.cacheDir, site('budget'))).toMatchObject({ result: 'budget' });
		const later = fakeNetwork();
		const { proposals } = await discoverTestPages(options(paths, later, { now: () => new Date(RUN_AT.getTime() + 24 * HOUR) }));
		expect(pagesOf(later.calls)).toEqual([site('budget', 'sitemap.xml'), site('budget')]);
		expect(proposals[0]).toMatchObject({ proposed_url: site('budget', 'test'), source: 'website', evidence: 'Einbürgerungstest' });
	});

	it('exits 1 on a mid-run failure, records every contacted host and says to commit the visits', async () => {
		const paths = setup([centre('home'), centre('follow')], []);
		// A directory where the homepage's cache file belongs: reading it throws.
		mkdirSync(join(paths.cacheDir, cacheFileName(site('home'))), { recursive: true });
		const errors: string[] = [];
		const code = await runCoverage({ ...options(paths, fakeNetwork()), discover: true, log: () => {}, error: (l) => errors.push(l) });
		expect(code).toBe(1);
		expect(errors.some((l) => l.includes('may have been updated') && l.includes('commit it'))).toBe(true);
		const hosts = (readJson(paths.visitLogPath) as Visit[]).map((v) => v.host).sort();
		expect(hosts).toEqual(['www.follow.example.de', 'www.home.example.de']);
	});

	it('does not count a sitemap.xml disallowed by robots.txt against the cap', async () => {
		const routes: Record<string, () => Response> = {
			'https://www.rsm.example.de/robots.txt': () => new Response('User-agent: *\nDisallow: /sitemap.xml\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
			'https://www.rsm.example.de/a': page('<a href="/a/einbuergerungstest">Einbürgerungstest</a>'),
			'https://www.rsm.example.de/b': page('<a href="/b/kurse">Kurse</a>'),
			'https://www.rsm.example.de/b/kurse': page('<a href="/b/kurse/lid">Leben in Deutschland</a>', 'Kurse'),
		};
		const paths = setup([centre('rsm-a', { website: 'https://www.rsm.example.de/a' }), centre('rsm-b', { website: 'https://www.rsm.example.de/b' })]);
		const net = fakeNetwork(routes);
		const { proposals } = await discoverTestPages(options(paths, net));
		expect(byId(proposals)['rsm-a']).toMatchObject({ source: 'website' });
		expect(byId(proposals)['rsm-b']).toMatchObject({ proposed_url: 'https://www.rsm.example.de/b/kurse/lid', source: 'follow-up' });
		expect(net.pageRequests()['www.rsm.example.de']).toBe(3);
	});
});

describe('shared test-page helpers', () => {
	const HOME = 'https://www.vhs.example.de/';
	it('prefers an "Einbürgerungstest" link over a wider match, also by title or encoded href', () => {
		expect(findTestLink('<a href="/lid">Leben in Deutschland</a><a href="/t" title="Einbürgerungstest">Termine</a>', HOME, ['vhs.example.de'], DISCOVERY_PATTERNS, { matchTitle: true })).toEqual({
			url: 'https://www.vhs.example.de/t',
			text: 'Termine',
		});
		expect(findTestLink('<a href="/einb%C3%BCrgerungstest"></a>', HOME, ['vhs.example.de'], DISCOVERY_PATTERNS)).toEqual({
			url: 'https://www.vhs.example.de/einb%C3%BCrgerungstest',
			text: '/einbürgerungstest',
		});
		expect(findTestLink('<a href="/t" title="Einbürgerungstest">x</a>', HOME, ['vhs.example.de'], DISCOVERY_PATTERNS)).toBeNull();
	});

	it('matches sitemap locs on the host only, preferring "Einbürgerungstest"', () => {
		const sitemap = '<urlset><url><loc>https://other.example.org/einbuergerungstest</loc></url><url><loc>https://www.vhs.example.de/leben-in-deutschland</loc></url><url><loc>https://vhs.example.de/einbuergerungstest</loc></url></urlset>';
		expect(findSitemapLoc(sitemap, ['vhs.example.de'], DISCOVERY_PATTERNS)).toBe('https://vhs.example.de/einbuergerungstest');
		expect(findSitemapLoc('<urlset></urlset>', ['vhs.example.de'], DISCOVERY_PATTERNS)).toBeNull();
	});

	it('never proposes a child sitemap of a sitemap index, or a file', () => {
		const index = '<sitemapindex><sitemap><loc>https://vhs.example.de/einbuergerung-sitemap.xml</loc></sitemap></sitemapindex>';
		expect(findSitemapLoc(index, ['vhs.example.de'], DISCOVERY_PATTERNS)).toBeNull();
		expect(findSitemapLoc('<urlset><url><loc>https://vhs.example.de/einbuergerungstest.pdf</loc></url></urlset>', ['vhs.example.de'], DISCOVERY_PATTERNS)).toBeNull();
	});
});

describe('--discover flag', () => {
	it('parses --discover, with --refresh, and rejects it with --fetch', () => {
		expect(parseCliArgs(['--discover'])).toEqual({ fetch: false, discover: true, refresh: false });
		expect(parseCliArgs(['--discover', '--refresh'])).toEqual({ fetch: false, discover: true, refresh: true });
		expect(parseCliArgs(['--discover', '--fetch'])).toHaveProperty('error');
	});

	it('formats an empty review', () => {
		expect(formatDiscovery([], 'x.json').at(-1)).toBe('test pages proposed 0 of 0 centres without one (written to x.json)');
	});
});
