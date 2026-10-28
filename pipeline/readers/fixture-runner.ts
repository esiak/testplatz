/**
 * Test-only helper: runs a reader against committed HTML fixtures instead of the network.
 * Mirrors the pipeline order (plan → list pages → detail selection, capped → parse → contract
 * check). A URL without a fixture throws, so a test never falls through to a real request.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Centre } from '../../shared/directory.ts';
import { checkParseResult, type FetchedPage, type ParseContext, type ParseResult, type Reader } from '../../shared/reader.ts';

/**
 * A fixture for one URL: an HTML file (absolute, or relative to `fixturesDir`) and its status
 * (default 200). `file: null` models a page with no body, `status: null` a timeout or network failure.
 */
export interface Fixture {
	file: string | null;
	status?: number | null;
}

export type Fixtures = Record<string, Fixture>;

function loadPage(url: string, role: FetchedPage['role'], fixtures: Fixtures, fixturesDir: string): FetchedPage {
	const fixture = fixtures[url];
	if (fixture === undefined) throw new Error(`no fixture for ${role} page ${url}`);
	const status = fixture.status === undefined ? 200 : fixture.status;
	const html = fixture.file === null ? null : readFileSync(resolve(fixturesDir, fixture.file), 'utf8');
	return { url, role, status, html };
}

/**
 * The reader's validated result for `centre` over `fixtures`. Detail URLs are de-duplicated
 * (first-seen order) before the cap. A throwing `parse` propagates.
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
	const detailUrls = [...new Set(plan.selectDetailUrls(listPages))].slice(0, Math.max(0, plan.maxDetailPages));
	const detailPages = detailUrls.map((url) => loadPage(url, 'detail', fixtures, fixturesDir));
	return checkParseResult(reader.parse([...listPages, ...detailPages], centre, ctx));
}
