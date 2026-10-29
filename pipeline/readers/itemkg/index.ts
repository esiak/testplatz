/**
 * ITEM KG (TYPO3 `itemkg_connect`) reader. The list page is the centre's course list (a category
 * or a search-word page, `#category-courses`); every course on it is a `.course-item` card with
 * the title, the date and the booking flags (`i.bk-icon` classes). One listing is read per dated
 * Einbürgerungstest row: date, time and flags from the row, venue, start-time fallback, deadline,
 * registration text and eligibility from the row's detail page (`.course-show-wrap`). Pure (AD-4):
 * no I/O, no clock, failures returned as values.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { Centre } from '../../../shared/directory.ts';
import { clampEligibility, isLocalDate, isLocalTime, mapStatus, type RawListing, type RegistrationMethod, type StatusSignals } from '../../../shared/listing.ts';
import type { FetchedPage, ParseResult, Reader, ReaderPlan } from '../../../shared/reader.ts';

/** Per-centre cap on detail pages (one per test date). */
export const ITEMKG_MAX_DETAIL_PAGES = 30;

/** An ITEM KG course list; a list page without one is not a page this reader knows. */
const LIST_CONTAINER = '#category-courses, .category-courses-container';
const DETAIL_CONTAINER = '.course-show-wrap';
const ROW = '.course-item';
const TEST_TITLE = /einb(ü|ue)rgerungstest/i;
const PREPARATION = /vorbereitung/i;

// ---------------------------------------------------------------------------------------------
// Text helpers (copied from the KuferWeb reader; readers never import each other)
// ---------------------------------------------------------------------------------------------

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The DOM node shape cheerio hands out (domhandler), reduced to what the line walker reads. */
interface DomNode {
	type: string;
	name?: string;
	data?: string;
	children?: DomNode[];
}

/** Elements that start a new line in rendered text. */
const LINE_BREAKING = new Set([
	'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
	'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
	'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'iframe']);

/** The element's text as rendered lines: block elements and `<br>` break lines; blank lines dropped. */
function textLines(root: DomNode | undefined): string[] {
	const lines: string[] = [];
	let current = '';
	const flush = () => {
		const line = collapse(current);
		if (line !== '') lines.push(line);
		current = '';
	};
	const walk = (node: DomNode) => {
		if (node.type === 'text') {
			current += node.data ?? '';
			return;
		}
		if (node.type !== 'tag' && node.type !== 'root') return;
		const name = node.name ?? '';
		if (SKIPPED.has(name)) return;
		const breaks = LINE_BREAKING.has(name);
		if (breaks) flush();
		for (const child of node.children ?? []) walk(child);
		if (breaks) flush();
	};
	if (root !== undefined) walk(root);
	flush();
	return lines;
}

type Selection = ReturnType<CheerioAPI>;

/** Rendered lines of every element in `selection`, in document order. */
const linesOf = (selection: Selection): string[] => selection.toArray().flatMap((element) => textLines(element as unknown as DomNode));

const DATE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/;
const TIME = /(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/;

/** `D.M.YY(YY)` as `YYYY-MM-DD` (2-digit years are 20YY), or null when not a real date. */
function toLocalDate(day: string, month: string, year: string): string | null {
	const fullYear = year.length === 2 ? `20${year}` : year;
	const date = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
	return isLocalDate(date) ? date : null;
}

/**
 * The first `HH:MM` time in `text` as `HH:mm`, or null. `00:00` is ITEM KG's all-day placeholder
 * ("00:00 - 23:59 Uhr"), not a start time, so it reads as no time.
 */
function findTime(text: string): string | null {
	const match = TIME.exec(text);
	if (match === null) return null;
	const time = `${match[1]!.padStart(2, '0')}:${match[2]!}`;
	return isLocalTime(time) && time !== '00:00' ? time : null;
}

// ---------------------------------------------------------------------------------------------
// Test rows (the one rule used by plan and parse)
// ---------------------------------------------------------------------------------------------

const pageBase = (page: FetchedPage): string => page.finalUrl ?? page.url;

/** The absolute http(s) URL of `href` against `base`, fragment dropped; null when it does not resolve. */
function resolveUrl(href: string, base: string): string | null {
	if (!URL.canParse(href, base)) return null;
	const url = new URL(href, base);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	url.hash = '';
	return url.href;
}

/** One dated Einbürgerungstest row of a list page. */
interface TestRow {
	$: CheerioAPI;
	row: Selection;
	url: string;
	/** The row's date as `YYYY-MM-DD`; null when the date text holds no real `D.M.YYYY` date. */
	date: string | null;
	time: string | null;
}

function testRows($: CheerioAPI, base: string): TestRow[] {
	const rows: TestRow[] = [];
	$(ROW).each((_, element) => {
		const row = $(element);
		const title = collapse(row.find('.course-title').first().text());
		if (!TEST_TITLE.test(title) || PREPARATION.test(title)) return;
		const dateText = collapse(row.find('.course-list-item-date').first().text());
		if (dateText === '') return; // "dates on request"
		const match = DATE.exec(dateText);
		const href = row.find('a.card-list-item[href]').first().attr('href');
		const url = href === undefined ? null : resolveUrl(href, base);
		if (url === null) return;
		if (match === null) {
			rows.push({ $, row, url, date: null, time: null }); // a date text that is no D.M.YYYY
			return;
		}
		const time = findTime(dateText.slice(match.index + match[0].length));
		rows.push({ $, row, url, date: toLocalDate(match[1]!, match[2]!, match[3]!), time });
	});
	return rows;
}

function selectDetailUrls(listPages: readonly FetchedPage[]): string[] {
	return listPages.flatMap((page) => (page.html === null ? [] : testRows(load(page.html), pageBase(page)).map((row) => row.url)));
}

// ---------------------------------------------------------------------------------------------
// Flags, registration method and status
// ---------------------------------------------------------------------------------------------

const TYPES = ['bk-bookable', 'bk-byphone', 'bk-written', 'bk-inperson', 'bk-notbookable'] as const;
const AVAILABILITIES = ['bk-av-enough', 'bk-av-few', 'bk-av-soldout'] as const;
const CLOSED_REASONS = new Set(['bk-rs-registrationdeadlineexpired', 'bk-rs-coursecompleted', 'bk-rs-coursealreadystarted']);

/** The booking flags of one `i.bk-icon`. */
export interface Flags {
	type: (typeof TYPES)[number] | null;
	availability: (typeof AVAILABILITIES)[number] | null;
	reasons: string[];
	emailHint: boolean;
}

/** The flags in an `i.bk-icon` class list. */
export function iconFlags(classes: readonly string[]): Flags {
	return {
		type: TYPES.find((type) => classes.includes(type)) ?? null,
		availability: AVAILABILITIES.find((availability) => classes.includes(availability)) ?? null,
		reasons: classes.filter((name) => name.startsWith('bk-rs-')),
		emailHint: classes.includes('bk-hint-e-mail_registration'),
	};
}

const IN_PERSON = /nur persönlich|ausschließlich persönlich|Anmeldung erfolgt persönlich|Persönliche Anmeldung|nur persönliche Anmeldung|persönlich entgegengenommen/i;
const ABOUT_REGISTRATION = /Anmeld/i;
const BY_EMAIL = /per\s+(E-?)?Mail/i;
const BY_POST = /per\s+Post|postalisch/i;

/** Sentences of the text lines; a period after a digit ("bis 22.10. nur …") does not end one. */
const sentences = (lines: readonly string[]): string[] => lines.flatMap((line) => line.split(/(?<=(?:^|\D)[.!?])\s+/));

/**
 * The registration method from the flags, else from the registration text (row `.bk-text`, row
 * `.course-content`, detail text). First match wins: online, in person, e-mail hint, then
 * in-person / e-mail / post wording in a sentence about registering; else null.
 */
export function registrationMethodOf(flags: Flags | null, texts: readonly string[]): RegistrationMethod | null {
	if (flags?.type === 'bk-bookable') return 'online';
	if (flags?.type === 'bk-inperson') return 'in_person';
	if (flags?.type === 'bk-written' && flags.emailHint) return 'email';
	const about = sentences(texts).filter((sentence) => ABOUT_REGISTRATION.test(sentence));
	if (about.some((sentence) => IN_PERSON.test(sentence))) return 'in_person';
	if (about.some((sentence) => BY_EMAIL.test(sentence))) return 'email';
	if (about.some((sentence) => BY_POST.test(sentence))) return 'post';
	return null;
}

/**
 * Whether `text` offers a waitlist: "Warteliste(n)" not negated in the 25 chars before it (within
 * its sentence) or right after it.
 */
export function hasWaitlistOffer(text: string): boolean {
	for (const match of text.matchAll(/Wartelisten?/gi)) {
		const window = text.slice(Math.max(0, match.index - 25), match.index);
		const before = window.slice(Math.max(...['.', '!', '?', '\n'].map((end) => window.lastIndexOf(end))) + 1);
		const after = text.slice(match.index + match[0].length);
		if (/\b(keine?|nicht)\b/i.test(before)) continue;
		if (/^\s*((ist|sind|wird|werden)\s+)?(voll|geschlossen|nicht)\b/i.test(after)) continue;
		return true;
	}
	return false;
}

/**
 * Status signals (FR10) for the flags. In-person-only registration or no icon → no signal;
 * not bookable or sold out → booked out; a bookable type with seats and no closing reason → free;
 * a waitlist offer counts only on a booked-out date.
 */
export function flagSignals(flags: Flags | null, method: RegistrationMethod | null, waitlistOffer: boolean): StatusSignals {
	if (flags === null || method === 'in_person') return {};
	const signals: StatusSignals = {};
	if (flags.type === 'bk-notbookable' || flags.availability === 'bk-av-soldout') signals.bookedOut = true;
	const bookable = flags.type === 'bk-bookable' || flags.type === 'bk-byphone' || flags.type === 'bk-written';
	const seats = flags.availability === 'bk-av-enough' || flags.availability === 'bk-av-few';
	if (bookable && seats && !flags.reasons.some((reason) => CLOSED_REASONS.has(reason))) signals.free = true;
	if (waitlistOffer && signals.bookedOut === true) signals.waitlist = true;
	return signals;
}

const classesOf = (icon: Selection): string[] | null => (icon.length === 0 ? null : (icon.attr('class') ?? '').split(/\s+/).filter((name) => name !== ''));

// ---------------------------------------------------------------------------------------------
// Detail fields
// ---------------------------------------------------------------------------------------------

/** The first `HH:MM` after `date` in the detail page's `Start` block; else null. */
function startTime($: CheerioAPI, wrap: Selection, date: string): string | null {
	let time: string | null = null;
	wrap.find('*').each((_, element) => {
		const label = $(element);
		if (label.children().length > 0 || collapse(label.text()) !== 'Start') return;
		const block = collapse(label.parent().text());
		const match = DATE.exec(block);
		if (match === null || toLocalDate(match[1]!, match[2]!, match[3]!) !== date) return;
		const found = findTime(block.slice(match.index + match[0].length));
		if (found !== null) {
			time = found;
			return false;
		}
		return;
	});
	return time;
}

/** Whether `token` occurs in `text` as a whole token (not inside a longer word or number). */
const containsToken = (text: string, token: string): boolean =>
	new RegExp(`(?<![\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text);

/** Place and address from the first `.venueContainer`, else the row's location text. */
function placeAndAddress(wrap: Selection, row: Selection): { place: string | null; address: string | null } {
	const venue = wrap.find('.venueContainer').first();
	if (venue.length === 0) {
		const location = collapse(row.find('.course-list-item-location').first().text());
		return { place: location === '' ? null : location, address: null };
	}
	const name = collapse(venue.find('.venueName').first().text());
	const number = collapse(venue.find('.venueNumber').first().text()).replace(/^Raum\s*/i, '');
	let place: string | null = name === '' ? null : name;
	if (place !== null && number !== '' && !containsToken(place, number)) place = `${place}, Raum ${number}`;
	const street = collapse(venue.find('.venueStreet').first().text());
	const city = collapse(venue.find('.venueCity').first().text());
	const address = street !== '' && /^\d{5}\s+\S/.test(city) ? `${street}, ${city}` : null;
	return { place, address };
}

const DEADLINES = [
	/Anmeldeschlu(?:ss|ß)\s*:?\s*(?:ist\s+der\s+|ist\s+am\s+|am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/g,
	/Anmeldung\s+(?:und\s+Beratung\s+)?bis\s+(?:zum\s+|spätestens\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g,
];

/** The first stated registration deadline in `text` that is a real date, or null. */
function deadlineIn(text: string): string | null {
	const found = DEADLINES.flatMap((pattern) => [...text.matchAll(pattern)]).sort((a, b) => a.index - b.index);
	for (const match of found) {
		const date = toLocalDate(match[1]!, match[2]!, match[3]!);
		if (date !== null) return date;
	}
	return null;
}

const RULE = /\b(Haupt)?Wohnsitz\b|\bwohnhaft\b|\b(nur|ausschließlich) für\b|(nur|ausschließlich)\b.*\bTeilnehmende/i;
const NOT_RULE = /Merkliste|eingeloggt/i;
const LEAF_CANDIDATES = 'p, li, td, dd, div, span';
const BLOCK_CHILDREN = 'p, div, li, td, th, tr, table, tbody, ul, ol, dl, dd, dt, h1, h2, h3, h4, h5, h6, section, article, form, blockquote';
const OUTSIDE_LIST_RULE = `${ROW}, header, nav, footer`;

/** The first leaf block in `blocks` that states who may register, verbatim. */
function eligibilityIn($: CheerioAPI, blocks: Selection): string | null {
	let found: string | null = null;
	blocks.each((_, element) => {
		const block = $(element);
		if (block.children(BLOCK_CHILDREN).length > 0) return;
		const text = textLines(element as unknown as DomNode).join(' ');
		if (RULE.test(text) && !NOT_RULE.test(text)) {
			found = text;
			return false;
		}
		return;
	});
	return found;
}

/** A list page's rule: leaf blocks outside every course row, header, nav and footer. */
const listRule = ($: CheerioAPI): string | null =>
	eligibilityIn($, $(LEAF_CANDIDATES).filter((_, element) => $(element).closest(OUTSIDE_LIST_RULE).length === 0));

// ---------------------------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------------------------

const failed = (reason: string): ParseResult => ({ kind: 'failed', reason });
const isOk = (status: number | null): boolean => status !== null && status >= 200 && status < 300;
const pageKey = (url: string): string => (URL.canParse(url) ? new URL(url).href.replace(/#.*$/, '') : url);

function parse(pages: readonly FetchedPage[]): ParseResult {
	const lists: CheerioAPI[] = [];
	const rows: TestRow[] = [];
	for (const page of pages.filter((p) => p.role === 'list')) {
		if (page.html === null) return failed('structure-missing');
		const $ = load(page.html);
		if ($(LIST_CONTAINER).length === 0) return failed('structure-missing');
		lists.push($);
		rows.push(...testRows($, pageBase(page)));
	}
	if (rows.length === 0) return { kind: 'ok', listings: [] };

	const detailPages = new Map<string, FetchedPage>();
	for (const page of pages.filter((p) => p.role === 'detail')) {
		const key = pageKey(page.url);
		if (!detailPages.has(key)) detailPages.set(key, page);
	}
	const pagesOfRows = rows.map((row) => detailPages.get(row.url));
	if (pagesOfRows.some((page) => page === undefined || !isOk(page.status) || page.html === null)) return failed('detail-page');
	const details = new Map<FetchedPage, { $: CheerioAPI; wrap: Selection }>();
	for (const page of pagesOfRows as FetchedPage[]) {
		if (details.has(page)) continue;
		const $ = load(page.html!);
		const wrap = $(DETAIL_CONTAINER).first();
		if (wrap.length === 0) return failed('structure-missing');
		details.set(page, { $, wrap });
	}

	const pageRule = lists.map(listRule).find((rule) => rule !== null) ?? null;
	const listings: RawListing[] = [];
	for (const [index, row] of rows.entries()) {
		const page = pagesOfRows[index]!;
		const { $, wrap } = details.get(page)!;
		if (row.date === null) return failed('date-unparseable');
		const time = row.time ?? startTime($, wrap, row.date);
		if (time === null) return failed('date-unparseable');

		const detailLines = textLines(wrap.get(0) as unknown as DomNode);
		const rowLines = textLines(row.row.get(0) as unknown as DomNode);
		const classes = classesOf(row.row.find('i.bk-icon').first()) ?? classesOf(wrap.find('i.bk-icon').first());
		const flags = classes === null ? null : iconFlags(classes);
		const registrationTexts = [...linesOf(row.row.find('.bk-text')), ...linesOf(row.row.find('.course-content')), ...detailLines];
		const method = registrationMethodOf(flags, registrationTexts);
		const waitlistOffer = hasWaitlistOffer([...rowLines, ...detailLines].join('\n'));

		listings.push({
			date: row.date,
			time,
			...placeAndAddress(wrap, row.row),
			status: mapStatus(flagSignals(flags, method, waitlistOffer)),
			deadline: deadlineIn(detailLines.join(' ')) ?? deadlineIn(rowLines.join(' ')),
			registration_method: method,
			eligibility: clampEligibility(eligibilityIn($, wrap.find(LEAF_CANDIDATES)) ?? pageRule),
			source_url: pageBase(page),
		});
	}
	return { kind: 'ok', listings };
}

export const itemkgReader: Reader = {
	plan(centre: Centre): ReaderPlan {
		const listUrl = centre.reader_config?.list_url ?? centre.test_page_url;
		return { listUrls: listUrl === null ? [] : [listUrl], selectDetailUrls, maxDetailPages: ITEMKG_MAX_DETAIL_PAGES };
	},
	parse: (pages) => parse(pages),
};
