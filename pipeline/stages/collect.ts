/**
 * Collect stage (Story 2.2): for one run over the directory, decides each centre's outcome and
 * returns this run's visits and the pages each parsed centre was given (without bodies). Order
 * per centre: opt-out → no reader → `reader.plan` → fetch → parse. One polite client per run,
 * with every over-budget host blocked. At most `MAX_PARALLEL_CENTRES_PER_READER` centres of one
 * reader system run at a time (Story 3.12); different systems run in parallel. Writes nothing.
 */
import type { Centre, Reader as ReaderSystem } from '../../shared/directory.ts';
import { summarisePage, type PageSummary, type ParseResult, type Reader, type ReaderPlan } from '../../shared/reader.ts';
import type { SkipReason } from '../../shared/state.ts';
import type { Visit } from '../../shared/visits.ts';
import { MAX_PARALLEL_CENTRES_PER_READER } from '../config.ts';
import { fetchCentre } from '../fetch/centre.ts';
import { createFetchClient, type FetchClientOptions } from '../fetch/index.ts';
import { overBudget } from '../fetch/visits.ts';
import { parseCentre } from './parse.ts';

export type { SkipReason };

/** A centre's outcome for one run: skipped (merge records the reason and time, Story 3.12), or the parse result (`ok` / `failed`). */
export type CentreOutcome = { kind: 'skipped'; reason: SkipReason } | ParseResult;

export type ReaderRegistry = Partial<Record<Exclude<ReaderSystem, 'none'>, Reader>>;

export interface CollectOptions {
	/** The visit log as read at run start. */
	log: readonly Visit[];
	/** The run's clock. */
	runAt: Date;
	/** Transport and timing for the run's client (tests pass `fetchImpl`, `sleep`, `delayMs`, `timeoutMs`). */
	clientOptions?: Omit<FetchClientOptions, 'isHostBlocked'>;
	/** Millisecond clock for the per-centre durations (default `performance.now`). */
	clock?: () => number;
	/** Centres of one reader system in flight at once (default `MAX_PARALLEL_CENTRES_PER_READER`). */
	maxPerReader?: number;
}

export interface CollectResult {
	outcomes: Record<string, CentreOutcome>;
	/** One visit per host this run contacted, `at` = `runAt`, sorted by host. */
	visits: Visit[];
	/** The pages (list then detail, no `html`) of every centre that reached parse; input for `link_ok`. */
	pages: Record<string, PageSummary[]>;
	/** Wall time per centre in whole ms, from its first rule to its outcome (for the run log). */
	durations: Record<string, number>;
	/** Per origin whose robots.txt was unusable this run (so treated as disallow all): why. */
	robotsUnavailable: Record<string, string>;
}

/** A limiter: `run(key, task)` starts `task` once fewer than `limit` tasks with that key are running. */
function keyedLimiter(limit: number): <T>(key: string, task: () => Promise<T>) => Promise<T> {
	const running = new Map<string, number>();
	const waiting = new Map<string, (() => void)[]>();
	return async (key, task) => {
		if ((running.get(key) ?? 0) >= limit) {
			await new Promise<void>((resolve) => {
				const queue = waiting.get(key) ?? [];
				queue.push(resolve);
				waiting.set(key, queue);
			});
		} else {
			running.set(key, (running.get(key) ?? 0) + 1);
		}
		try {
			return await task();
		} finally {
			// Hand the slot straight to the next waiter, or free it.
			const next = waiting.get(key)?.shift();
			if (next !== undefined) next();
			else running.set(key, running.get(key)! - 1);
		}
	};
}

export async function collectRun(
	centres: readonly Centre[],
	readers: ReaderRegistry,
	{ log, runAt, clientOptions, clock = () => performance.now(), maxPerReader = MAX_PARALLEL_CENTRES_PER_READER }: CollectOptions,
): Promise<CollectResult> {
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

	const durations: Record<string, number> = {};
	const limit = keyedLimiter(Math.max(1, maxPerReader));
	// allSettled, not all: a throw waits for the other centres, so every host contacted is counted.
	// The duration starts once the centre's slot is free, so waiting for its system is not counted.
	const settled = await Promise.allSettled(
		centres.map((centre) =>
			limit(centre.reader, async () => {
				const start = clock();
				const outcome = await collectCentre(centre);
				durations[centre.centre_id] = Math.max(0, Math.round(clock() - start));
				return [centre.centre_id, outcome] as const;
			}),
		),
	);
	const at = runAt.toISOString();
	const stats = client.stats();
	const visits = Object.keys(stats.rawRequests)
		.sort()
		.map((host) => ({ host, at }));
	const rejected = settled.find((result) => result.status === 'rejected');
	if (rejected !== undefined) throw new CollectError(rejected.reason, visits, { ...stats.robotsUnavailable });
	const results = settled.map((result) => (result as PromiseFulfilledResult<readonly [string, CentreOutcome]>).value);
	return { outcomes: Object.fromEntries(results), visits, pages, durations, robotsUnavailable: { ...stats.robotsUnavailable } };
}

/**
 * A throw during collect (Story 3.11), carrying the visits made before it so the run can still
 * record them (`run.ts --save-visits`), and the origins whose robots.txt was unusable (Story
 * 3.12) so the run can still log them. `message` is the cause's message.
 */
export class CollectError extends Error {
	readonly visits: Visit[];
	readonly robotsUnavailable: Record<string, string>;
	constructor(cause: unknown, visits: Visit[], robotsUnavailable: Record<string, string> = {}) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.name = 'CollectError';
		this.visits = visits;
		this.robotsUnavailable = robotsUnavailable;
	}
}
