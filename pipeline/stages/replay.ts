/**
 * The replay file (Story 2.6): one run's collect result, saved with `--save-collect` so a rejected
 * push can re-run normalise → merge → publish with `--from-collect` and no fetch. It holds
 * `{ runAt, outcomes, visits, pages }`: outcome codes and the reader's raw listings, the hosts
 * contacted, and page summaries (URL, role, status, final URL; never page bodies).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { rawListingSchema } from '../../shared/listing.ts';
import type { PageSummary } from '../../shared/reader.ts';
import { visitLogSchema, type Visit } from '../../shared/visits.ts';
import type { CentreOutcome, SkipReason } from './collect.ts';

const SKIP_REASONS = ['opted-out', 'no-reader', 'robots', 'budget'] as const satisfies readonly SkipReason[];
const REASON_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const outcomeSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('skipped'), reason: z.enum(SKIP_REASONS) }),
	z.strictObject({ kind: z.literal('ok'), listings: z.array(rawListingSchema) }),
	z.strictObject({ kind: z.literal('failed'), reason: z.string().regex(REASON_CODE) }),
]);

const pageSummarySchema = z.strictObject({
	url: z.string(),
	role: z.enum(['list', 'detail']),
	status: z.number().int().nullable(),
	finalUrl: z.string().nullable(),
});

export const replaySchema = z.strictObject({
	/** The original run's clock, reused on replay. */
	runAt: z.iso.datetime(),
	outcomes: z.record(z.string(), outcomeSchema),
	visits: visitLogSchema,
	pages: z.record(z.string(), z.array(pageSummarySchema)),
});

export interface Replay {
	runAt: Date;
	outcomes: Record<string, CentreOutcome>;
	visits: Visit[];
	pages: Record<string, PageSummary[]>;
}

const sortedKeys = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
	Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]!]));

/** The file text: `runAt` as an ISO string, `outcomes` and `pages` keys sorted, trailing newline. */
export function serializeReplay(replay: Replay): string {
	const data = { runAt: replay.runAt.toISOString(), outcomes: sortedKeys(replay.outcomes), visits: replay.visits, pages: sortedKeys(replay.pages) };
	return `${JSON.stringify(replaySchema.parse(data))}\n`;
}

/** Validates and writes the replay file to `path` (creating its directory). Throws on failure. */
export function saveReplay(replay: Replay, path: string): void {
	const text = serializeReplay(replay);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

/** The replay file at `path`. Throws, naming the file, when it is unreadable, not JSON or the wrong shape. */
export function loadReplay(path: string): Replay {
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(`cannot read replay file ${path}: ${(error as Error).message}`);
	}
	const parsed = replaySchema.safeParse(data);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new Error(`replay file ${path} is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
	}
	return { ...parsed.data, runAt: new Date(parsed.data.runAt) };
}
