/**
 * Verifies data/directory/centres.json against each centre's own website.
 *
 *   node tools/verify-directory.ts
 *
 * Per distinct website host: robots.txt, the homepage and at most one candidate test page.
 * Writes centres.json and review-note.md in data/directory/; the operator reviews and commits.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';
import { createFetchClient, nativeFetch, type FetchImpl, type FetchResult } from '../pipeline/fetch/index.ts';
import { USER_AGENT } from '../pipeline/config.ts';
import { directorySchema, serializeDirectory, type Centre, type Reader } from '../shared/directory.ts';
import { DIRECTORY_DIR } from './seed-directory.ts';

export const TEST_PATTERN = /einb(ü|ue|u)rgerungstest/i;
const KUFERWEB_FINGERPRINT = /\/fileadmin\/kuferweb\/webbasys\//i;
const ITEMKG_FINGERPRINT = /typo3conf\/ext\/itemkg_|\/p\/[a-z0-9-]+-\d+-CAT-KAT\d+/i;
const HOST_CONCURRENCY = 4;

/** What was fetched for one website host. */
export interface SitePages {
	home: FetchResult;
	/** The candidate test page link found on the homepage, or null. */
	testLink: string | null;
	/** The fetched test page (the homepage itself when it is the test page), or null when there was no link. */
	testPage: FetchResult | null;
}

export interface Change {
	field: string;
	from: unknown;
	to: unknown;
}

export interface Assessment {
	entry: Centre;
	changes: Change[];
	/** Why the entry stays unverified, or null when verified. */
	reason: string | null;
	/** Things for the operator that were not applied (e.g. a different postcode on the site). */
	notes: string[];
}

const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** The website's host without `www.`, or null. */
export const siteHost = (website: string | null): string | null =>
	website !== null && URL.canParse(website) ? stripWww(new URL(website).hostname) : null;

/** Visible page text (scripts and styles removed). */
export function pageText(html: string): string {
	const $ = load(html);
	$('script, style, noscript').remove();
	return $.root().text().replace(/\s+/g, ' ');
}

/**
 * First `<a>` on one of `hosts` (or a subdomain of one) whose text or href names the
 * Einbürgerungstest. `hosts` are given without `www.`.
 */
export function findTestLink(html: string, baseUrl: string, hosts: readonly string[]): string | null {
	const $ = load(html);
	for (const anchor of $('a[href]').toArray()) {
		const href = $(anchor).attr('href')!.trim();
		if (!URL.canParse(href, baseUrl)) continue;
		let decoded = href;
		try {
			decoded = decodeURIComponent(href);
		} catch {
			// keep the raw href
		}
		if (!TEST_PATTERN.test($(anchor).text()) && !TEST_PATTERN.test(decoded)) continue;
		const url = new URL(href, baseUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
		const linkHost = stripWww(url.hostname);
		if (!hosts.some((host) => linkHost === host || linkHost.endsWith(`.${host}`))) continue;
		url.hash = '';
		return url.href;
	}
	return null;
}

export function detectReader(htmls: readonly string[]): Reader {
	const kuferweb = htmls.some((html) => KUFERWEB_FINGERPRINT.test(html));
	const itemkg = htmls.some((html) => ITEMKG_FINGERPRINT.test(html));
	if (kuferweb === itemkg) return 'none';
	return kuferweb ? 'kuferweb' : 'itemkg';
}

interface JsonLdAddress {
	postalCode: string;
	streetAddress: string | null;
	addressLocality: string | null;
	/** `name` of the node that holds this address, if any. */
	holderName: string | null;
}

const asString = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() !== '' ? value.trim() : typeof value === 'number' ? String(value) : null;

const isPostalAddress = (node: Record<string, unknown>): boolean => {
	const type = node['@type'];
	return type === 'PostalAddress' || (Array.isArray(type) && type.includes('PostalAddress'));
};

/** Every schema.org PostalAddress with a postalCode, at any depth (`@graph` included). */
export function jsonLdAddresses(html: string): JsonLdAddress[] {
	const $ = load(html);
	const found: JsonLdAddress[] = [];
	const visit = (node: unknown, holder: Record<string, unknown> | null): void => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item, holder);
			return;
		}
		if (node === null || typeof node !== 'object') return;
		const record = node as Record<string, unknown>;
		if (isPostalAddress(record)) {
			const postalCode = asString(record['postalCode']);
			if (postalCode !== null) {
				found.push({
					postalCode,
					streetAddress: asString(record['streetAddress']),
					addressLocality: asString(record['addressLocality']),
					holderName: holder ? asString(holder['name']) : null,
				});
			}
		}
		for (const [key, value] of Object.entries(record)) {
			visit(value, key === 'address' ? record : null);
		}
	};
	$('script[type="application/ld+json"]').each((_, script) => {
		try {
			visit(JSON.parse($(script).text()), null);
		} catch {
			// malformed JSON-LD states nothing
		}
	});
	return found;
}

const okHtml = (result: FetchResult | null): string | null => (result?.ok ? result.text : null);

/** Pure: applies what the fetched pages state to one entry. */
export function assessSite(entry: Centre, pages: SitePages | null, now: string): Assessment {
	const next: Centre = structuredClone(entry);
	const changes: Change[] = [];
	const notes: string[] = [];
	const set = <K extends keyof Centre>(field: K, value: Centre[K]): void => {
		if (JSON.stringify(next[field]) === JSON.stringify(value)) return;
		changes.push({ field, from: next[field], to: value });
		next[field] = value;
	};
	const setAddress = (field: 'street' | 'city', value: string): void => {
		if (next.address[field] === value) return;
		changes.push({ field: `address.${field}`, from: next.address[field], to: value });
		next.address = { ...next.address, [field]: value };
	};
	const finish = (reason: string | null): Assessment => {
		set('verified_at', reason === null ? now : null);
		return { entry: next, changes, reason, notes };
	};

	if (entry.website === null || pages === null) return finish('no website');
	const { home, testLink, testPage } = pages;
	if (!home.ok) {
		if (home.reason === 'robots-disallowed') return finish('robots-disallowed');
		return finish(`unreachable: ${home.reason}${home.status !== null ? ` ${home.status}` : ''}`);
	}

	const testHtml = okHtml(testPage);
	const htmls = testHtml !== null && testPage !== home ? [home.text, testHtml] : [home.text];

	set('reader', detectReader(htmls));
	if (next.reader === 'none') set('reader_config', null);

	// Address and name: only from JSON-LD with the entry's own postcode.
	const postcode = entry.address.postcode;
	const addresses = htmls.flatMap(jsonLdAddresses);
	const own = addresses.find((a) => a.postalCode === postcode);
	if (own) {
		if (own.streetAddress) setAddress('street', own.streetAddress);
		if (own.addressLocality) setAddress('city', own.addressLocality);
		if (own.holderName) set('name', own.holderName);
	} else {
		for (const other of new Set(addresses.map((a) => a.postalCode).filter((code) => /^\d{5}$/.test(code)))) {
			notes.push(`site JSON-LD states postcode ${other} (not applied)`);
		}
	}

	const testConfirmed = testHtml !== null && TEST_PATTERN.test(pageText(testHtml));
	if (testConfirmed) set('test_page_url', testPage!.url);

	if (testLink === null) return finish('no test page link');
	if (!testConfirmed) return finish('test page not reachable');
	const postcodePattern = new RegExp(`(?<!\\d)${postcode}(?!\\d)`);
	const postcodeOnSite = htmls.some((html) => postcodePattern.test(pageText(html))) || own !== undefined;
	if (!postcodeOnSite) return finish('postcode not on site');
	return finish(null);
}

/**
 * Fetches what one host needs: the homepage and at most one test page. A test link may be on
 * the website's host or, when the homepage redirected elsewhere, on the host it landed on.
 */
export async function fetchSite(get: (url: string) => Promise<FetchResult>, website: string): Promise<SitePages> {
	const home = await get(website);
	if (!home.ok) return { home, testLink: null, testPage: null };
	const hosts = [...new Set([siteHost(website)!, siteHost(home.url)!])];
	const testLink = findTestLink(home.text, home.url, hosts);
	if (testLink === null) return { home, testLink, testPage: null };
	const testPage = testLink === home.url ? home : await get(testLink);
	return { home, testLink, testPage };
}

async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) await work(items[next++]!);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const show = (value: unknown): string => (value === null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value));

export interface RunStats {
	robotsRequests: number;
	pageRequests: number;
	/** Most page requests (redirect hops included) any one host received, and that host. */
	maxPagesPerHost: number;
	maxHost: string | null;
	allWithUserAgent: boolean;
}

export function reviewNote(input: {
	sourceSection: string;
	runAt: string;
	results: readonly Assessment[];
	stats: RunStats;
}): string {
	const { results, stats } = input;
	const verified = results.filter((r) => r.reason === null).length;
	const readerCount = (reader: Reader): number => results.filter((r) => r.entry.reader === reader).length;
	const byId = [...results].sort((a, b) => (a.entry.centre_id < b.entry.centre_id ? -1 : 1));
	const lines = [
		'# Directory review note',
		'',
		input.sourceSection.trimEnd(),
		'',
		'## Verification run',
		'',
		`- Run at: ${input.runAt}`,
		`- Centres: ${results.length}`,
		`- Verified: ${verified}`,
		`- Unverified: ${results.length - verified}`,
		`- Reader kuferweb: ${readerCount('kuferweb')}, itemkg: ${readerCount('itemkg')}, none: ${readerCount('none')}`,
		`- HTTP requests: ${stats.robotsRequests} robots.txt, ${stats.pageRequests} pages (redirect hops counted)`,
		`- Most page requests to one host: ${stats.maxPagesPerHost}${stats.maxHost ? ` (${stats.maxHost})` : ''}`,
		`- Every request sent User-Agent \`${USER_AGENT}\`: ${stats.allWithUserAgent ? 'yes' : 'NO'}`,
		'',
		'## Changes',
		'',
	];
	const changed = byId.filter((r) => r.changes.length > 0);
	if (changed.length === 0) lines.push('None.');
	for (const r of changed) {
		lines.push(`### ${r.entry.centre_id}`, '');
		for (const c of r.changes) lines.push(`- \`${c.field}\`: ${show(c.from)} → ${show(c.to)}`);
		lines.push('');
	}
	lines.push('', '## Unverified', '');
	const unverified = byId.filter((r) => r.reason !== null);
	if (unverified.length === 0) lines.push('None.');
	for (const r of unverified) lines.push(`- ${r.entry.centre_id} (${r.entry.website ?? 'no website'}): ${r.reason}`);
	const noted = byId.filter((r) => r.notes.length > 0);
	if (noted.length > 0) {
		lines.push('', '## Not applied', '');
		for (const r of noted) for (const n of r.notes) lines.push(`- ${r.entry.centre_id}: ${n}`);
	}
	return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/** The `## Source` section written by the seed tool, kept as is. */
function readSourceSection(notePath: string): string {
	const note = existsSync(notePath) ? readFileSync(notePath, 'utf8') : '';
	return note.match(/^## Source\n[\s\S]*?(?=^## |(?![\s\S]))/m)?.[0] ?? '## Source\n\n- Not recorded.\n';
}

export interface VerifyOptions {
	/** Directory holding centres.json and review-note.md. */
	dir?: string;
	fetchImpl?: FetchImpl;
	delayMs?: number;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

/** Verifies every entry and writes centres.json and review-note.md; returns the exit code. */
export async function runVerify(options: VerifyOptions = {}): Promise<number> {
	const { dir = DIRECTORY_DIR, log = console.log, error = console.error } = options;
	const centresPath = join(dir, 'centres.json');
	const notePath = join(dir, 'review-note.md');
	const baseFetch = options.fetchImpl ?? nativeFetch;
	const runAt = new Date().toISOString();
	const parsed = directorySchema.safeParse(JSON.parse(readFileSync(centresPath, 'utf8')));
	if (!parsed.success) {
		error('centres.json is invalid; run npm run check:directory');
		return 1;
	}
	const centres = parsed.data;

	const pagesPerHost = new Map<string, number>();
	/** Per origin: why its robots.txt could not be used, when it failed. */
	const robotsFailures = new Map<string, string>();
	let robotsRequests = 0;
	let pageRequests = 0;
	let allWithUserAgent = true;
	const countingFetch: FetchImpl = async (url, init) => {
		const { host, origin, pathname } = new URL(url);
		const isRobots = pathname === '/robots.txt';
		if (isRobots) robotsRequests++;
		else {
			pageRequests++;
			pagesPerHost.set(host, (pagesPerHost.get(host) ?? 0) + 1);
		}
		if (new Headers(init.headers).get('user-agent') !== USER_AGENT) allWithUserAgent = false;
		try {
			const response = await baseFetch(url, init);
			if (isRobots && response.status >= 500) robotsFailures.set(origin, `HTTP ${response.status}`);
			return response;
		} catch (caught) {
			if (isRobots) robotsFailures.set(origin, init.signal?.aborted ? 'timeout' : 'network error');
			throw caught;
		}
	};
	const client = createFetchClient({ fetchImpl: countingFetch, delayMs: options.delayMs });

	const groups = new Map<string, Centre[]>();
	for (const centre of centres) {
		const host = siteHost(centre.website);
		if (host === null) continue;
		groups.set(host, [...(groups.get(host) ?? []), centre]);
	}
	const sites = new Map<string, SitePages>();
	let done = 0;
	await pool([...groups.keys()], HOST_CONCURRENCY, async (host) => {
		sites.set(host, await fetchSite(client.get, groups.get(host)![0]!.website!));
		log(`[${++done}/${groups.size}] ${host}`);
	});

	const results = centres.map((centre) => {
		const host = siteHost(centre.website);
		const pages = host === null ? null : (sites.get(host) ?? null);
		const result = assessSite(centre, pages, runAt);
		// Say why robots.txt blocked the host when it was unavailable rather than restrictive.
		const failure = pages && !pages.home.ok && URL.canParse(pages.home.url) ? robotsFailures.get(new URL(pages.home.url).origin) : undefined;
		if (result.reason === 'robots-disallowed' && failure) result.reason = `robots-disallowed (robots.txt unavailable: ${failure})`;
		return result;
	});
	const next = directorySchema.safeParse(results.map((r) => r.entry));
	if (!next.success) {
		error(`verified directory fails the schema, nothing written:\n${next.error.message}`);
		return 1;
	}

	let maxHost: string | null = null;
	let maxPagesPerHost = 0;
	for (const [host, count] of pagesPerHost) {
		if (count > maxPagesPerHost) [maxHost, maxPagesPerHost] = [host, count];
	}
	const note = reviewNote({
		sourceSection: readSourceSection(notePath),
		runAt,
		results,
		stats: { robotsRequests, pageRequests, maxPagesPerHost, maxHost, allWithUserAgent },
	});
	writeFileSync(centresPath, serializeDirectory(next.data));
	writeFileSync(notePath, note);
	const verified = results.filter((r) => r.reason === null).length;
	log(`${verified} of ${results.length} centres verified; see ${notePath}`);
	return 0;
}

if (import.meta.main) process.exitCode = await runVerify();
