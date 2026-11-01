/**
 * The local coverage script (Story 4.2, `npm run coverage`): operator-run, never in CI or on a
 * schedule.
 *
 *   node pipeline/stages/coverage-script.ts                     # parse the cache offline, no network
 *   node pipeline/stages/coverage-script.ts --fetch             # fetch uncached pages, then parse
 *   node pipeline/stages/coverage-script.ts --fetch --refresh   # refetch every page, then parse
 *   node pipeline/stages/coverage-script.ts --discover          # look for missing test pages, then parse
 *   node pipeline/stages/coverage-script.ts --json <file>       # … and write the report as JSON
 *
 * `--discover` (Story 4.3) looks for the Einbürgerungstest page of every centre without a
 * `test_page_url` (not opted out, not PDF-only): its origin's `/sitemap.xml`, its `website` page,
 * then one follow-up page, at most 3 page requests per host, through the same cache, client and
 * visit budget as `--fetch`. Proposals go to `data/coverage/test-page-proposals.json` for review.
 *
 * `--fetch` fetches each centre's pages once through the polite client (`pipeline/fetch`) into
 * `data/coverage/cache/`: the list pages its reader plans and their detail pages; for a reader-
 * `none` centre its test page plus the detail pages of every registered reader whose structure
 * check matches that page. A host with 4 visits in the last 24 h is never contacted (its pages
 * are cached as `budget`); every host contacted is added to `data/state/visits.json`, which the
 * operator commits. A cached URL is not requested again unless `--refresh`; a `budget` entry is
 * always retried.
 *
 * The parse reads only the cache and never creates a fetch client. It classifies every centre
 * with `shared/coverage.ts`, tries every registered reader on every reader-`none` centre and
 * writes the ones that parse to `data/coverage/reader-proposals.json` for review. It never writes
 * `data/directory/centres.json`. Exits 1 on a bad directory, visit log or cache entry.
 */
import { parseArgs } from 'node:util';
import { buildCoverage, classifyCentre, formatCoverageLine, type Coverage, type CoverageCategory, type CoverageOutcome } from '../../shared/coverage.ts';
import { isHttpUrl, type Centre } from '../../shared/directory.ts';
import { dedupeUrls, isFetchableUrl, selectDetailUrls, type FetchedPage, type ParseContext, type ParseResult, type Reader, type ReaderPlan } from '../../shared/reader.ts';
import { DISCOVERY_PATTERNS, findSitemapLoc, findTestLink, FOLLOW_UP_PATTERN, pageTitle, siteHost } from '../../shared/test-page.ts';
import type { Visit } from '../../shared/visits.ts';
import { createFetchClient, type FetchClient, type FetchClientOptions, type FetchResult } from '../fetch/index.ts';
import { overBudget, readVisitLog } from '../fetch/visits.ts';
import type { ReaderRegistry } from './collect.ts';
import { readCacheEntry, writeCacheEntry, writeJsonAtomic, type CacheEntry } from './coverage-cache.ts';
import { mergeVisitLog, writeVisitLog } from './merge.ts';
import { parseCentre } from './parse.ts';
import { COVERAGE_CACHE_DIR, DIRECTORY_PATH, READER_PROPOSALS_PATH, TEST_PAGE_PROPOSALS_PATH, VISIT_LOG_PATH } from './paths.ts';
import { READER_REGISTRY, readDirectory } from './run.ts';

export interface CoverageOptions {
	directoryPath?: string;
	cacheDir?: string;
	visitLogPath?: string;
	proposalsPath?: string;
	/** The `--discover` review file. */
	testPageProposalsPath?: string;
	/** The run's clock: `runAt` for visits, cache timestamps and the readers' `ctx`. */
	now?: () => Date;
	readers?: ReaderRegistry;
	/** Transport options for the fetch client (tests pass a fake `fetchImpl`); `isHostBlocked` is always the visit budget. */
	clientOptions?: Omit<FetchClientOptions, 'isHostBlocked'>;
	/** Refetch cached URLs (`--fetch` and `--discover` only). */
	refresh?: boolean;
}

export interface FetchSummary {
	/** URLs requested this run (cache misses, `budget` retries, or everything with `refresh`); a URL whose host is over budget is not counted. */
	fetched: number;
	/** URLs served from the cache. */
	cached: number;
	/** Hosts contacted this run, sorted; each became one visit. */
	hosts: string[];
}

/** One reader tried on a reader-`none` centre. A reader whose structure check misses is `failed:structure-missing`. */
export interface Candidate {
	centre_id: string;
	reader: string;
	outcome: 'parsed' | 'parsed-empty' | 'failed';
	reason: string | null;
	listings: number;
}

export interface Proposal {
	centre_id: string;
	reader: string;
	outcome: 'parsed' | 'parsed-empty';
	listings: number;
}

export interface CentreRow {
	centre_id: string;
	category: CoverageCategory;
	reason: string | null;
	/** Listings parsed; `null` when no reader returned `ok`. */
	listings: number | null;
	reader: string;
}

export interface CoverageReport {
	run_at: string;
	centres: CentreRow[];
	candidates: Candidate[];
	proposals: Proposal[];
	coverage: Coverage;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortedReaders = (readers: ReaderRegistry): [string, Reader][] =>
	(Object.entries(readers) as [string, Reader | undefined][]).filter((e): e is [string, Reader] => e[1] !== undefined).sort(([a], [b]) => compare(a, b));

/** The centre as it would be with `reader` assigned and no reader config (`listUrls = [test_page_url]`). */
const asCandidate = (centre: Centre, reader: string): Centre => ({ ...centre, reader: reader as Centre['reader'], reader_config: null });

const planOf = (reader: Reader, centre: Centre): ReaderPlan | null => {
	try {
		return reader.plan(centre);
	} catch {
		return null;
	}
};

const detailUrlsOf = (plan: ReaderPlan, listPages: readonly FetchedPage[]): string[] | null => {
	try {
		return selectDetailUrls(plan, listPages);
	} catch {
		return null;
	}
};

/** Whether a reader's structure check finds its list container on these list pages (the "matches" test). */
const matches = (reader: Reader, centre: Centre, listPages: readonly FetchedPage[], ctx: ParseContext): boolean => {
	const result = parseCentre(reader, centre, listPages, ctx);
	return !(result.kind === 'failed' && result.reason === 'structure-missing');
};

/** The centres the script looks at: not opted out, not PDF-only. */
const inReach = (centre: Centre): boolean => !centre.opted_out && centre.pdf_only !== true;

/** The cache entry one fetch result comes to. */
function cacheEntryOf(url: string, at: string, result: FetchResult): CacheEntry {
	if (result.ok) return { url, fetched_at: at, result: 'ok', status: result.status, final_url: result.url, html: result.text };
	if (result.reason === 'host-blocked') return { url, fetched_at: at, result: 'budget', status: null, final_url: null, html: null };
	if (result.reason === 'robots-disallowed') return { url, fetched_at: at, result: 'robots', status: null, final_url: null, html: null };
	return { url, fetched_at: at, result: 'unreachable', status: result.status, final_url: result.status === null ? null : result.url, html: null };
}

const listPageOf = (entry: CacheEntry): FetchedPage => ({ url: entry.url, role: 'list', status: entry.status, html: entry.html, finalUrl: entry.final_url });

// ---------------------------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------------------------

/**
 * Fetches every in-reach centre's pages into the cache and records the run's visits. Throws
 * (before any request) when the directory or visit log is unreadable or invalid.
 */
export async function fetchCoverage(options: CoverageOptions = {}): Promise<FetchSummary> {
	const { directoryPath = DIRECTORY_PATH, cacheDir = COVERAGE_CACHE_DIR, visitLogPath = VISIT_LOG_PATH, now = () => new Date(), readers = READER_REGISTRY, refresh = false } = options;
	const directory = readDirectory(directoryPath);
	const log: Visit[] = readVisitLog(visitLogPath);
	const runAt = now();
	const at = runAt.toISOString();
	const ctx: ParseContext = { runAt };
	const client: FetchClient = createFetchClient({ ...options.clientOptions, isHostBlocked: (host) => overBudget(log, host, runAt) });

	let fetched = 0;
	let cached = 0;
	/** Per URL, this run's entry: requested at most once per run, also with `refresh`. */
	const inRun = new Map<string, Promise<CacheEntry>>();

	async function request(url: string): Promise<CacheEntry> {
		const result = await client.get(url);
		// A blocked host was sent nothing: not a request, and a cached `ok` page is kept (`--refresh`).
		if (!result.ok && result.reason === 'host-blocked') {
			const kept = refresh ? readCacheEntry(cacheDir, url) : null;
			if (kept !== null && kept.result === 'ok') return kept;
		} else {
			fetched++;
		}
		const entry = cacheEntryOf(url, at, result);
		writeCacheEntry(cacheDir, entry);
		return entry;
	}

	function page(url: string): Promise<CacheEntry> {
		let entry = inRun.get(url);
		if (entry === undefined) {
			const hit = refresh ? null : readCacheEntry(cacheDir, url);
			if (hit !== null && hit.result !== 'budget') {
				cached++;
				entry = Promise.resolve(hit);
			} else {
				entry = request(url);
			}
			inRun.set(url, entry);
		}
		return entry;
	}

	/** The plan's list pages in order, stopping at the first that is not `ok`; `null` when one failed. */
	async function listPages(plan: ReaderPlan): Promise<FetchedPage[] | null> {
		const pages: FetchedPage[] = [];
		for (const url of dedupeUrls(plan.listUrls)) {
			const entry = await page(url);
			if (entry.result !== 'ok') return null;
			pages.push(listPageOf(entry));
		}
		return pages;
	}

	async function details(plan: ReaderPlan, pages: readonly FetchedPage[]): Promise<void> {
		for (const url of detailUrlsOf(plan, pages) ?? []) {
			if (isFetchableUrl(url)) await page(url);
		}
	}

	async function fetchCentre(centre: Centre): Promise<void> {
		if (!inReach(centre)) return;
		if (centre.reader !== 'none') {
			const reader = readers[centre.reader];
			const plan = reader === undefined ? null : planOf(reader, centre);
			if (plan === null || dedupeUrls(plan.listUrls).length === 0) return;
			const pages = await listPages(plan);
			if (pages !== null) await details(plan, pages);
			return;
		}
		if (centre.test_page_url === null) return;
		const test = await page(centre.test_page_url);
		if (test.result !== 'ok') return;
		for (const [name, reader] of sortedReaders(readers)) {
			const candidate = asCandidate(centre, name);
			const plan = planOf(reader, candidate);
			if (plan === null) continue;
			const pages = await listPages(plan);
			if (pages === null || !matches(reader, candidate, pages, ctx)) continue;
			await details(plan, pages);
		}
	}

	// Wait for every centre, so a failure in one never cuts off the visits of requests still in flight.
	const settled = await Promise.allSettled(directory.map(fetchCentre));
	// Every host contacted is one visit, also when a centre failed mid-run.
	const hosts = Object.keys(client.stats().rawRequests).sort();
	if (hosts.length > 0) writeVisitLog(mergeVisitLog(log, hosts.map((host) => ({ host, at })), runAt), visitLogPath);
	const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
	if (rejected !== undefined) throw rejected.reason;
	return { fetched, cached, hosts: Object.keys(client.stats().rawRequests).sort() };
}

// ---------------------------------------------------------------------------------------------
// Offline parse
// ---------------------------------------------------------------------------------------------

type Loaded = { kind: 'pages'; pages: FetchedPage[] } | { kind: 'outcome'; outcome: CoverageOutcome };

/** The outcome a list-page cache entry implies when it is not `ok` (mirrors `pipeline/fetch/centre.ts`). */
function listFailure(entry: CacheEntry | null): CoverageOutcome | null {
	if (entry === null) return { kind: 'failed', reason: 'not-fetched' };
	if (entry.result === 'unreachable') return { kind: 'failed', reason: 'list-page' };
	if (entry.result === 'robots') return { kind: 'skipped', reason: 'robots' };
	if (entry.result === 'budget') return { kind: 'skipped', reason: 'budget' };
	return null;
}

/** The list pages at `urls` from the cache, in order, or the outcome of the first that is not `ok`. */
function loadList(cacheDir: string, urls: readonly string[]): Loaded {
	const listUrls = dedupeUrls(urls);
	if (listUrls.length === 0) return { kind: 'outcome', outcome: { kind: 'failed', reason: 'reader-error' } };
	const pages: FetchedPage[] = [];
	for (const url of listUrls) {
		const entry = readCacheEntry(cacheDir, url);
		const failure = listFailure(entry);
		if (failure !== null) return { kind: 'outcome', outcome: failure };
		pages.push(listPageOf(entry!));
	}
	return { kind: 'pages', pages };
}

/** The pages a plan implies from the cache alone (list pages first, then the capped details), or the outcome that stops it. */
function loadPlan(cacheDir: string, plan: ReaderPlan): Loaded {
	const list = loadList(cacheDir, plan.listUrls);
	if (list.kind === 'outcome') return list;
	const detailUrls = detailUrlsOf(plan, list.pages);
	if (detailUrls === null) return { kind: 'outcome', outcome: { kind: 'failed', reason: 'reader-error' } };
	// A detail page missing from the cache, or not fetchable, reaches the reader with nothing received.
	const detailPages = detailUrls.map((url): FetchedPage => {
		const entry = isFetchableUrl(url) ? readCacheEntry(cacheDir, url) : null;
		return entry === null
			? { url, role: 'detail', status: null, html: null, finalUrl: null }
			: { url, role: 'detail', status: entry.status, html: entry.html, finalUrl: entry.final_url };
	});
	return { kind: 'pages', pages: [...list.pages, ...detailPages] };
}

const candidateOf = (centreId: string, reader: string, result: ParseResult): Candidate =>
	result.kind === 'ok'
		? { centre_id: centreId, reader, outcome: result.listings.length > 0 ? 'parsed' : 'parsed-empty', reason: null, listings: result.listings.length }
		: { centre_id: centreId, reader, outcome: 'failed', reason: result.reason, listings: 0 };

/**
 * Parses the cache offline: classifies every directory centre and tries every registered reader
 * on every reader-`none` centre whose test page is cached as `ok`. Creates no fetch client and
 * sends no request. Writes the proposals file; throws on a bad directory or cache entry.
 */
export function parseCoverage(options: CoverageOptions = {}): CoverageReport {
	const { directoryPath = DIRECTORY_PATH, cacheDir = COVERAGE_CACHE_DIR, proposalsPath = READER_PROPOSALS_PATH, now = () => new Date(), readers = READER_REGISTRY } = options;
	const directory = readDirectory(directoryPath);
	const runAt = now();
	const ctx: ParseContext = { runAt };
	const outcomes: Record<string, CoverageOutcome> = {};
	const candidates: Candidate[] = [];

	for (const centre of directory) {
		if (!inReach(centre)) continue;
		if (centre.reader !== 'none') {
			const reader = readers[centre.reader];
			const plan = reader === undefined ? null : planOf(reader, centre);
			if (plan === null) {
				outcomes[centre.centre_id] = { kind: 'failed', reason: 'reader-error' };
				continue;
			}
			const loaded = loadPlan(cacheDir, plan);
			outcomes[centre.centre_id] = loaded.kind === 'outcome' ? loaded.outcome : parseCentre(reader!, centre, loaded.pages, ctx);
			continue;
		}
		if (centre.test_page_url === null) continue;
		const failure = listFailure(readCacheEntry(cacheDir, centre.test_page_url));
		if (failure !== null) {
			outcomes[centre.centre_id] = failure;
			continue;
		}
		outcomes[centre.centre_id] = { kind: 'skipped', reason: 'no-reader' };
		for (const [name, reader] of sortedReaders(readers)) {
			const candidate = asCandidate(centre, name);
			const plan = planOf(reader, candidate);
			if (plan === null) {
				candidates.push(candidateOf(centre.centre_id, name, { kind: 'failed', reason: 'reader-error' }));
				continue;
			}
			const listOnly = loadList(cacheDir, plan.listUrls);
			if (listOnly.kind === 'outcome') {
				const { outcome } = listOnly;
				candidates.push({ centre_id: centre.centre_id, reader: name, outcome: 'failed', reason: outcome.kind === 'ok' ? null : outcome.reason, listings: 0 });
				continue;
			}
			if (!matches(reader, candidate, listOnly.pages, ctx)) {
				candidates.push(candidateOf(centre.centre_id, name, { kind: 'failed', reason: 'structure-missing' }));
				continue;
			}
			const loaded = loadPlan(cacheDir, plan);
			const result: ParseResult = loaded.kind === 'pages' ? parseCentre(reader, candidate, loaded.pages, ctx) : { kind: 'failed', reason: 'reader-error' };
			candidates.push(candidateOf(centre.centre_id, name, result));
		}
	}

	const coverage = buildCoverage(directory, outcomes);
	const centres: CentreRow[] = directory.map((centre) => {
		const outcome = outcomes[centre.centre_id];
		const { category, reason } = classifyCentre(centre, outcome);
		return { centre_id: centre.centre_id, category, reason, listings: outcome?.kind === 'ok' ? outcome.listings.length : null, reader: centre.reader };
	});
	const proposals: Proposal[] = candidates
		.filter((c): c is Candidate & { outcome: Proposal['outcome'] } => c.outcome !== 'failed')
		.map(({ centre_id, reader, outcome, listings }) => ({ centre_id, reader, outcome, listings }))
		.sort((a, b) => compare(a.centre_id, b.centre_id) || compare(a.reader, b.reader));
	writeJsonAtomic(proposalsPath, proposals);
	return { run_at: runAt.toISOString(), centres, candidates, proposals, coverage };
}

// ---------------------------------------------------------------------------------------------
// Discover test pages (Story 4.3)
// ---------------------------------------------------------------------------------------------

/** At most this many page requests per host in one `--discover` run; robots.txt and redirect hops do not count. */
export const DISCOVERY_REQUESTS_PER_HOST = 3;

export type DiscoverySource = 'sitemap' | 'website' | 'follow-up';

/** One scoped centre in `test-page-proposals.json`. */
export interface TestPageProposal {
	centre_id: string;
	website: string | null;
	proposed_url: string | null;
	source: DiscoverySource | null;
	/** The matched link text, the sitemap URL, or why nothing was proposed (`no website`, `budget`, `robots`, `unreachable`, `not found`). */
	evidence: string;
}

export interface DiscoverySummary extends FetchSummary {
	/** One per scoped centre, sorted by `centre_id`. */
	proposals: TestPageProposal[];
}

/** The centres discovery looks at: in reach and without a test page. */
const needsTestPage = (centre: Centre): boolean => inReach(centre) && centre.test_page_url === null;

const unique = (values: readonly (string | null)[]): string[] => [...new Set(values.filter((v): v is string => v !== null))];

/**
 * Looks for the test page of every in-reach centre without a `test_page_url`: its origin's
 * `/sitemap.xml`, then its `website` page, then one follow-up page linked from it, stopping at the
 * first match. Pages come through the cache and one polite client with the visit budget; at most
 * `DISCOVERY_REQUESTS_PER_HOST` page requests per host, cached pages cost none. Records the visits
 * like `fetchCoverage`, writes the review file and never writes the directory.
 */
export async function discoverTestPages(options: CoverageOptions = {}): Promise<DiscoverySummary> {
	const {
		directoryPath = DIRECTORY_PATH,
		cacheDir = COVERAGE_CACHE_DIR,
		visitLogPath = VISIT_LOG_PATH,
		testPageProposalsPath = TEST_PAGE_PROPOSALS_PATH,
		now = () => new Date(),
		refresh = false,
	} = options;
	const directory = readDirectory(directoryPath);
	const log: Visit[] = readVisitLog(visitLogPath);
	const runAt = now();
	const at = runAt.toISOString();
	const client: FetchClient = createFetchClient({ ...options.clientOptions, isHostBlocked: (host) => overBudget(log, host, runAt) });

	let fetched = 0;
	let cached = 0;
	/** Page requests sent per host this run. */
	const sent = new Map<string, number>();
	const inRun = new Map<string, Promise<CacheEntry>>();

	async function request(url: string, host: string): Promise<CacheEntry> {
		const result = await client.get(url);
		if (!result.ok && (result.reason === 'host-blocked' || result.reason === 'robots-disallowed')) {
			// Stopped at the requested URL itself: nothing was sent to its host for this page, so no page request.
			if (result.url === new URL(url).href) sent.set(host, (sent.get(host) ?? 1) - 1);
			const kept = refresh && result.reason === 'host-blocked' ? readCacheEntry(cacheDir, url) : null;
			if (kept !== null && kept.result === 'ok') return kept;
		} else {
			fetched++;
		}
		const entry = cacheEntryOf(url, at, result);
		writeCacheEntry(cacheDir, entry);
		return entry;
	}

	/** The page at `url` from this run, the cache or the network; `'capped'` when its host has used its page requests. */
	function page(url: string): Promise<CacheEntry | 'capped'> {
		const known = inRun.get(url);
		if (known !== undefined) return known;
		const hit = refresh ? null : readCacheEntry(cacheDir, url);
		let entry: Promise<CacheEntry>;
		if (hit !== null && hit.result !== 'budget') {
			cached++;
			entry = Promise.resolve(hit);
		} else {
			const host = new URL(url).host;
			const used = sent.get(host) ?? 0;
			if (used >= DISCOVERY_REQUESTS_PER_HOST) return Promise.resolve('capped');
			sent.set(host, used + 1);
			entry = request(url, host);
		}
		inRun.set(url, entry);
		return entry;
	}

	const usable = (entry: CacheEntry | 'capped'): entry is CacheEntry & { html: string } => entry !== 'capped' && entry.result === 'ok';
	const limited = (entry: CacheEntry | 'capped'): boolean => entry === 'capped' || entry.result === 'budget';

	async function discover(centre: Centre): Promise<TestPageProposal> {
		const base = { centre_id: centre.centre_id, website: centre.website };
		const none = (evidence: string): TestPageProposal => ({ ...base, proposed_url: null, source: null, evidence });
		const found = (url: string, source: DiscoverySource, evidence: string): TestPageProposal => ({ ...base, proposed_url: url, source, evidence });
		const website = centre.website;
		if (website === null || !isFetchableUrl(website)) return none('no website');
		const hosts = unique([siteHost(website)]);
		/** A page was skipped for the visit budget or the per-host request cap. */
		let budget = false;

		// 1. The origin's sitemap.
		const sitemapUrl = new URL('/sitemap.xml', website).href;
		const sitemap = await page(sitemapUrl);
		budget ||= limited(sitemap);
		if (usable(sitemap)) {
			const loc = findSitemapLoc(sitemap.html, hosts, DISCOVERY_PATTERNS);
			if (loc !== null && isHttpUrl(loc)) return found(loc, 'sitemap', sitemapUrl);
		}

		// 2. The website page.
		const home = await page(website);
		if (!usable(home)) {
			if (home === 'capped' || home.result === 'budget') return none('budget');
			return none(home.result === 'robots' ? 'robots' : 'unreachable');
		}
		const homeUrl = home.final_url ?? website;
		const homeHosts = unique([...hosts, siteHost(homeUrl)]);
		const exclude = unique([website, homeUrl]);
		const link = findTestLink(home.html, homeUrl, homeHosts, DISCOVERY_PATTERNS, { matchTitle: true, exclude, skipFiles: true });
		if (link !== null && isHttpUrl(link.url)) return found(link.url, 'website', link.text);

		// 3. One follow-up page.
		const follow = findTestLink(home.html, homeUrl, homeHosts, FOLLOW_UP_PATTERN, { exclude, skipFiles: true, skipLanguageLinks: true });
		if (follow !== null) {
			const next = await page(follow.url);
			budget ||= limited(next);
			if (usable(next)) {
				const nextUrl = next.final_url ?? follow.url;
				const hit = findTestLink(next.html, nextUrl, homeHosts, DISCOVERY_PATTERNS, { matchTitle: true, exclude: unique([follow.url, nextUrl]), skipFiles: true });
				if (hit !== null && isHttpUrl(hit.url)) return found(hit.url, 'follow-up', `${hit.text} (on ${pageTitle(next.html) ?? nextUrl})`);
			}
		}
		return none(budget ? 'budget' : 'not found');
	}

	// Centres sharing a website host (`www.` ignored) run one after another, a fixed order for the request cap; hosts in parallel.
	const scoped = directory.filter(needsTestPage);
	const groups = new Map<string, Centre[]>();
	for (const centre of scoped) {
		const key = centre.website !== null && isFetchableUrl(centre.website) ? siteHost(centre.website)! : `(none) ${centre.centre_id}`;
		groups.set(key, [...(groups.get(key) ?? []), centre]);
	}
	const proposals: TestPageProposal[] = [];
	const settled = await Promise.allSettled(
		[...groups.values()].map(async (group) => {
			for (const centre of group) proposals.push(await discover(centre));
		}),
	);
	const hosts = Object.keys(client.stats().rawRequests).sort();
	if (hosts.length > 0) writeVisitLog(mergeVisitLog(log, hosts.map((host) => ({ host, at })), runAt), visitLogPath);
	const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
	if (rejected !== undefined) throw rejected.reason;
	proposals.sort((a, b) => compare(a.centre_id, b.centre_id));
	writeJsonAtomic(testPageProposalsPath, proposals);
	return { fetched, cached, hosts, proposals };
}

/** The discovery review as printed: one row per scoped centre, then the count line. */
export function formatDiscovery(proposals: readonly TestPageProposal[], path: string = TEST_PAGE_PROPOSALS_PATH): string[] {
	const lines = table(
		['centre', 'source', 'proposed', 'evidence'],
		proposals.map((p) => [p.centre_id, p.source ?? '-', p.proposed_url ?? '-', p.evidence]),
	);
	const count = proposals.filter((p) => p.proposed_url !== null).length;
	lines.push('', `test pages proposed ${count} of ${proposals.length} centres without one (written to ${path})`);
	return lines;
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

/** Plain columns, left-aligned, two spaces apart. */
function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
	const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
	const line = (cells: readonly string[]) => cells.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd();
	return [line(header), ...rows.map(line)];
}

/** The report as printed: per-centre table, reader-`none` section, coverage line, proposals count. */
export function formatReport(report: CoverageReport, proposalsPath: string = READER_PROPOSALS_PATH): string[] {
	const lines = table(
		['centre', 'category', 'reason', 'listings', 'reader'],
		report.centres.map((row) => [row.centre_id, row.category, row.reason ?? '-', row.listings === null ? '-' : String(row.listings), row.reader]),
	);
	lines.push('', 'Reader `none` centres');
	if (report.candidates.length === 0) lines.push('(none tried: no reader-`none` test page cached as ok)');
	else lines.push(...table(['centre', 'reader', 'outcome', 'reason', 'listings'], report.candidates.map((c) => [c.centre_id, c.reader, c.outcome, c.reason ?? '-', String(c.listings)])));
	lines.push('', formatCoverageLine(report.coverage), `proposals ${report.proposals.length} (written to ${proposalsPath})`);
	return lines;
}

export interface CliOptions extends CoverageOptions {
	fetch?: boolean;
	discover?: boolean;
	jsonPath?: string;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

/** Runs the script: `discover` or `fetch` first when asked, then the offline parse. Returns the exit code. */
export async function runCoverage(options: CliOptions = {}): Promise<number> {
	const { log = console.log, error = console.error } = options;
	try {
		if (options.discover === true) {
			let summary: DiscoverySummary;
			try {
				summary = await discoverTestPages(options);
			} catch (caught) {
				error((caught as Error).message);
				error(`discover failed: ${options.visitLogPath ?? VISIT_LOG_PATH} may have been updated with this run's visits; commit it`);
				return 1;
			}
			log(`discover: ${summary.fetched} requested, ${summary.cached} from cache, ${summary.hosts.length} hosts contacted`);
			for (const line of formatDiscovery(summary.proposals, options.testPageProposalsPath)) log(line);
			if (summary.hosts.length > 0) log(`visits recorded in ${options.visitLogPath ?? VISIT_LOG_PATH}: commit it`);
			log('');
		}
		if (options.fetch === true) {
			let summary: FetchSummary;
			try {
				summary = await fetchCoverage(options);
			} catch (caught) {
				error((caught as Error).message);
				error(`fetch failed: ${options.visitLogPath ?? VISIT_LOG_PATH} may have been updated with this run's visits; commit it`);
				return 1;
			}
			log(`fetch: ${summary.fetched} requested, ${summary.cached} from cache, ${summary.hosts.length} hosts contacted`);
			if (summary.hosts.length > 0) log(`visits recorded in ${options.visitLogPath ?? VISIT_LOG_PATH}: commit it`);
		}
		const report = parseCoverage(options);
		for (const line of formatReport(report, options.proposalsPath)) log(line);
		if (options.jsonPath !== undefined) writeJsonAtomic(options.jsonPath, report);
		return 0;
	} catch (caught) {
		error((caught as Error).message);
		return 1;
	}
}

const USAGE = 'usage: node pipeline/stages/coverage-script.ts [--fetch [--refresh] | --discover [--refresh]] [--json <file>]';

/** The CLI flags, or an error message. */
export function parseCliArgs(args: readonly string[]): { fetch: boolean; discover?: true; refresh: boolean; jsonPath?: string } | { error: string } {
	let values: { fetch?: boolean; discover?: boolean; refresh?: boolean; json?: string };
	try {
		({ values } = parseArgs({
			args: [...args],
			options: { fetch: { type: 'boolean' }, discover: { type: 'boolean' }, refresh: { type: 'boolean' }, json: { type: 'string' } },
			strict: true,
			allowPositionals: false,
		}));
	} catch (caught) {
		return { error: `${(caught as Error).message}\n${USAGE}` };
	}
	if (values.fetch === true && values.discover === true) return { error: `--fetch and --discover run separately\n${USAGE}` };
	if (values.refresh === true && values.fetch !== true && values.discover !== true) return { error: `--refresh needs --fetch or --discover\n${USAGE}` };
	return {
		fetch: values.fetch === true,
		...(values.discover === true ? { discover: true as const } : {}),
		refresh: values.refresh === true,
		...(values.json === undefined ? {} : { jsonPath: values.json }),
	};
}

if (import.meta.main) {
	const parsed = parseCliArgs(process.argv.slice(2));
	if ('error' in parsed) {
		console.error(parsed.error);
		process.exit(1);
	}
	process.exitCode = await runCoverage(parsed);
}
