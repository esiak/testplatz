import { z } from 'zod';
import { BAVARIA_BBOX, CENTRE_ID_PATTERN, isHttpUrl } from './directory.ts';

/** Seat status of one test date (data-sources.md §Status mapping). */
export const STATUS_CODES = ['free', 'booked_out', 'waitlist', 'unknown'] as const;
export type StatusCode = (typeof STATUS_CODES)[number];

/** How a candidate registers for a test date. */
export const REGISTRATION_METHODS = ['online', 'email', 'post', 'in_person'] as const;
export type RegistrationMethod = (typeof REGISTRATION_METHODS)[number];

/** Upper bound for the verbatim "who may register" text (CAP-11). */
export const ELIGIBILITY_MAX_LENGTH = 500;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for a real calendar date written `YYYY-MM-DD` (rejects `2026-02-30`). */
export function isLocalDate(value: string): boolean {
	const match = DATE_PATTERN.exec(value);
	if (match === null) return false;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (month < 1 || month > 12 || day < 1) return false;
	// Day 0 of the next month is the last day of this one; UTC keeps it free of local time zones.
	// `setUTCFullYear` takes years 0–99 literally (`Date.UTC` would map them to 1900+).
	const lastDay = new Date(0);
	lastDay.setUTCFullYear(year, month, 0);
	return day <= lastDay.getUTCDate();
}

/** True for a wall-clock time `HH:mm` between 00:00 and 23:59. */
export const isLocalTime = (value: string): boolean => TIME_PATTERN.test(value);

const localDate = z.string().refine(isLocalDate, { message: 'must be a real local date YYYY-MM-DD' });
const localTime = z.string().refine(isLocalTime, { message: 'must be a local time HH:mm (00:00–23:59)' });
/** Free text that is not empty or whitespace only; an absent value is `null`, never `''`. */
const notBlank = (schema: z.ZodString) =>
	schema.refine((value) => value.trim() !== '', { message: 'must not be blank; use null when absent' });

/**
 * One test date as a reader emits it, before normalise adds `centre_id`, `starts_at`, `link_ok`
 * and `first_seen_at`. Strict: unknown keys (such as an instructor name) are rejected, and every
 * optional field must be present as `null` when absent.
 */
export const rawListingSchema = z.strictObject({
	date: localDate,
	time: localTime,
	place: notBlank(z.string()).nullable(),
	/** Free text as published; normalise falls back to the centre address when `null`. */
	address: notBlank(z.string()).nullable(),
	status: z.enum(STATUS_CODES),
	deadline: localDate.nullable(),
	registration_method: z.enum(REGISTRATION_METHODS).nullable(),
	eligibility: notBlank(z.string().max(ELIGIBILITY_MAX_LENGTH)).nullable(),
	source_url: z.string().refine(isHttpUrl, { message: 'must be an http(s) URL with a plausible hostname' }),
});

export type RawListing = z.infer<typeof rawListingSchema>;

/** `starts_at`: local date and time with seconds `:00` and the Europe/Berlin offset in force. */
const STARTS_AT_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00\+0[12]:00$/;
/** Listing id (AD-7): `<centre_id>@<YYYY-MM-DDTHH:mm>`, then `#2`, `#3`, … for further same-minute dates. */
export const LISTING_ID_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?:#([2-9]|[1-9]\d+))?$/;

const startsAt = z.string().refine(
	(value) => {
		const match = STARTS_AT_PATTERN.exec(value);
		return match !== null && isLocalDate(match[1]!) && isLocalTime(match[2]!);
	},
	{ message: 'must be YYYY-MM-DDTHH:mm:00 with offset +01:00 or +02:00' },
);

/** The normalised listing fields, without the cross-field checks (extend this, then add `checkListing`). */
export const listingFieldsSchema = z.strictObject({
	id: z.string().regex(LISTING_ID_PATTERN, { message: 'must be <centre_id>@<YYYY-MM-DDTHH:mm>[#n]' }),
	centre_id: z.string().regex(CENTRE_ID_PATTERN, { message: 'must be a lowercase slug' }),
	starts_at: startsAt,
	place: rawListingSchema.shape.place,
	/** Never `null`: normalise falls back to the centre address. */
	address: notBlank(z.string()),
	status: rawListingSchema.shape.status,
	deadline: rawListingSchema.shape.deadline,
	registration_method: rawListingSchema.shape.registration_method,
	source_url: rawListingSchema.shape.source_url,
	/** True only when a 2xx detail page fetched this run is the `source_url` (AD-7). */
	link_ok: z.boolean(),
	eligibility: rawListingSchema.shape.eligibility,
});

type ListingFields = z.infer<typeof listingFieldsSchema>;

/** Cross-field listing checks: the id names the listing's `centre_id` and the local minute of `starts_at`. */
export function checkListing(listing: ListingFields, ctx: z.RefinementCtx): void {
	const id = LISTING_ID_PATTERN.exec(listing.id);
	if (id === null) return;
	if (id[1] !== listing.centre_id) {
		ctx.addIssue({ code: 'custom', path: ['id'], message: `must start with the centre_id "${listing.centre_id}@"` });
	}
	if (id[2] !== listing.starts_at.slice(0, 16)) {
		ctx.addIssue({ code: 'custom', path: ['id'], message: 'must name the local date and time of starts_at' });
	}
}

/**
 * One test date after normalise (AD-7): identity, `starts_at` with offset, address fallback and
 * `link_ok`. The shape shared by the merge state and the later snapshot.
 */
export const listingSchema = listingFieldsSchema.superRefine(checkListing);

export type Listing = z.infer<typeof listingSchema>;

/**
 * Where a listing's coordinates come from (FR36): `venue` = its own test address, `centre` = the
 * centre's coordinates as a fallback (no provider address, unparseable, not found, over the cap).
 */
export const LOCATIONS = ['venue', 'centre'] as const;
export type Location = (typeof LOCATIONS)[number];

/** The location fields locate adds: `lat`/`lon` both numbers or both `null`, and `location`. */
export const locationFields = {
	lat: z.number().nullable(),
	lon: z.number().nullable(),
	location: z.enum(LOCATIONS),
} as const;

/** Location checks: `lat`/`lon` both numbers inside the Bavaria box or both `null`. */
export function checkLocation(listing: { lat?: number | null; lon?: number | null }, ctx: z.RefinementCtx): void {
	const lat = listing.lat ?? null;
	const lon = listing.lon ?? null;
	if ((lat === null) !== (lon === null)) {
		ctx.addIssue({ code: 'custom', path: [lat === null ? 'lat' : 'lon'], message: 'lat and lon must both be numbers or both be null' });
	}
	if (lat !== null && (lat < BAVARIA_BBOX.minLat || lat > BAVARIA_BBOX.maxLat)) {
		ctx.addIssue({ code: 'custom', path: ['lat'], message: `must lie inside Bavaria (${BAVARIA_BBOX.minLat}–${BAVARIA_BBOX.maxLat})` });
	}
	if (lon !== null && (lon < BAVARIA_BBOX.minLon || lon > BAVARIA_BBOX.maxLon)) {
		ctx.addIssue({ code: 'custom', path: ['lon'], message: `must lie inside Bavaria (${BAVARIA_BBOX.minLon}–${BAVARIA_BBOX.maxLon})` });
	}
}

/** A listing after locate: the normalised listing plus `lat`, `lon` and `location`. */
export const locatedListingSchema = listingFieldsSchema.extend(locationFields).superRefine((listing, ctx) => {
	checkListing(listing, ctx);
	checkLocation(listing, ctx);
});

export type LocatedListing = z.infer<typeof locatedListingSchema>;

/**
 * Availability indicators a reader found on a page; absent means not seen. When the provider's
 * flag does not apply (e.g. ITEM KG with in-person-only registration), the reader passes no
 * availability signal, which maps to `unknown`.
 */
export interface StatusSignals {
	waitlist?: boolean;
	bookedOut?: boolean;
	free?: boolean;
}

/**
 * The status code for the signals. Precedence: waitlist > booked_out > free > unknown; no signal
 * (including a provider flag that does not apply) → `unknown`.
 */
export function mapStatus(signals: StatusSignals): StatusCode {
	if (signals.waitlist === true) return 'waitlist';
	if (signals.bookedOut === true) return 'booked_out';
	if (signals.free === true) return 'free';
	return 'unknown';
}

/**
 * Eligibility text ready for a listing: whitespace collapsed, cut at a word boundary with `…` so
 * it fits `ELIGIBILITY_MAX_LENGTH`. Empty or blank text → `null`.
 */
export function clampEligibility(text: string | null | undefined): string | null {
	if (text === null || text === undefined) return null;
	const collapsed = text.replace(/\s+/g, ' ').trim();
	if (collapsed === '') return null;
	if (collapsed.length <= ELIGIBILITY_MAX_LENGTH) return collapsed;
	const room = ELIGIBILITY_MAX_LENGTH - 1; // leaves space for the ellipsis
	const cut = collapsed.slice(0, room + 1);
	const lastSpace = cut.lastIndexOf(' ');
	const head = lastSpace > 0 ? cut.slice(0, lastSpace) : collapsed.slice(0, room);
	return `${head.trimEnd()}…`;
}
