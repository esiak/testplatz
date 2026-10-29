/**
 * Normalise stage (AD-7, FR8): turns one centre's `RawListing`s into `Listing`s with an id,
 * `starts_at` with the Europe/Berlin offset, the centre address as fallback and `link_ok` from
 * this run's detail pages. Pure: no clock, no I/O.
 */
import { formatAddress, type Centre } from '../../shared/directory.ts';
import { listingSchema, type Listing, type RawListing } from '../../shared/listing.ts';
import type { PageSummary } from '../../shared/reader.ts';
import type { CentreOutcome } from './collect.ts';

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

const formatOffset = (minutes: number): string => {
	const abs = Math.abs(minutes);
	const pad = (n: number) => String(n).padStart(2, '0');
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

/** A URL without its `#fragment` (normalised when parseable), for comparing pages. */
const withoutFragment = (url: string): string => (URL.canParse(url) ? new URL(url).href : url).replace(/#.*$/, '');

/** URLs (and final URLs) of this run's 2xx detail pages, without fragments. */
function okDetailUrls(pages: readonly PageSummary[]): Set<string> {
	const urls = new Set<string>();
	for (const page of pages) {
		if (page.role !== 'detail' || page.status === null || page.status < 200 || page.status > 299) continue;
		urls.add(withoutFragment(page.url));
		if (page.finalUrl !== null) urls.add(withoutFragment(page.finalUrl));
	}
	return urls;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** `null` sorts after every string. */
const compareNullable = (a: string | null, b: string | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : compare(a, b));

type Unnamed = Omit<Listing, 'id'>;

/** A comparable key over every normalised field, in schema order. */
const contentKey = (listing: Unnamed): string =>
	JSON.stringify([
		listing.centre_id,
		listing.starts_at,
		listing.place,
		listing.address,
		listing.status,
		listing.deadline,
		listing.registration_method,
		listing.source_url,
		listing.link_ok,
		listing.eligibility,
	]);

/** Same-minute order: place (`null` last), then source_url, then address; the full content breaks ties. */
const sameMinuteOrder = (a: Unnamed, b: Unnamed): number =>
	compareNullable(a.place, b.place) || compare(a.source_url, b.source_url) || compare(a.address, b.address) || compare(contentKey(a), contentKey(b));

/**
 * The centre's listings, ordered by id. Ids are `<centre_id>@<date>T<time>`; same-minute dates
 * collapse exact duplicates, then take `#2`, `#3`, … in `sameMinuteOrder`.
 */
export function normaliseCentre(centre: Centre, raw: readonly RawListing[], pages: readonly PageSummary[]): Listing[] {
	const okUrls = okDetailUrls(pages);
	const fallbackAddress = formatAddress(centre.address);
	const groups = new Map<string, Unnamed[]>();
	for (const item of raw) {
		const listing: Unnamed = {
			centre_id: centre.centre_id,
			starts_at: startsAt(item.date, item.time),
			place: item.place,
			address: item.address ?? fallbackAddress,
			status: item.status,
			deadline: item.deadline,
			registration_method: item.registration_method,
			source_url: item.source_url,
			link_ok: okUrls.has(withoutFragment(item.source_url)),
			eligibility: item.eligibility,
		};
		const minute = `${item.date}T${item.time}`;
		const group = groups.get(minute) ?? [];
		if (!group.some((other) => contentKey(other) === contentKey(listing))) group.push(listing);
		groups.set(minute, group);
	}
	const listings: Listing[] = [];
	for (const [minute, group] of groups) {
		group.sort(sameMinuteOrder).forEach((listing, index) => {
			const id = `${centre.centre_id}@${minute}${index === 0 ? '' : `#${index + 1}`}`;
			listings.push({ id, ...listing });
		});
	}
	return listings.sort((a, b) => compare(a.id, b.id));
}

/** A centre's outcome after normalise: `ok` carries `Listing`s; `failed` and `skipped` pass through. */
export type NormalisedOutcome = Exclude<CentreOutcome, { kind: 'ok' }> | { kind: 'ok'; listings: Listing[] };

/**
 * Normalises an `ok` outcome with the centre's pages from this run. Output that fails
 * `listingSchema` fails only this centre (`failed('schema')`), like reader output.
 */
export function normaliseOutcome(centre: Centre, outcome: CentreOutcome, pages: readonly PageSummary[]): NormalisedOutcome {
	if (outcome.kind !== 'ok') return outcome;
	const listings = normaliseCentre(centre, outcome.listings, pages);
	if (!listings.every((listing) => listingSchema.safeParse(listing).success)) return { kind: 'failed', reason: 'schema' };
	return { kind: 'ok', listings };
}
