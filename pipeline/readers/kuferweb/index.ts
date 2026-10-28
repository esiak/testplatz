/**
 * KuferWeb (TYPO3 "webbasys") reader. The list page is the centre's test page (an Einbürgerungstest
 * or wider language category); each Einbürgerungstest course on it has a detail page under `/kurs/`, and one listing is
 * read per detail page from the shared detail template (`.kw-kursdetails`, the `Beginn`/`Kursort`
 * labels and the `.kw-kurstageuebersicht` session table). List rows are used only for the links
 * and their traffic-light labels. Pure (AD-4): no I/O, no clock, failures returned as values.
 */
import { load, type CheerioAPI } from 'cheerio';
import type { Centre } from '../../../shared/directory.ts';
import { clampEligibility, isLocalDate, isLocalTime, mapStatus, type RawListing, type RegistrationMethod, type StatusSignals } from '../../../shared/listing.ts';
import type { FetchedPage, ParseResult, Reader, ReaderPlan } from '../../../shared/reader.ts';

/** Per-centre cap on detail pages (one per test date). */
export const KUFERWEB_MAX_DETAIL_PAGES = 30;

/** A KuferWeb course list; a list page without one is not a page this reader knows. */
const LIST_CONTAINER = '.kw-kursuebersicht, .kw-kat-kurs-ueb, .hauptseite_kurse';
const DETAIL_CONTAINER = '.kw-kursdetails';
const SESSION_TABLE = '.kw-kurstageuebersicht';
const TRAFFIC_LIGHT = '[class*="ampel"]';
/** Matched against the decoded course title segment right after `/kurs/`. */
const TEST_TITLE = /einb(ue|ü)rger/i;

// ---------------------------------------------------------------------------------------------
// Text helpers
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

const DATE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/;
const TIME = /(?<![\d.:])(\d{1,2})[:.](\d{2})(?![\d.:]?\d)/;

/** `D.M.YY(YY)` as `YYYY-MM-DD` (2-digit years are 20YY), or null when not a real date. */
function toLocalDate(day: string, month: string, year: string): string | null {
	const fullYear = year.length === 2 ? `20${year}` : year;
	const date = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
	return isLocalDate(date) ? date : null;
}

/** The first date in `text` and the text after it. */
function findDate(text: string): { date: string | null; rest: string } | null {
	const match = DATE.exec(text);
	if (match === null) return null;
	return { date: toLocalDate(match[1]!, match[2]!, match[3]!), rest: text.slice(match.index + match[0].length) };
}

/** The first `HH:MM` / `HH.MM` time in `text` as `HH:mm`, or null. */
function findTime(text: string): string | null {
	const match = TIME.exec(text);
	if (match === null) return null;
	const time = `${match[1]!.padStart(2, '0')}:${match[2]!}`;
	return isLocalTime(time) ? time : null;
}

// ---------------------------------------------------------------------------------------------
// Course links
// ---------------------------------------------------------------------------------------------

/** The absolute course URL (fragment dropped) for a link, or null when it is not a `/kurs/` link. */
function courseUrl(href: string, base: string): string | null {
	if (!URL.canParse(href, base)) return null;
	const url = new URL(href, base);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (!url.pathname.includes('/kurs/')) return null;
	url.hash = '';
	return url.href;
}

/** Whether the course title segment right after `/kurs/` names an Einbürgerungstest. */
function isTestCourse(url: string): boolean {
	const { pathname } = new URL(url);
	const segment = pathname.slice(pathname.indexOf('/kurs/') + '/kurs/'.length).split('/')[0] ?? '';
	let decoded: string;
	try {
		decoded = decodeURIComponent(segment.replace(/\+/g, ' '));
	} catch {
		decoded = segment;
	}
	return TEST_TITLE.test(decoded);
}

const pageBase = (page: FetchedPage): string => page.finalUrl ?? page.url;

/** Einbürgerungstest course URLs on one list page, in document order (may repeat). */
function testLinks($: CheerioAPI, base: string): string[] {
	const urls: string[] = [];
	$('a[href]').each((_, a) => {
		const url = courseUrl($(a).attr('href') ?? '', base);
		if (url !== null && isTestCourse(url)) urls.push(url);
	});
	return urls;
}

function selectDetailUrls(listPages: readonly FetchedPage[]): string[] {
	return listPages.flatMap((page) => (page.html === null ? [] : testLinks(load(page.html), pageBase(page))));
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

const NEGATED_WAITLIST = /(keine|kein)\s+(\S+\s+){0,3}Warteliste|Warteliste\s+(ist\s+|wird\s+)?(nicht|keine|voll|ausgebucht|geschlossen)/i;

/** Signals from one traffic light (label text and classes). `nicht_buchbar` alone gives none. */
export function lightSignals(label: string, classes: readonly string[]): StatusSignals {
	const signals: StatusSignals = {};
	if (/Warteliste/i.test(label) && !NEGATED_WAITLIST.test(label)) signals.waitlist = true;
	if (/ausgebucht|\bvoll\b/i.test(label) || classes.includes('ausgebucht')) signals.bookedOut = true;
	const seatsFree = /Plätze frei|wenige Plätze/i.test(label) && !/keine\s+Plätze/i.test(label);
	const registrationOpen = /Anmeldung möglich/i.test(label) && !/Keine\s+(Online-)?Anmeldung/i.test(label);
	if (seatsFree || registrationOpen) signals.free = true;
	return signals;
}

/** Upper-case AUSGEBUCHT is a flag; lower-case needs "ist/sind (bereits|leider|schon) ausgebucht". */
const BOOKED_OUT_FLAG = /AUSGEBUCHT/;
const BOOKED_OUT_PHRASE = /\b(ist|sind)\s+((bereits|leider|schon)\s+)?ausgebucht/i;
const WAITLIST_OFFER = /Anmeldung auf (die )?Warteliste|auf die Warteliste|Warteliste (ist )?möglich/gi;

/** Signals from detail or title text: booked-out wording, and a waitlist offer (counted only with it). */
export function textSignals(text: string): { bookedOut: boolean; waitlistOffer: boolean } {
	const bookedOut = BOOKED_OUT_FLAG.test(text) || BOOKED_OUT_PHRASE.test(text);
	let waitlistOffer = false;
	for (const match of text.matchAll(WAITLIST_OFFER)) {
		const before = text.slice(Math.max(0, match.index - 25), match.index);
		const after = text.slice(match.index + match[0].length, match.index + match[0].length + 25);
		if (!/\b(keine?|nicht)\b/i.test(before) && !/\b(keine?|nicht)\b/i.test(after)) waitlistOffer = true;
	}
	return { bookedOut, waitlistOffer };
}

function mergeSignals(into: StatusSignals, from: StatusSignals): void {
	if (from.waitlist === true) into.waitlist = true;
	if (from.bookedOut === true) into.bookedOut = true;
	if (from.free === true) into.free = true;
}

/** Signals of every traffic light inside `scope`. */
function trafficLightSignals($: CheerioAPI, scope: ReturnType<CheerioAPI>): StatusSignals {
	const signals: StatusSignals = {};
	scope.find(TRAFFIC_LIGHT).each((_, element) => {
		const light = $(element);
		const image = light.find('img').first();
		const label = collapse(light.text()) || image.attr('alt') || image.attr('title') || light.attr('title') || '';
		const classes = (light.attr('class') ?? '').split(/\s+/);
		mergeSignals(signals, lightSignals(collapse(label), classes));
	});
	return signals;
}

/** What the list pages say about one course: traffic-light signals of its row and its link texts. */
interface ListRowInfo {
	signals: StatusSignals;
	titles: string[];
}

function distinctCourseUrls($: CheerioAPI, scope: ReturnType<CheerioAPI>, base: string): Set<string> {
	const urls = new Set<string>();
	scope.find('a[href]').each((_, a) => {
		const url = courseUrl($(a).attr('href') ?? '', base);
		if (url !== null) urls.add(url);
	});
	return urls;
}

/** The list row of `url`: walk up from each link while the ancestor holds that one course URL. */
function listRowInfo(lists: readonly ParsedList[], url: string): ListRowInfo {
	const info: ListRowInfo = { signals: {}, titles: [] };
	for (const { $, base } of lists) {
		$('a[href]').each((_, a) => {
			const link = $(a);
			if (courseUrl(link.attr('href') ?? '', base) !== url) return;
			info.titles.push(collapse(link.text()));
			let row = link;
			for (let parent = row.parent(); parent.length > 0 && !parent.is('body, html'); parent = parent.parent()) {
				const urls = distinctCourseUrls($, parent, base);
				if (urls.size > 1) break;
				row = parent;
				if (parent.is(LIST_CONTAINER)) break;
			}
			mergeSignals(info.signals, trafficLightSignals($, row));
		});
	}
	return info;
}

// ---------------------------------------------------------------------------------------------
// Detail fields
// ---------------------------------------------------------------------------------------------

/** Labels that end a label's value block in the detail template. */
const LABELS = new Set([
	'kursort', 'termine', 'termine zum diesen kurs', 'termin', 'datum', 'uhrzeit', 'ort', 'wo', 'beginn', 'kursbeginn', 'ende',
	'kursende', 'dauer', 'kursdauer', 'gebühr', 'kursgebühr', 'kursleitung', 'bemerkungen', 'anmeldeschluss', 'kursnummer',
	'status', 'mitzubringen / materialien', 'download der kurstermine',
]);
const INLINE_LABEL = /^([A-ZÄÖÜ][\wäöüß-]*)\s*:\s*\S/;

function isLabel(line: string): boolean {
	if (LABELS.has(line.replace(/\s*:$/, '').toLowerCase())) return true;
	const inline = INLINE_LABEL.exec(line);
	return inline !== null && inline[1] !== 'Adresse';
}

/**
 * The value of the first `label`: inline `Label: value`, or the lines after a `Label` line up to
 * the next label (a value may wrap, e.g. `Do., 05.11.2026,` / `um 09:00 Uhr`).
 */
function labelValue(lines: readonly string[], names: readonly string[]): string | null {
	for (const [index, line] of lines.entries()) {
		for (const name of names) {
			if (line === name || line === `${name}:`) {
				const value: string[] = [];
				for (const next of lines.slice(index + 1, index + 4)) {
					if (isLabel(next)) break;
					value.push(next);
				}
				return value.length === 0 ? null : value.join(' ');
			}
			// The value must start with a date (after an optional weekday), not "Beginn der Anmeldung: …".
			const inline = new RegExp(`^${name}\\s*:?\\s+((?:[A-Za-zÄÖÜäöü]{2,10}\\.?,?\\s*)?\\d.*)$`).exec(line);
			if (inline !== null) return inline[1]!;
		}
	}
	return null;
}

/** One row of the session table. */
interface Session {
	date: string | null;
	time: string | null;
	location: string | null;
}

function sessions($: CheerioAPI, details: ReturnType<CheerioAPI>): Session[] {
	const rows = details.find(`${SESSION_TABLE} .kw-table-row, ${SESSION_TABLE} tr`).filter((_, row) => {
		const element = $(row);
		return !element.hasClass('kw-table-header') && element.closest('thead').length === 0;
	});
	const result: Session[] = [];
	const seen = new Set<unknown>();
	rows.each((_, row) => {
		if (seen.has(row)) return;
		seen.add(row);
		const element = $(row);
		let cells = element.children('.kw-table-data');
		if (cells.length === 0) cells = element.children('th, td');
		const texts: string[] = [];
		const labels: (string | null)[] = [];
		cells.each((_, cell) => {
			const element = $(cell);
			const clone = element.clone();
			clone.find('.kw-table-label, .visually-hidden, .sr-only').remove();
			texts.push(collapse(clone.text()));
			// Div theme: a `.kw-table-label` inside the cell or right before it; table theme: `headers`.
			const inner = element.find('.kw-table-label').first();
			const previous = element.prev('.kw-table-label');
			const label = inner.length > 0 ? inner : previous;
			const headers = element.attr('headers');
			if (label.length > 0) labels.push(collapse(label.text()).replace(/\s*:$/, ''));
			else if (headers !== undefined) labels.push(/ort$/i.test(headers) ? 'Ort' : headers);
			else labels.push(null);
		});
		const dateIndex = texts.findIndex((text) => DATE.test(text));
		if (dateIndex < 0) return;
		const found = findDate(texts[dateIndex]!);
		const afterDate = [found?.rest ?? '', ...texts.slice(dateIndex + 1)].join(' ');
		// The cell labelled Ort (Traunreut's theme labels it "Wo"); the last cell only when none is labelled.
		const last = texts.length - 1;
		const ortIndex = labels.some((label) => label !== null)
			? labels.findIndex((label) => label !== null && /^(Ort|Wo)$/i.test(label))
			: last > dateIndex + 1 ? last : -1;
		const location = ortIndex >= 0 && texts[ortIndex] !== '' ? texts[ortIndex]! : null;
		result.push({ date: found?.date ?? null, time: findTime(afterDate), location });
	});
	return result;
}

/** Start date and time per the `Beginn` label, falling back to the session table; null when unreadable. */
function startOf(lines: readonly string[], table: readonly Session[]): { date: string; time: string } | null {
	const begin = labelValue(lines, ['Beginn', 'Kursbeginn']);
	if (begin === null) {
		const first = table[0];
		return first?.date && first.time ? { date: first.date, time: first.time } : null;
	}
	const found = findDate(begin);
	if (found === null || found.date === null) return null;
	const time = findTime(found.rest) ?? table.find((session) => session.date === found.date)?.time ?? null;
	return time === null ? null : { date: found.date, time };
}

const STREET = /^(?=.*[A-Za-zÄÖÜäöüß])(.+?\s\d+\s*[a-zA-Z]?(?:\s*[-–+/]\s*\d+\s*[a-zA-Z]?)*)$/;
const POSTCODE_CITY = /^\d{5}\s+\S.*$/;
const ADDRESS_PREFIX = /^Adresse\s*:\s*/;
const CELL_ADDRESS_TAIL = /([^,;]+?\s\d+\s*[a-zA-Z]?(?:\s*[-–+/]\s*\d+\s*[a-zA-Z]?)*)\s*,\s*(\d{5}\s+[^,;]+)$/;

/** The lines after the first `Kursort` label up to the next label, or null when there is none. */
function kursortBlock(lines: readonly string[]): string[] | null {
	const index = lines.findIndex((line) => /^Kursort\s*:?$/.test(line) || /^Kursort\s*:\s*\S/.test(line));
	if (index < 0) return null;
	const inline = /^Kursort\s*:\s*(\S.*)$/.exec(lines[index]!);
	const block = inline === null ? [] : [inline[1]!];
	for (const line of lines.slice(index + 1)) {
		if (isLabel(line)) break;
		block.push(line);
	}
	return block;
}

/** Place and address from the Kursort block, else from the first session's location cell. */
function placeAndAddress(lines: readonly string[], table: readonly Session[]): { place: string | null; address: string | null } {
	const block = kursortBlock(lines);
	const cell = table[0]?.location ?? null;
	let place: string | null = null;
	let address: string | null = null;
	if (block === null) {
		place = cell;
	} else {
		const plain = block.map((line) => line.replace(ADDRESS_PREFIX, ''));
		let addressAt = -1;
		for (const [index, line] of plain.entries()) {
			const single = /^(.*?\S),?\s+(\d{5}\s+\S.*)$/.exec(line);
			if (single !== null && STREET.test(single[1]!)) {
				address = `${single[1]!}, ${single[2]!}`;
				addressAt = index;
				break;
			}
			const next = plain[index + 1];
			if (next !== undefined && STREET.test(line) && POSTCODE_CITY.test(next)) {
				address = `${line}, ${next}`;
				addressAt = index;
				break;
			}
		}
		const before = addressAt < 0 ? block : block.slice(0, addressAt);
		place = before.find((line) => !ADDRESS_PREFIX.test(line)) ?? null;
	}
	if (address === null && cell !== null) {
		const tail = CELL_ADDRESS_TAIL.exec(cell);
		if (tail !== null) address = `${tail[1]!.trim()}, ${tail[2]!.trim()}`;
	}
	return { place, address };
}

const DEADLINES = [
	/Anmeldeschlu(?:ss|ß)\s*:?\s*(?:ist\s+am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/g,
	/Anmeldung\s+bis\s+(?:zum\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g,
];

/** The first stated registration deadline that is a real date, or null. */
function deadlineOf(text: string): string | null {
	const found = DEADLINES.flatMap((pattern) => [...text.matchAll(pattern)]).sort((a, b) => a.index - b.index);
	for (const match of found) {
		const date = toLocalDate(match[1]!, match[2]!, match[3]!);
		if (date !== null) return date;
	}
	return null;
}

function registrationMethodOf($: CheerioAPI, details: ReturnType<CheerioAPI>, lines: readonly string[]): RegistrationMethod | null {
	const text = lines.join('\n');
	// "nur/ausschließlich persönlich" counts only in a sentence about registering ("Anmeld…" before it).
	if (/Anmeld[^.!?\n]*?(?<!nicht\s)(nur|ausschließlich)\s+persönlich|Anmeldung\s+erfolgt\s+(nur\s+)?persönlich/i.test(text)) return 'in_person';
	const cart = details.find('a, button, input').filter((_, element) => {
		const control = $(element);
		return /in den Warenkorb/i.test([control.text(), control.attr('title') ?? '', control.attr('value') ?? ''].join(' '));
	});
	if (cart.length > 0) return 'online';
	// "Anmeldung … per X" within a few words, so a form sent by post after an online registration is no signal.
	if (/Anmeldung\s+(?:[^\s.!?]+\s+){0,5}?per\s+E-?Mail/i.test(text)) return 'email';
	if (/Anmeldung\s+(?:[^\s.!?]+\s+){0,5}?(per\s+Post|postalisch)/i.test(text)) return 'post';
	return null;
}

const RULE = /Wohnsitz(?!nachweis|bescheinigung)|wohnhaft|nur für|(nur|ausschließlich)\b.*\bTeilnehmende/i;
const NOT_RULE = /Merkliste|eingeloggt/i;
const LEAF_CANDIDATES = 'p, li, td, dd, div, span';
const BLOCK_CHILDREN = 'p, div, li, td, th, tr, table, tbody, ul, ol, dl, dd, dt, h1, h2, h3, h4, h5, h6, section, article, form, blockquote';

/** The first leaf block in `scope` that states who may register, verbatim. */
function eligibilityIn($: CheerioAPI, scope: ReturnType<CheerioAPI>): string | null {
	let found: string | null = null;
	scope.find(LEAF_CANDIDATES).each((_, element) => {
		const block = $(element);
		if (block.children(BLOCK_CHILDREN).length > 0) return;
		const text = collapse(block.text());
		if (RULE.test(text) && !NOT_RULE.test(text)) {
			found = text;
			return false;
		}
		return;
	});
	return found;
}

/**
 * Where a list page states its rule: the content column holding the course list (`#content`, else
 * `main`), since sites put the category text in a content element beside the list; else the list.
 */
function listRuleScope($: CheerioAPI): ReturnType<CheerioAPI> {
	const list = $(LIST_CONTAINER).first();
	const column = list.closest('#content, main');
	return column.length > 0 ? column : list;
}

// ---------------------------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------------------------

interface ParsedList {
	$: CheerioAPI;
	base: string;
}

const failed = (reason: string): ParseResult => ({ kind: 'failed', reason });
const isOk = (status: number | null): boolean => status !== null && status >= 200 && status < 300;

function parse(pages: readonly FetchedPage[]): ParseResult {
	const lists: ParsedList[] = [];
	for (const page of pages.filter((p) => p.role === 'list')) {
		if (page.html === null) return failed('structure-missing');
		const $ = load(page.html);
		if ($(LIST_CONTAINER).length === 0) return failed('structure-missing');
		lists.push({ $, base: pageBase(page) });
	}
	const selected = lists.flatMap(({ $, base }) => testLinks($, base));
	if (selected.length === 0) return { kind: 'ok', listings: [] };

	const detailPages = pages.filter((p) => p.role === 'detail');
	if (detailPages.some((page) => !isOk(page.status) || page.html === null)) return failed('detail-page');
	const details = detailPages.map((page) => {
		const $ = load(page.html!);
		return { page, $, root: $(DETAIL_CONTAINER).first() };
	});
	if (details.some(({ root }) => root.length === 0)) return failed('structure-missing');

	const listRule = lists.map(({ $ }) => eligibilityIn($, listRuleScope($))).find((rule) => rule !== null) ?? null;
	const listings: RawListing[] = [];
	for (const { page, $, root } of details) {
		const lines = textLines(root.get(0) as unknown as DomNode);
		const table = sessions($, root);
		const start = startOf(lines, table);
		if (start === null) return failed('date-unparseable');
		const text = lines.join('\n');

		const row = listRowInfo(lists, page.url);
		const signals: StatusSignals = { ...row.signals };
		mergeSignals(signals, trafficLightSignals($, root));
		const body = textSignals([...row.titles, text].join('\n'));
		if (body.bookedOut) signals.bookedOut = true;
		if (body.waitlistOffer && signals.bookedOut === true) signals.waitlist = true;

		listings.push({
			date: start.date,
			time: start.time,
			...placeAndAddress(lines, table),
			status: mapStatus(signals),
			deadline: deadlineOf(lines.join(' ')),
			registration_method: registrationMethodOf($, root, lines),
			eligibility: clampEligibility(eligibilityIn($, root) ?? listRule),
			source_url: pageBase(page),
		});
	}
	return { kind: 'ok', listings };
}

export const kuferwebReader: Reader = {
	plan(centre: Centre): ReaderPlan {
		const listUrl = centre.reader_config?.list_url ?? centre.test_page_url;
		return { listUrls: listUrl === null ? [] : [listUrl], selectDetailUrls, maxDetailPages: KUFERWEB_MAX_DETAIL_PAGES };
	},
	parse: (pages) => parse(pages),
};
