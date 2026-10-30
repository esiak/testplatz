import { z } from 'zod';
import { CENTRE_ID_PATTERN } from './directory.ts';
import { checkListing, checkLocation, listingFieldsSchema, locationFields } from './listing.ts';
import { LAST_RESULTS } from './snapshot.ts';

/**
 * Merge's own history file `data/state/state.json` (AD-6). Only merge writes it. A file with any
 * other `stateVersion` is refused rather than migrated silently.
 */

/** The `stateVersion` this schema describes. */
export const STATE_VERSION = 1;

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

/** One centre's history. An entry exists once the centre has had an `ok` or `failed` run. */
export const centreStateSchema = z.strictObject({
	last_result: z.enum(LAST_RESULTS),
	last_checked_at: utcDatetime,
	last_success_at: utcDatetime.nullable(),
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
export type CentreState = z.infer<typeof centreStateSchema>;
export type State = z.infer<typeof stateSchema>;

/** The state before any run. */
export const emptyState = (): State => ({ stateVersion: STATE_VERSION, centres: {} });

/** `listings` sorted by id (code-unit order), the order state keeps them in. */
export const sortListings = <T extends { id: string }>(listings: readonly T[]): T[] => [...listings].sort(byId);
