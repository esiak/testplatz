/**
 * Collect stage (Story 2.2): for one run over the directory, decides each centre's outcome and
 * returns this run's visits and the pages each parsed centre was given (without bodies). Order
 * per centre: opt-out → no reader → `reader.plan` → fetch → parse. One polite client per run,
 * with every over-budget host blocked. Writes nothing.
 */
import type { Centre, Reader as ReaderSystem } from '../../shared/directory.ts';
import { summarisePage, type PageSummary, type ParseResult, type Reader, type ReaderPlan } from '../../shared/reader.ts';
import type { Visit } from '../../shared/visits.ts';
import { fetchCentre } from '../fetch/centre.ts';
import { createFetchClient, type FetchClientOptions } from '../fetch/index.ts';
import { overBudget } from '../fetch/visits.ts';
import { parseCentre } from './parse.ts';

export type SkipReason = 'opted-out' | 'no-reader' | 'robots' | 'budget';

/** A centre's outcome for one run: skipped (sets nothing), or the parse result (`ok` / `failed`). */
export type CentreOutcome = { kind: 'skipped'; reason: SkipReason } | ParseResult;

export type ReaderRegistry = Partial<Record<Exclude<ReaderSystem, 'none'>, Reader>>;

export interface CollectOptions {
	/** The visit log as read at run start. */
	log: readonly Visit[];
	/** The run's clock. */
	runAt: Date;
	/** Transport and timing for the run's client (tests pass `fetchImpl`, `sleep`, `delayMs`, `timeoutMs`). */
	clientOptions?: Omit<FetchClientOptions, 'isHostBlocked'>;
}

export interface CollectResult {
	outcomes: Record<string, CentreOutcome>;
	/** One visit per host this run contacted, `at` = `runAt`, sorted by host. */
	visits: Visit[];
	/** The pages (list then detail, no `html`) of every centre that reached parse; input for `link_ok`. */
	pages: Record<string, PageSummary[]>;
}

export async function collectRun(centres: readonly Centre[], readers: ReaderRegistry, { log, runAt, clientOptions }: CollectOptions): Promise<CollectResult> {
	const client = createFetchClient({ ...clientOptions, isHostBlocked: (host) => overBudget(log, host, runAt) });

	const pages: Record<string, PageSummary[]> = {};

	async function collectCentre(centre: Centre): Promise<CentreOutcome> {
		if (centre.opted_out) return { kind: 'skipped', reason: 'opted-out' };
		const reader = centre.reader === 'none' ? undefined : readers[centre.reader];
		if (!reader) return { kind: 'skipped', reason: 'no-reader' };
		let plan: ReaderPlan;
		try {
			plan = reader.plan(centre);
		} catch {
			return { kind: 'failed', reason: 'reader-error' };
		}
		const fetched = await fetchCentre(client, plan, { log, runAt });
		if (fetched.kind !== 'fetched') return fetched;
		pages[centre.centre_id] = fetched.pages.map(summarisePage);
		return parseCentre(reader, centre, fetched.pages, { runAt });
	}

	const results = await Promise.all(centres.map(async (centre) => [centre.centre_id, await collectCentre(centre)] as const));
	const at = runAt.toISOString();
	const visits = Object.keys(client.stats().rawRequests)
		.sort()
		.map((host) => ({ host, at }));
	return { outcomes: Object.fromEntries(results), visits, pages };
}
