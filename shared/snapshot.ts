import { z } from 'zod';
import { centreFieldsSchema, checkCentre, READERS } from './directory.ts';

/** The `schemaVersion` this contract describes. The app will embed it to detect a mismatch (Story 1.8). */
export const SNAPSHOT_SCHEMA_VERSION = 1;

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

export const snapshotSchema = z.strictObject({
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
	// Listings arrive in Epic 2, which bumps the schema version.
	listings: z.array(z.unknown()).max(0, { message: `must be empty in schema version ${SNAPSHOT_SCHEMA_VERSION}` }),
});

export type SnapshotCentre = z.infer<typeof snapshotCentreSchema>;
export type SnapshotSystem = z.infer<typeof systemSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
