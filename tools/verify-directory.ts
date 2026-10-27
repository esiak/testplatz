/**
 * Verifies data/directory/centres.json against each centre's own website.
 *
 *   node tools/verify-directory.ts [--all]
 *
 * By default only entries with `verified_at: null` are checked; `--all` re-checks verified ones
 * too. Opted-out entries are never fetched. Per distinct website host: robots.txt, the homepage
 * and at most one candidate test page, all through one polite client.
 * Writes centres.json and review-note.md in data/directory/; the operator reviews and commits.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'cheerio';
import { createFetchClient, nativeFetch, type FetchImpl, type FetchResult, type FetchStats } from '../pipeline/fetch/index.ts';
import { USER_AGENT } from '../pipeline/config.ts';
import { directorySchema, serializeDirectory, type Centre, type Reader } from '../shared/directory.ts';
import { CENTRES_FILE, DIRECTORY_DIR, REVIEW_NOTE_FILE } from './paths.ts';

export const TEST_PATTERN = /einb(ü|ue|u)rgerungstest/i;
const KUFERWEB_FINGERPRINT = /\/fileadmin\/kuferweb\/webbasys\//i;
const ITEMKG_FINGERPRINT = /typo3conf\/ext\/itemkg_|\/p\/[a-z0-9-]+-\d+-CAT-KAT\d+/i;
const HOST_CONCURRENCY = 4;

/** schema.org types whose address may correct a centre's name and address. */
export const ORGANISATION_TYPES = [
	'Organization',
	'EducationalOrganization',
	'LocalBusiness',
	'GovernmentOrganization',
	'CollegeOrUniversity',
	'School',
] as const;

/** What was fetched for one website host. */
export interface SitePages {
	home: FetchResult;
	/** The candidate test page link found on the homepage, or null. */
	testLink: string | null;
	/** The fetched test page (the homepage itself when it is the test page), or null when there was no link. */
	testPage: FetchResult | null;
}

export interface AssessContext {
	/** Run start time, written as `verified_at`. */
	now: string;
	/** The website host is shared by centres with different postcodes: no name or address corrections. */
	sharedHost: boolean;
	/** Why robots.txt was unusable when the homepage was robots-disallowed because of it, else null. */
	robotsUnavailable: string | null;
}

export interface Change {
	field: string;
	from: unknown;
	to: unknown;
}

export interface Assessment {
	entry: Centre;
	/** Values changed in `entry`. */
	changes: Change[];
	/** Why the entry stays unverified, or null when verified. */
	reason: string | null;
	/** Things for the operator that were not applied (proposals, rejected or different values). */
	notes: string[];
}

const stripWww = (host: string): string => host.toLowerCase().replace(/^www\./, '');

/** The website's host without `www.`, or null. */
export const siteHost = (website: string | null): string | null =>
	website !== null && URL.canParse(website) ? stripWww(new URL(website).hostname) : null;

/** A successful response that is an HTML page (Content-Type missing or containing `html`). */
export const isHtmlPage = (result: FetchResult | null): boolean =>
	result !== null && result.ok && (result.contentType === null || /html/i.test(result.contentType));

/** The HTML text of a page that counts, else null. */
const htmlOf = (result: FetchResult | null): string | null => (result !== null && result.ok && isHtmlPage(result) ? result.text : null);

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Visible page text (scripts and styles removed). */
export function pageText(html: string): string {
	const $ = load(html);
	$('script, style, noscript, template').remove();
	return collapse($.root().text());
}

/**
 * True when the page itself is about the Einbürgerungstest: the pattern is in its `<title>`, an
 * `h1`–`h3`, or the visible text outside navigation, header and footer (menus never confirm).
 */
export function confirmsTestPage(html: string): boolean {
	const $ = load(html);
	if (TEST_PATTERN.test($('title').text())) return true;
	if ($('h1, h2, h3').toArray().some((h) => TEST_PATTERN.test($(h).text()))) return true;
	$('script, style, noscript, template, nav, header, footer, [role=navigation]').remove();
	return TEST_PATTERN.test(collapse($('body').length > 0 ? $('body').text() : $.root().text()));
}

/** True when `postcode` is in the visible text, not inside a longer digit run. */
export const postcodeInText = (postcode: string, text: string): boolean =>
	new RegExp(`(?<!\\d)${postcode}(?!\\d)`).test(text);

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

/** An organisation's name and postal address from JSON-LD, whitespace-collapsed. */
export interface JsonLdOrganisation {
	type: string;
	name: string | null;
	postalCode: string;
	streetAddress: string | null;
	addressLocality: string | null;
}

const asString = (value: unknown): string | null => {
	if (typeof value === 'number') return String(value);
	if (typeof value !== 'string') return null;
	const text = collapse(value);
	return text === '' ? null : text;
};

const typesOf = (node: Record<string, unknown>): string[] => {
	const type = node['@type'];
	return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string');
};

/**
 * Every schema.org organisation-type node (any depth, `@graph` included) with a `PostalAddress`
 * that has a postalCode. Never `Event`, `Place` or anything under a `location` key.
 */
export function jsonLdOrganisations(html: string): JsonLdOrganisation[] {
	const $ = load(html);
	const found: JsonLdOrganisation[] = [];
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (node === null || typeof node !== 'object') return;
		const record = node as Record<string, unknown>;
		const orgType = typesOf(record).find((t) => (ORGANISATION_TYPES as readonly string[]).includes(t));
		if (orgType !== undefined) {
			const addresses = Array.isArray(record['address']) ? record['address'] : [record['address']];
			for (const address of addresses) {
				if (address === null || typeof address !== 'object') continue;
				const a = address as Record<string, unknown>;
				if (!typesOf(a).includes('PostalAddress')) continue;
				const postalCode = asString(a['postalCode']);
				if (postalCode === null) continue;
				found.push({
					type: orgType,
					name: asString(record['name']),
					postalCode,
					streetAddress: asString(a['streetAddress']),
					addressLocality: asString(a['addressLocality']),
				});
			}
		}
		for (const [key, value] of Object.entries(record)) {
			if (key === 'location' || key === 'address') continue;
			visit(value);
		}
	};
	$('script[type="application/ld+json"]').each((_, script) => {
		try {
			visit(JSON.parse($(script).text()));
		} catch {
			// malformed JSON-LD states nothing
		}
	});
	return found;
}

/** Room and floor words; `OG`/`EG` only in capitals. */
const ROOM_WORD = /(?<![\p{L}\d])(?:raum|stock|etage|zimmer)(?![\p{L}\d])/iu;
const FLOOR_ABBREVIATION = /(?<![\p{L}\d])(?:OG|EG)(?![\p{L}\d])/u;
const MARKUP = /[{}<>]/;

/** Why a JSON-LD value must not be applied, or null when it is clean. */
export function rejectValue(field: 'name' | 'street' | 'city', value: string): string | null {
	if (MARKUP.test(value)) return 'contains markup characters';
	if (field === 'street' && value.includes(',')) return 'street contains a comma';
	if (field === 'street' && (ROOM_WORD.test(value) || FLOOR_ABBREVIATION.test(value))) return 'street names a room or floor';
	return null;
}

const show = (value: unknown): string => (value === null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value));

/** Pure: applies what the fetched pages state to one entry. */
export function assessSite(entry: Centre, pages: SitePages | null, context: AssessContext): Assessment {
	const next: Centre = structuredClone(entry);
	const changes: Change[] = [];
	const notes: string[] = [];
	/** Name, address and test page changes: applied only when the entry ends up verified. */
	const proposals: { field: string; to: string; apply: () => void; from: string | null }[] = [];

	const set = <K extends keyof Centre>(field: K, value: Centre[K]): void => {
		if (JSON.stringify(next[field]) === JSON.stringify(value)) return;
		changes.push({ field, from: next[field], to: value });
		next[field] = value;
	};
	const propose = (field: 'name' | 'address.street' | 'address.city' | 'test_page_url', to: string): void => {
		const from =
			field === 'name' ? entry.name : field === 'address.street' ? entry.address.street : field === 'address.city' ? entry.address.city : entry.test_page_url;
		if (from === to) return;
		proposals.push({
			field,
			from,
			to,
			apply: () => {
				if (field === 'name') next.name = to;
				else if (field === 'address.street') next.address = { ...next.address, street: to };
				else if (field === 'address.city') next.address = { ...next.address, city: to };
				else next.test_page_url = to;
			},
		});
	};
	const finish = (reason: string | null): Assessment => {
		if (reason === null) {
			for (const p of proposals) {
				p.apply();
				changes.push({ field: p.field, from: p.from, to: p.to });
			}
		} else {
			for (const p of proposals) {
				notes.push(`proposed \`${p.field}\`: ${show(p.from)} → ${show(p.to)} (not applied: entry unverified)`);
			}
		}
		set('verified_at', reason === null ? context.now : null);
		return { entry: next, changes, reason, notes };
	};

	if (entry.website === null || pages === null) return finish('no website');
	const { home, testLink, testPage } = pages;
	if (!home.ok) {
		if (home.reason === 'robots-disallowed') {
			return finish(context.robotsUnavailable !== null ? `robots.txt unavailable: ${context.robotsUnavailable}` : 'robots-disallowed');
		}
		return finish(`unreachable: ${home.reason}${home.status !== null ? ` ${home.status}` : ''}`);
	}
	if (!isHtmlPage(home)) return finish(`unreachable: not an HTML page (${home.contentType})`);

	const testHtml = htmlOf(testPage);
	const htmls = testHtml !== null && testPage !== home ? [home.text, testHtml] : [home.text];

	set('reader', detectReader(htmls));
	if (next.reader === 'none') set('reader_config', null);

	const postcode = entry.address.postcode;
	if (!context.sharedHost) {
		const organisations = htmls.flatMap(jsonLdOrganisations);
		const own = organisations.find((o) => o.postalCode === postcode);
		if (own) {
			const candidates: ['name' | 'street' | 'city', 'name' | 'address.street' | 'address.city', string | null][] = [
				['name', 'name', own.name],
				['street', 'address.street', own.streetAddress],
				['city', 'address.city', own.addressLocality],
			];
			for (const [kind, field, value] of candidates) {
				if (value === null) continue;
				const rejected = rejectValue(kind, value);
				if (rejected !== null) notes.push(`JSON-LD \`${field}\` "${value}" rejected: ${rejected}`);
				else propose(field, value);
			}
		} else {
			for (const other of new Set(organisations.map((o) => o.postalCode))) {
				notes.push(`site JSON-LD (${organisations.find((o) => o.postalCode === other)!.type}) states postcode ${other} (not applied)`);
			}
		}
	}

	const testConfirmed = testHtml !== null && confirmsTestPage(testHtml);
	if (testConfirmed && testPage !== null && testPage.ok) propose('test_page_url', testPage.url);

	if (testLink === null) return finish('no test page link');
	if (!testConfirmed) return finish('test page not reachable');
	if (!htmls.some((html) => postcodeInText(postcode, pageText(html)))) return finish('postcode not on site');
	return finish(null);
}

/**
 * Fetches what one host needs: the homepage and at most one test page. A test link may be on
 * the website's host or, when the homepage redirected elsewhere, on the host it landed on.
 */
export async function fetchSite(get: (url: string) => Promise<FetchResult>, website: string): Promise<SitePages> {
	const home = await get(website);
	if (!home.ok || !isHtmlPage(home)) return { home, testLink: null, testPage: null };
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

const maxEntry = (record: Record<string, number>): [string | null, number] => {
	let best: [string | null, number] = [null, 0];
	for (const [key, count] of Object.entries(record)) if (count > best[1]) best = [key, count];
	return best;
};

export interface ReviewNoteInput {
	sourceSection: string;
	runAt: string;
	mode: 'default' | 'all';
	/** The whole directory after the run. */
	directory: readonly Centre[];
	/** Entries checked this run. */
	results: readonly Assessment[];
	hostsContacted: number;
	stats: FetchStats;
	allWithUserAgent: boolean;
}

export function reviewNote(input: ReviewNoteInput): string {
	const { directory, results, stats } = input;
	const byId = <T extends { entry: Centre }>(list: readonly T[]): T[] =>
		[...list].sort((a, b) => (a.entry.centre_id < b.entry.centre_id ? -1 : 1));
	const verified = directory.filter((c) => c.verified_at !== null).length;
	const readerCount = (reader: Reader): number => directory.filter((c) => c.reader === reader).length;
	const sum = (record: Record<string, number>): number => Object.values(record).reduce((a, b) => a + b, 0);
	const [maxPageHost, maxPages] = maxEntry(stats.pageGets);
	const [maxRawHost, maxRaw] = maxEntry(stats.rawRequests);
	const optedOut = directory.filter((c) => c.opted_out).length;
	const lines = [
		'# Directory review note',
		'',
		input.sourceSection.trimEnd(),
		'',
		'## Verification run',
		'',
		`- Run at: ${input.runAt}`,
		`- Mode: ${input.mode === 'all' ? '--all (verified entries re-checked)' : 'default (only entries with verified_at null)'}`,
		`- Centres in directory: ${directory.length}`,
		`- Checked this run: ${results.length} (opted out, never fetched: ${optedOut})`,
		`- Verified: ${verified}`,
		`- Unverified: ${directory.length - verified}`,
		`- Reader kuferweb: ${readerCount('kuferweb')}, itemkg: ${readerCount('itemkg')}, none: ${readerCount('none')}`,
		`- Website hosts contacted: ${input.hostsContacted}`,
		`- HTTP requests: ${stats.robotsRequests} robots.txt, ${sum(stats.pageGets)} page gets, ${stats.redirectHops} redirect hops; ${sum(stats.rawRequests)} in total`,
		`- Most page gets to one host: ${maxPages}${maxPageHost ? ` (${maxPageHost})` : ''}`,
		`- Most requests of any kind to one host (robots.txt and hops included): ${maxRaw}${maxRawHost ? ` (${maxRawHost})` : ''}`,
		`- Every request sent User-Agent \`${USER_AGENT}\`: ${input.allWithUserAgent ? 'yes' : 'NO'}`,
		'',
		'## Changes',
		'',
	];
	const changed = byId(results).filter((r) => r.changes.length > 0);
	if (changed.length === 0) lines.push('None.');
	for (const r of changed) {
		lines.push(`### ${r.entry.centre_id}`, '');
		for (const c of r.changes) lines.push(`- \`${c.field}\`: ${show(c.from)} → ${show(c.to)}`);
		lines.push('');
	}
	lines.push('', '## Unverified', '');
	const reasons = new Map(results.map((r) => [r.entry.centre_id, r.reason]));
	const unverified = byId(directory.filter((c) => c.verified_at === null).map((entry) => ({ entry })));
	if (unverified.length === 0) lines.push('None.');
	for (const { entry } of unverified) {
		const reason = entry.opted_out ? 'opted out (not fetched)' : (reasons.get(entry.centre_id) ?? 'not checked this run');
		lines.push(`- ${entry.centre_id} (${entry.website ?? 'no website'}): ${reason}`);
	}
	lines.push('', '## Not applied', '');
	const noted = byId(results).filter((r) => r.notes.length > 0);
	if (noted.length === 0) lines.push('None.');
	for (const r of noted) for (const n of r.notes) lines.push(`- ${r.entry.centre_id}: ${n}`);
	return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

/** The `## Source` section written by the seed tool (subsections included), kept as is. */
function readSourceSection(notePath: string): string {
	const note = existsSync(notePath) ? readFileSync(notePath, 'utf8') : '';
	return note.match(/^## Source\n[\s\S]*?(?=^## |(?![\s\S]))/m)?.[0] ?? '## Source\n\n- Not recorded.\n';
}

export interface VerifyOptions {
	/** Directory holding centres.json and review-note.md. */
	dir?: string;
	/** Re-check verified entries too. */
	all?: boolean;
	fetchImpl?: FetchImpl;
	delayMs?: number;
	timeoutMs?: number;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

function loadDirectory(path: string): { ok: true; centres: Centre[] } | { ok: false; message: string } {
	if (!existsSync(path)) return { ok: false, message: `${path} not found; run npm run seed:directory first` };
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (caught) {
		return { ok: false, message: `${path} is not valid JSON: ${(caught as Error).message}` };
	}
	const parsed = directorySchema.safeParse(data);
	if (!parsed.success) return { ok: false, message: `${path} is invalid; run npm run check:directory for details` };
	return { ok: true, centres: parsed.data };
}

/** Verifies the selected entries and writes centres.json and review-note.md; returns the exit code. */
export async function runVerify(options: VerifyOptions = {}): Promise<number> {
	const { dir = DIRECTORY_DIR, all = false, log = console.log, error = console.error } = options;
	const centresPath = join(dir, CENTRES_FILE);
	const notePath = join(dir, REVIEW_NOTE_FILE);
	const runAt = new Date().toISOString();
	const loaded = loadDirectory(centresPath);
	if (!loaded.ok) {
		error(loaded.message);
		return 1;
	}
	const centres = loaded.centres;

	const baseFetch = options.fetchImpl ?? nativeFetch;
	let allWithUserAgent = true;
	const checkedFetch: FetchImpl = (url, init) => {
		if (new Headers(init.headers).get('user-agent') !== USER_AGENT) allWithUserAgent = false;
		return baseFetch(url, init);
	};
	const client = createFetchClient({ fetchImpl: checkedFetch, delayMs: options.delayMs, timeoutMs: options.timeoutMs });

	const selected = centres.filter((c) => !c.opted_out && (all || c.verified_at === null));

	/** Postcodes per website host across the whole directory, to spot shared hosts. */
	const postcodesByHost = new Map<string, Set<string>>();
	for (const centre of centres) {
		const host = siteHost(centre.website);
		if (host === null) continue;
		postcodesByHost.set(host, (postcodesByHost.get(host) ?? new Set()).add(centre.address.postcode));
	}

	const groups = new Map<string, Centre[]>();
	for (const centre of selected) {
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

	const stats = client.stats();
	const results = selected.map((centre) => {
		const host = siteHost(centre.website);
		const pages = host === null ? null : (sites.get(host) ?? null);
		const failedOrigin =
			pages && !pages.home.ok && pages.home.reason === 'robots-disallowed' && URL.canParse(pages.home.url)
				? new URL(pages.home.url).origin
				: null;
		return assessSite(centre, pages, {
			now: runAt,
			sharedHost: host !== null && (postcodesByHost.get(host)?.size ?? 0) > 1,
			robotsUnavailable: failedOrigin !== null ? (stats.robotsUnavailable[failedOrigin] ?? null) : null,
		});
	});
	const updated = new Map(results.map((r) => [r.entry.centre_id, r.entry]));
	const next = directorySchema.safeParse(centres.map((c) => updated.get(c.centre_id) ?? c));
	if (!next.success) {
		error(`verified directory fails the schema, nothing written:\n${next.error.message}`);
		return 1;
	}

	const note = reviewNote({
		sourceSection: readSourceSection(notePath),
		runAt,
		mode: all ? 'all' : 'default',
		directory: next.data,
		results,
		hostsContacted: groups.size,
		stats,
		allWithUserAgent,
	});
	writeFileSync(centresPath, serializeDirectory(next.data));
	writeFileSync(notePath, note);
	const verified = results.filter((r) => r.reason === null).length;
	log(`${verified} of ${results.length} checked centres verified; see ${notePath}`);
	return 0;
}

if (import.meta.main) process.exitCode = await runVerify({ all: process.argv.slice(2).includes('--all') });
