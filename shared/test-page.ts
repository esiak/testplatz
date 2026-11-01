/**
 * Finding a centre's Einbürgerungstest page in its own HTML or sitemap (pure, cheerio only).
 * Used by `tools/verify-directory.ts` (narrow pattern) and by the coverage script's
 * `--discover` (Story 4.3, wider pattern with a preference for "Einbürgerungstest").
 * Not for `web/`: it pulls in cheerio.
 */
import { load } from 'cheerio';

/** Names the test itself; wins over a link that only matches `DISCOVERY_PATTERN`. */
export const TEST_PATTERN = /einb(ü|ue|u)rgerungstest/i;

/** What discovery accepts as a link to the test page. */
export const DISCOVERY_PATTERN = /einb(ü|ue|u)rgerungstest|einb(ü|ue|u)rgerung|leben[ -]in[ -]deutschland/i;

/** Discovery's patterns in order of preference: a "test" link beats a wider match on the same page. */
export const DISCOVERY_PATTERNS: readonly RegExp[] = [TEST_PATTERN, DISCOVERY_PATTERN];

/** A page likely to link onward to the test page (discovery's one follow-up page). */
export const FOLLOW_UP_PATTERN = /programm|kurse|deutsch|sprache|integration|prüfung|pruefung/i;

/** A link to a file rather than a page (PDF, office document, archive, image). */
export const FILE_PATH = /\.(pdf|docx?|xlsx?|zip|png|jpe?g|gif|svg|webp)$/i;

/** Link text that only names a language, as in a language switcher. */
const LANGUAGE_NAME = /^(deutsch|de|english|en)$/i;

export const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** The URL's host without `www.`, or null when it is not a URL. */
export const siteHost = (url: string | null): string | null => (url !== null && URL.canParse(url) ? stripWww(new URL(url).hostname) : null);

/** True when `url`'s host is one of `hosts` (given without `www.`) or a subdomain of one. */
export const onHosts = (url: URL, hosts: readonly string[]): boolean => {
	const host = stripWww(url.hostname);
	return hosts.some((h) => host === h || host.endsWith(`.${h}`));
};

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

const decode = (value: string): string => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

export interface FoundLink {
	/** Absolute http(s) URL, fragment removed. */
	url: string;
	/** The link text, else its title, else its decoded href: the evidence for the operator. */
	text: string;
}

export interface FindLinkOptions {
	/** Also match the link's `title` attribute (discovery); verify-directory matches text and href only. */
	matchTitle?: boolean;
	/** Absolute URLs (without fragment) never returned, e.g. the page itself. */
	exclude?: readonly string[];
	/** Skip links to files (`FILE_PATH`): discovery wants pages. */
	skipFiles?: boolean;
	/** Skip language-switcher links: an `hreflang` or `lang` attribute, or text that is just a language name or code. */
	skipLanguageLinks?: boolean;
}

/**
 * The first `<a>` on one of `hosts` (or a subdomain of one) whose text or decoded href (and
 * title, with `matchTitle`) matches `pattern`. With several patterns, the first pattern that
 * matches any link wins, so earlier patterns are preferred. `hosts` are given without `www.`.
 */
export function findTestLink(html: string, baseUrl: string, hosts: readonly string[], pattern: RegExp | readonly RegExp[], options: FindLinkOptions = {}): FoundLink | null {
	const $ = load(html);
	const anchors = $('a[href]')
		.toArray()
		.map((anchor) => {
			const href = $(anchor).attr('href')!.trim();
			const language = $(anchor).attr('hreflang') !== undefined || $(anchor).attr('lang') !== undefined;
			const text = collapse($(anchor).text());
			return { href, text, title: collapse($(anchor).attr('title') ?? ''), language: language || LANGUAGE_NAME.test(text) };
		});
	const patterns = pattern instanceof RegExp ? [pattern] : pattern;
	for (const p of patterns) {
		for (const { href, text, title, language } of anchors) {
			if (!URL.canParse(href, baseUrl)) continue;
			if (options.skipLanguageLinks === true && language) continue;
			const decoded = decode(href);
			if (!p.test(text) && !p.test(decoded) && !(options.matchTitle === true && p.test(title))) continue;
			const url = new URL(href, baseUrl);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
			if (!onHosts(url, hosts)) continue;
			url.hash = '';
			if (options.exclude?.includes(url.href) === true) continue;
			if (options.skipFiles === true && FILE_PATH.test(url.pathname)) continue;
			return { url: url.href, text: text !== '' ? text : title !== '' ? title : decoded };
		}
	}
	return null;
}

/**
 * The first sitemap page entry (`<url><loc>`, never a child sitemap of a `<sitemapindex>`) on one
 * of `hosts` whose decoded URL matches `pattern` (earlier patterns preferred, as in
 * `findTestLink`), as an absolute http(s) URL without fragment. File URLs (`FILE_PATH`) are skipped.
 */
export function findSitemapLoc(xml: string, hosts: readonly string[], pattern: RegExp | readonly RegExp[]): string | null {
	const $ = load(xml, { xml: true });
	const locs = $('url > loc')
		.toArray()
		.map((loc) => collapse($(loc).text()));
	const patterns = pattern instanceof RegExp ? [pattern] : pattern;
	for (const p of patterns) {
		for (const loc of locs) {
			if (!URL.canParse(loc) || !p.test(decode(loc))) continue;
			const url = new URL(loc);
			if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
			if (!onHosts(url, hosts) || FILE_PATH.test(url.pathname)) continue;
			url.hash = '';
			return url.href;
		}
	}
	return null;
}

/** The page's collapsed `<title>`, or null when it has none. */
export function pageTitle(html: string): string | null {
	const title = collapse(load(html)('title').first().text());
	return title === '' ? null : title;
}
