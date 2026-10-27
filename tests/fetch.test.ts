import { describe, expect, it } from 'vitest';
import { USER_AGENT } from '../pipeline/config.ts';
import { decodeBody } from '../pipeline/fetch/decode.ts';
import { createFetchClient, type FetchImpl } from '../pipeline/fetch/index.ts';
import { parseRobots } from '../pipeline/fetch/robots.ts';

type Route = (init: RequestInit) => Response | Promise<Response>;

interface Call {
	url: string;
	userAgent: string | null;
	start: number;
	end: number;
}

/** A fake network: routes by full URL; unknown URLs get 404. Records every call. */
function fakeNetwork(routes: Record<string, Route>, latencyMs = 5) {
	const calls: Call[] = [];
	const fetchImpl: FetchImpl = async (url, init) => {
		const start = performance.now();
		await new Promise((r) => setTimeout(r, latencyMs));
		const route = routes[url];
		const response = route ? await route(init) : new Response('not found', { status: 404 });
		calls.push({ url, userAgent: new Headers(init.headers).get('user-agent'), start, end: performance.now() });
		return response;
	};
	return { calls, fetchImpl };
}

const html = (body: string, headers: Record<string, string> = {}) => () =>
	new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const text = (body: string) => () => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
const redirect = (location: string, status = 301) => () => new Response(null, { status, headers: { location } });
const status = (code: number) => () => new Response('', { status: code });

describe('parseRobots', () => {
	it('prefers the bgtsearch-bot group over *', () => {
		const rules = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: bgtsearch-bot\nDisallow: /private\n');
		expect(rules.isAllowed('/kurse')).toBe(true);
		expect(rules.isAllowed('/private/x')).toBe(false);
	});

	it('uses the longest match, Allow winning ties, with * and $', () => {
		const rules = parseRobots(
			'User-agent: *\nDisallow: /kurse\nAllow: /kurse/einbuergerung\nDisallow: /*.pdf$\nAllow: /a\nDisallow: /a\n',
		);
		expect(rules.isAllowed('/kurse/x')).toBe(false);
		expect(rules.isAllowed('/kurse/einbuergerungstest')).toBe(true);
		expect(rules.isAllowed('/docs/flyer.pdf')).toBe(false);
		expect(rules.isAllowed('/docs/flyer.pdf?x=1')).toBe(true);
		expect(rules.isAllowed('/a')).toBe(true);
		expect(rules.isAllowed('/')).toBe(true);
	});

	it('ignores comments, empty Disallow and groups for other bots', () => {
		const rules = parseRobots('# hi\nUser-agent: otherbot\nDisallow: /\nUser-agent: *\nDisallow:   # nothing\n');
		expect(rules.isAllowed('/anything')).toBe(true);
	});

	it('joins consecutive user-agent lines into one group', () => {
		const rules = parseRobots('User-agent: foo\nUser-agent: BGTSearch-Bot\nDisallow: /x\n');
		expect(rules.isAllowed('/x')).toBe(false);
	});
});

describe('createFetchClient', () => {
	it('returns the page with the bot User-Agent on every request', async () => {
		const net = fakeNetwork({ 'https://a.de/robots.txt': status(404), 'https://a.de/p': html('<p>hi</p>') });
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		const result = await client.get('https://a.de/p#frag');
		expect(result).toEqual({
			ok: true,
			status: 200,
			url: 'https://a.de/p',
			contentType: 'text/html; charset=utf-8',
			text: '<p>hi</p>',
		});
		expect(net.calls.map((c) => c.userAgent)).toEqual([USER_AGENT, USER_AGENT]);
	});

	it('never requests a robots-disallowed path and fetches robots.txt once', async () => {
		const net = fakeNetwork({
			'https://a.de/robots.txt': text('User-agent: *\nDisallow: /kurse\n'),
			'https://a.de/': html('home'),
			'https://a.de/other': html('other'),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect(await client.get('https://a.de/kurse/x')).toEqual({
			ok: false,
			reason: 'robots-disallowed',
			url: 'https://a.de/kurse/x',
			status: null,
		});
		expect((await client.get('https://a.de/')).ok).toBe(true);
		expect((await client.get('https://a.de/other')).ok).toBe(true);
		expect(net.calls.map((c) => c.url)).toEqual(['https://a.de/robots.txt', 'https://a.de/', 'https://a.de/other']);
	});

	it('treats a 4xx robots.txt as allow-all and a 5xx as disallow-all', async () => {
		const net = fakeNetwork({
			'https://a.de/robots.txt': status(404),
			'https://a.de/x': html('x'),
			'https://b.de/robots.txt': status(503),
			'https://b.de/x': html('x'),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect((await client.get('https://a.de/x')).ok).toBe(true);
		expect(await client.get('https://b.de/x')).toMatchObject({ ok: false, reason: 'robots-disallowed' });
		expect(await client.get('https://b.de/')).toMatchObject({ ok: false, reason: 'robots-disallowed' });
		expect(net.calls.filter((c) => c.url.startsWith('https://b.de')).map((c) => c.url)).toEqual(['https://b.de/robots.txt']);
	});

	it('treats a robots.txt timeout or network error as disallow-all', async () => {
		const net = fakeNetwork({
			'https://a.de/robots.txt': () => Promise.reject(new TypeError('fetch failed')),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect(await client.get('https://a.de/x')).toMatchObject({ ok: false, reason: 'robots-disallowed' });
	});

	it('runs requests to one host serially, at least the delay apart; other hosts in parallel', async () => {
		const delayMs = 60;
		const net = fakeNetwork(
			{
				'https://a.de/robots.txt': status(404),
				'https://a.de/1': html('1'),
				'https://a.de/2': html('2'),
				'https://a.de/3': html('3'),
				'https://b.de/robots.txt': status(404),
				'https://b.de/1': html('1'),
			},
			20,
		);
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs });
		const results = await Promise.all(
			['https://a.de/1', 'https://a.de/2', 'https://a.de/3', 'https://b.de/1'].map((u) => client.get(u)),
		);
		expect(results.every((r) => r.ok)).toBe(true);

		const aCalls = net.calls.filter((c) => c.url.startsWith('https://a.de')).sort((x, y) => x.start - y.start);
		expect(aCalls).toHaveLength(4);
		for (let i = 1; i < aCalls.length; i++) {
			expect(aCalls[i]!.start - aCalls[i - 1]!.end).toBeGreaterThanOrEqual(delayMs - 2);
		}
		const bFirst = net.calls.find((c) => c.url === 'https://b.de/robots.txt')!;
		expect(bFirst.start).toBeLessThan(aCalls[1]!.start);
	});

	it('uses the injected sleep between requests to a host', async () => {
		const slept: number[] = [];
		const net = fakeNetwork({ 'https://a.de/robots.txt': status(404), 'https://a.de/1': html('1') }, 0);
		const client = createFetchClient({
			fetchImpl: net.fetchImpl,
			delayMs: 1000,
			sleep: async (ms) => {
				slept.push(ms);
			},
		});
		await client.get('https://a.de/1');
		expect(slept).toEqual([1000]);
	});

	it('times out a slow server', async () => {
		const net = fakeNetwork({
			'https://a.de/robots.txt': status(404),
			'https://a.de/slow': (init) =>
				new Promise<Response>((_, reject) => {
					init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
				}),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0, timeoutMs: 30 });
		expect(await client.get('https://a.de/slow')).toEqual({
			ok: false,
			reason: 'timeout',
			url: 'https://a.de/slow',
			status: null,
		});
	});

	it('reports network and http errors as values', async () => {
		const net = fakeNetwork({
			'https://a.de/robots.txt': status(404),
			'https://a.de/down': () => Promise.reject(new TypeError('fetch failed')),
			'https://a.de/gone': status(410),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect(await client.get('https://a.de/down')).toMatchObject({ ok: false, reason: 'network-error', status: null });
		expect(await client.get('https://a.de/gone')).toMatchObject({ ok: false, reason: 'http-error', status: 410 });
		expect(await client.get('not a url')).toMatchObject({ ok: false, reason: 'network-error' });
	});

	it('follows a cross-host redirect, checking the new host’s robots.txt', async () => {
		const net = fakeNetwork({
			'https://a.de/robots.txt': status(404),
			'https://a.de/': redirect('https://b.de/p'),
			'https://b.de/robots.txt': text('User-agent: *\nDisallow: /private\n'),
			'https://b.de/p': html('landed'),
			'https://a.de/x': redirect('https://b.de/private/y', 302),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect(await client.get('https://a.de/')).toMatchObject({ ok: true, url: 'https://b.de/p', text: 'landed' });
		expect(net.calls.map((c) => c.url)).toContain('https://b.de/robots.txt');
		expect(await client.get('https://a.de/x')).toMatchObject({
			ok: false,
			reason: 'robots-disallowed',
			url: 'https://b.de/private/y',
		});
		expect(net.calls.map((c) => c.url)).not.toContain('https://b.de/private/y');
	});

	it('fetches a robots.txt URL once even when several origins redirect to it', async () => {
		const net = fakeNetwork({
			'https://www.a.de/robots.txt': redirect('https://a.de/robots.txt'),
			'http://a.de/robots.txt': redirect('https://a.de/robots.txt'),
			'https://a.de/robots.txt': status(404),
			'https://www.a.de/': redirect('http://a.de/'),
			'http://a.de/': redirect('https://a.de/'),
			'https://a.de/': html('home'),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect(await client.get('https://www.a.de/')).toMatchObject({ ok: true, url: 'https://a.de/' });
		expect(net.calls.filter((c) => c.url === 'https://a.de/robots.txt')).toHaveLength(1);
	});

	it('stops after 5 redirects', async () => {
		const routes: Record<string, Route> = { 'https://a.de/robots.txt': status(404) };
		for (let i = 0; i < 10; i++) routes[`https://a.de/${i}`] = redirect(`/${i + 1}`);
		const net = fakeNetwork(routes, 0);
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect(await client.get('https://a.de/0')).toMatchObject({ ok: false, reason: 'too-many-redirects', status: 301 });
		expect(net.calls.filter((c) => c.url !== 'https://a.de/robots.txt')).toHaveLength(6);
	});

	it('decodes a Latin-1 page from the Content-Type charset', async () => {
		const net = fakeNetwork({
			'https://a.de/robots.txt': status(404),
			'https://a.de/l1': () =>
				new Response(new Uint8Array([0x46, 0xfc, 0x72, 0x74, 0x68]), {
					status: 200,
					headers: { 'content-type': 'text/html; charset=iso-8859-1' },
				}),
		});
		const client = createFetchClient({ fetchImpl: net.fetchImpl, delayMs: 0 });
		expect(await client.get('https://a.de/l1')).toMatchObject({ ok: true, text: 'Fürth' });
	});
});

describe('decodeBody', () => {
	const latin1 = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

	it('uses an HTML meta charset when the header has none', () => {
		expect(decodeBody(latin1('<meta charset="iso-8859-1"><p>Fürth'), 'text/html')).toContain('Fürth');
		expect(
			decodeBody(latin1('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">ü'), null),
		).toContain('ü');
	});

	it('falls back to UTF-8 for an unknown label or no charset', () => {
		const utf8 = new TextEncoder().encode('Fürth');
		expect(decodeBody(utf8, 'text/html; charset=x-made-up')).toBe('Fürth');
		expect(decodeBody(utf8, null)).toBe('Fürth');
	});
});
