import { z } from 'zod';
import { isInBavariaBox } from './directory.ts';

/**
 * The venue cache `data/state/venues.json` (FR36, AD-6): Nominatim results for test-date
 * addresses, keyed by `normaliseAddress`. Only merge writes it. A hit has coordinates and
 * `reason: null`; a miss has null coordinates and the rejection reason, and is retried after
 * `VENUE_MISS_RETRY_MS`. Failed requests are never cached.
 */

/** The `venuesVersion` this schema describes. */
export const VENUES_VERSION = 1;

/** A cached miss older than this (by the run's clock) counts as not cached: 30 days. */
export const VENUE_MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

export const venueEntrySchema = z
	.strictObject({
		/** The run that looked the address up (UTC). */
		fetched_at: z.iso.datetime(),
		lat: z.number().nullable(),
		lon: z.number().nullable(),
		/** Why a miss was rejected; `null` for a hit. */
		reason: z.string().min(1).nullable(),
	})
	.superRefine((entry, ctx) => {
		const hit = entry.lat !== null && entry.lon !== null && entry.reason === null;
		const miss = entry.lat === null && entry.lon === null && entry.reason !== null;
		if (!hit && !miss) {
			ctx.addIssue({ code: 'custom', path: ['reason'], message: 'must be a hit (lat, lon, reason null) or a miss (lat and lon null, a reason)' });
		} else if (hit && !isInBavariaBox(entry.lat!, entry.lon!)) {
			ctx.addIssue({ code: 'custom', path: ['lat'], message: 'must lie inside Bavaria' });
		}
	});

export const venuesSchema = z.strictObject({
	venuesVersion: z.literal(VENUES_VERSION),
	entries: z.record(z.string().min(1), venueEntrySchema),
});

export type VenueEntry = z.infer<typeof venueEntrySchema>;
export type Venues = z.infer<typeof venuesSchema>;

/** The cache before any lookup. */
export const emptyVenues = (): Venues => ({ venuesVersion: VENUES_VERSION, entries: {} });
