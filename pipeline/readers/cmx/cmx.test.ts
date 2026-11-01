import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { Centre } from '../../../shared/directory.ts';
import { mapStatus, rawListingSchema, type RawListing } from '../../../shared/listing.ts';
import { selectDetailUrls, type FetchedPage, type ParseContext, type ParseResult } from '../../../shared/reader.ts';
import { runReaderOnFixtures } from '../fixture-runner.ts';
import { ampelSignals, cmxReader } from './index.ts';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const READERS_DIR = fileURLToPath(new URL('../', import.meta.url));
const CTX: ParseContext = { runAt: new Date('2026-11-01T19:30:00.000Z') };

const centre = (id: string, testPageUrl: string | null, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: 'https://example.de/',
	test_page_url: testPageUrl,
	reader: 'cmx',
	reader_config: null,
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

/** A fixture centre: its test page and the fixture file standing for it. */
interface FixtureCentre {
	centre: Centre;
	file: string;
}

const GERMERING: FixtureCentre = { centre: centre('vhs-germering-e-v', 'https://vhs-germering.de/Programmbereich/cmx67e28778abee8.html'), file: 'germering/list.html' };
const DACHAU: FixtureCentre = { centre: centre('vhs-dachau-gmbh', 'https://vhs-dachau.de/Artikel/cmx655e01456395b.html'), file: 'dachau/list.html' };
const BUCHLOE: FixtureCentre = { centre: centre('vhs-buchloe-e-v', 'https://vhs-buchloe.de/Programmbereich/cmx69c2693eca8cf.html'), file: 'buchloe/list.html' };
const KEMPTEN: FixtureCentre = { centre: centre('vhs-kempten', 'https://vhs-kempten.de/Programmbereich/cmx6321cc9fe80ca.html'), file: 'kempten/list.html' };
const HOMEPAGE: FixtureCentre = { centre: centre('vhs-dillingen-e-v', 'https://vhs-dillingen.de'), file: 'structure-missing/list.html' };

const run = (fc: FixtureCentre, file = fc.file, dir = FIXTURES_DIR): ParseResult =>
	runReaderOnFixtures(cmxReader, fc.centre, { [fc.centre.test_page_url!]: { file } }, CTX, dir);

const tempDirs: string[] = [];
afterAll(() => tempDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Runs a centre on a copy of its real fixture with string edits applied; each `from` must occur in the file. */
function runEdited(fc: FixtureCentre, edits: [string, string][]): ParseResult {
	const dir = mkdtempSync(join(tmpdir(), 'cmx-'));
	tempDirs.push(dir);
	let html = readFileSync(join(FIXTURES_DIR, fc.file), 'utf8');
	for (const [from, to] of edits) {
		if (!html.includes(from)) throw new Error(`edit target not in ${fc.file}: ${from}`);
		html = html.split(from).join(to);
	}
	mkdirSync(dirname(join(dir, fc.file)), { recursive: true });
	writeFileSync(join(dir, fc.file), html);
	return run(fc, fc.file, dir);
}

const listingsOf = (result: ParseResult): RawListing[] => {
	if (result.kind !== 'ok') throw new Error(`expected ok, got failed(${result.reason})`);
	return result.listings;
};

const fields = { address: null, deadline: null, registration_method: null, eligibility: null } as const;

describe('cmxReader on real fixtures', () => {
	it('Germering (Programmbereich): six test teasers, DTZ teasers skipped, status from the seat light', () => {
		const at = (id: string) => `https://vhs-germering.de/Veranstaltung/${id}.html`;
		const booked = { place: 'Germering', status: 'booked_out', ...fields } as const;
		const free = { place: 'Germering', status: 'free', ...fields } as const;
		expect(run(GERMERING)).toEqual({
			kind: 'ok',
			listings: [
				{ date: '2026-11-30', time: '09:30', ...booked, source_url: at('cmx69e9f9b45dd7f') },
				{ date: '2026-11-30', time: '10:45', ...booked, source_url: at('cmx6a3509f46e300') },
				{ date: '2026-11-30', time: '12:00', ...booked, source_url: at('cmx6a350a72ed754') },
				{ date: '2027-02-22', time: '09:30', ...free, source_url: at('cmx6a350c1f60314') },
				{ date: '2027-02-22', time: '10:45', ...free, source_url: at('cmx6a350c9fba40d') },
				{ date: '2027-02-22', time: '12:00', ...free, source_url: at('cmx6a350ccf44bef') },
			],
		});
	});

	it('Dachau (Artikel): twelve `div` teasers whose titles carry the date, all with seats free', () => {
		const listings = listingsOf(run(DACHAU));
		expect(listings).toHaveLength(12);
		expect(listings[0]).toEqual({ date: '2027-01-20', time: '15:00', place: 'Dachau', status: 'free', ...fields, source_url: 'https://vhs-dachau.de/Veranstaltung/cmx6acf3363c17c1.html' });
		expect(listings[11]).toMatchObject({ date: '2027-11-24', time: '16:30', status: 'free' });
		expect(new Set(listings.map((l) => l.status))).toEqual(new Set(['free']));
	});

	it('Buchloe: an ended ("Beendet") teaser is skipped; status_100 → booked_out, "noch 3 Plätze frei" → free', () => {
		expect(listingsOf(run(BUCHLOE)).map((l) => [l.date, l.time, l.status])).toEqual([
			['2026-11-21', '09:30', 'booked_out'],
			['2027-02-06', '09:30', 'free'],
		]);
	});

	it('an ended teaser that is not marked "Beendet" is listed, "noch 1 Platz frei" → free', () => {
		const result = runEdited(BUCHLOE, [['Klasse beendet Beendet', 'Klasse ']]);
		expect(listingsOf(result)[0]).toMatchObject({ date: '2026-10-17', time: '09:30', status: 'free' });
	});

	it('every listing is schema-valid and carries no extra keys', () => {
		for (const fc of [GERMERING, DACHAU, BUCHLOE]) {
			for (const listing of listingsOf(run(fc))) expect(rawListingSchema.parse(listing)).toEqual(listing);
		}
	});

	it('source_url resolves against the list page finalUrl after a redirect', () => {
		const url = BUCHLOE.centre.test_page_url!;
		const result = runReaderOnFixtures(cmxReader, BUCHLOE.centre, { [url]: { file: BUCHLOE.file, finalUrl: 'https://www.vhs-buchloe.de/x/y.html' } }, CTX, FIXTURES_DIR);
		expect(listingsOf(result)[0]!.source_url).toBe('https://www.vhs-buchloe.de/Veranstaltung/cmx69c2693f569c7.html');
	});
});

describe('matrix', () => {
	it('CMX container without test teasers (Kempten Programmbereich) → ok with no listings', () => {
		expect(run(KEMPTEN)).toEqual({ kind: 'ok', listings: [] });
	});

	it('CMX homepage without a Programmbereich or Artikel container → failed(structure-missing)', () => {
		expect(run(HOMEPAGE)).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it.each([
		['kuferweb/fixtures/moosburg/list.html'],
		['kuferweb/fixtures/aichach/G40108-17.html'],
		['kuferweb/fixtures/structure-missing/list.html'],
		['itemkg/fixtures/starnberg/list.html'],
		['itemkg/fixtures/mvhs/X674130.html'],
		['itemkg/fixtures/structure-missing/list.html'],
	])('non-CMX page %s → failed(structure-missing)', (file) => {
		const c = centre('x', 'https://example.de/l');
		expect(runReaderOnFixtures(cmxReader, c, { 'https://example.de/l': { file } }, CTX, READERS_DIR)).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('list page without html → failed(structure-missing)', () => {
		const list: FetchedPage = { url: 'https://example.de/l', role: 'list', status: 200, html: null, finalUrl: null };
		expect(cmxReader.parse([list], centre('x', 'https://example.de/l'), CTX)).toEqual({ kind: 'failed', reason: 'structure-missing' });
	});

	it('"Deutsch-Test für Zuwanderer" and "Leben in Deutschland" teasers are no listings; a preparation course neither', () => {
		const result = runEdited(BUCHLOE, [
			['Klasse beendet Beendet', 'Klasse '],
			['<span>Einbürgerungstest</span></span><span class="Nummer">S700.262', '<span>Deutsch-Test für Zuwanderer</span></span><span class="Nummer">S700.262'],
			['<span>Einbürgerungstest</span></span><span class="Nummer">S701.262', '<span>Test „Leben in Deutschland“</span></span><span class="Nummer">S701.262'],
			['<span>Einbürgerungstest</span></span><span class="Nummer">S702.262', '<span>Vorbereitung auf den Einbürgerungstest</span></span><span class="Nummer">S702.262'],
		]);
		expect(result).toEqual({ kind: 'ok', listings: [] });
	});

	it('a teaser that mentions Einbürgerung without naming the test ("Infoabend Einbürgerung", "Einbürgerungsfeier") is no listing', () => {
		const result = runEdited(BUCHLOE, [
			['<span>Einbürgerungstest</span></span><span class="Nummer">S701.262', '<span>Infoabend Einbürgerung</span></span><span class="Nummer">S701.262'],
			['<span>Einbürgerungstest</span></span><span class="Nummer">S702.262', '<span>Einbürgerungsfeier</span></span><span class="Nummer">S702.262'],
		]);
		expect(result).toEqual({ kind: 'ok', listings: [] });
	});

	it('the same test teaser shown twice gives one listing', () => {
		const html = readFileSync(join(FIXTURES_DIR, BUCHLOE.file), 'utf8');
		const start = html.indexOf('<li id="cmx69c2693fd3a78"');
		const end = html.indexOf('</li>', start) + '</li>'.length;
		const teaser = html.slice(start, end);
		expect(teaser.startsWith('<li')).toBe(true);
		const listings = listingsOf(runEdited(BUCHLOE, [[teaser, teaser + teaser]]));
		expect(listings.filter((l) => l.source_url.endsWith('cmx69c2693fd3a78.html'))).toHaveLength(1);
	});

	it('a test teaser without a start time element → a listing with time null (Story 3.10)', () => {
		const result = runEdited(BUCHLOE, [['<span class="Datum">21.11.26</span><span class="AnzahlTermine"> (1-mal) </span> <span class="Uhrzeit"> <span class="UhrzeitBeginn"> 09:30</span>', '<span class="Datum">21.11.26</span><span class="AnzahlTermine"> (1-mal) </span> <span class="Uhrzeit"> ']]);
		expect(listingsOf(result).find((l) => l.date === '2026-11-21')).toMatchObject({ date: '2026-11-21', time: null });
	});

	it('a test teaser with a blank start time → a listing with time null (Story 3.10)', () => {
		const result = runEdited(BUCHLOE, [['<span class="UhrzeitBeginn"> 09:30</span>', '<span class="UhrzeitBeginn">  </span>']]);
		expect(listingsOf(result).find((l) => l.date === '2026-11-21')).toMatchObject({ date: '2026-11-21', time: null });
	});

	it('a test teaser whose start time text cannot be read → failed(date-unparseable)', () => {
		const result = runEdited(BUCHLOE, [['<span class="UhrzeitBeginn"> 09:30</span>', '<span class="UhrzeitBeginn"> vormittags</span>']]);
		expect(result).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('a test teaser whose date is no real date → failed(date-unparseable)', () => {
		expect(runEdited(BUCHLOE, [['<span class="Datum">21.11.26</span>', '<span class="Datum">31.11.26</span>']])).toEqual({ kind: 'failed', reason: 'date-unparseable' });
	});

	it('an empty seat light → unknown; a waitlist light → waitlist', () => {
		const listings = listingsOf(
			runEdited(BUCHLOE, [
				['<span title="noch 3 Plätze frei">', '<span>'],
				['alt="noch 3 Plätze frei"', 'alt=""'],
				['<span>(noch 3 Plätze frei) </span>', '<span></span>'],
				['<span>(keine freien Plätze. Eine Anmeldung ist nicht mehr möglich.) </span>', '<span>(Anmeldung auf Warteliste möglich) </span>'],
			]),
		);
		expect(listings.map((l) => l.status)).toEqual(['waitlist', 'unknown']);
	});

	it('no test_page_url and no reader_config → no list URLs', () => {
		expect(cmxReader.plan(centre('x', null)).listUrls).toEqual([]);
	});
});

describe('plan', () => {
	it('uses reader_config.list_url over test_page_url, and fetches no detail page', () => {
		expect(cmxReader.plan(centre('x', 'https://a.de/test')).listUrls).toEqual(['https://a.de/test']);
		expect(cmxReader.plan(centre('x', 'https://a.de/test', { reader_config: { list_url: 'https://a.de/list' } })).listUrls).toEqual(['https://a.de/list']);
		const plan = cmxReader.plan(GERMERING.centre);
		expect(plan.maxDetailPages).toBe(0);
		const html = readFileSync(join(FIXTURES_DIR, GERMERING.file), 'utf8');
		expect(selectDetailUrls(plan, [{ url: 'https://vhs-germering.de/', role: 'list', status: 200, html, finalUrl: null }])).toEqual([]);
	});
});

describe('status signals', () => {
	it.each([
		['keine freien Plätze. Eine Anmeldung ist nicht mehr möglich.', null, 'booked_out'],
		['', '/cmx/ordner/system/Veranstaltung/Icons/Ampel/Fortschrittsanzeige/status_100.svg', 'booked_out'],
		['Plätze frei', '/x/status_25.svg', 'free'],
		['noch 1 Platz frei', '/x/status_75.svg', 'free'],
		['noch 3 Plätze frei', null, 'free'],
		['Anmeldung auf Warteliste', '/x/status_100.svg', 'waitlist'],
		['Warteliste ist voll', '/x/status_100.svg', 'booked_out'],
		['', '/x/status_0.svg', 'unknown'],
		['', null, 'unknown'],
		['', '/x/status_100.svg 1x, /x/status_100@2x.svg 2x', 'booked_out'],
		['', '/x/status_100.svg?v=3', 'booked_out'],
		['', '/x/status_1000.svg', 'unknown'],
	] as const)('label %j, icon %j → %s', (label, icon, status) => {
		expect(mapStatus(ampelSignals(label, icon))).toBe(status);
	});
});

describe('directory', () => {
	const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
	const centres = JSON.parse(readFileSync(join(ROOT, 'data/directory/centres.json'), 'utf8')) as Centre[];
	const note = readFileSync(join(ROOT, 'data/directory/cmx-note.md'), 'utf8');

	it('every cmx centre has a test page and verified_at, and matches the Confirmed table of cmx-note.md', () => {
		const confirmed = note
			.split('## Proposed')[0]!
			.split('\n')
			.map((line) => /^\| `([^`]+)` \| (\S+) \| (\d{4}-\d{2}-\d{2}) \|$/.exec(line))
			.filter((match) => match !== null)
			.map((match) => ({ id: match[1]!, url: match[2]!, date: match[3]! }));
		const cmx = centres.filter((c) => c.reader === 'cmx');
		for (const c of cmx) {
			expect(c.test_page_url).not.toBeNull();
			expect(c.verified_at).not.toBeNull();
		}
		expect(cmx.map((c) => ({ id: c.centre_id, url: c.test_page_url, date: c.verified_at!.slice(0, 10) }))).toEqual(confirmed);
	});

	it('the fixture centres use their directory test pages', () => {
		for (const fc of [GERMERING, DACHAU, BUCHLOE, KEMPTEN]) {
			expect(centres.find((c) => c.centre_id === fc.centre.centre_id)?.test_page_url).toBe(fc.centre.test_page_url);
		}
	});
});
