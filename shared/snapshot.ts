import { z } from 'zod';
import { centreFieldsSchema, checkCentre, READERS } from './directory.ts';
import { checkListing, listingFieldsSchema } from './listing.ts';

/** The `schemaVersion` this contract describes. The app embeds it to detect a mismatch. */
export const SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * Freshness threshold (AD-11, amended 2026-10-29 for once-a-day collection): a centre's
 * `last_success_at` older than this reads as the exact time, and a system as "not updated since".
 */
export const FRESHNESS_MS = 36 * 60 * 60 * 1000;

/** Whether a centre is read automatically. `not_checked` = uncovered card. */
export const COVERAGE = ['covered', 'not_checked'] as const;
export type Coverage = (typeof COVERAGE)[number];

/** Outcome of the last read of a centre; `null` when it was never read. */
export const LAST_RESULTS = ['ok', 'failed'] as const;
export type LastResult = (typeof LAST_RESULTS)[number];

/** A UTC ISO 8601 datetime ending in `Z` (no offsets). */
const utcDatetime = z.iso.datetime();

export const snapshotCentreSchema = centreFieldsSchema
	.extend({
		coverage: z.enum(COVERAGE),
		last_result: z.enum(LAST_RESULTS).nullable(),
		last_checked_at: utcDatetime.nullable(),
		last_success_at: utcDatetime.nullable(),
	})
	.superRefine((centre, ctx) => {
		checkCentre(centre, ctx);
		if (centre.coverage === 'covered' && centre.opted_out) {
			ctx.addIssue({ code: 'custom', path: ['coverage'], message: 'must be "not_checked" for an opted-out centre' });
		}
		if (centre.coverage === 'covered' && centre.reader === 'none') {
			ctx.addIssue({ code: 'custom', path: ['coverage'], message: 'must be "not_checked" when reader is "none"' });
		}
	});

/** Per-reader-system run summary (AD-9). */
export const systemSchema = z.strictObject({
	reader: z.enum(READERS).refine((reader) => reader !== 'none', { message: 'must be a reader system, not "none"' }),
	centres_covered: z.number().int().nonnegative(),
	centres_ok: z.number().int().nonnegative(),
	centres_failed: z.number().int().nonnegative(),
	last_success_at: utcDatetime.nullable(),
});

/** A published test date: the normalised listing plus `first_seen_at` and `baseline` from merge. */
export const snapshotListingSchema = listingFieldsSchema
	.extend({
		/** The run that first saw this id. */
		first_seen_at: utcDatetime,
		/** Seen on the centre's first `ok` run, so it is not "new". */
		baseline: z.boolean(),
	})
	.superRefine(checkListing);

export const snapshotSchema = z
	.strictObject({
		schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
		generated_at: utcDatetime,
		systems: z.array(systemSchema),
		centres: z.array(snapshotCentreSchema).superRefine((centres, ctx) => {
			const seen = new Set<string>();
			centres.forEach((centre, index) => {
				if (seen.has(centre.centre_id)) {
					ctx.addIssue({ code: 'custom', path: [index, 'centre_id'], message: `duplicate centre_id "${centre.centre_id}"` });
				}
				seen.add(centre.centre_id);
			});
		}),
		/** Upcoming, not removed listings of `covered` centres, sorted by id. */
		listings: z.array(snapshotListingSchema).superRefine((listings, ctx) => {
			for (let index = 1; index < listings.length; index += 1) {
				if (listings[index - 1]!.id >= listings[index]!.id) {
					ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'listing ids must be unique and sorted' });
				}
			}
		}),
	})
	.superRefine((snapshot, ctx) => {
		const coverage = new Map(snapshot.centres.map((centre) => [centre.centre_id, centre.coverage]));
		snapshot.listings.forEach((listing, index) => {
			const found = coverage.get(listing.centre_id);
			if (found === undefined) {
				ctx.addIssue({ code: 'custom', path: ['listings', index, 'centre_id'], message: `unknown centre "${listing.centre_id}"` });
			} else if (found !== 'covered') {
				ctx.addIssue({ code: 'custom', path: ['listings', index, 'centre_id'], message: `centre "${listing.centre_id}" is not covered` });
			}
		});
	});

export type SnapshotCentre = z.infer<typeof snapshotCentreSchema>;
export type SnapshotListing = z.infer<typeof snapshotListingSchema>;
export type SnapshotSystem = z.infer<typeof systemSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
