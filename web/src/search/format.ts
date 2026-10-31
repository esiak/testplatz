import { FRESHNESS_MS } from '../../../shared/snapshot.ts';
import type { Lang } from '../i18n/i18n.tsx';

/**
 * Date and time words for result cards. Everything is Europe/Berlin local: dates and times come
 * from the `starts_at` / `deadline` strings themselves, and instants are converted with an
 * explicit time zone, so the browser's own zone never matters.
 */

const LOCALES: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };
const BERLIN = 'Europe/Berlin';
const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * HOUR_MS;

/** `YYYY-MM-DDTHH:mm…` → its local date parts and `HH:mm`. */
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/;

interface LocalParts {
	year: number;
	month: number;
	day: number;
	time: string;
}

function localParts(value: string): LocalParts {
	const match = LOCAL.exec(value);
	if (!match) throw new Error(`not a local date: ${value}`);
	return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), time: match[4] ?? '00:00' };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale}|${JSON.stringify(options)}`;
	let cached = formatters.get(key);
	if (!cached) {
		cached = new Intl.DateTimeFormat(locale, options);
		formatters.set(key, cached);
	}
	return cached;
}

/** Formats a calendar date (no zone shifts: the parts are placed at UTC midnight and read in UTC). */
function calendar(parts: LocalParts, lang: Lang, options: Intl.DateTimeFormatOptions): string {
	return formatter(LOCALES[lang], { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

/** An instant's Europe/Berlin date and `HH:mm`. */
function berlinParts(ms: number): LocalParts {
	const parts = formatter('en-US', {
		timeZone: BERLIN,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(new Date(ms));
	const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
	return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), time: `${get('hour')}:${get('minute')}` };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Today's date in Europe/Berlin as `YYYY-MM-DD`. */
export function berlinToday(now: number): string {
	const { year, month, day } = berlinParts(now);
	return `${year}-${pad(month)}-${pad(day)}`;
}

const WEEKDAY_DAY_MONTH: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };

/** Card date: en `Wed 9 Dec, 10:00`, de `Mi., 9. Dez., 10:00` — the local date and time of `starts_at`. */
export function cardDate(startsAt: string, lang: Lang): string {
	const parts = localParts(startsAt);
	return `${calendar(parts, lang, WEEKDAY_DAY_MONTH)}, ${parts.time}`;
}

/** Date tile parts: en `{ month: 'Dec', day: '9', weekday: 'Wed' }`, de `{ month: 'Dez', day: '9', weekday: 'Mi' }`. */
export function tileDate(startsAt: string, lang: Lang): { month: string; day: string; weekday: string } {
	const parts = localParts(startsAt);
	return {
		month: calendar(parts, lang, { month: 'short' }),
		day: String(parts.day),
		weekday: calendar(parts, lang, { weekday: 'short' }),
	};
}

/** The local start time of `starts_at` as `HH:mm`. */
export function cardTime(startsAt: string): string {
	return localParts(startsAt).time;
}

export type DeadlineState = { kind: 'unknown' } | { kind: 'passed' } | { kind: 'date'; date: string };

/** `null` → unknown; before today's Berlin date → passed (the card stays); else the date in the given language. */
export function deadlineState(deadline: string | null, now: number, lang: Lang): DeadlineState {
	if (deadline === null) return { kind: 'unknown' };
	if (deadline < berlinToday(now)) return { kind: 'passed' };
	return { kind: 'date', date: calendar(localParts(deadline), lang, { day: 'numeric', month: 'short' }) };
}

export type Freshness = { kind: 'under_hour' } | { kind: 'relative'; hours: number } | { kind: 'exact'; time: string };

/**
 * A centre's last successful check: under 1 h, whole hours under 36 h, else the exact Berlin
 * time — weekday and `HH:mm` within the last 6 Berlin calendar days, weekday, day and month before that. A future
 * timestamp counts as age 0.
 */
export function freshness(lastSuccessAt: string, now: number, lang: Lang): Freshness {
	const at = Date.parse(lastSuccessAt);
	const age = Math.max(0, now - at);
	if (age < HOUR_MS) return { kind: 'under_hour' };
	if (age < FRESHNESS_MS) return { kind: 'relative', hours: Math.floor(age / HOUR_MS) };
	const parts = berlinParts(at);
	// Weekday only within the last 6 calendar days, so it never names today's weekday of last week.
	const withinWeek = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` > berlinToday(now - WEEK_MS);
	const time = withinWeek ? `${calendar(parts, lang, { weekday: 'short' })} ${parts.time}` : `${calendar(parts, lang, WEEKDAY_DAY_MONTH)}, ${parts.time}`;
	return { kind: 'exact', time };
}
