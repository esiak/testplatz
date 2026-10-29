import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Centre } from '../../../shared/directory.ts';
import { mapStatus, rawListingSchema, type RawListing } from '../../../shared/listing.ts';
import { checkParseResult, selectDetailUrls, type FetchedPage, type ParseContext, type ParseResult } from '../../../shared/reader.ts';
import { runReaderOnFixtures, type Fixtures } from '../fixture-runner.ts';
import { flagSignals, hasWaitlistOffer, iconFlags, ITEMKG_MAX_DETAIL_PAGES, itemkgReader, registrationMethodOf } from './index.ts';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CTX: ParseContext = { runAt: new Date('2026-10-29T12:00:00.000Z') };

const centre = (id: string, testPageUrl: string | null, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: 'https://example.de/',
	test_page_url: testPageUrl,
	reader: 'itemkg',
	reader_config: testPageUrl === null ? null : { list_url: testPageUrl },
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

/** A fixture centre: its list page URL, its fixture directory and its detail pages (course id → URL). */
interface FixtureCentre {
	centre: Centre;
	dir: string;
	courses: Record<string, string>;
}

const STARNBERG_DETAIL = 'https://www.vhs-starnbergammersee.de/p/sprachen-und-integration/deutsch-als-fremdsprache/pruefungen-pruefungsvorbereitung-einbuergerung/einbuergerungstest/einbuergerungstest-665-C-';
const STARNBERG: FixtureCentre = {
	centre: centre(
		'vhs-starnberger-see-e-v',
		'https://www.vhs-starnbergammersee.de/p/sprachen-und-integration/deutsch-als-fremdsprache/pruefungen-pruefungsvorbereitung-einbuergerung/einbuergerungstest-665-CAT-KAT96?tx_itemkgconnect_categorys%5Bfilters%5D%5Bsort%5D%5B0%5D=startDate%2Casc&tx_itemkgconnect_categorys%5Bpage%5D=0&tx_itemkgconnect_categorys%5Bsword%5D=&cHash=e569d94aa4bc8aa65614afb3e67fd1ab',
	),
	dir: 'starnberg',
	courses: Object.fromEntries(['262-3479-S', '262-3492-A', '262-3480-S', '262-3481-S', '262-3482-S', '262-3493-A'].map((id) => [id, `${STARNBERG_DETAIL}${id}`])),
};
const KISSINGEN: FixtureCentre = {
	centre: centre('vhs-bad-kisingen-und-hammelburg', 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest-675-CAT-KAT77'),
	dir: 'kissingen',
	courses: {
		'2617425KG': 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest/einbuergerungstest-5-26-675-C-2617425KG',
		'2627400KG': 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest/einbuergerungstest-6-26-675-C-2627400KG',
		'2627405KG': 'https://www.vhs-kisshab.de/p/integration/einbuergerungstest/einbuergerungstest-7-26-675-C-2627405KG',
	},
};
const ERDING_DETAIL = 'https://www.vhs-erding.de/p/deutsch-integration/pruefungen/einbuergerungstest/pruefung-einbuergerungstest';
const ERDING: FixtureCentre = {
	centre: centre('zweckverband-vhs-im-landkreis-erding', 'https://www.vhs-erding.de/p/deutsch-integration/pruefungen/einbuergerungstest-664-CAT-KAT329'),
	dir: 'erding',
	courses: {
		'262-4085': `${ERDING_DETAIL}/ausgebucht-664-C-262-4085`,
		'262-4086': `${ERDING_DETAIL}/ausgebucht-664-C-262-4086`,
		'262-4087': `${ERDING_DETAIL}/ausgebucht-664-C-262-4087`,
		'262-4088': `${ERDING_DETAIL}-664-C-262-4088`,
		'262-4089': `${ERDING_DETAIL}-664-C-262-4089`,
	},
};
const ROTH: FixtureCentre = {
	centre: centre('vhs-der-gemeinden-im-landkreis-roth', 'https://www.vhs-roth.de/suche?tx_itemkgconnect_search%5Bsword%5D=Einb%C3%BCrgerungstest'),
	dir: 'roth',
	courses: {
		N31300: 'https://www.vhs-roth.de/p/sprachen/deutsch/test-leben-in-deutschland/integration-einbuergerungstest-ebt-681-C-N31300',
		N31301: 'https://www.vhs-roth.de/p/sprachen/deutsch/test-leben-in-deutschland/integration-einbuergerungstest-ebt-681-C-N31301',
	},
};
const EBERSBERG: FixtureCentre = {
	centre: centre('vhs-ebersberger-land-grafing-bei-muenchen', 'https://www.vhs-ebersberger-land.de/p/sprachen/deutsch/einbuergerungstests-649-CAT-KAT215'),
	dir: 'ebersberg',
	courses: { '262-30994': 'https://www.vhs-ebersberger-land.de/p/sprachen/deutsch/einbuergerungstests/einbuergerungstest-649-C-262-30994' },
};
const WUERZBURG: FixtureCentre = {
	centre: centre(
		'vhs-wuerzburg',
		'https://www.vhs-wuerzburg.info/p/sprachen-489-CAT-KAT5892356?tx_itemkgconnect_categorys%5Bfilters%5D%5Breset%5D=1&tx_itemkgconnect_categorys%5Bfilters%5D%5Bsort%5D%5B0%5D=__EMPTY__&tx_itemkgconnect_categorys%5Bsword%5D=einbürgerung&cHash=7c429aef482378a0bbc422fcfe4806e7',
	),
	dir: 'wuerzburg',
	courses: Object.fromEntries(['18616538', '18648736', '18616509', '18648761', '18729879'].map((id) => [id, `https://www.vhs-wuerzburg.info/p/sprachen/einbuergerungstest-489-C-${id}`])),
};
const MVHS_DETAIL = 'https://www.mvhs.de/kurse/deutsch-integration/pruefungen-einbuergerung/einbuergerung/einbuergerungstest/10-tage-vor-der-pruefung-bekommen-sie-die-genauen-pruefungszeiten-per-e-mail-zugeschickt-460-C-';
const MVHS: FixtureCentre = {
	centre: centre('muenchner-vhs-gmbh', 'https://www.mvhs.de/kurse/deutsch-integration/pruefungen-einbuergerung/einbuergerung-460-CAT-KAT7868'),
	dir: 'mvhs',
	courses: { X674118: `${MVHS_DETAIL}X674118`, X674130: `${MVHS_DETAIL}X674130` },
};
const BAMBERG: FixtureCentre = { centre: centre('vhs-bamberg', 'https://www.vhs-bamberg.de/einbuergerungstests'), dir: 'bamberg', courses: {} };
const BAMBERG_LAND: FixtureCentre = { centre: centre('vhs-bamberg-land-e-v', 'https://www.vhs-bamberg-land.de/p/488-CAT-KAT4512071'), dir: 'bamberg-land', courses: {} };
const DONAUWOERTH: FixtureCentre = { centre: centre('vhs-donauwoerth', 'https://www.vhs-don.de/einbuergerungstests'), dir: 'structure-missing', courses: {} };

const detailUrl = (fc: FixtureCentre, id: string): string => fc.courses[id]!;

/** URL → fixture map for a centre: its list page and every detail page. */
function fixturesOf(fc: FixtureCentre, overrides: Fixtures = {}): Fixtures {
	const fixtures: Fixtures = { [fc.centre.test_page_url!]: { file: `${fc.dir}/list.html` } };
	for (const [id, url] of Object.entries(fc.courses)) fixtures[url] = { file: `${fc.dir}/${id}.html` };
	return { ...fixtures, ...overrides };
}

const run = (fc: FixtureCentre, overrides: Fixtures = {}): ParseResult =>
	runReaderOnFixtures(itemkgReader, fc.centre, fixturesOf(fc, overrides), CTX, FIXTURES_DIR);

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * Runs a centre on copies of its real fixtures with string edits applied (file → [from, to][]).
 * Each `from` must occur in the file, so an edit never silently does nothing.
 */
function runEdited(fc: FixtureCentre, edits: Record<string, [string, string][]>): ParseResult {
	const dir = mkdtempSync(join(tmpdir(), 'itemkg-'));
	tempDirs.push(dir);
	const files = [`${fc.dir}/list.html`, ...Object.keys(fc.courses).map((id) => `${fc.dir}/${id}.html`)];
	for (const file of files) {
		let html = readFileSync(join(FIXTURES_DIR, file), 'utf8');
		for (const [from, to] of edits[file] ?? []) {
			if (!html.includes(from)) throw new Error(`edit target not in ${file}: ${from}`);
			html = html.split(from).join(to);
		}
		mkdirSync(dirname(join(dir, file)), { recursive: true });
		writeFileSync(join(dir, file), html);
	}
	return runReaderOnFixtures(itemkgReader, fc.centre, fixturesOf(fc), CTX, dir);
}

const listingsOf = (result: ParseResult): RawListing[] => {
	if (result.kind !== 'ok') throw new Error(`expected ok, got failed(${result.reason})`);
	return result.listings;
};

const MVHS_TIMES: [string, string][] = [
	['Fr. 04.12.2026\n', 'Fr. 04.12.2026 09:00\n'],
	['Fr. 22.01.2027\n', 'Fr. 22.01.2027 09:00\n'],
];
const STARNBERG_NOTE = '<p>Anmeldung nur per Mail oder persönlich möglich</p>';
const STARNBERG_MAIN = 'Bitte melden Sie sich per E-Mail (<a';

describe('itemkgReader on real fixtures', () => {
	it('Starnberg: 6 dates by e-mail, the 2 sold-out ones booked out, the rest free', () => {
		const starnberg = { place: 'Starnberg, vhs, Bahnhofplatz 14, II. OG, Raum 23', address: 'Bahnhofplatz 14, 82319 Starnberg' } as const;
		const herrsching = { place: 'Herrsching, Realschule, Jahnstr. 10, Raum E24', address: 'Jahnstraße 10, 82211 Herrsching' } as const;
		const common = { deadline: null, registration_method: 'email', eligibility: null } as const;
		expect(run(STARNBERG)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-12-11', time: '15:30', ...starnberg, status: 'booked_out', ...common, source_url: detailUrl(STARNBERG, '262-3479-S') },
				{ date: '2026-12-15', time: '18:15', ...herrsching, status: 'booked_out', ...common, source_url: detailUrl(STARNBERG, '262-3492-A') },
				{ date: '2027-01-29', time: '13:30', ...starnberg, status: 'free', ...common, source_url: detailUrl(STARNBERG, '262-3480-S') },
				{ date: '2027-01-29', time: '14:30', ...starnberg, status: 'free', ...common, source_url: detailUrl(STARNBERG, '262-3481-S') },
				{ date: '2027-01-29', time: '15:30', ...starnberg, status: 'free', ...common, source_url: detailUrl(STARNBERG, '262-3482-S') },
				{ date: '2027-02-02', time: '18:15', ...herrsching, status: 'free', ...common, source_url: detailUrl(STARNBERG, '262-3493-A') },
			],
		});
	});

	it('Bad Kissingen: "Persönliche Anmeldung" → in person, status unknown (also for the bk-notbookable row)', () => {
		const common = {
			time: '14:30',
			place: 'Altes Schulhaus Winkels (Raum 2), Winkelser Straße 42, 97688 Bad Kissingen',
			address: 'Winkelser Straße 42, 97688 Bad Kissingen',
			status: 'unknown',
			deadline: null,
			registration_method: 'in_person',
			eligibility: null,
		} as const;
		expect(run(KISSINGEN)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-09-17', ...common, source_url: detailUrl(KISSINGEN, '2617425KG') },
				{ date: '2026-11-19', ...common, source_url: detailUrl(KISSINGEN, '2627400KG') },
				{ date: '2026-12-03', ...common, source_url: detailUrl(KISSINGEN, '2627405KG') },
			],
		});
	});

	it('Erding: bk-inperson → in person and unknown; sold out and "keine Warteliste" give no waitlist', () => {
		const common = { time: '16:00', place: 'Erding, VHS-Haus, Raum B 215', address: 'Lethnerstraße 13, 85435 Erding', status: 'unknown', deadline: null, registration_method: 'in_person', eligibility: null } as const;
		expect(run(ERDING)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-10-29', ...common, source_url: detailUrl(ERDING, '262-4085') },
				{ date: '2026-11-12', ...common, source_url: detailUrl(ERDING, '262-4086') },
				{ date: '2026-11-19', ...common, source_url: detailUrl(ERDING, '262-4087') },
				{ date: '2026-11-26', ...common, source_url: detailUrl(ERDING, '262-4088') },
				{ date: '2026-12-17', ...common, source_url: detailUrl(ERDING, '262-4089') },
			],
		});
	});

	it('Roth (search page): "Anmeldung bis 22.10.2026 nur persönlich" → deadline and in person', () => {
		const common = { date: '2026-11-14', place: 'Landwirtschaftsschule, Aula', address: 'Johann-Strauß-Str. 1, 91154 Roth', status: 'unknown', deadline: '2026-10-22', registration_method: 'in_person', eligibility: null } as const;
		expect(run(ROTH)).toEqual({
			kind: 'ok',
			listings: [
				{ ...common, time: '09:00', source_url: detailUrl(ROTH, 'N31300') },
				{ ...common, time: '10:30', source_url: detailUrl(ROTH, 'N31301') },
			],
		});
	});

	it('Ebersberg: bk-written with the e-mail hint → email, free; room number already in the venue name', () => {
		expect(run(EBERSBERG)).toEqual({
			kind: 'ok',
			listings: [
				{
					date: '2026-12-15',
					time: '14:30',
					place: 'Ebersberg, vhs, Dr.-Wintrich-Str. 3, 406',
					address: 'Dr.-Wintrich-Str. 3, 85560 Ebersberg',
					status: 'free',
					deadline: null,
					registration_method: 'email',
					eligibility: null,
					source_url: detailUrl(EBERSBERG, '262-30994'),
				},
			],
		});
	});

	it('Würzburg: only the 5 test rows of a mixed category (telc rows skipped), in row order; in person → unknown', () => {
		const common = { place: 'City vhs, Zi. 3.1', address: 'Juliuspromenade 68, 97070 Würzburg', status: 'unknown', deadline: null, registration_method: 'in_person', eligibility: null } as const;
		expect(run(WUERZBURG)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-11-12', time: '10:45', ...common, source_url: detailUrl(WUERZBURG, '18616538') },
				{ date: '2026-11-26', time: '09:15', ...common, source_url: detailUrl(WUERZBURG, '18648736') },
				{ date: '2026-11-12', time: '09:15', ...common, source_url: detailUrl(WUERZBURG, '18616509') },
				{ date: '2026-11-26', time: '10:45', ...common, source_url: detailUrl(WUERZBURG, '18648761') },
				{ date: '2027-01-14', time: '09:15', ...common, source_url: detailUrl(WUERZBURG, '18729879') },
			],
		});
	});

	it('every listing is schema-valid and passes checkParseResult unchanged', () => {
		for (const fc of [STARNBERG, KISSINGEN, ERDING, ROTH, EBERSBERG, WUERZBURG]) {
			const result = run(fc);
			expect(checkParseResult(result)).toEqual(result);
			for (const listing of listingsOf(result)) expect(rawListingSchema.safeParse(listing).success).toBe(true);
		}
	});

	it('source_url is the detail page finalUrl after a redirect', () => {
		const url = detailUrl(EBERSBERG, '262-30994');
		const result = run(EBERSBERG, { [url]: { file: 'ebersberg/262-30994.html', finalUrl: `${url}?moved=1` } });
		expect(listingsOf(result)[0]!.source_url).toBe(`${url}?moved=1`);
	});
});

describe('matrix', () => {
	it('MVHS: rows without a time and no Start block → failed(date-unparseable)', () => {
		expect(run(MVHS)).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('MVHS: the "Geschichte und Politik" prep course is not a test row', () => {
		const plan = itemkgReader.plan(MVHS.centre);
		const html = readFileSync(join(FIXTURES_DIR, 'mvhs/list.html'), 'utf8');
		const list: FetchedPage = { url: MVHS.centre.test_page_url!, role: 'list', status: 200, html, finalUrl: MVHS.centre.test_page_url! };
		expect(selectDetailUrls(plan, [list])).toEqual([detailUrl(MVHS, 'X674118'), detailUrl(MVHS, 'X674130')]);
	});

	it('MVHS edited: a row time and a rule paragraph → eligibility is that paragraph; no venue → row location', () => {
		const rule = 'Die Anmeldung zum Einbürgerungstest ist nur für Personen mit Hauptwohnsitz in München möglich.';
		const result = runEdited(MVHS, {
			'mvhs/list.html': MVHS_TIMES,
			'mvhs/X674118.html': [['<div class="contentMain"><p>Anmeldezeiten', `<div class="contentMain"><p>${rule}</p><p>Anmeldezeiten`]],
		});
		const common = { time: '09:00', place: 'Innenstadt', address: null, status: 'unknown', registration_method: 'in_person' } as const;
		expect(result).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-12-04', ...common, deadline: '2026-10-31', eligibility: rule, source_url: detailUrl(MVHS, 'X674118') },
				{ date: '2027-01-22', ...common, deadline: null, eligibility: null, source_url: detailUrl(MVHS, 'X674130') },
			],
		});
	});

	it('Bamberg (empty course list) and Bamberg-Land (row without a date) → ok with no listings', () => {
		expect(run(BAMBERG)).toEqual({ kind: 'ok', listings: [] });
		expect(run(BAMBERG_LAND)).toEqual({ kind: 'ok', listings: [] });
	});

	it('Donauwörth info page as list page → failed(structure-missing)', () => {
		expect(run(DONAUWOERTH)).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('list page without html → failed(structure-missing)', () => {
		expect(run(STARNBERG, { [STARNBERG.centre.test_page_url!]: { file: null, status: 500 } })).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('a selected detail page with 404 and no body → failed(detail-page)', () => {
		expect(run(STARNBERG, { [detailUrl(STARNBERG, '262-3481-S')]: { file: null, status: 404 } })).toEqual({ kind: 'failed', reason: 'detail-page' });
	});

	it('a detail page with a non-2xx status but a body, or a timeout → failed(detail-page)', () => {
		expect(run(ROTH, { [detailUrl(ROTH, 'N31301')]: { file: 'roth/N31301.html', status: 500 } })).toEqual({ kind: 'failed', reason: 'detail-page' });
		expect(run(ROTH, { [detailUrl(ROTH, 'N31301')]: { file: null, status: null } })).toEqual({ kind: 'failed', reason: 'detail-page' });
	});

	it('a test row without a detail page (beyond the cap) → failed(detail-page)', () => {
		const list = { url: 'https://a.de/l', role: 'list', status: 200, html: readFileSync(join(FIXTURES_DIR, 'roth/list.html'), 'utf8'), finalUrl: 'https://www.vhs-roth.de/suche' } as const;
		const detail = { url: detailUrl(ROTH, 'N31300'), role: 'detail', status: 200, html: readFileSync(join(FIXTURES_DIR, 'roth/N31300.html'), 'utf8'), finalUrl: detailUrl(ROTH, 'N31300') } as const;
		expect(itemkgReader.parse([list, detail], ROTH.centre, CTX)).toEqual({ kind: 'failed', reason: 'detail-page' });
	});

	it('a detail page without .course-show-wrap → failed(structure-missing)', () => {
		expect(run(ROTH, { [detailUrl(ROTH, 'N31300')]: { file: 'roth/list.html' } })).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('a row date that is no real date → failed(date-unparseable)', () => {
		expect(runEdited(STARNBERG, { 'starnberg/list.html': [['Fr. 11.12.2026 15:30', 'Fr. 31.02.2027 15:30']] })).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('no test_page_url and no reader_config → no list URLs', () => {
		expect(itemkgReader.plan(centre('x', null)).listUrls).toEqual([]);
	});
});

describe('plan', () => {
	const page = (html: string, url: string, finalUrl: string | null = url): FetchedPage => ({ url, role: 'list', status: 200, html, finalUrl });
	const row = (title: string, date: string, href: string) =>
		`<div class="course-item"><a class="card-list-item" href="${href}"><div class="course-title">${title}</div><div class="course-list-item-date">${date}</div></a></div>`;

	it('uses reader_config.list_url over test_page_url, else test_page_url', () => {
		expect(itemkgReader.plan(centre('x', 'https://a.de/test', { reader_config: null })).listUrls).toEqual(['https://a.de/test']);
		expect(itemkgReader.plan(centre('x', 'https://a.de/test', { reader_config: { list_url: 'https://a.de/list' } })).listUrls).toEqual(['https://a.de/list']);
		expect(itemkgReader.plan(centre('x', null, { reader_config: { list_url: 'https://a.de/list' } })).listUrls).toEqual(['https://a.de/list']);
	});

	it('keeps dated Einbürgerungstest rows (not Vorbereitung), resolved against finalUrl, without fragment', () => {
		const html = [
			row('Einbürgerungstest', 'Fr. 11.12.2026 15:30', 'p/kurs-1-C-1#top'),
			row('Vorbereitung auf den Einbürgerungstest', 'Sa. 12.12.2026', '/p/kurs-2-C-2'),
			row('Einbuergerungstest EBT', 'Sa. 1.2.2027', 'https://other.de/p/kurs-3-C-3?x=1'),
			row('Einbürgerungstest', '', '/p/kurs-4-C-4'),
			row('Deutsch B1 (telc)', 'Sa. 12.12.2026', '/p/kurs-5-C-5'),
			row('Einbürgerungstest', 'Fr. 11.12.2026', 'mailto:x@a.de'),
			'<div class="course-item"><div class="course-title">Einbürgerungstest</div><div class="course-list-item-date">Fr. 11.12.2026</div></div>',
		].join('');
		const plan = itemkgReader.plan(centre('x', 'https://a.de/start'));
		expect(plan.selectDetailUrls([page(html, 'https://a.de/start', 'https://b.de/suche/')])).toEqual(['https://b.de/suche/p/kurs-1-C-1', 'https://other.de/p/kurs-3-C-3?x=1']);
	});

	it('ignores list pages without html and resolves against url when finalUrl is null', () => {
		const plan = itemkgReader.plan(centre('x', 'https://a.de/l'));
		const none: FetchedPage = { url: 'https://a.de/l', role: 'list', status: 500, html: null, finalUrl: null };
		expect(plan.selectDetailUrls([none, page(row('Einbürgerungstest', '1.12.2026', '/p/1'), 'https://c.de/l', null)])).toEqual(['https://c.de/p/1']);
	});

	it('caps detail pages at ITEMKG_MAX_DETAIL_PAGES', () => {
		const plan = itemkgReader.plan(centre('x', 'https://a.de/l'));
		expect(plan.maxDetailPages).toBe(ITEMKG_MAX_DETAIL_PAGES);
		expect(ITEMKG_MAX_DETAIL_PAGES).toBe(30);
		const rows = Array.from({ length: 35 }, (_, i) => row('Einbürgerungstest', '1.12.2026', `/p/${i}`)).join('');
		expect(selectDetailUrls(plan, [page(rows, 'https://a.de/l')])).toHaveLength(30);
	});

	it('selects the real Roth search-page rows', () => {
		const plan = itemkgReader.plan(ROTH.centre);
		const html = readFileSync(join(FIXTURES_DIR, 'roth/list.html'), 'utf8');
		expect(plan.selectDetailUrls([page(html, ROTH.centre.test_page_url!)])).toEqual([detailUrl(ROTH, 'N31300'), detailUrl(ROTH, 'N31301')]);
	});
});

describe('field rules on edited real fixtures', () => {
	it('a row without a time takes the detail Start block time on the same date', () => {
		const result = runEdited(STARNBERG, { 'starnberg/list.html': [['Fr. 11.12.2026 15:30', 'Fr. 11.12.2026']] });
		expect(listingsOf(result)[0]).toMatchObject({ date: '2026-12-11', time: '15:30' });
	});

	it('a Start block with a range "15:30 - 16:30 Uhr" gives the start time', () => {
		const result = runEdited(STARNBERG, {
			'starnberg/list.html': [['Fr. 11.12.2026 15:30', 'Fr. 11.12.2026']],
			'starnberg/262-3479-S.html': [['15:30 Uhr', '15:30 - 16:30 Uhr']],
		});
		expect(listingsOf(result)[0]).toMatchObject({ date: '2026-12-11', time: '15:30' });
	});

	it('00:00 (the all-day placeholder) is no time: a row 00:00 falls back to the Start block, a Start 00:00 fails', () => {
		const row = runEdited(STARNBERG, { 'starnberg/list.html': [['Fr. 11.12.2026 15:30', 'Fr. 11.12.2026 00:00']] });
		expect(listingsOf(row)[0]).toMatchObject({ date: '2026-12-11', time: '15:30' });
		const both = runEdited(STARNBERG, {
			'starnberg/list.html': [['Fr. 11.12.2026 15:30', 'Fr. 11.12.2026 00:00']],
			'starnberg/262-3479-S.html': [['15:30 Uhr', '00:00 - 23:59 Uhr']],
		});
		expect(both).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('a non-empty row date that is no D.M.YYYY ("Fr. 11.12.26") is a test row → failed(date-unparseable)', () => {
		expect(runEdited(STARNBERG, { 'starnberg/list.html': [['Fr. 11.12.2026 15:30', 'Fr. 11.12.26 15:30']] })).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('a Start block on another date gives no time → failed(date-unparseable)', () => {
		const result = runEdited(STARNBERG, { 'starnberg/list.html': [['Fr. 11.12.2026 15:30', 'Fr. 10.12.2026']] });
		expect(result).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('a venue number not in the name is appended as ", Raum <n>"', () => {
		const result = runEdited(STARNBERG, { 'starnberg/262-3479-S.html': [['Starnberg, vhs, Bahnhofplatz 14, II. OG, Raum 23', 'Starnberg, vhs, Bahnhofplatz 14']] });
		expect(listingsOf(result)[0]!.place).toBe('Starnberg, vhs, Bahnhofplatz 14, Raum 23');
	});

	it('a room number is checked as a whole token ("Raum 1" is not in "Bahnhofplatz 14")', () => {
		const result = runEdited(STARNBERG, {
			'starnberg/262-3479-S.html': [
				['Starnberg, vhs, Bahnhofplatz 14, II. OG, Raum 23', 'Starnberg, vhs, Bahnhofplatz 14'],
				['Raum\n                                                23', 'Raum\n                                                1'],
			],
		});
		expect(listingsOf(result)[0]!.place).toBe('Starnberg, vhs, Bahnhofplatz 14, Raum 1');
	});

	it('a waitlist offer on a booked-out date → waitlist; on a free date it stays free', () => {
		const offer = `${STARNBERG_NOTE}<p>Anmeldung auf die Warteliste möglich.</p>`;
		const result = runEdited(STARNBERG, { 'starnberg/262-3479-S.html': [[STARNBERG_NOTE, offer]], 'starnberg/262-3480-S.html': [[STARNBERG_NOTE, offer]] });
		const listings = listingsOf(result);
		expect(listings[0]!.status).toBe('waitlist');
		expect(listings[1]!.status).toBe('booked_out');
		expect(listings[2]!.status).toBe('free');
	});

	it('a negated waitlist ("keine Warteliste", "Warteliste ist voll") on a booked-out date stays booked out', () => {
		for (const text of ['Es gibt leider keine Warteliste.', 'Die Warteliste ist voll.', 'Eine Warteliste nicht möglich.']) {
			const result = runEdited(STARNBERG, { 'starnberg/262-3479-S.html': [[STARNBERG_NOTE, `${STARNBERG_NOTE}<p>${text}</p>`]] });
			expect(listingsOf(result)[0]!.status).toBe('booked_out');
		}
	});

	it('a rule on the list page outside the rows applies when the detail page has none', () => {
		const rule = 'Teilnahme nur für Personen, die im Landkreis Starnberg wohnhaft sind.';
		const result = runEdited(STARNBERG, { 'starnberg/list.html': [['<div id="category-courses"', `<p>${rule}</p><div id="category-courses"`]] });
		expect(listingsOf(result).map((l) => l.eligibility)).toEqual(Array(6).fill(rule));
	});

	it('a rule in a list page footer or nav is not the list page rule', () => {
		for (const wrap of ['footer', 'nav']) {
			const block = `<${wrap}><p>Angebote nur für Mitglieder.</p></${wrap}>`;
			const result = runEdited(STARNBERG, { 'starnberg/list.html': [['<div id="category-courses"', `${block}<div id="category-courses"`]] });
			expect(listingsOf(result).map((l) => l.eligibility)).toEqual(Array(6).fill(null));
		}
	});

	it('a rule inside a list row is not the list page rule', () => {
		const result = runEdited(STARNBERG, { 'starnberg/list.html': [['Bitte melden Sie sich per E-Mail (info', 'Nur für Personen mit Wohnsitz im Landkreis. Bitte melden Sie sich per E-Mail (info']] });
		expect(listingsOf(result).map((l) => l.eligibility)).toEqual(Array(6).fill(null));
	});

	it('Straubing-style "Erstwohnsitz" and "Wohnsitznachweis" are no rule', () => {
		const docs = 'Bitte bringen Sie einen Wohnsitznachweis mit.</div><div>Anmeldung mit Erstwohnsitz-Bescheinigung und Erstwohnsitz. ';
		const result = runEdited(STARNBERG, { 'starnberg/262-3479-S.html': [[STARNBERG_MAIN, `${docs}${STARNBERG_MAIN}`]] });
		expect(listingsOf(result)[0]!.eligibility).toBeNull();
	});

	it('"nur … Teilnehmende" is a rule; Merkliste notes are not', () => {
		const rule = 'Die Prüfung ist nur für Teilnehmende unserer Integrationskurse.';
		const some = runEdited(STARNBERG, { 'starnberg/262-3479-S.html': [[STARNBERG_NOTE, `${STARNBERG_NOTE}<p>${rule}</p>`]] });
		expect(listingsOf(some)[0]!.eligibility).toBe(rule);
		const none = runEdited(STARNBERG, { 'starnberg/262-3479-S.html': [[STARNBERG_NOTE, `${STARNBERG_NOTE}<p>Die Merkliste ist nur für eingeloggte Nutzer.</p>`]] });
		expect(listingsOf(none)[0]!.eligibility).toBeNull();
	});

	it('a venue city without a postcode gives no address', () => {
		const result = runEdited(ROTH, { 'roth/N31300.html': [['91154 Roth', 'Roth']] });
		expect(listingsOf(result)[0]).toMatchObject({ place: 'Landwirtschaftsschule, Aula', address: null });
	});

	it('"Anmeldeschluss am D.M.YY" in the detail text is the deadline', () => {
		const result = runEdited(STARNBERG, { 'starnberg/262-3479-S.html': [[STARNBERG_NOTE, `${STARNBERG_NOTE}<p>Anmeldeschluss am 20.11.26.</p>`]] });
		expect(listingsOf(result)[0]!.deadline).toBe('2026-11-20');
	});

	it('no icon on the list row → flags from the detail page icon', () => {
		const result = runEdited(EBERSBERG, { 'ebersberg/list.html': [['bk-icon bk-type-course', 'x-icon bk-type-course']] });
		expect(listingsOf(result)[0]).toMatchObject({ status: 'free', registration_method: 'email' });
	});

	it('no icon on row or detail → unknown', () => {
		const result = runEdited(EBERSBERG, {
			'ebersberg/list.html': [['bk-icon bk-type-course', 'x-icon bk-type-course']],
			'ebersberg/262-30994.html': [['bk-icon bk-type-course', 'x-icon bk-type-course']],
		});
		expect(listingsOf(result)[0]).toMatchObject({ status: 'unknown' });
	});
});

describe('status from flags', () => {
	const flags = (classes: string) => iconFlags(classes.split(' '));
	it.each([
		['bk-byphone bk-av-enough bk-rs-notbookableonline', 'email', false, 'free'],
		['bk-written bk-av-few', null, false, 'free'],
		['bk-bookable bk-av-enough', 'online', false, 'free'],
		['bk-byphone bk-av-soldout bk-rs-notbookableonline', 'email', false, 'booked_out'],
		['bk-notbookable bk-av-enough', null, false, 'booked_out'],
		['bk-byphone bk-av-soldout', 'email', true, 'waitlist'],
		['bk-byphone bk-av-enough', 'email', true, 'free'],
		['bk-byphone bk-av-enough bk-rs-registrationdeadlineexpired', null, false, 'unknown'],
		['bk-byphone bk-av-enough bk-rs-coursecompleted', null, false, 'unknown'],
		['bk-byphone bk-av-enough bk-rs-coursealreadystarted', null, false, 'unknown'],
		['bk-inperson bk-av-soldout', 'in_person', true, 'unknown'],
		['bk-byphone bk-av-soldout', 'in_person', false, 'unknown'],
		['bk-notbookable bk-av-enough bk-rs-coursecompleted', 'in_person', false, 'unknown'],
	] as const)('%s, %s, waitlist offer %s → %s', (classes, method, waitlist, expected) => {
		expect(mapStatus(flagSignals(flags(classes), method, waitlist))).toBe(expected);
	});

	it('no icon → unknown', () => {
		expect(mapStatus(flagSignals(null, null, true))).toBe('unknown');
	});

	it.each([
		['Anmeldung auf die Warteliste möglich.', true],
		['Warteliste', true],
		['Es gibt keine Platzreservierung und keine Warteliste.', false],
		['Eine Warteliste wird nicht geführt.', false],
		['Die Warteliste ist voll.', false],
		['Warteliste geschlossen', false],
		['Warteliste nicht möglich', false],
		['Wartelisten werden nicht geführt.', false],
		['Es gibt keine Kosten. Warteliste möglich', true],
		['Keine Kosten\nWarteliste möglich', true],
	] as const)('waitlist offer in %j → %s', (text, expected) => {
		expect(hasWaitlistOffer(text)).toBe(expected);
	});
});

describe('registration method', () => {
	const flags = (classes: string) => iconFlags(classes.split(' '));
	it.each([
		['bk-bookable bk-av-enough', [], 'online'],
		['bk-inperson bk-av-enough', ['Anmeldung per E-Mail'], 'in_person'],
		['bk-written bk-av-enough bk-hint-e-mail_registration', [], 'email'],
		['bk-written bk-av-enough', [], null],
		['bk-byphone', ['Anmeldung nur per Mail oder persönlich möglich'], 'email'],
		['bk-byphone', ['Anmeldung bis 22.10.2026 nur persönlich im Integrationsbüro'], 'in_person'],
		['bk-byphone', ['Anmeldung bis 22.10. nur persönlich im Integrationsbüro'], 'in_person'],
		['bk-byphone', ['Die Anmeldung erfolgt persönlich in der vhs.'], 'in_person'],
		['bk-notbookable', ['Persönliche Anmeldung'], 'in_person'],
		['bk-byphone', ['Gemäß der Prüfungsordnung werden die Anmeldungen nur persönlich entgegengenommen.'], 'in_person'],
		['bk-byphone', ['Nur persönliche Anmeldung in der Einsteinstr. 28'], 'in_person'],
		['bk-byphone', ['Eine Anmeldung per E-Mail ist möglich. Die Anmeldung erfolgt persönlich.'], 'in_person'],
		['bk-byphone', ['Die Ergebnisse werden nur persönlich ausgehändigt.'], null],
		['bk-byphone', ['Prüfungszeiten per E-Mail zugeschickt.', 'Bitte zur Anmeldung den Pass mitbringen.'], null],
		['bk-byphone', ['Anmeldung postalisch an die vhs.'], 'post'],
		['bk-byphone', ['Anmeldung bitte per Post.'], 'post'],
	] as const)('%s + %j → %s', (classes, texts, expected) => {
		expect(registrationMethodOf(flags(classes), texts)).toBe(expected);
	});

	it('no icon → text only', () => {
		expect(registrationMethodOf(null, ['Anmeldung per E-Mail'])).toBe('email');
		expect(registrationMethodOf(null, [])).toBeNull();
	});
});

describe('directory', () => {
	const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
	const centres = JSON.parse(readFileSync(join(ROOT, 'data/directory/centres.json'), 'utf8')) as Centre[];
	const note = readFileSync(join(ROOT, 'data/directory/itemkg-note.md'), 'utf8');

	it('every itemkg centre has a test page, reader_config.list_url equal to it and verified_at, matching itemkg-note.md', () => {
		const confirmed = note
			.split('## URL changes')[0]!
			.split('\n')
			.map((line) => /^\| `([^`]+)` \| (\S+) \| (\d{4}-\d{2}-\d{2}) \|$/.exec(line))
			.filter((match) => match !== null)
			.map((match) => ({ id: match[1]!, url: match[2]!, date: match[3]! }));
		const itemkg = centres.filter((c) => c.reader === 'itemkg');
		expect(itemkg).toHaveLength(21);
		for (const c of itemkg) {
			expect(c.test_page_url).not.toBeNull();
			expect(c.reader_config?.list_url).toBe(c.test_page_url);
			expect(c.verified_at).not.toBeNull();
		}
		expect(itemkg.map((c) => ({ id: c.centre_id, url: c.test_page_url, date: c.verified_at!.slice(0, 10) }))).toEqual(confirmed);
	});

	it('the fixture centres use their directory list URLs', () => {
		for (const fc of [STARNBERG, KISSINGEN, ERDING, ROTH, EBERSBERG, WUERZBURG, MVHS, BAMBERG, BAMBERG_LAND]) {
			expect(centres.find((c) => c.centre_id === fc.centre.centre_id)?.reader_config?.list_url).toBe(fc.centre.test_page_url);
		}
	});
});
