/**
 * Executes one centre's `ReaderPlan` through the run's polite client: list pages first, in order,
 * then the capped detail pages. List-page failures decide the centre's outcome (AD-4); detail
 * pages fail soft and still reach `parse`. Client errors are not caught here.
 */
import { dedupeUrls, isFetchableUrl, selectDetailUrls, type FetchedPage, type ReaderPlan } from '../../shared/reader.ts';
import type { Visit } from '../../shared/visits.ts';
import type { FetchClient } from './index.ts';
import { overBudget } from './visits.ts';

export type CentreFetch =
	| { kind: 'skipped'; reason: 'robots' | 'budget' }
	| { kind: 'failed'; reason: 'list-page' | 'reader-error' }
	| { kind: 'fetched'; pages: FetchedPage[] };

export interface FetchCentreOptions {
	/** The visit log as read at run start. */
	log: readonly Visit[];
	runAt: Date;
}

const hostOf = (url: string): string | null => (URL.canParse(url) ? new URL(url).host : null);

export async function fetchCentre(client: FetchClient, plan: ReaderPlan, { log, runAt }: FetchCentreOptions): Promise<CentreFetch> {
	const listUrls = dedupeUrls(plan.listUrls);
	if (listUrls.length === 0) return { kind: 'failed', reason: 'reader-error' };
	// The up-front check covers the planned list hosts only. A later list URL blocked via its
	// robots.txt or a redirect (the client blocks every hop) still ends the centre as skipped,
	// after earlier list pages were fetched and counted as a visit.
	for (const url of listUrls) {
		const host = hostOf(url);
		if (host !== null && overBudget(log, host, runAt)) return { kind: 'skipped', reason: 'budget' };
	}

	const listPages: FetchedPage[] = [];
	for (const url of listUrls) {
		const result = await client.get(url);
		if (!result.ok) {
			if (result.reason === 'host-blocked') return { kind: 'skipped', reason: 'budget' };
			if (result.reason === 'robots-disallowed') return { kind: 'skipped', reason: 'robots' };
			return { kind: 'failed', reason: 'list-page' };
		}
		listPages.push({ url, role: 'list', status: result.status, html: result.text, finalUrl: result.url });
	}

	let detailUrls: string[];
	try {
		detailUrls = selectDetailUrls(plan, listPages);
	} catch {
		return { kind: 'failed', reason: 'reader-error' };
	}

	const detailPages = await Promise.all(
		detailUrls.map(async (url): Promise<FetchedPage> => {
			if (!isFetchableUrl(url)) return { url, role: 'detail', status: null, html: null, finalUrl: null };
			const result = await client.get(url);
			return result.ok
				? { url, role: 'detail', status: result.status, html: result.text, finalUrl: result.url }
				: { url, role: 'detail', status: result.status, html: null, finalUrl: result.status === null ? null : result.url };
		}),
	);
	return { kind: 'fetched', pages: [...listPages, ...detailPages] };
}
