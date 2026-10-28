import { z } from 'zod';
import type { Centre } from './directory.ts';
import { rawListingSchema, type RawListing } from './listing.ts';

/**
 * The reader contract (AD-4) shared by readers, fetch and stages. A reader plans which pages to
 * fetch and parses fetched pages; it does no I/O and returns failures as values.
 */

/** One fetched page as handed to a reader. */
export interface FetchedPage {
	url: string;
	role: 'list' | 'detail';
	/** HTTP status; `null` on timeout or network failure. */
	status: number | null;
	/** Decoded body; `null` when nothing was received. */
	html: string | null;
}

/** What to fetch for one centre. */
export interface ReaderPlan {
	listUrls: string[];
	/** Pure: picks detail-page URLs from the fetched list pages. */
	selectDetailUrls: (listPages: readonly FetchedPage[]) => string[];
	/** Per-centre cap on detail pages. */
	maxDetailPages: number;
}

/** The parse context. `runAt` is the reader's only clock. */
export interface ParseContext {
	runAt: Date;
}

/** A reader's outcome for one centre. `reason` is a short kebab-case code, e.g. `structure-missing`. */
export type ParseResult = { kind: 'ok'; listings: RawListing[] } | { kind: 'failed'; reason: string };

/** A booking-system reader. */
export interface Reader {
	plan: (centre: Centre) => ReaderPlan;
	parse: (pages: readonly FetchedPage[], centre: Centre, ctx: ParseContext) => ParseResult;
}

/** A short kebab-case failure code such as `structure-missing`. */
const FAILURE_REASON_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const parseResultSchema = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('ok'), listings: z.array(rawListingSchema) }),
	z.strictObject({ kind: z.literal('failed'), reason: z.string().regex(FAILURE_REASON_PATTERN) }),
]);

/** The result when it is a valid `ParseResult` with schema-valid listings; else `failed('schema')`. */
export function checkParseResult(result: unknown): ParseResult {
	const checked = parseResultSchema.safeParse(result);
	return checked.success ? checked.data : { kind: 'failed', reason: 'schema' };
}
