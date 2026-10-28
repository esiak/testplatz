import { z } from 'zod';
import { isHttpUrl } from './directory.ts';

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
