import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Centre } from '../../../shared/directory.ts';
import { mapStatus, rawListingSchema, type RawListing } from '../../../shared/listing.ts';
import { selectDetailUrls, type FetchedPage, type ParseContext, type ParseResult } from '../../../shared/reader.ts';
import { runReaderOnFixtures, type Fixtures } from '../fixture-runner.ts';
import { KUFERWEB_MAX_DETAIL_PAGES, kuferwebReader, lightSignals, textSignals } from './index.ts';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CTX: ParseContext = { runAt: new Date('2026-10-28T19:30:00.000Z') };

const centre = (id: string, testPageUrl: string | null, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: 'https://example.de/',
	test_page_url: testPageUrl,
	reader: 'kuferweb',
	reader_config: null,
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

/** A fixture centre: its list page URL, its directory and the `/kurs/` base of its detail pages. */
interface FixtureCentre {
	centre: Centre;
	dir: string;
	detailBase: string;
	courses: string[];
}

const AICHACH: FixtureCentre = {
	centre: centre('vhs-aichach-friedberg-e-v', 'https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest'),
	dir: 'aichach',
	detailBase: 'https://www.vhs-aichach-friedberg.de/programm/einbuergerungstest/kurs/',
	courses: [
		'AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40108-17',
		'AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40208-17',
		'AUSGEBUCHT-KEINE-ANMELDUNG-MEHR-MOEGLICH-Einbuergerungstest/G40308-17',
		'Einbuergerungstest/G40203-18',
		'Einbuergerungstest/G40303-18',
	],
};
const TAUFKIRCHEN: FixtureCentre = {
	centre: centre('vhs-taufkirchen', 'https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest'),
	dir: 'taufkirchen',
	detailBase: 'https://www.vhs-taufkirchen.de/kurse/integration-einbuergerung/einbuergerungstest/kurs/Einbuergerungstest/',
	courses: ['262-30111', '262-30112', '262-30113', '262-30121', '262-30122'],
};
const MOOSBURG: FixtureCentre = {
	centre: centre('vhs-moosburg-e-v', 'https://www.vhs-moosburg.de/programm/sprachen/kategorie/Einbuergerungstest/50#inhalt'),
	dir: 'moosburg',
	detailBase: 'https://www.vhs-moosburg.de/programm/sprachen/kurs/Einbuergerungstest/',
	courses: ['262.3071', '262.3072'],
};
const TRAUNREUT: FixtureCentre = {
	centre: centre('vhs-traunreut-e-v', 'https://www.vhs-traunreut.de/programm/sprachen/kategorie/Einbuergerungstest/1052'),
	dir: 'traunreut',
	detailBase: 'https://www.vhs-traunreut.de/programm/sprachen/kurs/Einbuergerungstest/',
	courses: ['X4046', 'X4047'],
};
const STRAUBING: FixtureCentre = {
	centre: centre('volkshochschule-straubing-bogen-ggmbh', 'https://www.vhs-straubing-bogen.de/programm/sprachen/kategorie/Deutsch+als+Fremdsprache/69#inhalt'),
	dir: 'straubing',
	detailBase: 'https://www.vhs-straubing-bogen.de/programm/sprachen/kurs/Einbuergerungstest/',
	courses: ['262-S09OA'],
};
const MUEHLDORF: FixtureCentre = {
	centre: centre('vhs-muehldorf-e-v', 'https://www.vhs-muehldorf.de/programm/sprachen-verstaendigung/kategorie/Einbuergerung/61#inhalt'),
	dir: 'muehldorf',
	detailBase: 'https://www.vhs-muehldorf.de/programm/sprachen-verstaendigung/kurs/Deutsch-Einbuergerungstest/',
	courses: ['E36901'],
};

const detailUrl = (fc: FixtureCentre, course: string): string => `${fc.detailBase}${course}`;
const courseFile = (fc: FixtureCentre, course: string): string => `${fc.dir}/${course.split('/').pop()!}.html`;

/** URL → fixture map for a centre: its list page and every detail page. */
function fixturesOf(fc: FixtureCentre, overrides: Fixtures = {}): Fixtures {
	const fixtures: Fixtures = { [fc.centre.test_page_url!]: { file: `${fc.dir}/list.html` } };
	for (const course of fc.courses) fixtures[detailUrl(fc, course)] = { file: courseFile(fc, course) };
	return { ...fixtures, ...overrides };
}

const run = (fc: FixtureCentre, overrides: Fixtures = {}): ParseResult =>
	runReaderOnFixtures(kuferwebReader, fc.centre, fixturesOf(fc, overrides), CTX, FIXTURES_DIR);

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/**
 * Runs a centre on copies of its real fixtures with string edits applied (file → [from, to][]).
 * Each `from` must occur in the file, so an edit never silently does nothing.
 */
function runEdited(fc: FixtureCentre, edits: Record<string, [string, string][]>): ParseResult {
	const dir = mkdtempSync(join(tmpdir(), 'kuferweb-'));
	tempDirs.push(dir);
	const files = [`${fc.dir}/list.html`, ...fc.courses.map((course) => courseFile(fc, course))];
	for (const file of files) {
		let html = readFileSync(join(FIXTURES_DIR, file), 'utf8');
		for (const [from, to] of edits[file] ?? []) {
			if (!html.includes(from)) throw new Error(`edit target not in ${file}: ${from}`);
			html = html.split(from).join(to);
		}
		mkdirSync(dirname(join(dir, file)), { recursive: true });
		writeFileSync(join(dir, file), html);
	}
	return runReaderOnFixtures(kuferwebReader, fc.centre, fixturesOf(fc), CTX, dir);
}

const listingsOf = (result: ParseResult): RawListing[] => {
	if (result.kind !== 'ok') throw new Error(`expected ok, got failed(${result.reason})`);
	return result.listings;
};

const AICHACH_RULE = 'Voraussetzung: Wohnsitz in Bayern!';

describe('kuferwebReader on real fixtures', () => {
	it('Aichach: 5 dates, 3 booked out by the AUSGEBUCHT title, the residence rule from the list page', () => {
		const booked = { place: 'Friedberg; Archivgalerie; Kursraum EG', address: 'Pfarrstraße 6, 86316 Friedberg', status: 'booked_out', deadline: null, registration_method: null, eligibility: AICHACH_RULE } as const;
		const open = { place: 'Aichach; Feuerhaus; Kursraum', address: 'Martinstrasse 17 + 19, 86551 Aichach', status: 'unknown', deadline: null, registration_method: 'online', eligibility: AICHACH_RULE } as const;
		expect(run(AICHACH)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-11-12', time: '13:00', ...booked, source_url: detailUrl(AICHACH, AICHACH.courses[0]!) },
				{ date: '2026-11-12', time: '14:30', ...booked, source_url: detailUrl(AICHACH, AICHACH.courses[1]!) },
				{ date: '2026-11-12', time: '16:00', ...booked, source_url: detailUrl(AICHACH, AICHACH.courses[2]!) },
				{ date: '2027-01-15', time: '14:00', ...open, source_url: detailUrl(AICHACH, AICHACH.courses[3]!) },
				{ date: '2027-01-15', time: '15:30', ...open, source_url: detailUrl(AICHACH, AICHACH.courses[4]!) },
			],
		});
	});

	it('Taufkirchen: 262-30122 free and online, "Termin ist ausgebucht" dates booked out, no rule', () => {
		const common = { place: 'vhs, Ahornring 121, Raum 2.2', address: 'Ahornring 121, 82024 Taufkirchen', deadline: null, eligibility: null } as const;
		const booked = { ...common, status: 'booked_out', registration_method: null } as const;
		expect(run(TAUFKIRCHEN)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-11-11', time: '13:00', ...booked, source_url: detailUrl(TAUFKIRCHEN, '262-30111') },
				{ date: '2026-11-11', time: '14:00', ...booked, source_url: detailUrl(TAUFKIRCHEN, '262-30112') },
				{ date: '2026-11-11', time: '15:00', ...booked, source_url: detailUrl(TAUFKIRCHEN, '262-30113') },
				{ date: '2026-12-02', time: '13:00', ...booked, source_url: detailUrl(TAUFKIRCHEN, '262-30121') },
				{ date: '2026-12-02', time: '14:00', ...common, status: 'free', registration_method: 'online', source_url: detailUrl(TAUFKIRCHEN, '262-30122') },
			],
		});
	});

	it('Moosburg: Beginn time beats the session table, first Kursort block, in-person registration', () => {
		const common = { time: '15:00', place: 'UG4', address: 'Stadtplatz 2, 85368 Moosburg', status: 'unknown', deadline: null, registration_method: 'in_person', eligibility: null } as const;
		expect(run(MOOSBURG)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-11-26', ...common, source_url: detailUrl(MOOSBURG, '262.3071') },
				{ date: '2027-02-25', ...common, source_url: detailUrl(MOOSBURG, '262.3072') },
			],
		});
	});

	it('Traunreut: Adresse block without a room line, 2-digit-year Anmeldeschluss', () => {
		const common = { time: '10:00', place: null, address: 'Johann.-Hinrich-Wichern-Str. 5, 83301 Traunreut', status: 'unknown', registration_method: null, eligibility: null } as const;
		expect(run(TRAUNREUT)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-11-13', ...common, deadline: '2026-10-16', source_url: detailUrl(TRAUNREUT, 'X4046') },
				{ date: '2026-12-04', ...common, deadline: '2026-11-06', source_url: detailUrl(TRAUNREUT, 'X4047') },
			],
		});
	});

	it('Straubing: only the test from a mixed category, Anmeldeschluss label line, "ausschließlich persönlich"', () => {
		expect(run(STRAUBING)).toEqual({
			kind: 'ok',
			listings: [
				{
					date: '2026-11-30',
					time: '09:00',
					place: 'vhs Oberalteich, Raum Rachel',
					address: 'Klosterhof 1-2, 94327 Bogen',
					status: 'unknown',
					deadline: '2026-11-05',
					registration_method: 'in_person',
					eligibility: null,
					source_url: detailUrl(STRAUBING, '262-S09OA'),
				},
			],
		});
	});

	it('Mühldorf: one listing from a category with DaF courses, "13.00 Uhr", "Anmeldung bis", no street → address null', () => {
		expect(run(MUEHLDORF)).toEqual({
			kind: 'ok',
			listings: [
				{
					date: '2026-12-11',
					time: '13:00',
					place: 'vhs-Zentrum Schlörstraße Raum 07/UG',
					address: null,
					status: 'unknown',
					deadline: '2026-11-13',
					registration_method: null,
					eligibility: null,
					source_url: detailUrl(MUEHLDORF, 'E36901'),
				},
			],
		});
	});

	it('every listing is schema-valid and carries no extra keys', () => {
		for (const fc of [AICHACH, TAUFKIRCHEN, MOOSBURG, TRAUNREUT, STRAUBING, MUEHLDORF]) {
			for (const listing of listingsOf(run(fc))) expect(rawListingSchema.safeParse(listing).success).toBe(true);
		}
	});

	it('source_url is the detail page finalUrl after a redirect', () => {
		const url = detailUrl(STRAUBING, '262-S09OA');
		const result = run(STRAUBING, { [url]: { file: 'straubing/262-S09OA.html', finalUrl: `${url}?moved=1` } });
		expect(listingsOf(result)[0]!.source_url).toBe(`${url}?moved=1`);
	});
});

describe('matrix', () => {
	it('course list without test links (Mainburg Sprachen) → ok with no listings', () => {
		const c = centre('vhs-mainburg-e-v', 'https://www.vhs-mainburg.de/programm/sprachen');
		expect(runReaderOnFixtures(kuferwebReader, c, { 'https://www.vhs-mainburg.de/programm/sprachen': { file: 'no-tests/list.html' } }, CTX, FIXTURES_DIR)).toEqual({ kind: 'ok', listings: [] });
	});

	it('KuferWeb homepage (Neumarkt) as list page → failed(structure-missing)', () => {
		const c = centre('vhs-im-ldkr-neumarkt-opf', 'https://www.vhs-neumarkt.de/');
		expect(runReaderOnFixtures(kuferwebReader, c, { 'https://www.vhs-neumarkt.de/': { file: 'structure-missing/list.html' } }, CTX, FIXTURES_DIR)).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('list page without html → failed(structure-missing)', () => {
		const list: FetchedPage = { url: 'https://example.de/l', role: 'list', status: 200, html: null, finalUrl: null };
		expect(kuferwebReader.parse([list], centre('x', 'https://example.de/l'), CTX)).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('a selected detail page with 404 and no body → failed(detail-page)', () => {
		expect(run(AICHACH, { [detailUrl(AICHACH, AICHACH.courses[1]!)]: { file: null, status: 404 } })).toEqual({ kind: 'failed', reason: 'detail-page' });
	});

	it('a detail page with a non-2xx status but a body, or a timeout → failed(detail-page)', () => {
		expect(run(MOOSBURG, { [detailUrl(MOOSBURG, '262.3072')]: { file: 'moosburg/262.3072.html', status: 500 } })).toEqual({ kind: 'failed', reason: 'detail-page' });
		expect(run(MOOSBURG, { [detailUrl(MOOSBURG, '262.3072')]: { file: null, status: null } })).toEqual({ kind: 'failed', reason: 'detail-page' });
	});

	it('a detail page without .kw-kursdetails → failed(structure-missing)', () => {
		expect(run(MOOSBURG, { [detailUrl(MOOSBURG, '262.3071')]: { file: 'moosburg/list.html' } })).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('a detail page whose start date cannot be read → failed(date-unparseable)', () => {
		const result = runEdited(AICHACH, {
			'aichach/G40108-17.html': [['<abbr title="Donnerstag">Do.</abbr>, 12.11.2026, 13:00 - 14:30 Uhr', 'nach Vereinbarung']],
		});
		expect(result).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('no test_page_url and no reader_config → no list URLs', () => {
		expect(kuferwebReader.plan(centre('x', null)).listUrls).toEqual([]);
	});
});

describe('plan', () => {
	const page = (html: string, url: string, finalUrl: string | null = url): FetchedPage => ({ url, role: 'list', status: 200, html, finalUrl });

	it('uses reader_config.list_url over test_page_url, else test_page_url', () => {
		expect(kuferwebReader.plan(centre('x', 'https://a.de/test')).listUrls).toEqual(['https://a.de/test']);
		expect(kuferwebReader.plan(centre('x', 'https://a.de/test', { reader_config: { list_url: 'https://a.de/list' } })).listUrls).toEqual(['https://a.de/list']);
		expect(kuferwebReader.plan(centre('x', null, { reader_config: { list_url: 'https://a.de/list' } })).listUrls).toEqual(['https://a.de/list']);
	});

	it('caps detail pages at KUFERWEB_MAX_DETAIL_PAGES', () => {
		const plan = kuferwebReader.plan(centre('x', 'https://a.de/l'));
		expect(plan.maxDetailPages).toBe(KUFERWEB_MAX_DETAIL_PAGES);
		expect(KUFERWEB_MAX_DETAIL_PAGES).toBe(30);
		const links = Array.from({ length: 35 }, (_, i) => `<a href="/kurs/Einbuergerungstest/${i}">x</a>`).join('');
		expect(selectDetailUrls(plan, [page(links, 'https://a.de/l')])).toHaveLength(30);
	});

	it('keeps only /kurs/ links whose title segment names the test, resolved against finalUrl, without fragment', () => {
		const html = [
			'<a href="kurs/Einb%C3%BCrgerungstest/A1#inhalt">a</a>',
			'<a href="/programm/kurs/DaF-B1-Pruefung/B2">b</a>',
			'<a href="/programm/kategorie/Einbuergerungstest/61">c</a>',
			'<a href="/kurs/Deutsch-Einbuergerungstest/C3">d</a>',
			'<a href="/kurs/Kurs/Einbuergerungstest">e</a>',
			'<a href="mailto:x@einbuergerung.de">f</a>',
			'<a href="https://other.de/x/kurs/EINBUERGERUNGSTEST-ausgebucht/D4?x=1">g</a>',
		].join('');
		const plan = kuferwebReader.plan(centre('x', 'https://a.de/start'));
		expect(plan.selectDetailUrls([page(html, 'https://a.de/start', 'https://b.de/programm/')])).toEqual([
			'https://b.de/programm/kurs/Einb%C3%BCrgerungstest/A1',
			'https://b.de/kurs/Deutsch-Einbuergerungstest/C3',
			'https://other.de/x/kurs/EINBUERGERUNGSTEST-ausgebucht/D4?x=1',
		]);
	});

	it('ignores list pages without html and resolves against url when finalUrl is null', () => {
		const plan = kuferwebReader.plan(centre('x', 'https://a.de/l'));
		const none: FetchedPage = { url: 'https://a.de/l', role: 'list', status: 500, html: null, finalUrl: null };
		expect(plan.selectDetailUrls([none, page('<a href="/kurs/Einbuergerungstest/1">x</a>', 'https://c.de/l', null)])).toEqual(['https://c.de/kurs/Einbuergerungstest/1']);
	});

	it('never throws on a malformed escape in a link', () => {
		const plan = kuferwebReader.plan(centre('x', 'https://a.de/l'));
		expect(plan.selectDetailUrls([page('<a href="/kurs/Einbuergerung%E0%A4%A/1">x</a>', 'https://a.de/l')])).toEqual(['https://a.de/kurs/Einbuergerung%E0%A4%A/1']);
	});
});

describe('field rules on edited real fixtures', () => {
	it('a Beginn without a time takes the time from the session row with that date', () => {
		const result = runEdited(AICHACH, { 'aichach/G40108-17.html': [['12.11.2026, 13:00 - 14:30 Uhr</td>', '12.11.2026</td>']] });
		expect(listingsOf(result)[0]).toMatchObject({ date: '2026-11-12', time: '13:00' });
	});

	it('a Beginn value wrapped onto a second line ("um 08:00 Uhr") is read whole', () => {
		const result = runEdited(AICHACH, { 'aichach/G40108-17.html': [['12.11.2026, 13:00 - 14:30 Uhr</td>', '12.11.2026,<br />um 08:00 Uhr</td>']] });
		expect(listingsOf(result)[0]).toMatchObject({ date: '2026-11-12', time: '08:00' });
	});

	it('a single Kursort line "<street no.>, <postcode city>" gives the address', () => {
		const result = runEdited(AICHACH, { 'aichach/G40108-17.html': [['Pfarrstra&szlig;e 6<br />', 'Pfarrstra&szlig;e 6, ']] });
		expect(listingsOf(result)[0]).toMatchObject({ place: 'Friedberg; Archivgalerie; Kursraum EG', address: 'Pfarrstraße 6, 86316 Friedberg' });
	});

	it('no Kursort label → place from the session row Ort cell, address from its tail', () => {
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Kursort: ', '<li>']] });
		expect(listingsOf(result)[4]).toMatchObject({ place: 'vhs, Ahornring 121, Raum 2.2, Ahornring 121, 82024 Taufkirchen', address: 'Ahornring 121, 82024 Taufkirchen' });
	});

	it('a session column after Ort (e.g. instructor) never becomes the place', () => {
		const result = runEdited(TAUFKIRCHEN, {
			'taufkirchen/262-30122.html': [
				['<li>Kursort: ', '<li>'],
				['Raum 2.2, Ahornring 121, 82024 Taufkirchen', 'Raum 2.2, Ahornring 121, 82024 Taufkirchen</td><td headers="kt-columnheader-leitung">Max Muster'],
			],
		});
		expect(listingsOf(result)[4]).toMatchObject({ place: 'vhs, Ahornring 121, Raum 2.2, Ahornring 121, 82024 Taufkirchen' });
	});

	it('"Beginn der Anmeldung: <date>" is not read as the test start', () => {
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Gebühr: ', '<li>Beginn der Anmeldung: 01.09.2026</li><li>Gebühr: ']] });
		expect(listingsOf(result)[4]).toMatchObject({ date: '2026-12-02', time: '14:00' });
		const first = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Kursbeginn: ', '<li>Beginn der Anmeldung: 01.09.2026</li><li>Kursbeginn: ']] });
		expect(listingsOf(first)[4]).toMatchObject({ date: '2026-12-02', time: '14:00' });
	});

	it('"persönlich" outside a registration sentence, or "nicht nur persönlich", is no in-person signal', () => {
		const handout = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Gebühr: ', '<li>Die Ergebnisse werden nur persönlich ausgehändigt.</li><li>Gebühr: ']] });
		expect(listingsOf(handout)[4]!.registration_method).toBe('online');
		const notOnly = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Gebühr: ', '<li>Die Anmeldung ist nicht nur persönlich, sondern auch online möglich.</li><li>Gebühr: ']] });
		expect(listingsOf(notOnly)[4]!.registration_method).toBe('online');
	});

	it('Wohnsitznachweis / Wohnsitzbescheinigung (documents) are no rule', () => {
		const docs = '<p>Bitte bringen Sie einen Wohnsitznachweis mit.</p><p>Eine Wohnsitzbescheinigung ist erforderlich.</p>';
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Gebühr: ', `<li>${docs}</li><li>Gebühr: `]] });
		expect(listingsOf(result)[4]!.eligibility).toBeNull();
	});

	it('no Beginn label → date and time from the first session row', () => {
		const result = runEdited(AICHACH, { 'aichach/G40108-17.html': [['<td>Beginn </td>', '<td>Termin </td>']] });
		expect(listingsOf(result)[0]).toMatchObject({ date: '2026-11-12', time: '13:00' });
	});

	it('reads "D.M.YY um HH:MM" in Kursbeginn', () => {
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['Mi.</abbr>, 2.12.2026, 14:00 Uhr</strong> </li>', 'Mi.</abbr>, 2.12.26 um 08:00</strong> </li>']] });
		expect(listingsOf(result)[4]).toMatchObject({ date: '2026-12-02', time: '08:00' });
	});

	it('a rule on the detail page beats the list page rule', () => {
		const rule = '<p>Die Anmeldung ist nur für Personen mit Hauptwohnsitz im Landkreis möglich.</p>';
		const result = runEdited(AICHACH, { 'aichach/G40203-18.html': [['<td>Beginn </td>', `<td>${rule}</td></tr><tr><td>Beginn </td>`]] });
		const listings = listingsOf(result);
		expect(listings[3]!.eligibility).toBe('Die Anmeldung ist nur für Personen mit Hauptwohnsitz im Landkreis möglich.');
		expect(listings[4]!.eligibility).toBe(AICHACH_RULE);
	});

	it('Teilnehmende alone and Merkliste notes are no rule; "nur … Teilnehmende" is', () => {
		const notes = '<p>Liebe Teilnehmende,</p><p>Die Merkliste ist nur für eingeloggte Nutzer.</p>';
		const none = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Gebühr: ', `<li>${notes}</li><li>Gebühr: `]] });
		expect(listingsOf(none)[4]!.eligibility).toBeNull();
		const rule = '<p>Der Test ist ausschließlich für unsere Teilnehmende des Integrationskurses.</p>';
		const some = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Gebühr: ', `<li>${rule}</li><li>Gebühr: `]] });
		expect(listingsOf(some)[4]!.eligibility).toBe('Der Test ist ausschließlich für unsere Teilnehmende des Integrationskurses.');
	});

	it('registration per E-Mail / per Post when nothing stronger is stated', () => {
		const email = runEdited(MUEHLDORF, { 'muehldorf/E36901.html': [['Anmeldung bis 13.11.2026', 'Anmeldung bitte per E-Mail bis 13.11.2026']] });
		expect(listingsOf(email)[0]).toMatchObject({ registration_method: 'email', deadline: null });
		const post = runEdited(MUEHLDORF, { 'muehldorf/E36901.html': [['Anmeldung bis 13.11.2026', 'Anmeldung postalisch, Anmeldeschluss ist am 1.11.2026']] });
		expect(listingsOf(post)[0]).toMatchObject({ registration_method: 'post', deadline: '2026-11-01' });
	});
});

describe('status on edited real fixtures', () => {
	const LIGHT = '<span class="kw_ampel status2">Anmeldung m&ouml;glich</span>';

	it('list-row light "Anmeldung auf Warteliste" → waitlist', () => {
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/list.html': [[LIGHT, '<span class="kw_ampel status4">Anmeldung auf Warteliste</span>']] });
		expect(listingsOf(result).map((l) => l.status)).toEqual(['booked_out', 'booked_out', 'booked_out', 'booked_out', 'waitlist']);
	});

	it('a full light (class ausgebucht) → booked_out even with a free detail light', () => {
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/list.html': [[LIGHT, '<span class="kw_ampel ausgebucht"></span>']] });
		expect(listingsOf(result)[4]!.status).toBe('booked_out');
	});

	it('VHS Nord-style "ausgebucht. Eine Warteliste ist nicht möglich." → booked_out, not waitlist', () => {
		const result = runEdited(TAUFKIRCHEN, {
			'taufkirchen/262-30111.html': [['Der Termin ist ausgebucht. Keine Anmeldung mehr möglich.', 'Der Kurs ist leider ausgebucht. Eine Warteliste ist nicht möglich.']],
		});
		expect(listingsOf(result)[0]!.status).toBe('booked_out');
	});

	it('a body waitlist offer on a booked-out date → waitlist', () => {
		const result = runEdited(TAUFKIRCHEN, {
			'taufkirchen/262-30111.html': [['Keine Anmeldung mehr möglich.', 'Anmeldung auf die Warteliste ist möglich.']],
		});
		expect(listingsOf(result)[0]!.status).toBe('waitlist');
	});

	it('a neutral list-row light leaves 262-30122 free from its detail light', () => {
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/list.html': [[LIGHT, '<span class="kw_ampel">Kursinfo</span>']] });
		expect(listingsOf(result)[4]!.status).toBe('free');
	});

	it('a detail page without AUSGEBUCHT stays booked_out from the list link title', () => {
		const result = runEdited(AICHACH, {
			'aichach/G40108-17.html': [
				['AUSGEBUCHT', 'GESCHLOSSEN'],
				['ist bereits ausgebucht', 'ist bereits geschlossen'],
			],
		});
		const listings = listingsOf(result);
		expect(listings[0]!.status).toBe('booked_out');
		expect(listings.map((l) => l.status)).toEqual(['booked_out', 'booked_out', 'booked_out', 'unknown', 'unknown']);
	});

	it('a waitlist offer negated after the match ("… ist nicht möglich") does not make a waitlist', () => {
		const result = runEdited(TAUFKIRCHEN, {
			'taufkirchen/262-30111.html': [['Keine Anmeldung mehr möglich.', 'Anmeldung auf die Warteliste ist nicht möglich.']],
		});
		expect(listingsOf(result)[0]!.status).toBe('booked_out');
	});

	it('a body waitlist offer without booked-out stays free', () => {
		const result = runEdited(TAUFKIRCHEN, { 'taufkirchen/262-30122.html': [['<li>Gebühr: ', '<li>Anmeldung auf die Warteliste möglich.</li><li>Gebühr: ']] });
		expect(listingsOf(result)[4]!.status).toBe('free');
	});
});

describe('status signals', () => {
	it.each([
		['Plätze frei', [], 'free'],
		['wenige Plätze', [], 'free'],
		['Anmeldung möglich', [], 'free'],
		['Keine Anmeldung möglich', [], 'unknown'],
		['Keine Online-Anmeldung möglich', [], 'unknown'],
		['', ['ampelbutton', 'nicht_buchbar'], 'unknown'],
		['Kurs ausgebucht', [], 'booked_out'],
		['Kurs ist voll', [], 'booked_out'],
		['', ['ampelbutton', 'ausgebucht'], 'booked_out'],
		['Anmeldung auf Warteliste', ['ausgebucht'], 'waitlist'],
		['Warteliste', [], 'waitlist'],
		['Keine Warteliste', [], 'unknown'],
		['Warteliste nicht möglich', [], 'unknown'],
		['Warteliste voll', [], 'booked_out'],
		['Warteliste ist voll', [], 'booked_out'],
		['Warteliste ausgebucht', [], 'booked_out'],
		['Warteliste geschlossen', [], 'unknown'],
	] as const)('light %j %j → %s', (label, classes, expected) => {
		expect(mapStatus(lightSignals(label, classes))).toBe(expected);
	});

	it.each([
		['G40108-17 (AUSGEBUCHT KEINE ANMELDUNG MEHR MÖGLICH) Einbürgerungstest', true, false],
		['Der Kurs ist bereits ausgebucht', true, false],
		['Die Termine sind leider ausgebucht', true, false],
		['Fast ausgebucht? Melden Sie sich bald an.', false, false],
		['Ausgebucht', false, false],
		['Der Kurs ist ausgebucht. Anmeldung auf die Warteliste möglich.', true, true],
		['Der Kurs ist ausgebucht. Eine Warteliste ist nicht möglich.', true, false],
		['Keine Anmeldung auf die Warteliste.', false, false],
		['Der Kurs ist ausgebucht. Anmeldung auf die Warteliste ist nicht möglich.', true, false],
		['Keine Anmeldung möglich', false, false],
		['Dieser Kurs ist nicht buchbar', false, false],
	] as const)('text %j → bookedOut %s, waitlist offer %s', (text, bookedOut, waitlistOffer) => {
		expect(textSignals(text)).toEqual({ bookedOut, waitlistOffer });
	});
});

describe('directory', () => {
	const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
	const centres = JSON.parse(readFileSync(join(ROOT, 'data/directory/centres.json'), 'utf8')) as Centre[];
	const note = readFileSync(join(ROOT, 'data/directory/kuferweb-note.md'), 'utf8');

	it('every kuferweb centre has a test page and verified_at, and matches kuferweb-note.md', () => {
		const confirmed = note
			.split('## Moved to reader `none`')[0]!
			.split('\n')
			.map((line) => /^\| `([^`]+)` \| (\S+) \| (\d{4}-\d{2}-\d{2}) \|$/.exec(line))
			.filter((match) => match !== null)
			.map((match) => ({ id: match[1]!, url: match[2]!, date: match[3]! }));
		const kuferweb = centres.filter((c) => c.reader === 'kuferweb');
		expect(kuferweb.length).toBeGreaterThan(0);
		for (const c of kuferweb) {
			expect(c.test_page_url).not.toBeNull();
			expect(c.verified_at).not.toBeNull();
		}
		expect(kuferweb.map((c) => ({ id: c.centre_id, url: c.test_page_url, date: c.verified_at!.slice(0, 10) }))).toEqual(confirmed);
	});

	it('every centre moved to none in the note has reader none', () => {
		const moved = [...note.split('## Moved to reader `none`')[1]!.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]!);
		expect(moved.length).toBeGreaterThan(0);
		for (const id of moved) expect(centres.find((c) => c.centre_id === id)?.reader).toBe('none');
	});
});
