import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixturePages, runReaderOnFixtures, type Fixtures } from '../pipeline/readers/fixture-runner.ts';
import { itemkgReader } from '../pipeline/readers/itemkg/index.ts';
import { kuferwebReader } from '../pipeline/readers/kuferweb/index.ts';
import { berlinOffset, normaliseCentre, normaliseOutcome, startsAt, type PriorListing } from '../pipeline/stages/normalise.ts';
import type { Centre } from '../shared/directory.ts';
import { listingSchema, type RawListing } from '../shared/listing.ts';
import { summarisePage, type PageSummary, type Reader } from '../shared/reader.ts';

const centre = (id: string, reader: Centre['reader'] = 'kuferweb', testPageUrl: string | null = null): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: 'https://example.de/',
	test_page_url: testPageUrl,
	reader,
	reader_config: testPageUrl === null || reader === 'kuferweb' ? null : { list_url: testPageUrl },
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
});

const raw = (extra: Partial<RawListing> = {}): RawListing => ({
	date: '2026-11-12',
	time: '10:00',
	place: null,
	address: 'Pfarrstraße 6, 86316 Friedberg',
	status: 'free',
	deadline: null,
	registration_method: null,
	eligibility: null,
	source_url: 'https://a.de/k/1',
	...extra,
});

const detail = (url: string, status: number | null = 200, finalUrl: string | null = url): PageSummary => ({ url, role: 'detail', status, finalUrl });
const C = centre('c');

describe('berlinOffset and startsAt', () => {
	it.each<[string, string, string]>([
		['2026-07-14', '10:00', '2026-07-14T10:00:00+02:00'],
		['2026-12-01', '09:30', '2026-12-01T09:30:00+01:00'],
		['2026-10-25', '02:30', '2026-10-25T02:30:00+02:00'], // fall-back hour: the earlier occurrence
		['2026-03-29', '02:30', '2026-03-29T02:30:00+01:00'], // spring gap: the pre-gap offset
		['2026-10-25', '03:00', '2026-10-25T03:00:00+01:00'],
		['2026-03-29', '03:00', '2026-03-29T03:00:00+02:00'],
		['2026-03-29', '01:59', '2026-03-29T01:59:00+01:00'],
		['2026-10-25', '01:59', '2026-10-25T01:59:00+02:00'],
		['2027-01-01', '00:00', '2027-01-01T00:00:00+01:00'],
	])('%s %s → %s', (date, time, expected) => {
		expect(startsAt(date, time)).toBe(expected);
		expect(berlinOffset(date, time)).toBe(expected.slice(-6));
	});
});

describe('normaliseCentre', () => {
	it('builds every normalised field; the id is <centre_id>@<date>T<time>', () => {
		expect(normaliseCentre(C, [raw({ place: 'Raum 1', deadline: '2026-11-01', eligibility: 'nur für Wohnsitz' })], [detail('https://a.de/k/1')])).toEqual([
			{
				id: 'c@2026-11-12T10:00',
				centre_id: 'c',
				starts_at: '2026-11-12T10:00:00+01:00',
				place: 'Raum 1',
				address: 'Pfarrstraße 6, 86316 Friedberg',
				status: 'free',
				deadline: '2026-11-01',
				registration_method: null,
				source_url: 'https://a.de/k/1',
				link_ok: true,
				eligibility: 'nur für Wohnsitz',
			},
		]);
	});

	it('falls back to the centre address as "street, postcode city"', () => {
		expect(normaliseCentre(C, [raw({ address: null })], [])[0]!.address).toBe('Hauptstraße 1, 80331 München');
	});

	it('numbers same-minute dates by place, null last', () => {
		const listings = normaliseCentre(C, [raw({ place: 'B' }), raw({ place: 'A' }), raw({ place: null })], []);
		expect(listings.map((l) => [l.id, l.place])).toEqual([
			['c@2026-11-12T10:00', 'A'],
			['c@2026-11-12T10:00#2', 'B'],
			['c@2026-11-12T10:00#3', null],
		]);
	});

	it('breaks place ties by source_url, then address', () => {
		const listings = normaliseCentre(
			C,
			[raw({ source_url: 'https://a.de/k/2', address: 'A' }), raw({ source_url: 'https://a.de/k/1', address: 'B' }), raw({ source_url: 'https://a.de/k/1', address: 'A' })],
			[],
		);
		expect(listings.map((l) => [l.id, l.source_url, l.address])).toEqual([
			['c@2026-11-12T10:00', 'https://a.de/k/1', 'A'],
			['c@2026-11-12T10:00#2', 'https://a.de/k/1', 'B'],
			['c@2026-11-12T10:00#3', 'https://a.de/k/2', 'A'],
		]);
	});

	it('gives the same ids whatever the input order', () => {
		const input = [raw({ place: 'B' }), raw({ place: 'A' }), raw({ time: '09:00' }), raw({ place: null })];
		expect(normaliseCentre(C, [...input].reverse(), [])).toEqual(normaliseCentre(C, input, []));
	});

	describe('same-minute ids from stored listings (Story 3.8)', () => {
		const M = 'c@2026-11-12T10:00';
		const prior = (suffix: string, place: string | null, source_url = 'https://a.de/k/1', removed_at: string | null = null) => ({
			id: `${M}${suffix}`,
			place,
			source_url,
			removed_at,
		});
		const ids = (rawListings: RawListing[], previous: PriorListing[]) =>
			normaliseCentre(C, rawListings, [], previous).map((l) => [l.id, l.place, l.source_url]);

		it('keeps a stored id matched by source_url and place, whatever the sort position', () => {
			expect(ids([raw({ place: 'B' })], [prior('', 'A'), prior('#2', 'B')])).toEqual([[`${M}#2`, 'B', 'https://a.de/k/1']]);
		});

		it('matches by source_url when the place changed, then by place when the URL changed', () => {
			const previous = [prior('', 'A', 'https://a.de/k/a'), prior('#2', 'B', 'https://a.de/k/b')];
			expect(ids([raw({ place: 'B2', source_url: 'https://a.de/k/b' })], previous)).toEqual([[`${M}#2`, 'B2', 'https://a.de/k/b']]);
			expect(ids([raw({ place: 'B', source_url: 'https://a.de/k/new' })], previous)).toEqual([[`${M}#2`, 'B', 'https://a.de/k/new']]);
		});

		it('never matches by a null place', () => {
			expect(ids([raw({ place: null, source_url: 'https://a.de/k/x' })], [prior('', null, 'https://a.de/k/y')])).toEqual([[`${M}#2`, null, 'https://a.de/k/x']]);
		});

		it('gives a new date the lowest #n held by no stored listing, live or tombstoned', () => {
			const previous = [prior('', 'A', 'https://a.de/k/a'), prior('#3', 'C', 'https://a.de/k/c')];
			expect(ids([raw({ place: 'D', source_url: 'https://a.de/k/d' }), raw({ place: 'E', source_url: 'https://a.de/k/e' })], previous)).toEqual([
				[`${M}#2`, 'D', 'https://a.de/k/d'],
				[`${M}#4`, 'E', 'https://a.de/k/e'],
			]);
		});

		it('never matches by a URL several sessions share: a new session does not take the id of a gone sibling', () => {
			// A and B share one detail page. A is gone and Z is new on the same page: Z must not inherit A's history.
			const previous = [prior('', 'A'), prior('#2', 'B')];
			expect(ids([raw({ place: 'B' }), raw({ place: 'Z' })], previous)).toEqual([
				[`${M}#2`, 'B', 'https://a.de/k/1'],
				[`${M}#3`, 'Z', 'https://a.de/k/1'],
			]);
		});

		it('gives a date whose URL and place both changed a new id', () => {
			expect(ids([raw({ place: 'Q', source_url: 'https://a.de/k/q' })], [prior('', 'A', 'https://a.de/k/a')])).toEqual([[`${M}#2`, 'Q', 'https://a.de/k/q']]);
		});

		it('keeps shared-URL sessions with no place on their stored ids when all are still listed', () => {
			const previous = [prior('', null), prior('#2', null)];
			const listings = normaliseCentre(C, [raw({ status: 'booked_out' }), raw({ status: 'free' })], [], previous);
			expect(listings.map((l) => l.id)).toEqual([M, `${M}#2`]);
		});

		it('prefers a live stored listing to a tombstoned one with the same match', () => {
			const previous = [prior('', 'B', 'https://a.de/k/1', '2026-10-28T05:17:00.000Z'), prior('#2', 'B')];
			expect(ids([raw({ place: 'B' })], previous)).toEqual([[`${M}#2`, 'B', 'https://a.de/k/1']]);
		});

		it('ignores stored listings of other minutes, other centres and malformed ids', () => {
			const previous = [
				{ id: 'c@2026-11-12T09:00#2', place: 'A', source_url: 'https://a.de/k/1' },
				{ id: 'other@2026-11-12T10:00#2', place: 'A', source_url: 'https://a.de/k/1' },
				{ id: `${M}#1`, place: 'A', source_url: 'https://a.de/k/1' },
				{ id: `${M}#x`, place: 'A', source_url: 'https://a.de/k/1' },
			];
			expect(ids([raw({ place: 'A' })], previous)).toEqual([[M, 'A', 'https://a.de/k/1']]);
		});
	});

	it('collapses exact duplicates into one listing without #2', () => {
		expect(normaliseCentre(C, [raw(), raw()], []).map((l) => l.id)).toEqual(['c@2026-11-12T10:00']);
	});

	it('keeps same-minute listings that differ in any field, also after the address fallback', () => {
		expect(normaliseCentre(C, [raw(), raw({ status: 'booked_out' })], []).map((l) => l.id)).toEqual(['c@2026-11-12T10:00', 'c@2026-11-12T10:00#2']);
		// raw address null and the centre address written out are the same listing once normalised
		expect(normaliseCentre(C, [raw({ address: null }), raw({ address: 'Hauptstraße 1, 80331 München' })], [])).toHaveLength(1);
	});

	it('orders the result by id and never puts the URL in the id', () => {
		const listings = normaliseCentre(C, [raw({ date: '2026-12-01' }), raw({ time: '09:00' }), raw()], []);
		expect(listings.map((l) => l.id)).toEqual(['c@2026-11-12T09:00', 'c@2026-11-12T10:00', 'c@2026-12-01T10:00']);
		expect(listings.every((l) => !l.id.includes('a.de'))).toBe(true);
	});

	it.each<[string, PageSummary[], boolean]>([
		['a 2xx detail page with that url', [detail('https://a.de/k/1')], true],
		['a 2xx detail page whose finalUrl matches', [detail('https://a.de/old', 200, 'https://a.de/k/1')], true],
		['a match differing only by #fragment', [detail('https://a.de/k/1#termin')], true],
		['a 404 detail page', [detail('https://a.de/k/1', 404)], false],
		['a detail page with no response', [detail('https://a.de/k/1', null, null)], false],
		['a 2xx list page only', [{ url: 'https://a.de/k/1', role: 'list', status: 200, finalUrl: 'https://a.de/k/1' }], false],
		['another detail page', [detail('https://a.de/k/2')], false],
		['no pages', [], false],
	])('link_ok with %s → %s', (_case, pages, expected) => {
		expect(normaliseCentre(C, [raw()], pages)[0]!.link_ok).toBe(expected);
	});

	it('link_ok matches a source_url carrying a fragment', () => {
		expect(normaliseCentre(C, [raw({ source_url: 'https://a.de/k/1#x' })], [detail('https://a.de/k/1')])[0]!.link_ok).toBe(true);
	});
});

describe('normaliseOutcome', () => {
	it('passes failed and skipped through unchanged', () => {
		expect(normaliseOutcome(C, { kind: 'failed', reason: 'list-page' }, [], [])).toEqual({ kind: 'failed', reason: 'list-page' });
		expect(normaliseOutcome(C, { kind: 'skipped', reason: 'budget' }, [], [])).toEqual({ kind: 'skipped', reason: 'budget' });
	});

	it('normalises an ok outcome with the pages', () => {
		expect(normaliseOutcome(C, { kind: 'ok', listings: [raw()] }, [detail('https://a.de/k/1')], [])).toEqual({
			kind: 'ok',
			listings: normaliseCentre(C, [raw()], [detail('https://a.de/k/1')]),
			centreAddressIds: [],
		});
	});

	it.each<[string, RawListing[]]>([
		['fallback first', [raw({ address: null }), raw({ address: 'Hauptstraße 1, 80331 München' })]],
		['stated first', [raw({ address: 'Hauptstraße 1, 80331 München' }), raw({ address: null })]],
	])('treats a same-minute duplicate as stated when one row gives the centre address (%s)', (_order, listings) => {
		const outcome = normaliseOutcome(C, { kind: 'ok', listings }, [], []);
		expect(outcome).toMatchObject({ kind: 'ok', centreAddressIds: [] });
		expect(outcome.kind === 'ok' && outcome.listings).toHaveLength(1);
	});

	it('names the ids whose address is the centre fallback, not a provider address equal to it', () => {
		const outcome = normaliseOutcome(
			C,
			{
				kind: 'ok',
				listings: [
					raw({ address: null }),
					raw({ time: '11:00', address: 'Hauptstraße 1, 80331 München' }),
					raw({ time: '12:00' }),
					raw({ date: '2026-11-13', address: null }),
				],
			},
			[],
			[],
		);
		expect(outcome).toMatchObject({ kind: 'ok', centreAddressIds: ['c@2026-11-12T10:00', 'c@2026-11-13T10:00'] });
	});

	it('fails only this centre as schema when a normalised listing fails listingSchema', () => {
		// A 1947 date (Berlin double summer time, +03:00) falls outside the +01:00/+02:00 offsets the schema accepts.
		expect(normaliseOutcome(C, { kind: 'ok', listings: [raw({ date: '1947-06-01' })] }, [], [])).toEqual({ kind: 'failed', reason: 'schema' });
	});
});

const KUFERWEB_DIR = fileURLToPath(new URL('../pipeline/readers/kuferweb/fixtures/', import.meta.url));
const ITEMKG_DIR = fileURLToPath(new URL('../pipeline/readers/itemkg/fixtures/', import.meta.url));

interface FixtureCase {
	name: string;
	reader: Reader;
	centre: Centre;
	dir: string;
	fixtures: Fixtures;
}

const kuferweb = (id: string, listUrl: string, dir: string, detailBase: string, courses: string[]): FixtureCase => ({
	name: `kuferweb ${dir}`,
	reader: kuferwebReader,
	centre: centre(id, 'kuferweb', listUrl),
	dir: KUFERWEB_DIR,
	fixtures: {
		[listUrl]: { file: `${dir}/list.html` },
		...Object.fromEntries(courses.map((course) => [`${detailBase}${course}`, { file: `${dir}/${course.split('/').pop()!}.html` }])),
	},
});

const itemkg = (id: string, listUrl: string, dir: string, courses: Record<string, string>): FixtureCase => ({
	name: `itemkg ${dir}`,
	reader: itemkgReader,
	centre: centre(id, 'itemkg', listUrl),
	dir: ITEMKG_DIR,
	fixtures: { [listUrl]: { file: `${dir}/list.html` }, ...Object.fromEntries(Object.entries(courses).map(([course, url]) => [url, { file: `${dir}/${course}.html` }])) },
});

const ERDING_DETAIL = 'https://www.vhs-erding.de/p/deutsch-integration/pruefungen/einbuergerungstest/pruefung-einbuergerungstest';
const FIXTURE_CASES: FixtureCase[] = [
	kuferweb(
		'vhs-aichach-friedberg-e-v',
		'https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest',
		'aichach',
		'https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest/kurs/',
		[
			'AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40108-17',
			'AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40208-17',
			'AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40308-17',
			'Einbuergerungstest/G40203-18',
			'Einbuergerungstest/G40303-18',
		],
	),
	kuferweb(
		'vhs-taufkirchen',
		'https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest',
		'taufkirchen',
		'https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest/kurs/Einbuergerungstest/',
		['262-30111', '262-30112', '262-30113', '262-30121', '262-30122'],
	),
	kuferweb(
		'vhs-moosburg-e-v',
		'https://www.vhs-moosburg.de/programm/sprachen/kategorie/Einbuergerungstest/50#inhalt',
		'moosburg',
		'https://www.vhs-moosburg.de/programm/sprachen/kurs/Einbuergerungstest/',
		['262.3071', '262.3072'],
	),
	itemkg('vhs-der-gemeinden-im-landkreis-roth', 'https://www.vhs-roth.de/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest', 'roth', {
		N31300: 'https://www.vhs-roth.de/p/sprachen/deutsch/test-leben-in-deutschland/integration-einbuergerungstest-ebt-681-C-N31300',
		N31301: 'https://www.vhs-roth.de/p/sprachen/deutsch/test-leben-in-deutschland/integration-einbuergerungstest-ebt-681-C-N31301',
	}),
	itemkg('zweckverband-vhs-im-landkreis-erding', 'https://www.vhs-erding.de/p/deutsch-integration/pruefungen/einbuergerungstest-664-CAT-KAT329', 'erding', {
		'262-4085': `${ERDING_DETAIL}/ausgebucht-664-C-262-4085`,
		'262-4086': `${ERDING_DETAIL}/ausgebucht-664-C-262-4086`,
		'262-4087': `${ERDING_DETAIL}/ausgebucht-664-C-262-4087`,
		'262-4088': `${ERDING_DETAIL}-664-C-262-4088`,
		'262-4089': `${ERDING_DETAIL}-664-C-262-4089`,
	}),
	itemkg('vhs-bad-kisingen-und-hammelburg', 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest-675-CAT-KAT77', 'kissingen', {
		'2617425KG': 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest/einbuergerungstest-5-26-675-C-2617425KG',
		'2627400KG': 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest/einbuergerungstest-6-26-675-C-2627400KG',
		'2627405KG': 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest/einbuergerungstest-7-26-675-C-2627405KG',
	}),
];

describe('normalise on reader fixture results', () => {
	it.each(FIXTURE_CASES.map((fc) => [fc.name, fc] as const))('%s: every listing valid, ids unique, link_ok true', (_name, fc) => {
		const result = runReaderOnFixtures(fc.reader, fc.centre, fc.fixtures, { runAt: new Date('2026-10-29T12:00:00.000Z') }, fc.dir);
		const pages = loadFixturePages(fc.reader, fc.centre, fc.fixtures, fc.dir).map(summarisePage);
		expect(result.kind).toBe('ok');
		const outcome = normaliseOutcome(fc.centre, result, pages, []);
		if (outcome.kind !== 'ok') throw new Error(`expected ok, got ${outcome.kind}`);
		expect(outcome.listings.length).toBeGreaterThan(0);
		for (const listing of outcome.listings) expect(listingSchema.safeParse(listing).success, listing.id).toBe(true);
		expect(new Set(outcome.listings.map((l) => l.id)).size).toBe(outcome.listings.length);
		expect(outcome.listings.every((l) => l.link_ok)).toBe(true);
	});
});
