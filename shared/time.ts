/**
 * Europe/Berlin wall-clock helpers shared by the pipeline (normalise builds `starts_at`) and the
 * browser (an untimed date stays current until its Berlin day ends, Story 3.10). Pure.
 */

const MINUTE_MS = 60_000;
/** The offsets Europe/Berlin uses, summer (CEST) first. */
const OFFSETS = [120, 60] as const;

const berlinOffsetFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'longOffset' });

/** The Europe/Berlin UTC offset in minutes at an instant (`GMT+02:00` → 120). */
function offsetMinutesAt(ms: number): number {
	const name = berlinOffsetFormat.formatToParts(new Date(ms)).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
	const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
	if (match === null) throw new Error(`unexpected Europe/Berlin offset name ${JSON.stringify(name)}`);
	const minutes = Number(match[2]) * 60 + Number(match[3]);
	return match[1] === '-' ? -minutes : minutes;
}

const pad = (n: number): string => String(n).padStart(2, '0');

const formatOffset = (minutes: number): string => {
	const abs = Math.abs(minutes);
	return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/**
 * The Europe/Berlin offset in force at local `date` (`YYYY-MM-DD`) and `time` (`HH:mm`):
 * `+01:00` or `+02:00`. An ambiguous fall-back time takes the earlier occurrence (`+02:00`); a
 * nonexistent spring-gap time takes the offset before the gap (`+01:00`).
 */
export function berlinOffset(date: string, time: string): string {
	const [year, month, day] = date.split('-').map(Number) as [number, number, number];
	const [hour, minute] = time.split(':').map(Number) as [number, number];
	const wall = new Date(0);
	wall.setUTCFullYear(year, month - 1, day);
	wall.setUTCHours(hour, minute, 0, 0);
	const wallMs = wall.getTime();
	// A candidate fits when Berlin really is at that offset at the instant it implies.
	for (const offset of OFFSETS) {
		if (offsetMinutesAt(wallMs - offset * MINUTE_MS) === offset) return formatOffset(offset);
	}
	// In the gap: the offset in force shortly before it.
	return formatOffset(offsetMinutesAt(wallMs - 3 * 60 * MINUTE_MS));
}

/** `starts_at`: `<date>T<time>:00` with the Europe/Berlin offset. */
export const startsAt = (date: string, time: string): string => `${date}T${time}:00${berlinOffset(date, time)}`;

/** The calendar day after `date` (`YYYY-MM-DD`), across month and year ends. */
export function nextDate(date: string): string {
	const [year, month, day] = date.split('-').map(Number) as [number, number, number];
	const next = new Date(0);
	next.setUTCFullYear(year, month - 1, day + 1);
	return `${String(next.getUTCFullYear()).padStart(4, '0')}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * The instant (ms) the Berlin day `date` ends: the next day's 00:00 Europe/Berlin, so a 23 h or
 * 25 h DST day keeps its real length (never `+24 h`).
 */
export const berlinDayEnd = (date: string): number => Date.parse(startsAt(nextDate(date), '00:00'));
