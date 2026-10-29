import { afterEach, describe, expect, it } from 'vitest';
import { berlinToday, cardDate, deadlineState, freshness } from '../web/src/search/format.ts';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const at = (iso: string): number => Date.parse(iso);
const iso = (ms: number): string => new Date(ms).toISOString();

const originalTz = process.env.TZ;
afterEach(() => {
	if (originalTz === undefined) delete process.env.TZ;
	else process.env.TZ = originalTz;
});

describe('cardDate', () => {
	it('formats the local date and time of starts_at in both languages', () => {
		expect(cardDate('2026-12-09T10:00:00+01:00', 'en')).toBe('Wed 9 Dec, 10:00');
		expect(cardDate('2026-12-09T10:00:00+01:00', 'de')).toBe('Mi., 9. Dez., 10:00');
	});

	it('reads summer-time dates from the string, not from a UTC conversion', () => {
		expect(cardDate('2026-07-01T09:30:00+02:00', 'en')).toBe('Wed 1 Jul, 09:30');
		expect(cardDate('2026-07-01T00:30:00+02:00', 'en')).toBe('Wed 1 Jul, 00:30');
	});

	it('does not depend on the browser time zone', () => {
		for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
			process.env.TZ = tz;
			expect(cardDate('2026-12-09T23:30:00+01:00', 'en')).toBe('Wed 9 Dec, 23:30');
			expect(cardDate('2026-12-09T00:15:00+01:00', 'de')).toBe('Mi., 9. Dez., 00:15');
		}
	});
});

describe('berlinToday and deadlineState', () => {
	it('uses the Berlin date, not the UTC date', () => {
		// 23:30 UTC on 29 Oct is 00:30 on 30 Oct in Berlin (CET).
		expect(berlinToday(at('2026-10-29T23:30:00Z'))).toBe('2026-10-30');
		// 22:30 UTC on 1 Jul is 00:30 on 2 Jul in Berlin (CEST).
		expect(berlinToday(at('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
	});

	it('is unknown for null, passed before today, and the date from today on', () => {
		const now = at('2026-10-29T23:30:00Z');
		expect(deadlineState(null, now, 'en')).toEqual({ kind: 'unknown' });
		expect(deadlineState('2026-10-29', now, 'en')).toEqual({ kind: 'passed' });
		expect(deadlineState('2026-10-30', now, 'en')).toEqual({ kind: 'date', date: '30 Oct' });
		expect(deadlineState('2026-11-11', now, 'en')).toEqual({ kind: 'date', date: '11 Nov' });
		expect(deadlineState('2026-11-11', now, 'de')).toEqual({ kind: 'date', date: '11. Nov.' });
	});

	it('does not depend on the browser time zone', () => {
		process.env.TZ = 'America/Los_Angeles';
		expect(berlinToday(at('2026-10-29T23:30:00Z'))).toBe('2026-10-30');
	});
});

describe('freshness', () => {
	// Thursday 29 Oct 2026, 06:00 in Berlin (CET).
	const now = at('2026-10-29T05:00:00Z');

	it('reads "under 1 h" below an hour, and for a future timestamp', () => {
		expect(freshness(iso(now - 59 * MINUTE), now, 'en')).toEqual({ kind: 'under_hour' });
		expect(freshness(iso(now), now, 'en')).toEqual({ kind: 'under_hour' });
		expect(freshness(iso(now + 5 * HOUR), now, 'en')).toEqual({ kind: 'under_hour' });
	});

	it('gives whole hours, floored, below 36 h', () => {
		expect(freshness(iso(now - HOUR), now, 'en')).toEqual({ kind: 'relative', hours: 1 });
		expect(freshness(iso(now - 2 * HOUR), now, 'en')).toEqual({ kind: 'relative', hours: 2 });
		expect(freshness(iso(now - 35 * HOUR - 59 * MINUTE), now, 'en')).toEqual({ kind: 'relative', hours: 35 });
	});

	it('gives the Berlin weekday and time from 36 h to under 7 days', () => {
		expect(freshness(iso(now - 36 * HOUR), now, 'en')).toEqual({ kind: 'exact', time: 'Tue 18:00' });
		// 40 h ago: Tuesday 27 Oct, 14:00 in Berlin.
		expect(freshness('2026-10-27T13:00:00Z', now, 'en')).toEqual({ kind: 'exact', time: 'Tue 14:00' });
		expect(freshness('2026-10-27T13:00:00Z', now, 'de')).toEqual({ kind: 'exact', time: 'Di 14:00' });
	});

	it('adds day and month from 7 days on, with the summer-time offset of that day', () => {
		// Monday 19 Oct, 14:00 in Berlin (CEST).
		expect(freshness('2026-10-19T12:00:00Z', now, 'en')).toEqual({ kind: 'exact', time: 'Mon 19 Oct, 14:00' });
		expect(freshness('2026-10-19T12:00:00Z', now, 'de')).toEqual({ kind: 'exact', time: 'Mo., 19. Okt., 14:00' });
		expect(freshness(iso(now - 8 * 24 * HOUR), now, 'en')).toEqual({ kind: 'exact', time: 'Wed 21 Oct, 07:00' });
	});

	it('never gives a weekday-only label for today\'s weekday of last week', () => {
		// now: Thursday 29 Oct, 06:00 Berlin. 6 d 23 h ago: Thursday 22 Oct, 08:00 CEST (later clock time).
		expect(freshness(iso(now - 6 * 24 * HOUR - 23 * HOUR), now, 'en')).toEqual({ kind: 'exact', time: 'Thu 22 Oct, 08:00' });
		// 6 days 2 h ago, earlier in the day: Friday 23 Oct, 05:00 CEST.
		expect(freshness(iso(now - 6 * 24 * HOUR - 2 * HOUR), now, 'en')).toEqual({ kind: 'exact', time: 'Fri 05:00' });
	});

	it('does not depend on the browser time zone', () => {
		process.env.TZ = 'Pacific/Kiritimati';
		expect(freshness('2026-10-27T13:00:00Z', now, 'en')).toEqual({ kind: 'exact', time: 'Tue 14:00' });
	});
});
