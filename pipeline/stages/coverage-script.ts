/**
 * The local coverage script (Story 4.2, `npm run coverage`): operator-run, never in CI or on a
 * schedule.
 *
 *   node pipeline/stages/coverage-script.ts                     # parse the cache offline, no network
 *   node pipeline/stages/coverage-script.ts --fetch             # fetch uncached pages, then parse
 *   node pipeline/stages/coverage-script.ts --fetch --refresh   # refetch every page, then parse
 *   node pipeline/stages/coverage-script.ts --json <file>       # … and write the report as JSON
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
import type { Centre } from '../../shared/directory.ts';
import { dedupeUrls, isFetchableUrl, selectDetailUrls, type FetchedPage, type ParseContext, type ParseResult, type Reader, type ReaderPlan } from '../../shared/reader.ts';
import type { Visit } from '../../shared/visits.ts';
import { createFetchClient, type FetchClient, type FetchClientOptions } from '../fetch/index.ts';
import { overBudget, readVisitLog } from '../fetch/visits.ts';
import type { ReaderRegistry } from './collect.ts';
import { readCacheEntry, writeCacheEntry, writeJsonAtomic, type CacheEntry } from './coverage-cache.ts';
import { mergeVisitLog, writeVisitLog } from './merge.ts';
import { parseCentre } from './parse.ts';
import { COVERAGE_CACHE_DIR, DIRECTORY_PATH, READER_PROPOSALS_PATH, VISIT_LOG_PATH } from './paths.ts';
import { READER_REGISTRY, readDirectory } from './run.ts';

export interface CoverageOptions {
	directoryPath?: string;
	cacheDir?: string;
	visitLogPath?: string;
	proposalsPath?: string;
	/** The run's clock: `runAt` for visits, cache timestamps and the readers' `ctx`. */
	now?: () => Date;
	readers?: ReaderRegistry;
	/** Transport options for the fetch client (tests pass a fake `fetchImpl`); `isHostBlocked` is always the visit budget. */
	clientOptions?: Omit<FetchClientOptions, 'isHostBlocked'>;
	/** Refetch cached URLs (`--fetch` only). */
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
		let entry: CacheEntry;
		if (result.ok) entry = { url, fetched_at: at, result: 'ok', status: result.status, final_url: result.url, html: result.text };
		else if (result.reason === 'host-blocked') entry = { url, fetched_at: at, result: 'budget', status: null, final_url: null, html: null };
		else if (result.reason === 'robots-disallowed') entry = { url, fetched_at: at, result: 'robots', status: null, final_url: null, html: null };
		else entry = { url, fetched_at: at, result: 'unreachable', status: result.status, final_url: result.status === null ? null : result.url, html: null };
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
	jsonPath?: string;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

/** Runs the script: `fetch` first when asked, then the offline parse. Returns the exit code. */
export async function runCoverage(options: CliOptions = {}): Promise<number> {
	const { log = console.log, error = console.error } = options;
	try {
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

const USAGE = 'usage: node pipeline/stages/coverage-script.ts [--fetch [--refresh]] [--json <file>]';

/** The CLI flags, or an error message. */
export function parseCliArgs(args: readonly string[]): { fetch: boolean; refresh: boolean; jsonPath?: string } | { error: string } {
	let values: { fetch?: boolean; refresh?: boolean; json?: string };
	try {
		({ values } = parseArgs({ args: [...args], options: { fetch: { type: 'boolean' }, refresh: { type: 'boolean' }, json: { type: 'string' } }, strict: true, allowPositionals: false }));
	} catch (caught) {
		return { error: `${(caught as Error).message}\n${USAGE}` };
	}
	if (values.refresh === true && values.fetch !== true) return { error: `--refresh needs --fetch\n${USAGE}` };
	return { fetch: values.fetch === true, refresh: values.refresh === true, ...(values.json === undefined ? {} : { jsonPath: values.json }) };
}

if (import.meta.main) {
	const parsed = parseCliArgs(process.argv.slice(2));
	if ('error' in parsed) {
		console.error(parsed.error);
		process.exit(1);
	}
	process.exitCode = await runCoverage(parsed);
}
