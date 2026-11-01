import { z } from 'zod';
import { CENTRE_ID_PATTERN } from './directory.ts';
import { checkListing, checkLocation, listingFieldsSchema, locationFields } from './listing.ts';
import { LAST_RESULTS } from './snapshot.ts';

/**
 * Merge's own history file `data/state/state.json` (AD-6). Only merge writes it. Version 2 (Story
 * 3.12) adds each centre's newest skip; a version 1 file is upgraded in memory by `upgradeState`
 * (the next write is version 2). A file with any other `stateVersion` is refused.
 */

/** The `stateVersion` this schema describes. */
export const STATE_VERSION = 2;

/** Why a centre was skipped (collect's skip reasons). */
export const SKIP_REASONS = ['robots', 'budget', 'opted-out', 'no-reader'] as const;

/** A UTC ISO 8601 datetime ending in `Z` (run timestamps). */
const utcDatetime = z.iso.datetime();

/** A listing as kept across runs: the normalised listing plus its history fields. */
export const storedListingSchema = listingFieldsSchema
	.extend({
		/** The run that first saw this id; set once, never changed. */
		first_seen_at: utcDatetime,
		/** The `ok` run that first missed it (tombstone); `null` while listed. */
		removed_at: utcDatetime.nullable(),
		/** Seen on the centre's first `ok` run, so it is not "new". */
		baseline: z.boolean(),
		/** Listings stored before Story 3.10 lack it and were all timed (no `stateVersion` bump). */
		time_known: z.boolean().default(true),
		/** Located coordinates (Story 2.10). Optional: listings stored before locate lack them. */
		lat: locationFields.lat.optional(),
		lon: locationFields.lon.optional(),
		location: locationFields.location.optional(),
	})
	.superRefine((listing, ctx) => {
		checkListing(listing, ctx);
		checkLocation(listing, ctx);
		const present = [listing.lat, listing.lon, listing.location].filter((value) => value !== undefined).length;
		if (present !== 0 && present !== 3) {
			ctx.addIssue({ code: 'custom', path: ['location'], message: 'lat, lon and location must all be present or all be absent' });
		}
	});

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * One centre's history. An entry exists once the centre has had any outcome (`ok`, `failed` or a
 * skip); a centre that was only ever skipped has `last_result`, `last_checked_at` and
 * `last_success_at` null and no listings. The skip fields record the newest skip of any reason and
 * the newest robots skip, and are kept across later checks.
 */
export const centreStateSchema = z.strictObject({
	last_result: z.enum(LAST_RESULTS).nullable(),
	last_checked_at: utcDatetime.nullable(),
	last_success_at: utcDatetime.nullable(),
	last_skip_reason: z.enum(SKIP_REASONS).nullable(),
	last_skip_at: utcDatetime.nullable(),
	last_robots_skip_at: utcDatetime.nullable(),
	listings: z.array(storedListingSchema).superRefine((listings, ctx) => {
		for (let index = 1; index < listings.length; index += 1) {
			if (byId(listings[index - 1]!, listings[index]!) >= 0) {
				ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'listing ids must be unique and sorted' });
			}
		}
	}),
});

export const stateSchema = z.strictObject({
	stateVersion: z.literal(STATE_VERSION),
	centres: z.record(z.string().regex(CENTRE_ID_PATTERN, { message: 'must be a lowercase slug' }), centreStateSchema).superRefine((centres, ctx) => {
		for (const [centreId, centre] of Object.entries(centres)) {
			centre.listings.forEach((listing, index) => {
				if (listing.centre_id !== centreId) {
					ctx.addIssue({ code: 'custom', path: [centreId, 'listings', index, 'centre_id'], message: `must equal its centre key "${centreId}"` });
				}
			});
		}
	}),
});

export type StoredListing = z.infer<typeof storedListingSchema>;
export type SkipReason = (typeof SKIP_REASONS)[number];
export type CentreState = z.infer<typeof centreStateSchema>;
export type State = z.infer<typeof stateSchema>;

/** The state before any run. */
export const emptyState = (): State => ({ stateVersion: STATE_VERSION, centres: {} });

/** `listings` sorted by id (code-unit order), the order state keeps them in. */
export const sortListings = <T extends { id: string }>(listings: readonly T[]): T[] => [...listings].sort(byId);

/**
 * `data` as a version 2 state object, still to be validated: a version 2 object as it is, a
 * version 1 object with each centre given the three skip fields as `null`. Any other version (or
 * not an object) is null. Version 1 centres that are not objects are left for the schema to refuse.
 */
export function upgradeState(data: unknown): { data: unknown; upgradedFrom: 1 | null } | null {
	if (typeof data !== 'object' || data === null) return null;
	const { stateVersion, centres } = data as { stateVersion?: unknown; centres?: unknown };
	if (stateVersion === STATE_VERSION) return { data, upgradedFrom: null };
	if (stateVersion !== 1) return null;
	const upgraded =
		typeof centres === 'object' && centres !== null && !Array.isArray(centres)
			? Object.fromEntries(
					Object.entries(centres).map(([id, centre]) => [
						id,
						typeof centre === 'object' && centre !== null && !Array.isArray(centre)
							? { ...centre, last_skip_reason: null, last_skip_at: null, last_robots_skip_at: null }
							: centre,
					]),
				)
			: centres;
	return { data: { ...data, stateVersion: STATE_VERSION, centres: upgraded }, upgradedFrom: 1 };
}
