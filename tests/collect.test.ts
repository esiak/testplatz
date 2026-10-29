import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FetchImpl } from '../pipeline/fetch/index.ts';
import { collectRun, type ReaderRegistry } from '../pipeline/stages/collect.ts';
import type { Centre } from '../shared/directory.ts';
import type { RawListing } from '../shared/listing.ts';
import { selectDetailUrls, type FetchedPage, type ParseContext, type Reader, type ReaderPlan } from '../shared/reader.ts';
import type { Visit } from '../shared/visits.ts';

type Route = () => Response | Promise<Response>;

/** A fake network: routes by full URL; unknown URLs get 404. Records every requested URL in order. */
function fakeNetwork(routes: Record<string, Route>) {
	const calls: string[] = [];
	const fetchImpl: FetchImpl = async (url) => {
		calls.push(url);
		await new Promise((r) => setTimeout(r, 1));
		const route = routes[url];
		return route ? route() : new Response('not found', { status: 404 });
	};
	return { calls, fetchImpl };
}

const html = (body: string) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const text = (body: string) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });
const status = (code: number) => () => new Response('', { status: code });
const late = (ms: number) => () => new Promise<Response>((r) => setTimeout(() => r(new Response('late')), ms));
const links = (...urls: string[]) => html(urls.map((u) => `<a class="date" href="${u}">x</a>`).join(''));

const RUN_AT = new Date('2026-10-28T05:17:00.000Z');
const AT = RUN_AT.toISOString();
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(RUN_AT.getTime() - ms).toISOString();
const fullBudget = (host: string, offsetMs = 0): Visit[] => [1, 2, 3, 4].map((h) => ({ host, at: ago(offsetMs + h * HOUR) }));

const centre = (id: string, host: string, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: `https://${host}/`,
	test_page_url: `https://${host}/test`,
	reader: 'kuferweb',
	reader_config: { list_url: `https://${host}/kurse` },
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

const listing = (source_url: string): RawListing => ({
	date: '2026-11-12',
	time: '09:30',
	place: null,
	address: null,
	status: 'free',
	deadline: null,
	registration_method: null,
	eligibility: null,
	source_url,
});

/**
 * A stub reader: by default plans the centre's list URL, follows `class="date"` links (cap 2), and
 * emits one listing per detail page with a body. Records the pages each centre's parse received.
 */
function stubReader(overrides: { plan?: (c: Centre) => Partial<ReaderPlan>; parse?: Reader['parse'] } = {}) {
	const parsed: Record<string, readonly FetchedPage[]> = {};
	const contexts: Record<string, ParseContext> = {};
	const reader: Reader = {
		plan: (c) => ({
			listUrls: [c.reader_config!.list_url],
			selectDetailUrls: (pages) => pages.flatMap((p) => [...(p.html ?? '').matchAll(/class="date" href="([^"]+)"/g)].map((m) => m[1]!)),
			maxDetailPages: 2,
			...overrides.plan?.(c),
		}),
		parse: (pages, c, ctx) => {
			parsed[c.centre_id] = pages;
			contexts[c.centre_id] = ctx;
			if (overrides.parse) return overrides.parse(pages, c, ctx);
			return { kind: 'ok', listings: pages.filter((p) => p.role === 'detail' && p.html !== null).map((p) => listing(p.url)) };
		},
	};
	return { reader, parsed, contexts };
}

/** Runs collect over a fake network; `result` leaves out `durations` (see the durations test). */
function run(centres: Centre[], routes: Record<string, Route>, readers: ReaderRegistry, log: Visit[] = []) {
	const net = fakeNetwork(routes);
	const result = collectRun(centres, readers, {
		log,
		runAt: RUN_AT,
		clientOptions: { fetchImpl: net.fetchImpl, delayMs: 0, timeoutMs: 50, sleep: async () => {} },
		clock: () => 0,
	}).then(({ durations: _durations, ...rest }) => rest);
	return { net, result };
}

describe('collectRun', () => {
	it('skips an opted-out centre with zero requests, before any other rule', async () => {
		const { reader } = stubReader();
		const { net, result } = run([centre('a', 'a.de', { opted_out: true })], {}, { kuferweb: reader }, fullBudget('a.de'));
		expect(await result).toEqual({ outcomes: { a: { kind: 'skipped', reason: 'opted-out' } }, visits: [], pages: {} });
		expect(net.calls).toEqual([]);
	});

	it('skips a reader-none or unregistered-reader centre with zero requests', async () => {
		const { reader } = stubReader();
		const centres = [centre('a', 'a.de', { reader: 'none', reader_config: null }), centre('b', 'b.de', { reader: 'itemkg' })];
		const { net, result } = run(centres, {}, { kuferweb: reader });
		expect(await result).toEqual({
			outcomes: { a: { kind: 'skipped', reason: 'no-reader' }, b: { kind: 'skipped', reason: 'no-reader' } },
			visits: [],
			pages: {},
		});
		expect(net.calls).toEqual([]);
	});

	it('skips robots-disallowed list pages, requesting robots.txt once for two centres on the host', async () => {
		const { reader, parsed } = stubReader({ plan: (c) => ({ listUrls: [`https://a.de/kurse/${c.centre_id}`] }) });
		const { net, result } = run(
			[centre('a', 'a.de'), centre('b', 'a.de')],
			{ 'https://a.de/robots.txt': text('User-agent: *\nDisallow: /kurse\n') },
			{ kuferweb: reader },
		);
		expect(await result).toEqual({
			outcomes: { a: { kind: 'skipped', reason: 'robots' }, b: { kind: 'skipped', reason: 'robots' } },
			visits: [{ host: 'a.de', at: AT }],
			pages: {},
		});
		expect(net.calls).toEqual(['https://a.de/robots.txt']);
		expect(parsed).toEqual({});
	});

	it('skips robots.txt unavailable (5xx) as robots', async () => {
		const { reader } = stubReader();
		const { result } = run([centre('a', 'a.de')], { 'https://a.de/robots.txt': status(503) }, { kuferweb: reader });
		expect((await result).outcomes).toEqual({ a: { kind: 'skipped', reason: 'robots' } });
	});

	it('does not contact an over-budget host at all, not even robots.txt', async () => {
		const { reader } = stubReader();
		const { net, result } = run([centre('a', 'a.de')], { 'https://a.de/robots.txt': status(404) }, { kuferweb: reader }, fullBudget('a.de'));
		expect(await result).toEqual({ outcomes: { a: { kind: 'skipped', reason: 'budget' } }, visits: [], pages: {} });
		expect(net.calls).toEqual([]);
	});

	it('fetches a host whose four visits are all older than 24 h', async () => {
		const { reader } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links() },
			{ kuferweb: reader },
			fullBudget('a.de', 24 * HOUR - HOUR),
		);
		expect(await result).toEqual({
			outcomes: { a: { kind: 'ok', listings: [] } },
			visits: [{ host: 'a.de', at: AT }],
			pages: { a: [{ url: 'https://a.de/kurse', role: 'list', status: 200, finalUrl: 'https://a.de/kurse' }] },
		});
		expect(net.calls).toEqual(['https://a.de/robots.txt', 'https://a.de/kurse']);
	});

	it.each<[string, Route]>([
		['500', status(500)],
		['a timeout', late(200)],
		['a network error', () => Promise.reject(new TypeError('fetch failed'))],
	])('fails a list page answering %s without calling parse', async (_case, route) => {
		const { reader, parsed } = stubReader();
		const { result } = run([centre('a', 'a.de')], { 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': route }, { kuferweb: reader });
		expect(await result).toEqual({ outcomes: { a: { kind: 'failed', reason: 'list-page' } }, visits: [{ host: 'a.de', at: AT }], pages: {} });
		expect(parsed).toEqual({});
	});

	it('happy path: list page then capped detail pages, all with status, parsed, one visit for the host', async () => {
		const { reader, parsed } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{
				'https://a.de/robots.txt': status(404),
				'https://a.de/kurse': links('https://a.de/k/1', 'https://a.de/k/2', 'https://a.de/k/3'),
				'https://a.de/k/1': html('one'),
				'https://a.de/k/2': html('two'),
				'https://a.de/k/3': html('three'),
			},
			{ kuferweb: reader },
		);
		expect(await result).toEqual({
			outcomes: { a: { kind: 'ok', listings: [listing('https://a.de/k/1'), listing('https://a.de/k/2')] } },
			visits: [{ host: 'a.de', at: AT }],
			pages: {
				a: [
					{ url: 'https://a.de/kurse', role: 'list', status: 200, finalUrl: 'https://a.de/kurse' },
					{ url: 'https://a.de/k/1', role: 'detail', status: 200, finalUrl: 'https://a.de/k/1' },
					{ url: 'https://a.de/k/2', role: 'detail', status: 200, finalUrl: 'https://a.de/k/2' },
				],
			},
		});
		expect(net.calls).toEqual(['https://a.de/robots.txt', 'https://a.de/kurse', 'https://a.de/k/1', 'https://a.de/k/2']);
		expect(parsed.a!.map((p) => [p.url, p.role, p.status, p.finalUrl])).toEqual([
			['https://a.de/kurse', 'list', 200, 'https://a.de/kurse'],
			['https://a.de/k/1', 'detail', 200, 'https://a.de/k/1'],
			['https://a.de/k/2', 'detail', 200, 'https://a.de/k/2'],
		]);
	});

	it('hands the run clock to parse', async () => {
		const { reader, contexts } = stubReader();
		const { result } = run([centre('a', 'a.de')], { 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links() }, { kuferweb: reader });
		await result;
		expect(contexts.a!.runAt).toBe(RUN_AT);
	});

	it('requests and parses a duplicated list URL once', async () => {
		const { reader, parsed } = stubReader({ plan: () => ({ listUrls: ['https://a.de/kurse', 'https://a.de/kurse'] }) });
		const { net, result } = run([centre('a', 'a.de')], { 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links() }, { kuferweb: reader });
		expect((await result).outcomes.a).toEqual({ kind: 'ok', listings: [] });
		expect(net.calls).toEqual(['https://a.de/robots.txt', 'https://a.de/kurse']);
		expect(parsed.a!.map((p) => p.url)).toEqual(['https://a.de/kurse']);
	});

	it('passes a redirected list page with its finalUrl, so relative links resolve against the target', async () => {
		const { reader, parsed } = stubReader({
			plan: () => ({
				selectDetailUrls: (pages) =>
					pages.flatMap((p) => [...(p.html ?? '').matchAll(/class="date" href="([^"]+)"/g)].map((m) => new URL(m[1]!, p.finalUrl!).href)),
			}),
		});
		const { net, result } = run(
			[centre('a', 'a.de')],
			{
				'https://a.de/robots.txt': status(404),
				'https://a.de/kurse': redirect('https://a.de/neu/kurse'),
				'https://a.de/neu/kurse': links('k/1'),
				'https://a.de/neu/k/1': html('one'),
			},
			{ kuferweb: reader },
		);
		expect((await result).outcomes.a).toEqual({ kind: 'ok', listings: [listing('https://a.de/neu/k/1')] });
		expect(parsed.a![0]).toMatchObject({ url: 'https://a.de/kurse', role: 'list', status: 200, finalUrl: 'https://a.de/neu/kurse' });
		expect(net.calls).toEqual(['https://a.de/robots.txt', 'https://a.de/kurse', 'https://a.de/neu/kurse', 'https://a.de/neu/k/1']);
	});

	it('skips as robots a list URL redirecting within budget to a robots-disallowed path', async () => {
		const { reader, parsed } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': text('User-agent: *\nDisallow: /privat\n'), 'https://a.de/kurse': redirect('/privat/kurse') },
			{ kuferweb: reader },
		);
		expect((await result).outcomes).toEqual({ a: { kind: 'skipped', reason: 'robots' } });
		expect(net.calls).toEqual(['https://a.de/robots.txt', 'https://a.de/kurse']);
		expect(parsed).toEqual({});
	});

	it('passes a robots-disallowed detail page to parse with null status and html, centre still ok', async () => {
		const { reader, parsed } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{
				'https://a.de/robots.txt': text('User-agent: *\nDisallow: /privat\n'),
				'https://a.de/kurse': links('https://a.de/k/1', 'https://a.de/privat/2'),
				'https://a.de/k/1': html('one'),
			},
			{ kuferweb: reader },
		);
		expect((await result).outcomes.a).toEqual({ kind: 'ok', listings: [listing('https://a.de/k/1')] });
		expect(parsed.a![2]).toEqual({ url: 'https://a.de/privat/2', role: 'detail', status: null, html: null, finalUrl: null });
		expect(net.calls).not.toContain('https://a.de/privat/2');
	});

	it('passes a 404 detail page to parse with its status and null html', async () => {
		const { reader, parsed } = stubReader();
		const { result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links('https://a.de/k/1', 'https://a.de/gone'), 'https://a.de/k/1': html('one') },
			{ kuferweb: reader },
		);
		expect((await result).outcomes.a).toEqual({ kind: 'ok', listings: [listing('https://a.de/k/1')] });
		expect(parsed.a![2]).toEqual({ url: 'https://a.de/gone', role: 'detail', status: 404, html: null, finalUrl: 'https://a.de/gone' });
	});

	it('returns page summaries without html, keeping a failed detail page status, also when parse fails', async () => {
		const { reader } = stubReader({ parse: () => ({ kind: 'failed', reason: 'structure-missing' }) });
		const { result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links('https://a.de/gone') },
			{ kuferweb: reader },
		);
		expect(await result).toMatchObject({
			outcomes: { a: { kind: 'failed', reason: 'structure-missing' } },
			pages: {
				a: [
					{ url: 'https://a.de/kurse', role: 'list', status: 200, finalUrl: 'https://a.de/kurse' },
					{ url: 'https://a.de/gone', role: 'detail', status: 404, finalUrl: 'https://a.de/gone' },
				],
			},
		});
		expect(Object.values((await result).pages).flat().every((page) => !('html' in page))).toBe(true);
	});

	it('does not request an unparseable detail URL and passes it with null status', async () => {
		const { reader, parsed } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links('/k/relative') },
			{ kuferweb: reader },
		);
		await result;
		expect(parsed.a![1]).toEqual({ url: '/k/relative', role: 'detail', status: null, html: null, finalUrl: null });
		expect(net.calls).toEqual(['https://a.de/robots.txt', 'https://a.de/kurse']);
	});

	it('skips as budget a list URL redirecting to an over-budget host, without contacting it', async () => {
		const { reader, parsed } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': redirect('https://b.de/kurse'), 'https://b.de/kurse': links() },
			{ kuferweb: reader },
			fullBudget('b.de'),
		);
		expect(await result).toEqual({ outcomes: { a: { kind: 'skipped', reason: 'budget' } }, visits: [{ host: 'a.de', at: AT }], pages: {} });
		expect(net.calls.filter((u) => u.includes('b.de'))).toEqual([]);
		expect(parsed).toEqual({});
	});

	it('skips as budget a list host whose robots.txt redirects to an over-budget host', async () => {
		const { reader } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': redirect('https://b.de/robots.txt'), 'https://a.de/kurse': links() },
			{ kuferweb: reader },
			fullBudget('b.de'),
		);
		expect((await result).outcomes).toEqual({ a: { kind: 'skipped', reason: 'budget' } });
		expect(net.calls).toEqual(['https://a.de/robots.txt']);
	});

	it('passes a detail page redirecting to an over-budget host with null status', async () => {
		const { reader, parsed } = stubReader();
		const { net, result } = run(
			[centre('a', 'a.de')],
			{ 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links('https://a.de/k/1'), 'https://a.de/k/1': redirect('https://b.de/k/1') },
			{ kuferweb: reader },
			fullBudget('b.de'),
		);
		expect((await result).visits).toEqual([{ host: 'a.de', at: AT }]);
		expect(parsed.a![1]).toEqual({ url: 'https://a.de/k/1', role: 'detail', status: null, html: null, finalUrl: null });
		expect(net.calls.filter((u) => u.includes('b.de'))).toEqual([]);
	});

	it('records both hosts of a cross-host redirect within budget, and the detail finalUrl', async () => {
		const { reader, parsed } = stubReader();
		const { result } = run(
			[centre('a', 'c.de')],
			{
				'https://c.de/robots.txt': status(404),
				'https://c.de/kurse': links('https://c.de/k/1'),
				'https://c.de/k/1': redirect('https://b.de/k/1?x'),
				'https://b.de/robots.txt': status(404),
				'https://b.de/k/1?x': html('one'),
			},
			{ kuferweb: reader },
		);
		expect((await result).visits).toEqual([
			{ host: 'b.de', at: AT },
			{ host: 'c.de', at: AT },
		]);
		expect(parsed.a![1]).toEqual({ url: 'https://c.de/k/1', role: 'detail', status: 200, html: 'one', finalUrl: 'https://b.de/k/1?x' });
	});

	it('skips as budget, with zero requests, when only the second list URL is over budget', async () => {
		const { reader } = stubReader({ plan: () => ({ listUrls: ['https://a.de/kurse', 'https://b.de/kurse'] }) });
		const { net, result } = run([centre('a', 'a.de')], { 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links() }, { kuferweb: reader }, fullBudget('b.de'));
		expect(await result).toEqual({ outcomes: { a: { kind: 'skipped', reason: 'budget' } }, visits: [], pages: {} });
		expect(net.calls).toEqual([]);
	});

	it('fails list-page without parse when the second of two list URLs returns 404', async () => {
		const { reader, parsed } = stubReader({ plan: () => ({ listUrls: ['https://a.de/kurse', 'https://a.de/kurse?p=2'] }) });
		const { net, result } = run([centre('a', 'a.de')], { 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links() }, { kuferweb: reader });
		expect((await result).outcomes).toEqual({ a: { kind: 'failed', reason: 'list-page' } });
		expect(net.calls).toEqual(['https://a.de/robots.txt', 'https://a.de/kurse', 'https://a.de/kurse?p=2']);
		expect(parsed).toEqual({});
	});

	it('fails reader-error with no request when the plan has no list URLs', async () => {
		const { reader, parsed } = stubReader({ plan: () => ({ listUrls: [] }) });
		const { net, result } = run([centre('a', 'a.de')], {}, { kuferweb: reader });
		expect(await result).toEqual({ outcomes: { a: { kind: 'failed', reason: 'reader-error' } }, visits: [], pages: {} });
		expect(net.calls).toEqual([]);
		expect(parsed).toEqual({});
	});

	it.each<[string, Reader, { kind: 'failed'; reason: string }]>([
		[
			'a throwing plan',
			{ ...stubReader().reader, plan: () => { throw new Error('boom'); } },
			{ kind: 'failed', reason: 'reader-error' },
		],
		[
			'a throwing selectDetailUrls',
			stubReader({ plan: () => ({ selectDetailUrls: () => { throw new Error('boom'); } }) }).reader,
			{ kind: 'failed', reason: 'reader-error' },
		],
		['a throwing parse', stubReader({ parse: () => { throw new Error('boom'); } }).reader, { kind: 'failed', reason: 'reader-error' }],
		[
			'a schema-invalid listing',
			stubReader({ parse: () => ({ kind: 'ok', listings: [{ ...listing('https://x.de/'), status: 'full' as never }] }) }).reader,
			{ kind: 'failed', reason: 'schema' },
		],
	])('fails only its centre for %s while a sibling centre is ok', async (_case, bad, expected) => {
		const { reader: good } = stubReader();
		const { result } = run(
			[centre('bad', 'a.de', { reader: 'itemkg' }), centre('good', 'b.de')],
			{
				'https://a.de/robots.txt': status(404),
				'https://a.de/kurse': links(),
				'https://b.de/robots.txt': status(404),
				'https://b.de/kurse': links('https://b.de/k/1'),
				'https://b.de/k/1': html('one'),
			},
			{ kuferweb: good, itemkg: bad },
		);
		expect((await result).outcomes).toEqual({ bad: expected, good: { kind: 'ok', listings: [listing('https://b.de/k/1')] } });
	});

	it('lists each contacted host once across several centres and leaves data/state byte-identical', async () => {
		const stateDir = fileURLToPath(new URL('../data/state/', import.meta.url));
		const snapshot = () =>
			readdirSync(stateDir, { recursive: true, encoding: 'utf8' })
				.sort()
				.map((entry) => {
					try {
						return [entry, readFileSync(join(stateDir, entry)).toString('base64')];
					} catch {
						return [entry, '<dir>'];
					}
				});
		const before = snapshot();
		const { reader } = stubReader();
		const { result } = run(
			[centre('a', 'a.de'), centre('b', 'a.de', { reader_config: { list_url: 'https://a.de/kurse?b' } }), centre('c', 'b.de'), centre('d', 'z.de', { opted_out: true })],
			{
				'https://a.de/robots.txt': status(404),
				'https://a.de/kurse': links(),
				'https://a.de/kurse?b': links(),
				'https://b.de/robots.txt': status(404),
				'https://b.de/kurse': links(),
			},
			{ kuferweb: reader },
		);
		expect((await result).visits).toEqual([
			{ host: 'a.de', at: AT },
			{ host: 'b.de', at: AT },
		]);
		expect(snapshot()).toEqual(before);
	});
});

describe('collectRun durations', () => {
	it('measures each centre with the injected clock, in whole ms, skipped centres included', async () => {
		const { reader } = stubReader();
		const net = fakeNetwork({ 'https://a.de/robots.txt': status(404), 'https://a.de/kurse': links() });
		let ticks = 0;
		const { durations } = await collectRun([centre('a', 'a.de'), centre('b', 'b.de', { opted_out: true })], { kuferweb: reader }, {
			log: [],
			runAt: RUN_AT,
			clientOptions: { fetchImpl: net.fetchImpl, delayMs: 0, timeoutMs: 50, sleep: async () => {} },
			// Each reading advances 10.4 ms, so every centre spans a whole number of readings.
			clock: () => (ticks += 10.4),
		});
		expect(Object.keys(durations).sort()).toEqual(['a', 'b']);
		for (const ms of Object.values(durations)) {
			expect(Number.isInteger(ms)).toBe(true);
			expect(ms).toBeGreaterThan(0);
		}
	});

	it('defaults to a real clock', async () => {
		const { reader } = stubReader();
		const { durations } = await collectRun([centre('a', 'a.de', { opted_out: true })], { kuferweb: reader }, { log: [], runAt: RUN_AT });
		expect(durations.a).toBeGreaterThanOrEqual(0);
	});
});

describe('selectDetailUrls', () => {
	const plan = (urls: string[], maxDetailPages: number): ReaderPlan => ({ listUrls: [], selectDetailUrls: () => urls, maxDetailPages });
	const urls = ['https://a.de/2', 'https://a.de/1', 'https://a.de/2', 'https://a.de/3'];

	it.each<[string, number, string[]]>([
		['de-duplicates in first-seen order', 10, ['https://a.de/2', 'https://a.de/1', 'https://a.de/3']],
		['caps after de-duplication', 2, ['https://a.de/2', 'https://a.de/1']],
		['cap 0', 0, []],
		['a negative cap', -1, []],
		['a NaN cap', Number.NaN, []],
		['an Infinity cap', Number.POSITIVE_INFINITY, []],
		['a fractional cap (floored)', 2.9, ['https://a.de/2', 'https://a.de/1']],
	])('%s', (_case, cap, expected) => {
		expect(selectDetailUrls(plan(urls, cap), [])).toEqual(expected);
	});

	it('treats URLs differing only by #fragment as one page, keeping the first-seen string', () => {
		const withHash = ['https://a.de/1#a', 'https://a.de/1#b', 'https://a.de/1', 'https://a.de/2'];
		expect(selectDetailUrls(plan(withHash, 2), [])).toEqual(['https://a.de/1#a', 'https://a.de/2']);
	});

	it('passes the list pages to the plan and propagates a throw', () => {
		const pages: FetchedPage[] = [{ url: 'https://a.de/', role: 'list', status: 200, html: '', finalUrl: 'https://a.de/' }];
		let seen: readonly FetchedPage[] | undefined;
		selectDetailUrls({ listUrls: [], selectDetailUrls: (p) => ((seen = p), []), maxDetailPages: 1 }, pages);
		expect(seen).toBe(pages);
		expect(() => selectDetailUrls({ listUrls: [], selectDetailUrls: () => { throw new Error('boom'); }, maxDetailPages: 1 }, pages)).toThrow('boom');
	});
});
