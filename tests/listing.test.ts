import { describe, expect, it } from 'vitest';
import {
	clampEligibility,
	ELIGIBILITY_MAX_LENGTH,
	mapStatus,
	rawListingSchema,
	REGISTRATION_METHODS,
	STATUS_CODES,
	type RawListing,
	type StatusSignals,
} from '../shared/listing.ts';

const listing = (extra: Partial<RawListing> = {}): RawListing => ({
	date: '2026-11-12',
	time: '09:30',
	place: 'Raum 2.04',
	address: 'Hauptstraße 1, 80331 München',
	status: 'free',
	deadline: '2026-10-15',
	registration_method: 'online',
	eligibility: 'Nur für Personen mit Hauptwohnsitz in München.',
	source_url: 'https://example.de/kurs/1',
	...extra,
});

const accepts = (value: unknown): boolean => rawListingSchema.safeParse(value).success;

describe('rawListingSchema', () => {
	it('accepts a full listing', () => {
		expect(accepts(listing())).toBe(true);
	});

	it.each(STATUS_CODES)('accepts status %s', (status) => {
		expect(accepts(listing({ status }))).toBe(true);
	});

	it.each(REGISTRATION_METHODS)('accepts registration method %s', (registration_method) => {
		expect(accepts(listing({ registration_method }))).toBe(true);
	});

	it('accepts null for every optional field', () => {
		expect(
			accepts(listing({ place: null, address: null, deadline: null, registration_method: null, eligibility: null })),
		).toBe(true);
	});

	it('rejects an unknown status or registration code', () => {
		expect(accepts({ ...listing(), status: 'full' })).toBe(false);
		expect(accepts({ ...listing(), registration_method: 'phone' })).toBe(false);
	});

	it.each(['place', 'address', 'deadline', 'registration_method', 'eligibility'] as const)(
		'rejects a missing %s key (absent fields must be null)',
		(key) => {
			const { [key]: _omitted, ...rest } = listing();
			expect(accepts(rest)).toBe(false);
		},
	);

	it('rejects unknown keys such as personal data or normalise fields', () => {
		for (const key of ['instructor', 'centre_id', 'starts_at', 'link_ok', 'first_seen_at']) {
			expect(accepts({ ...listing(), [key]: 'x' }), key).toBe(false);
		}
	});

	it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-5', '12.11.2026', '2026-11-12T09:30', ''])(
		'rejects date %j',
		(date) => {
			expect(accepts(listing({ date }))).toBe(false);
			expect(accepts(listing({ deadline: date }))).toBe(false);
		},
	);

	it('accepts a leap day only in a leap year', () => {
		expect(accepts(listing({ date: '2028-02-29' }))).toBe(true);
		expect(accepts(listing({ date: '2027-02-29' }))).toBe(false);
	});

	it.each(['24:00', '9:30', '09:60', '09:30:00', '0930', ''])('rejects time %j', (time) => {
		expect(accepts(listing({ time }))).toBe(false);
	});

	it('accepts the edges of the day', () => {
		expect(accepts(listing({ time: '00:00' }))).toBe(true);
		expect(accepts(listing({ time: '23:59' }))).toBe(true);
	});

	it.each(['ftp://example.de/kurs', '/kurs/1', 'https://www.vhs-kisshab,de/kurs', 'not a url'])(
		'rejects source_url %j',
		(source_url) => {
			expect(accepts(listing({ source_url }))).toBe(false);
		},
	);

	it('accepts eligibility of exactly the max length', () => {
		expect(accepts(listing({ eligibility: 'a'.repeat(ELIGIBILITY_MAX_LENGTH) }))).toBe(true);
	});

	it('rejects eligibility over the max length', () => {
		expect(accepts(listing({ eligibility: 'a'.repeat(ELIGIBILITY_MAX_LENGTH + 1) }))).toBe(false);
	});

	it.each(['place', 'address', 'eligibility'] as const)('rejects an empty or blank %s (absent must be null)', (key) => {
		for (const blank of ['', ' ', '\n\t ']) {
			expect(accepts(listing({ [key]: blank })), JSON.stringify(blank)).toBe(false);
		}
	});

	it('checks years 0000–0099 as written (no 1900+ mapping)', () => {
		// Year 0 is a leap year (divisible by 400), 1900 is not: a 1900+ mapping would reject this date.
		expect(accepts(listing({ date: '0000-02-29' }))).toBe(true);
		expect(accepts(listing({ date: '0001-02-29' }))).toBe(false);
	});
});

describe('mapStatus', () => {
	it.each<[StatusSignals, string]>([
		[{ waitlist: true, bookedOut: true }, 'waitlist'],
		[{ bookedOut: true, free: true }, 'booked_out'],
		[{ free: true }, 'free'],
		[{}, 'unknown'],
		[{ waitlist: true, bookedOut: true, free: true }, 'waitlist'],
		[{ waitlist: false, bookedOut: false, free: false }, 'unknown'],
	])('%j → %s', (signals, expected) => {
		expect(mapStatus(signals)).toBe(expected);
	});

	// data-sources.md §Status mapping, one line each, expressed as the signals a reader would set.
	it.each<[string, StatusSignals, string]>([
		['any system: booked out with a waitlist offer', { bookedOut: true, waitlist: true }, 'waitlist'],
		['KuferWeb: "AUSGEBUCHT" in the title', { bookedOut: true }, 'booked_out'],
		['KuferWeb: full traffic light', { bookedOut: true }, 'booked_out'],
		['KuferWeb: free traffic light', { free: true }, 'free'],
		['KuferWeb: no indicator', {}, 'unknown'],
		['ITEM KG: bookable true', { free: true }, 'free'],
		['ITEM KG: bookable false', { bookedOut: true }, 'booked_out'],
		['ITEM KG: bookable absent', {}, 'unknown'],
		// The bookable flag does not apply to in-person-only registration, so the reader passes no availability signal.
		['ITEM KG: registration in person only (flag does not apply, no signal)', {}, 'unknown'],
	])('%s → %s', (_line, signals, expected) => {
		expect(mapStatus(signals)).toBe(expected);
	});
});

describe('clampEligibility', () => {
	it('returns null for null, undefined, empty or blank text', () => {
		expect(clampEligibility(null)).toBeNull();
		expect(clampEligibility(undefined)).toBeNull();
		expect(clampEligibility('')).toBeNull();
		expect(clampEligibility(' \n\t ')).toBeNull();
	});

	it('collapses whitespace and keeps short text whole', () => {
		expect(clampEligibility('  Nur für\n\tPersonen   mit Wohnsitz  in München. ')).toBe(
			'Nur für Personen mit Wohnsitz in München.',
		);
	});

	it('keeps text of exactly the max length whole', () => {
		const text = 'a'.repeat(ELIGIBILITY_MAX_LENGTH);
		expect(clampEligibility(text)).toBe(text);
	});

	it('cuts a long paragraph at a word boundary with an ellipsis', () => {
		const words = Array.from({ length: 400 }, (_, i) => `Wort${i}`);
		const paragraph = words.join('  \n ');
		expect(paragraph.length).toBeGreaterThan(2000);
		const clamped = clampEligibility(paragraph)!;
		expect(clamped.length).toBeLessThanOrEqual(ELIGIBILITY_MAX_LENGTH);
		expect(clamped.endsWith('…')).toBe(true);
		expect(clamped).not.toMatch(/\s{2,}|\n/);
		const kept = clamped.slice(0, -1).split(' ');
		expect(kept).toEqual(words.slice(0, kept.length));
		expect(rawListingSchema.shape.eligibility.safeParse(clamped).success).toBe(true);
	});

	it('cuts a single over-long word hard', () => {
		const clamped = clampEligibility('x'.repeat(2000))!;
		expect(clamped).toBe(`${'x'.repeat(ELIGIBILITY_MAX_LENGTH - 1)}…`);
	});
});
