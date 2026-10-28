/**
 * Test-only helper: runs a reader against committed HTML fixtures instead of the network.
 * Mirrors the pipeline order (plan → list pages → detail selection, capped → parse → contract
 * check). A URL without a fixture throws, so a test never falls through to a real request.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Centre } from '../../shared/directory.ts';
import { checkParseResult, isFetchableUrl, selectDetailUrls, type FetchedPage, type ParseContext, type ParseResult, type Reader } from '../../shared/reader.ts';

/**
 * A fixture for one URL: an HTML file (absolute, or relative to `fixturesDir`) and its status
 * (default 200). `file: null` models a page with no body, `status: null` a timeout or network failure.
 * `finalUrl` models a redirect (default: the URL itself; always `null` when `file` is null).
 */
export interface Fixture {
	file: string | null;
	status?: number | null;
	finalUrl?: string;
}

export type Fixtures = Record<string, Fixture>;

function loadPage(url: string, role: FetchedPage['role'], fixtures: Fixtures, fixturesDir: string): FetchedPage {
	const fixture = fixtures[url];
	if (fixture === undefined) throw new Error(`no fixture for ${role} page ${url}`);
	const status = fixture.status === undefined ? 200 : fixture.status;
	if (fixture.file === null) return { url, role, status, html: null, finalUrl: null };
	const html = readFileSync(resolve(fixturesDir, fixture.file), 'utf8');
	return { url, role, status, html, finalUrl: fixture.finalUrl ?? url };
}

/**
 * The reader's validated result for `centre` over `fixtures`. Detail URLs are chosen with the
 * shared `selectDetailUrls` rule (de-duplicated, then capped). A throwing `parse` propagates.
 */
export function runReaderOnFixtures(
	reader: Reader,
	centre: Centre,
	fixtures: Fixtures,
	ctx: ParseContext,
	fixturesDir: string,
): ParseResult {
	const plan = reader.plan(centre);
	const listPages = plan.listUrls.map((url) => loadPage(url, 'list', fixtures, fixturesDir));
	// Like fetch: a URL fetch would not request reaches parse as a page with nothing received.
	const detailPages = selectDetailUrls(plan, listPages).map((url): FetchedPage =>
		isFetchableUrl(url) ? loadPage(url, 'detail', fixtures, fixturesDir) : { url, role: 'detail', status: null, html: null, finalUrl: null },
	);
	return checkParseResult(reader.parse([...listPages, ...detailPages], centre, ctx));
}
