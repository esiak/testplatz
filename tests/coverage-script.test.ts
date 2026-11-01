import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchImpl } from '../pipeline/fetch/index.ts';
import type { ReaderRegistry } from '../pipeline/stages/collect.ts';
import { cacheFileName, readCacheEntry, writeCacheEntry, type CacheEntry } from '../pipeline/stages/coverage-cache.ts';
import { fetchCoverage, parseCliArgs, parseCoverage, runCoverage, type CoverageOptions } from '../pipeline/stages/coverage-script.ts';
import { buildCoverage, COVERAGE_CATEGORIES, formatCoverageLine } from '../shared/coverage.ts';
import type { Centre } from '../shared/directory.ts';
import type { FetchedPage, Reader } from '../shared/reader.ts';
import type { Visit } from '../shared/visits.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const KUFERWEB_FIXTURES = join(REPO, 'pipeline/readers/kuferweb/fixtures');

const RUN_AT = new Date('2026-11-01T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// Fake readers: `kuferweb` needs `<ul class="alpha">` and reads one date per detail page;
// `itemkg` needs `<ul class="beta">` and reads `<li data-date>` from the list page alone.
// ---------------------------------------------------------------------------------------------

const listing = (date: string, url: string) => ({
	date,
	time: '10:00',
	place: null,
	address: null,
	status: 'free' as const,
	deadline: null,
	registration_method: null,
	eligibility: null,
	source_url: url,
});

const alphaReader: Reader = {
	plan: (centre) => {
		const url = centre.reader_config?.list_url ?? centre.test_page_url;
		return {
			listUrls: url === null ? [] : [url],
			selectDetailUrls: (pages: readonly FetchedPage[]) => pages.flatMap((p) => [...(p.html ?? '').matchAll(/<a class="d" href="([^"]+)"/g)].map((m) => new URL(m[1]!, p.finalUrl!).href)),
			maxDetailPages: 5,
		};
	},
	parse: (pages) => {
		const list = pages.filter((p) => p.role === 'list');
		if (list.some((p) => p.html === null || !p.html.includes('<ul class="alpha">'))) return { kind: 'failed', reason: 'structure-missing' };
		const details = pages.filter((p) => p.role === 'detail');
		if (details.some((p) => p.html === null)) return { kind: 'failed', reason: 'detail-page' };
		return { kind: 'ok', listings: details.map((p) => listing(/data-date="([^"]+)"/.exec(p.html!)![1]!, p.url)) };
	},
};

const betaReader: Reader = {
	plan: (centre) => {
		const url = centre.reader_config?.list_url ?? centre.test_page_url;
		return { listUrls: url === null ? [] : [url], selectDetailUrls: () => [], maxDetailPages: 0 };
	},
	parse: (pages) => {
		const page = pages[0]!;
		if (page.html === null || !page.html.includes('<ul class="beta">')) return { kind: 'failed', reason: 'structure-missing' };
		return { kind: 'ok', listings: [...page.html.matchAll(/<li data-date="([^"]+)"/g)].map((m) => listing(m[1]!, page.url)) };
	},
};

const READERS: ReaderRegistry = { kuferweb: alphaReader, itemkg: betaReader };

// ---------------------------------------------------------------------------------------------
// Directory: one centre per matrix row.
// ---------------------------------------------------------------------------------------------

const centre = (id: string, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: `https://${id}.example.de/`,
	test_page_url: `https://${id}.example.de/test`,
	reader: 'kuferweb',
	reader_config: null,
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

const url = (id: string, path = 'test') => `https://${id}.example.de/${path}`;

const DIRECTORY: Centre[] = [
	centre('opted', { opted_out: true }),
	centre('pdf', { reader: 'none', pdf_only: true }),
	centre('nopage', { reader: 'none', test_page_url: null }),
	centre('alpha-ok'),
	centre('beta-empty', { reader: 'itemkg' }),
	centre('alpha-detail-gone'),
	centre('alpha-broken'),
	centre('down'),
	centre('robots'),
	centre('budget'),
	centre('never'),
	centre('none-alpha', { reader: 'none' }),
	centre('none-beta', { reader: 'none' }),
	centre('none-nothing', { reader: 'none' }),
	centre('none-down', { reader: 'none' }),
];

const html = (body: string) => () => new Response(`<html><body>${body}</body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const ALPHA_LIST = (...details: string[]) => html(`<ul class="alpha">${details.map((d) => `<a class="d" href="${d}">x</a>`).join('')}</ul>`);
const DETAIL = (date: string) => html(`<p data-date="${date}">Test</p>`);

const ROUTES: Record<string, () => Response> = {
	'https://robots.example.de/robots.txt': () => new Response('User-agent: *\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
	[url('alpha-ok')]: ALPHA_LIST('/k/1', '/k/2'),
	[url('alpha-ok', 'k/1')]: DETAIL('2026-12-01'),
	[url('alpha-ok', 'k/2')]: DETAIL('2026-12-08'),
	[url('beta-empty')]: html('<ul class="beta"></ul>'),
	[url('alpha-detail-gone')]: ALPHA_LIST('/k/1'),
	[url('alpha-detail-gone', 'k/1')]: () => new Response('gone', { status: 410 }),
	[url('alpha-broken')]: html('<p>redesigned</p>'),
	[url('down')]: () => new Response('down', { status: 503 }),
	[url('budget')]: ALPHA_LIST(),
	[url('never')]: ALPHA_LIST(),
	[url('none-alpha')]: ALPHA_LIST('/k/9'),
	[url('none-alpha', 'k/9')]: DETAIL('2026-12-15'),
	[url('none-beta')]: html('<ul class="beta"><li data-date="2026-12-20">x</li></ul>'),
	[url('none-nothing')]: html('<p>Termine auf Anfrage</p>'),
	[url('none-down')]: () => new Response('nope', { status: 500 }),
	[url('opted')]: ALPHA_LIST(),
	[url('pdf')]: html('<a href="termine.pdf">PDF</a>'),
};

/** budget.example.de has used its 4 visits in the last 24 h. */
const VISIT_LOG: Visit[] = [1, 2, 3, 4].map((h) => ({ host: 'budget.example.de', at: new Date(RUN_AT.getTime() - h * HOUR).toISOString() }));

/** A fake network over the routes (unknown URLs, robots.txt included, get 404). Records every URL. */
function fakeNetwork(routes: Record<string, () => Response> = ROUTES) {
	const calls: string[] = [];
	const fetchImpl: FetchImpl = async (requested) => {
		calls.push(requested);
		return routes[requested]?.() ?? new Response('not found', { status: 404 });
	};
	return { calls, fetchImpl };
}

interface Paths {
	dir: string;
	directoryPath: string;
	cacheDir: string;
	visitLogPath: string;
	proposalsPath: string;
}

function setup({ directory = DIRECTORY, log = VISIT_LOG }: { directory?: Centre[]; log?: Visit[] | string | null } = {}): Paths {
	const dir = mkdtempSync(join(tmpdir(), 'bgt-coverage-'));
	const paths = {
		dir,
		directoryPath: join(dir, 'directory', 'centres.json'),
		cacheDir: join(dir, 'coverage', 'cache'),
		visitLogPath: join(dir, 'state', 'visits.json'),
		proposalsPath: join(dir, 'coverage', 'reader-proposals.json'),
	};
	mkdirSync(join(dir, 'directory'));
	mkdirSync(join(dir, 'state'));
	writeFileSync(paths.directoryPath, `${JSON.stringify(directory, null, '\t')}\n`);
	if (log !== null) writeFileSync(paths.visitLogPath, typeof log === 'string' ? log : `${JSON.stringify(log, null, '\t')}\n`);
	return paths;
}

const options = (paths: Paths, net = fakeNetwork(), extra: Partial<CoverageOptions> = {}): CoverageOptions => ({
	directoryPath: paths.directoryPath,
	cacheDir: paths.cacheDir,
	visitLogPath: paths.visitLogPath,
	proposalsPath: paths.proposalsPath,
	now: () => RUN_AT,
	readers: READERS,
	clientOptions: { fetchImpl: net.fetchImpl, delayMs: 0, timeoutMs: 1000, sleep: async () => {} },
	...extra,
});

const rowOf = (report: ReturnType<typeof parseCoverage>, id: string) => report.centres.find((row) => row.centre_id === id)!;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

afterEach(() => {
	vi.restoreAllMocks();
});

describe('fetchCoverage + parseCoverage', () => {
	it('classifies every matrix row from the fetched cache', async () => {
		const paths = setup();
		const net = fakeNetwork();
		await fetchCoverage(options(paths, net));
		// `never` was not fetched: drop its cache entry to model an incomplete cache.
		rmSync(join(paths.cacheDir, cacheFileName(url('never'))));

		const report = parseCoverage(options(paths));
		const got = Object.fromEntries(report.centres.map((row) => [row.centre_id, [row.category, row.reason, row.listings]]));
		expect(got).toEqual({
			opted: ['opted-out', null, null],
			pdf: ['pdf-only', null, null],
			nopage: ['no-test-page', null, null],
			'alpha-ok': ['parsed', null, 2],
			'beta-empty': ['parsed-empty', null, 0],
			'alpha-detail-gone': ['failed', 'detail-page', null],
			'alpha-broken': ['failed', 'structure-missing', null],
			down: ['unreachable', null, null],
			robots: ['robots', null, null],
			budget: ['budget', null, null],
			never: ['failed', 'not-fetched', null],
			'none-alpha': ['no-reader', null, null],
			'none-beta': ['no-reader', null, null],
			'none-nothing': ['no-reader', null, null],
			'none-down': ['unreachable', null, null],
		});
		expect(rowOf(report, 'alpha-ok').reader).toBe('kuferweb');
	});

	it('never requests opted-out or PDF-only pages', async () => {
		const paths = setup();
		const net = fakeNetwork();
		await fetchCoverage(options(paths, net));
		expect(net.calls.filter((c) => c.includes('opted.example.de') || c.includes('pdf.example.de'))).toEqual([]);
	});

	it('caches each result with status and no body unless ok', async () => {
		const paths = setup();
		await fetchCoverage(options(paths));
		const entry = (u: string) => readCacheEntry(paths.cacheDir, u)!;
		expect(entry(url('alpha-ok'))).toMatchObject({ url: url('alpha-ok'), fetched_at: RUN_AT.toISOString(), result: 'ok', status: 200, final_url: url('alpha-ok') });
		expect(entry(url('alpha-ok')).html).toContain('class="alpha"');
		expect(entry(url('down'))).toEqual({ url: url('down'), fetched_at: RUN_AT.toISOString(), result: 'unreachable', status: 503, final_url: url('down'), html: null });
		expect(entry(url('robots'))).toMatchObject({ result: 'robots', status: null, html: null });
		expect(entry(url('budget'))).toMatchObject({ result: 'budget', status: null, html: null });
		expect(entry(url('alpha-detail-gone', 'k/1'))).toMatchObject({ result: 'unreachable', status: 410 });
	});

	it('passes a detail page missing from the cache as nothing received', async () => {
		const paths = setup({ directory: [centre('alpha-ok')] });
		await fetchCoverage(options(paths));
		rmSync(join(paths.cacheDir, cacheFileName(url('alpha-ok', 'k/2'))));
		const report = parseCoverage(options(paths));
		expect(rowOf(report, 'alpha-ok')).toMatchObject({ category: 'failed', reason: 'detail-page' });
	});

	it('does not request URLs cached as ok, unreachable or robots again', async () => {
		const paths = setup();
		const first = fakeNetwork();
		const summary = await fetchCoverage(options(paths, first));
		expect(first.calls.length).toBeGreaterThan(0);
		expect(summary.fetched).toBeGreaterThan(0);
		const second = fakeNetwork();
		const again = await fetchCoverage(options(paths, second));
		// Only `budget` entries are retried, and the budget host is still blocked: nothing is sent.
		expect(second.calls).toEqual([]);
		expect(again.hosts).toEqual([]);
	});

	it('retries a cached budget entry once the host has budget again', async () => {
		const paths = setup({ directory: [centre('budget')] });
		await fetchCoverage(options(paths));
		expect(readCacheEntry(paths.cacheDir, url('budget'))!.result).toBe('budget');
		const later = fakeNetwork();
		await fetchCoverage(options(paths, later, { now: () => new Date(RUN_AT.getTime() + 24 * HOUR) }));
		expect(later.calls).toContain(url('budget'));
		expect(readCacheEntry(paths.cacheDir, url('budget'))!.result).toBe('ok');
	});

	it('refetches cached URLs with refresh', async () => {
		const paths = setup({ directory: [centre('alpha-ok'), centre('down')] });
		await fetchCoverage(options(paths));
		const second = fakeNetwork();
		await fetchCoverage(options(paths, second, { refresh: true }));
		expect(second.calls).toEqual(expect.arrayContaining([url('alpha-ok'), url('alpha-ok', 'k/1'), url('alpha-ok', 'k/2'), url('down')]));
	});

	it('requests a URL shared by two centres once per run', async () => {
		const shared = { reader_config: { list_url: url('alpha-ok') } };
		const paths = setup({ directory: [centre('alpha-ok'), centre('twin', shared)] });
		const net = fakeNetwork();
		await fetchCoverage(options(paths, net, { refresh: true }));
		expect(net.calls.filter((c) => c === url('alpha-ok'))).toHaveLength(1);
	});

	it('keeps a cached ok page when --refresh finds its host over budget, and counts no request', async () => {
		const paths = setup({ directory: [centre('budget')], log: [] });
		await fetchCoverage(options(paths));
		const before = readCacheEntry(paths.cacheDir, url('budget'))!;
		expect(before.result).toBe('ok');
		writeFileSync(paths.visitLogPath, JSON.stringify(VISIT_LOG));
		const net = fakeNetwork();
		const summary = await fetchCoverage(options(paths, net, { refresh: true }));
		expect(net.calls).toEqual([]);
		expect(summary.fetched).toBe(0);
		expect(readCacheEntry(paths.cacheDir, url('budget'))).toEqual(before);
	});

	it('does not fetch detail pages of a reader whose structure check misses', async () => {
		const routes = { ...ROUTES, [url('none-links')]: html('<a class="d" href="/k/x">x</a>') };
		const paths = setup({ directory: [centre('none-links', { reader: 'none' })], log: [] });
		const net = fakeNetwork(routes);
		await fetchCoverage(options(paths, net));
		expect(net.calls).toContain(url('none-links'));
		expect(net.calls).not.toContain(url('none-links', 'k/x'));
	});

	it('records every contacted host when one centre fails mid-run, then exits 1', async () => {
		// `slow` answers late and links to a detail on `late.example.de`, first contacted after `down` failed.
		const routes = { ...ROUTES, [url('slow')]: ALPHA_LIST('https://late.example.de/k/1'), 'https://late.example.de/k/1': DETAIL('2026-12-01') };
		const paths = setup({ directory: [...DIRECTORY, centre('slow')] });
		// A directory where the `down` page's cache file belongs makes that one cache write fail.
		mkdirSync(join(paths.cacheDir, cacheFileName(url('down'))), { recursive: true });
		writeFileSync(join(paths.cacheDir, cacheFileName(url('down')), 'block'), '');
		const base = fakeNetwork(routes);
		const net = {
			calls: base.calls,
			fetchImpl: (async (requested, init) => {
				if (requested === url('slow')) await new Promise((resolve) => setTimeout(resolve, 30));
				return base.fetchImpl(requested, init);
			}) as FetchImpl,
		};
		const errors: string[] = [];
		const code = await runCoverage({ ...options(paths, net, { refresh: true }), fetch: true, log: () => {}, error: (line) => errors.push(line) });
		expect(code).toBe(1);
		expect(net.calls).toContain(url('down'));
		expect(net.calls).toContain('https://late.example.de/k/1');
		const contacted = [...new Set(net.calls.map((c) => new URL(c).host))].sort();
		const recorded = (readJson(paths.visitLogPath) as Visit[]).filter((v) => v.at === RUN_AT.toISOString()).map((v) => v.host).sort();
		expect(recorded).toEqual(contacted);
		expect(errors.join('\n')).toContain(`${paths.visitLogPath} may have been updated`);
	});

	it('never contacts a host over budget, robots.txt included', async () => {
		const paths = setup();
		const net = fakeNetwork();
		await fetchCoverage(options(paths, net));
		expect(net.calls.filter((c) => new URL(c).host === 'budget.example.de')).toEqual([]);
		expect(rowOf(parseCoverage(options(paths)), 'budget').category).toBe('budget');
		const log = readJson(paths.visitLogPath) as Visit[];
		expect(log.filter((v) => v.host === 'budget.example.de')).toEqual([...VISIT_LOG].reverse());
	});

	it('records one visit per contacted host at runAt', async () => {
		const paths = setup();
		const net = fakeNetwork();
		const summary = await fetchCoverage(options(paths, net));
		const contacted = [...new Set(net.calls.map((c) => new URL(c).host))].sort();
		expect(summary.hosts).toEqual(contacted);
		const log = readJson(paths.visitLogPath) as Visit[];
		const fresh = log.filter((v) => v.at === RUN_AT.toISOString());
		expect(fresh.map((v) => v.host).sort()).toEqual(contacted);
		expect(log).toHaveLength(VISIT_LOG.length + contacted.length);
	});

	it('tries every reader on reader-none centres and proposes the ones that parse', async () => {
		const paths = setup();
		const net = fakeNetwork();
		await fetchCoverage(options(paths, net));
		// Detail pages are fetched only for readers whose structure check matched.
		expect(net.calls).toContain(url('none-alpha', 'k/9'));
		const report = parseCoverage(options(paths));
		expect(report.candidates).toEqual([
			{ centre_id: 'none-alpha', reader: 'itemkg', outcome: 'failed', reason: 'structure-missing', listings: 0 },
			{ centre_id: 'none-alpha', reader: 'kuferweb', outcome: 'parsed', reason: null, listings: 1 },
			{ centre_id: 'none-beta', reader: 'itemkg', outcome: 'parsed', reason: null, listings: 1 },
			{ centre_id: 'none-beta', reader: 'kuferweb', outcome: 'failed', reason: 'structure-missing', listings: 0 },
			{ centre_id: 'none-nothing', reader: 'itemkg', outcome: 'failed', reason: 'structure-missing', listings: 0 },
			{ centre_id: 'none-nothing', reader: 'kuferweb', outcome: 'failed', reason: 'structure-missing', listings: 0 },
		]);
		const proposals = [
			{ centre_id: 'none-alpha', reader: 'kuferweb', outcome: 'parsed', listings: 1 },
			{ centre_id: 'none-beta', reader: 'itemkg', outcome: 'parsed', listings: 1 },
		];
		expect(report.proposals).toEqual(proposals);
		expect(readJson(paths.proposalsPath)).toEqual(proposals);
	});

	it('proposes kuferweb for a real KuferWeb page with the shipped readers', async () => {
		const LIST = 'https://www.vhs-moosburg.de/programm/sprachen/kategorie/Einbuergerungstest/50';
		const DETAIL_BASE = 'https://www.vhs-moosburg.de/programm/sprachen/kurs/Einbuergerungstest/';
		const page = (file: string) => () => new Response(readFileSync(join(KUFERWEB_FIXTURES, 'moosburg', file)), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
		const routes = { [LIST]: page('list.html'), [`${DETAIL_BASE}262.3071`]: page('262.3071.html'), [`${DETAIL_BASE}262.3072`]: page('262.3072.html') };
		const paths = setup({ directory: [centre('moosburg', { reader: 'none', test_page_url: LIST })], log: [] });
		const net = fakeNetwork(routes);
		const { readers: _ignored, ...shipped } = options(paths, net);
		await fetchCoverage(shipped);
		const report = parseCoverage(shipped);
		expect(report.proposals).toEqual([{ centre_id: 'moosburg', reader: 'kuferweb', outcome: 'parsed', listings: expect.any(Number) }]);
		expect(report.proposals[0]!.listings).toBeGreaterThan(0);
		expect(report.candidates.find((c) => c.reader === 'itemkg')).toMatchObject({ outcome: 'failed', reason: 'structure-missing' });
	});

	it('writes an empty proposals file when nothing is proposed', () => {
		const paths = setup();
		parseCoverage(options(paths));
		expect(readJson(paths.proposalsPath)).toEqual([]);
	});
});

describe('the offline parse', () => {
	it('sends no request and creates no client', async () => {
		const paths = setup();
		await fetchCoverage(options(paths));
		const net = fakeNetwork();
		const globalFetch = vi.spyOn(globalThis, 'fetch');
		const logs: string[] = [];
		const code = await runCoverage({ ...options(paths, net), log: (line) => logs.push(line), error: (line) => logs.push(line) });
		expect(code).toBe(0);
		expect(net.calls).toEqual([]);
		expect(globalFetch).not.toHaveBeenCalled();
	});

	it('equals buildCoverage over the outcomes the cache implies, summing to the directory size', async () => {
		const paths = setup();
		await fetchCoverage(options(paths));
		const report = parseCoverage(options(paths));
		const expected = buildCoverage(
			DIRECTORY,
			Object.fromEntries(
				report.centres.map((row) => {
					// Rebuild each outcome from its row, then classify through shared/coverage.ts again.
					if (row.listings !== null) return [row.centre_id, { kind: 'ok', listings: Array.from({ length: row.listings }) }];
					const reason = { robots: 'robots', budget: 'budget', unreachable: 'list-page', 'no-reader': 'no-reader' }[row.category as string];
					if (row.category === 'failed') return [row.centre_id, { kind: 'failed', reason: row.reason! }];
					if (row.category === 'unreachable') return [row.centre_id, { kind: 'failed', reason: reason! }];
					if (reason !== undefined) return [row.centre_id, { kind: 'skipped', reason }];
					return [row.centre_id, undefined];
				}),
			),
		);
		expect(report.coverage).toEqual(expected);
		expect(Object.values(report.coverage.by_category).reduce((a, b) => a + b, 0)).toBe(DIRECTORY.length);
		expect(report.coverage.coverage).toEqual({ percent: 37.5, numerator: 3, denominator: 8 });
	});

	it('prints the table, the reader-none section, the coverage line and the proposals count', async () => {
		const paths = setup();
		await fetchCoverage(options(paths));
		const logs: string[] = [];
		const jsonPath = join(paths.dir, 'report.json');
		expect(await runCoverage({ ...options(paths), jsonPath, log: (line) => logs.push(line) })).toBe(0);
		expect(logs[0]).toMatch(/^centre\s+category\s+reason\s+listings\s+reader$/);
		expect(logs).toContain('Reader `none` centres');
		const report = readJson(jsonPath) as ReturnType<typeof parseCoverage>;
		expect(logs).toContain(formatCoverageLine(report.coverage));
		expect(logs.at(-1)).toBe(`proposals 2 (written to ${paths.proposalsPath})`);
		expect(JSON.stringify(report)).not.toContain('<html>');
		expect(Object.keys(report.coverage.by_category)).toEqual([...COVERAGE_CATEGORIES]);
	});

	it('reports every centre with a reader as not-fetched over an empty cache', async () => {
		const paths = setup();
		const report = parseCoverage(options(paths));
		for (const row of report.centres) {
			expect(['failed', 'opted-out', 'pdf-only', 'no-test-page']).toContain(row.category);
			if (row.category === 'failed') expect(row.reason).toBe('not-fetched');
		}
	});

	it('exits 1 naming a bad cache entry', async () => {
		const paths = setup({ directory: [centre('alpha-ok')] });
		mkdirSync(paths.cacheDir, { recursive: true });
		const bad: Partial<CacheEntry> = { url: url('alpha-ok'), result: 'ok' };
		writeFileSync(join(paths.cacheDir, cacheFileName(url('alpha-ok'))), JSON.stringify(bad));
		const errors: string[] = [];
		expect(await runCoverage({ ...options(paths), log: () => {}, error: (line) => errors.push(line) })).toBe(1);
		expect(errors.join('\n')).toContain(cacheFileName(url('alpha-ok')));
	});
});

describe('runCoverage --fetch', () => {
	it('exits 1 before any request when the visit log is invalid', async () => {
		const paths = setup({ log: '{"not": "a log"}' });
		const net = fakeNetwork();
		const errors: string[] = [];
		expect(await runCoverage({ ...options(paths, net), fetch: true, log: () => {}, error: (line) => errors.push(line) })).toBe(1);
		expect(net.calls).toEqual([]);
		expect(errors.join('\n')).toContain(paths.visitLogPath);
		expect(() => readdirSync(paths.cacheDir)).toThrow();
	});

	it('never writes the directory', async () => {
		const paths = setup();
		const before = readFileSync(paths.directoryPath);
		expect(await runCoverage({ ...options(paths), fetch: true, log: () => {} })).toBe(0);
		expect(readFileSync(paths.directoryPath)).toEqual(before);
	});

	it('writes a cache entry per requested page, keyed by the URL hash', async () => {
		const paths = setup({ directory: [centre('alpha-ok')], log: [] });
		await runCoverage({ ...options(paths), fetch: true, log: () => {} });
		expect(readdirSync(paths.cacheDir).sort()).toEqual([url('alpha-ok'), url('alpha-ok', 'k/1'), url('alpha-ok', 'k/2')].map(cacheFileName).sort());
	});
});

describe('parseCliArgs', () => {
	it('accepts --fetch, --refresh with --fetch and --json', () => {
		expect(parseCliArgs([])).toEqual({ fetch: false, refresh: false });
		expect(parseCliArgs(['--fetch', '--refresh', '--json', 'r.json'])).toEqual({ fetch: true, refresh: true, jsonPath: 'r.json' });
	});

	it('rejects --refresh without --fetch, and unknown flags', () => {
		expect(parseCliArgs(['--refresh'])).toHaveProperty('error');
		expect(parseCliArgs(['--unknown'])).toHaveProperty('error');
		expect(parseCliArgs(['extra'])).toHaveProperty('error');
	});
});

describe('workflows', () => {
	it('never run the coverage script', () => {
		const dir = join(REPO, '.github/workflows');
		for (const file of readdirSync(dir)) {
			const text = readFileSync(join(dir, file), 'utf8');
			expect(text, file).not.toContain('coverage-script');
			expect(text, file).not.toMatch(/npm run coverage/);
		}
	});
});

describe('the cache', () => {
	it('round-trips an entry and rejects a body on a non-ok entry', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bgt-cache-'));
		const entry: CacheEntry = { url: 'https://x.example.de/a', fetched_at: RUN_AT.toISOString(), result: 'ok', status: 200, final_url: 'https://x.example.de/a', html: '<p>x</p>' };
		writeCacheEntry(dir, entry);
		expect(readCacheEntry(dir, entry.url)).toEqual(entry);
		expect(readCacheEntry(dir, 'https://x.example.de/b')).toBeNull();
		expect(() => writeCacheEntry(dir, { ...entry, result: 'unreachable' })).toThrow();
	});
});
