/**
 * CMX reader: VHS sites built on the "CMX" CMS (pages load `/cmx/interpreter/js/index.js`, ids
 * `cmx<hex>`). The list page is the centre's test page, a `Programmbereich` (`.ProgrammheftInhalt`)
 * or an `Artikel` (`.ArtikelContainer`); each course on it is a `.Veranstaltung.Teaser` (an `li` in a
 * Programmbereich, a `div` in an Artikel) carrying the title (`.Name`), the first date (`.Datum`,
 * `dd.mm.yy`), the start time (`.UhrzeitBeginn`), the town (`.Ort`) and the seat light
 * (`.Ampelanzeige`). One listing is read per Einbürgerungstest teaser from the list page alone; no
 * detail page is fetched. Pure (AD-4): no I/O, no clock, failures returned as values.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { Centre } from '../../../shared/directory.ts';
import { isLocalDate, isLocalTime, mapStatus, type RawListing, type StatusSignals } from '../../../shared/listing.ts';
import type { FetchedPage, ParseResult, Reader, ReaderPlan } from '../../../shared/reader.ts';

/**
 * The CMX content container of a Programmbereich or an Artikel page (the `body` carries the page's
 * own `cmx<hex>` id); a list page without one, such as a CMX homepage, is not a page this reader knows.
 */
const CONTAINER = [
	'body.Programmbereich[id^="cmx"] #content .ProgrammheftInhalt',
	'body.Artikel[id^="cmx"] #content > article.Artikel > .ArtikelContainer',
].join(', ');
const TEASER = '.Veranstaltung.Teaser';
/** The title must name the Einbürgerungstest (not an info evening or ceremony), and not a course preparing for it. */
const TEST_TITLE = /einb(ü|ue|u)rgerungstest/i;
const PREPARATION = /vorbereitung/i;

type Selection = ReturnType<CheerioAPI>;

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const DATE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/;
const TIME = /(?<![\d.:])(\d{1,2})[:.](\d{2})(?![\d.:]?\d)/;

/** The first `D.M.YY(YY)` date in `text` as `YYYY-MM-DD` (2-digit years are 20YY), or null. */
function findDate(text: string): string | null {
	const match = DATE.exec(text);
	if (match === null) return null;
	const year = match[3]!.length === 2 ? `20${match[3]!}` : match[3]!;
	const date = `${year}-${match[2]!.padStart(2, '0')}-${match[1]!.padStart(2, '0')}`;
	return isLocalDate(date) ? date : null;
}

/** The first `HH:MM` / `HH.MM` time in `text` as `HH:mm`, or null. */
function findTime(text: string): string | null {
	const match = TIME.exec(text);
	if (match === null) return null;
	const time = `${match[1]!.padStart(2, '0')}:${match[2]!}`;
	return isLocalTime(time) ? time : null;
}

const NEGATED_WAITLIST = /(keine|kein)\s+(\S+\s+){0,3}Warteliste|Warteliste\s+(ist\s+|wird\s+)?(nicht|keine|voll|ausgebucht|geschlossen)/i;

/**
 * Status signals of one seat light: its text, its `title`/`alt` texts and the icon file name.
 * `status_100` or "keine freien Plätze" / "ausgebucht" → booked out; "Plätze frei" / "noch 1 Platz
 * frei" → free; a waitlist mention not negated → waitlist; nothing → no signal.
 */
export function ampelSignals(label: string, iconSrc: string | null): StatusSignals {
	const signals: StatusSignals = {};
	if (/Warteliste/i.test(label) && !NEGATED_WAITLIST.test(label)) signals.waitlist = true;
	if (/(^|\/)status_100\.\w+(?=$|[\s,?])/.test(iconSrc ?? '') || /keine\s+freien\s+Pl(ä|ae)tze|ausgebucht/i.test(label)) signals.bookedOut = true;
	if (/\bPl(ätze|aetze|atz)\s+frei\b/i.test(label) && !/keine\s+freien/i.test(label)) signals.free = true;
	return signals;
}

function ampelOf(teaser: Selection): StatusSignals {
	const ampel = teaser.find('.Ampelanzeige').first();
	const titles: string[] = [];
	ampel.find('[title], img[alt]').each((_, element) => {
		const node = teaser.find(element);
		titles.push(node.attr('title') ?? '', node.attr('alt') ?? '');
	});
	const label = collapse([ampel.text(), ...titles].join(' '));
	const src = ampel.find('img[src]').first().attr('src') ?? ampel.find('source[srcset]').first().attr('srcset') ?? null;
	return ampelSignals(label, src);
}

const pageBase = (page: FetchedPage): string => page.finalUrl ?? page.url;

/** The absolute http(s) URL of `href` against `base`, fragment dropped; null when it does not resolve. */
function resolveUrl(href: string, base: string): string | null {
	if (!URL.canParse(href, base)) return null;
	const url = new URL(href, base);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	url.hash = '';
	return url.href;
}

const failed = (reason: string): ParseResult => ({ kind: 'failed', reason });

/** Listings of one list page's Einbürgerungstest teasers, or the failure reason. */
function teaserListings($: CheerioAPI, base: string): RawListing[] | string {
	const listings: RawListing[] = [];
	const seen = new Set<string>();
	for (const element of $(CONTAINER).find(TEASER).toArray()) {
		const teaser = $(element);
		if (teaser.hasClass('Beendet')) continue; // the course is over
		const title = collapse(teaser.find('.Name').first().text());
		if (!TEST_TITLE.test(title) || PREPARATION.test(title)) continue;
		const link = teaser.find('a[href]').first().attr('href');
		const sourceUrl = (link === undefined ? null : resolveUrl(link, base)) ?? base;
		const date = findDate(teaser.find('.Datum').first().text());
		// A start time is required (`RawListing.time`); a teaser without one cannot be listed.
		const time = findTime(teaser.find('.UhrzeitBeginn').first().text());
		if (date === null || time === null) return 'date-unparseable';
		const key = `${sourceUrl} ${date} ${time}`;
		if (seen.has(key)) continue; // the same teaser shown twice on the page
		seen.add(key);
		const place = collapse(teaser.find('.Ort').first().text());
		listings.push({
			date,
			time,
			place: place === '' ? null : place,
			address: null,
			status: mapStatus(ampelOf(teaser)),
			deadline: null,
			registration_method: null,
			eligibility: null,
			source_url: sourceUrl,
		});
	}
	return listings;
}

function parse(pages: readonly FetchedPage[]): ParseResult {
	const listings: RawListing[] = [];
	for (const page of pages.filter((p) => p.role === 'list')) {
		if (page.html === null) return failed('structure-missing');
		const $ = load(page.html);
		if ($(CONTAINER).length === 0) return failed('structure-missing');
		const found = teaserListings($, pageBase(page));
		if (typeof found === 'string') return failed(found);
		listings.push(...found);
	}
	return { kind: 'ok', listings };
}

export const cmxReader: Reader = {
	plan(centre: Centre): ReaderPlan {
		const listUrl = centre.reader_config?.list_url ?? centre.test_page_url;
		return { listUrls: listUrl === null ? [] : [listUrl], selectDetailUrls: () => [], maxDetailPages: 0 };
	},
	parse: (pages) => parse(pages),
};
