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
 * What normalise needs of a stored listing to keep same-minute ids stable: its id, place, URL and
 * whether it is tombstoned (`removed_at` set).
 */
export type PriorListing = Pick<Listing, 'id' | 'place' | 'source_url'> & { removed_at?: string | null };

/** A stored listing of one minute and the `#n` its id holds (the unsuffixed id is `#1`). */
interface Prior {
	listing: PriorListing;
	n: number;
}

/** The centre's stored listings grouped by minute (`YYYY-MM-DDTHH:mm`), each group by `#n`. */
function priorByMinute(centreId: string, previous: readonly PriorListing[]): Map<string, Prior[]> {
	const prefix = `${centreId}@`;
	const byMinute = new Map<string, Prior[]>();
	for (const listing of previous) {
		if (!listing.id.startsWith(prefix)) continue;
		const match = /^([^#]+)(?:#([2-9]|[1-9]\d+))?$/.exec(listing.id.slice(prefix.length));
		if (match === null) continue;
		const group = byMinute.get(match[1]!) ?? [];
		group.push({ listing, n: match[2] === undefined ? 1 : Number(match[2]) });
		byMinute.set(match[1]!, group);
	}
	// Live listings are tried before tombstoned ones, each by `#n`.
	const live = (prior: Prior): number => ((prior.listing.removed_at ?? null) === null ? 0 : 1);
	for (const group of byMinute.values()) group.sort((a, b) => live(a) - live(b) || a.n - b.n);
	return byMinute;
}

/** How often each value occurs. */
const counts = <T>(values: readonly T[]): Map<T, number> => {
	const out = new Map<T, number>();
	for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
	return out;
};

/**
 * Matching passes, strongest first: same `source_url` and `place`; then same `source_url` when that
 * URL belongs to exactly one session on each side (a URL several sessions share says nothing about
 * which is which); then the same non-null `place`.
 */
function matchPasses(sorted: readonly Unnamed[], priors: readonly Prior[]): Array<(listing: Unnamed, prior: PriorListing) => boolean> {
	const runUrls = counts(sorted.map((listing) => listing.source_url));
	const storedUrls = counts(priors.map((prior) => prior.listing.source_url));
	return [
		(listing, prior) => listing.source_url === prior.source_url && listing.place === prior.place,
		(listing, prior) => listing.source_url === prior.source_url && runUrls.get(listing.source_url) === 1 && storedUrls.get(prior.source_url) === 1,
		(listing, prior) => listing.place !== null && listing.place === prior.place,
	];
}

/**
 * The `#n` of each listing of one minute (`sorted` in `sameMinuteOrder`). A listing that matches a
 * stored one (each stored listing matches at most once, live before tombstoned) keeps its number;
 * the rest take the lowest numbers held by no stored listing of the minute, live or tombstoned, in
 * `sorted` order.
 */
function numberMinute(sorted: readonly Unnamed[], priors: readonly Prior[]): Map<Unnamed, number> {
	const numbers = new Map<Unnamed, number>();
	const unmatched = [...priors];
	for (const matches of matchPasses(sorted, priors)) {
		for (const listing of sorted) {
			if (numbers.has(listing)) continue;
			const index = unmatched.findIndex((prior) => matches(listing, prior.listing));
			if (index === -1) continue;
			numbers.set(listing, unmatched[index]!.n);
			unmatched.splice(index, 1);
		}
	}
	const taken = new Set(priors.map((prior) => prior.n));
	let next = 1;
	for (const listing of sorted) {
		if (numbers.has(listing)) continue;
		while (taken.has(next)) next += 1;
		numbers.set(listing, next);
		taken.add(next);
	}
	return numbers;
}

/**
 * The centre's listings, ordered by id, and the ids whose address is the centre fallback (the
 * reader gave none). Shared by `normaliseCentre` and `normaliseOutcome`.
 */
function buildListings(
	centre: Centre,
	raw: readonly RawListing[],
	pages: readonly PageSummary[],
	previous: readonly PriorListing[],
): { listings: Listing[]; centreAddressIds: string[] } {
	const okUrls = okDetailUrls(pages);
	const fallbackAddress = formatAddress(centre.address);
	const groups = new Map<string, Unnamed[]>();
	/** Listings whose address came from the fallback. */
	const fromCentre = new Set<Unnamed>();
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
		const same = group.find((other) => contentKey(other) === contentKey(listing));
		if (same === undefined) {
			group.push(listing);
			if (item.address === null) fromCentre.add(listing);
		} else if (item.address !== null) {
			// A duplicate whose provider did state the address: not a fallback.
			fromCentre.delete(same);
		}
		groups.set(minute, group);
	}
	const listings: Listing[] = [];
	const centreAddressIds: string[] = [];
	const priors = priorByMinute(centre.centre_id, previous);
	for (const [minute, group] of groups) {
		const sorted = group.sort(sameMinuteOrder);
		const numbers = numberMinute(sorted, priors.get(minute) ?? []);
		for (const listing of sorted) {
			const n = numbers.get(listing)!;
			const id = `${centre.centre_id}@${minute}${n === 1 ? '' : `#${n}`}`;
			listings.push({ id, ...listing });
			if (fromCentre.has(listing)) centreAddressIds.push(id);
		}
	}
	return { listings: listings.sort((a, b) => compare(a.id, b.id)), centreAddressIds: centreAddressIds.sort(compare) };
}

/**
 * The centre's listings, ordered by id. Ids are `<centre_id>@<date>T<time>`; same-minute dates
 * collapse exact duplicates, then keep the id of the stored listing they match in `previous` (the
 * centre's state listings, live and tombstoned), else take the lowest free `#n` in
 * `sameMinuteOrder` (AD-7, Story 3.8). With no `previous`, that is `#2`, `#3`, … in order.
 */
export function normaliseCentre(centre: Centre, raw: readonly RawListing[], pages: readonly PageSummary[], previous: readonly PriorListing[] = []): Listing[] {
	return buildListings(centre, raw, pages, previous).listings;
}

/**
 * A centre's outcome after normalise: `ok` carries `Listing`s and `centreAddressIds`, the ids whose
 * address is the centre fallback (for locate); `failed` and `skipped` pass through.
 */
export type NormalisedOutcome = Exclude<CentreOutcome, { kind: 'ok' }> | { kind: 'ok'; listings: Listing[]; centreAddressIds: string[] };

/**
 * Normalises an `ok` outcome with the centre's pages from this run and its stored listings
 * (`previous`, for stable same-minute ids). Output that fails `listingSchema` fails only this
 * centre (`failed('schema')`), like reader output.
 */
export function normaliseOutcome(centre: Centre, outcome: CentreOutcome, pages: readonly PageSummary[], previous: readonly PriorListing[]): NormalisedOutcome {
	if (outcome.kind !== 'ok') return outcome;
	const { listings, centreAddressIds } = buildListings(centre, outcome.listings, pages, previous);
	if (!listings.every((listing) => listingSchema.safeParse(listing).success)) return { kind: 'failed', reason: 'schema' };
	return { kind: 'ok', listings, centreAddressIds };
}
