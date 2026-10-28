import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runReaderOnFixtures, type Fixtures } from '../pipeline/readers/fixture-runner.ts';
import { parseCentre } from '../pipeline/stages/parse.ts';
import type { Centre } from '../shared/directory.ts';
import type { RawListing } from '../shared/listing.ts';
import { checkParseResult, type FetchedPage, type ParseContext, type ParseResult, type Reader } from '../shared/reader.ts';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/reader-contract/', import.meta.url));
const CTX: ParseContext = { runAt: new Date('2026-10-28T05:17:00.000Z') };

const centre = (id: string, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: 'https://example.de/',
	test_page_url: 'https://example.de/test',
	reader: 'kuferweb',
	reader_config: { list_url: 'https://example.de/kurse' },
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

const listing = (extra: Partial<RawListing> = {}): RawListing => ({
	date: '2026-11-12',
	time: '09:30',
	place: null,
	address: null,
	status: 'free',
	deadline: null,
	registration_method: null,
	eligibility: null,
	source_url: 'https://example.de/kurs/1',
	...extra,
});

/** A reader whose `parse` returns (or throws) whatever the test gives it. */
const stubReader = (parse: Reader['parse']): Reader => ({
	plan: () => ({ listUrls: [], selectDetailUrls: () => [], maxDetailPages: 0 }),
	parse,
});

const returning = (result: unknown): Reader => stubReader(() => result as ParseResult);

describe('checkParseResult', () => {
	it('passes valid listings through unchanged', () => {
		const result = { kind: 'ok', listings: [listing(), listing({ time: '13:00', status: 'waitlist' })] };
		expect(checkParseResult(result)).toEqual(result);
	});

	it('passes zero listings through as ok', () => {
		expect(checkParseResult({ kind: 'ok', listings: [] })).toEqual({ kind: 'ok', listings: [] });
	});

	it('passes a reader failure through unchanged', () => {
		expect(checkParseResult({ kind: 'failed', reason: 'structure-missing' })).toEqual({
			kind: 'failed',
			reason: 'structure-missing',
		});
	});

	it.each<[string, unknown]>([
		['status "full"', { kind: 'ok', listings: [listing(), { ...listing(), status: 'full' }] }],
		['an extra instructor key', { kind: 'ok', listings: [{ ...listing(), instructor: 'Frau M.' }] }],
		['a missing deadline key', { kind: 'ok', listings: [(({ deadline: _d, ...rest }) => rest)(listing())] }],
		['an unknown kind', { kind: 'maybe', listings: [] }],
		['no listings array', { kind: 'ok' }],
		['an empty reason', { kind: 'failed', reason: '' }],
		['a non-kebab-case reason', { kind: 'failed', reason: 'Some Error' }],
		['a blank reason', { kind: 'failed', reason: ' ' }],
		['undefined', undefined],
		['a string', 'ok'],
	])('turns %s into failed(schema)', (_case, result) => {
		expect(checkParseResult(result)).toEqual({ kind: 'failed', reason: 'schema' });
	});
});

describe('parseCentre', () => {
	it('returns valid listings unchanged', () => {
		const result: ParseResult = { kind: 'ok', listings: [listing()] };
		expect(parseCentre(returning(result), centre('a'), [], CTX)).toEqual(result);
	});

	it('returns ok with zero listings', () => {
		expect(parseCentre(returning({ kind: 'ok', listings: [] }), centre('a'), [], CTX)).toEqual({ kind: 'ok', listings: [] });
	});

	it('passes a reader failure through', () => {
		const failed = { kind: 'failed', reason: 'structure-missing' };
		expect(parseCentre(returning(failed), centre('a'), [], CTX)).toEqual(failed);
	});

	it('catches a throwing reader as failed(reader-error)', () => {
		const reader = stubReader(() => {
			throw new Error('boom');
		});
		expect(parseCentre(reader, centre('a'), [], CTX)).toEqual({ kind: 'failed', reason: 'reader-error' });
	});

	it('fails only the centre whose reader emits an invalid listing', () => {
		const reader = stubReader((_pages, c) =>
			c.centre_id === 'bad'
				? ({ kind: 'ok', listings: [{ ...listing(), status: 'full' }] } as unknown as ParseResult)
				: { kind: 'ok', listings: [listing()] },
		);
		const results = ['good', 'bad'].map((id) => parseCentre(reader, centre(id), [], CTX));
		expect(results).toEqual([
			{ kind: 'ok', listings: [listing()] },
			{ kind: 'failed', reason: 'schema' },
		]);
	});

	it('hands pages and ctx to the reader', () => {
		const parse = vi.fn<Reader['parse']>(() => ({ kind: 'ok', listings: [] }));
		const pages: FetchedPage[] = [{ url: 'https://example.de/kurse', role: 'list', status: 200, html: '<p></p>' }];
		const c = centre('a');
		parseCentre(stubReader(parse), c, pages, CTX);
		expect(parse).toHaveBeenCalledWith(pages, c, CTX);
	});
});

describe('runReaderOnFixtures', () => {
	const LIST_URL = 'https://example.de/kurse';

	/** A reader that follows every date link on the list page and emits one listing per detail page. */
	const linkReader = (maxDetailPages: number, seen: { pages?: readonly FetchedPage[]; ctx?: ParseContext } = {}): Reader => ({
		plan: (c) => ({
			listUrls: [c.reader_config!.list_url],
			selectDetailUrls: (listPages) =>
				listPages.flatMap((page) => [...(page.html ?? '').matchAll(/class="date" href="([^"]+)"/g)].map((m) => m[1]!)),
			maxDetailPages,
		}),
		parse: (pages, _c, ctx) => {
			seen.pages = pages;
			seen.ctx = ctx;
			const listings = pages
				.filter((page) => page.role === 'detail')
				.map((page) => {
					const body = page.html ?? '';
					const [, date, time] = /data-date="([^"]+)" data-time="([^"]+)"/.exec(body) ?? [];
					const status = /Warteliste/.test(body) ? 'waitlist' : /Plätze frei/.test(body) ? 'free' : 'unknown';
					return listing({ date, time, status, source_url: page.url });
				});
			return { kind: 'ok', listings };
		},
	});

	const FIXTURES: Fixtures = {
		[LIST_URL]: { file: 'list.html' },
		'https://example.de/kurs/1': { file: 'detail-1.html' },
		'https://example.de/kurs/2': { file: `${FIXTURES_DIR}detail-2.html`, status: 203 },
		// kurs/3 has no fixture: the cap of 2 must keep the runner from asking for it.
	};

	let fetchSpy: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		fetchSpy = vi.fn(() => {
			throw new Error('network access in a reader test');
		});
		vi.stubGlobal('fetch', fetchSpy);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('selects detail pages from the list page, caps them, and validates the result without the network', () => {
		const seen: { pages?: readonly FetchedPage[]; ctx?: ParseContext } = {};
		const result = runReaderOnFixtures(linkReader(2, seen), centre('a'), FIXTURES, CTX, FIXTURES_DIR);

		expect(seen.pages!.map((p) => [p.url, p.role, p.status])).toEqual([
			[LIST_URL, 'list', 200],
			['https://example.de/kurs/1', 'detail', 200],
			['https://example.de/kurs/2', 'detail', 203],
		]);
		expect(seen.ctx).toBe(CTX);
		expect(result).toEqual({
			kind: 'ok',
			listings: [
				listing({ date: '2026-11-12', time: '09:30', status: 'waitlist', source_url: 'https://example.de/kurs/1' }),
				listing({ date: '2026-12-10', time: '14:00', status: 'free', source_url: 'https://example.de/kurs/2' }),
			],
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('de-duplicates detail URLs in first-seen order before applying the cap', () => {
		const seen: { pages?: readonly FetchedPage[]; ctx?: ParseContext } = {};
		const base = linkReader(2, seen);
		const reader: Reader = {
			...base,
			plan: (c) => ({
				...base.plan(c),
				selectDetailUrls: () => ['https://example.de/kurs/2', 'https://example.de/kurs/2', 'https://example.de/kurs/1', 'https://example.de/kurs/3'],
			}),
		};
		runReaderOnFixtures(reader, centre('a'), FIXTURES, CTX, FIXTURES_DIR);
		expect(seen.pages!.filter((p) => p.role === 'detail').map((p) => p.url)).toEqual([
			'https://example.de/kurs/2',
			'https://example.de/kurs/1',
		]);
	});

	it('models a timed-out or empty page as null status and null html', () => {
		const seen: { pages?: readonly FetchedPage[]; ctx?: ParseContext } = {};
		const fixtures: Fixtures = { [LIST_URL]: { file: null, status: null } };
		const result = runReaderOnFixtures(linkReader(2, seen), centre('a'), fixtures, CTX, FIXTURES_DIR);
		expect(seen.pages).toEqual([{ url: LIST_URL, role: 'list', status: null, html: null }]);
		expect(result).toEqual({ kind: 'ok', listings: [] });
		const noBody = runReaderOnFixtures(linkReader(2, seen), centre('a'), { [LIST_URL]: { file: null, status: 500 } }, CTX, FIXTURES_DIR);
		expect(noBody.kind).toBe('ok');
		expect(seen.pages).toEqual([{ url: LIST_URL, role: 'list', status: 500, html: null }]);
	});

	it('throws for a URL without a fixture instead of fetching it', () => {
		expect(() => runReaderOnFixtures(linkReader(3), centre('a'), FIXTURES, CTX, FIXTURES_DIR)).toThrow(
			'no fixture for detail page https://example.de/kurs/3',
		);
		expect(() => runReaderOnFixtures(linkReader(0), centre('a', { reader_config: { list_url: 'https://example.de/other' } }), FIXTURES, CTX, FIXTURES_DIR)).toThrow(
			'no fixture for list page https://example.de/other',
		);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('runs the contract check on the reader output', () => {
		const reader: Reader = { ...linkReader(1), parse: returning({ kind: 'ok', listings: [{ ...listing(), instructor: 'x' }] }).parse };
		expect(runReaderOnFixtures(reader, centre('a'), FIXTURES, CTX, FIXTURES_DIR)).toEqual({ kind: 'failed', reason: 'schema' });
	});
});

describe('reader clock rule', () => {
	const READERS_DIR = fileURLToPath(new URL('../pipeline/readers/', import.meta.url));
	const CLOCK_READ = /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/;

	it('no reader source reads the clock (ctx.runAt is the only time source)', () => {
		const files = readdirSync(READERS_DIR, { recursive: true, encoding: 'utf8' })
			.map((entry) => entry.split('\\').join('/'))
			.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts') && entry !== 'fixture-runner.ts');
		const offenders = files.filter((entry) => CLOCK_READ.test(readFileSync(join(READERS_DIR, entry), 'utf8')));
		expect(offenders).toEqual([]);
	});

	it('the pattern catches Date.now() and argument-less new Date()', () => {
		expect(CLOCK_READ.test('const t = Date.now();')).toBe(true);
		expect(CLOCK_READ.test('const d = new Date();')).toBe(true);
		expect(CLOCK_READ.test("const d = new Date('2026-11-12');")).toBe(false);
		expect(CLOCK_READ.test('const d = new Date(ctx.runAt);')).toBe(false);
	});
});
