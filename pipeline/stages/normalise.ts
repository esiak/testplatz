/**
 * Normalise stage (AD-7, FR8): turns one centre's `RawListing`s into `Listing`s with an id,
 * `starts_at` with the Europe/Berlin offset, the centre address as fallback and `link_ok` from
 * this run's detail pages. Pure: no clock, no I/O.
 */
import { formatAddress, type Centre } from '../../shared/directory.ts';
import { listingSchema, type Listing, type RawListing } from '../../shared/listing.ts';
import type { PageSummary } from '../../shared/reader.ts';
import { startsAt } from '../../shared/time.ts';
import type { CentreOutcome } from './collect.ts';

/** Moved to `shared/time.ts` (Story 3.10, the browser needs it too); re-exported for callers here. */
export { berlinOffset, startsAt } from '../../shared/time.ts';

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
		listing.time_known,
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
 * History carry-over (Story 3.10, AD-7): a date whose time was published later (untimed → timed)
 * or withdrawn (timed → untimed) takes a new id but keeps the stored listing's history. Each
 * listing whose id no stored listing holds is matched to the centre's stored listings of the same
 * date with the other timedness whose ids this run does not produce, live before tombstoned, each
 * at most once, with Story 3.8's passes. Returns new id → stored id.
 */
function carryOver(centreId: string, listings: readonly Listing[], previous: readonly PriorListing[]): Record<string, string> {
	const prefix = `${centreId}@`;
	const produced = new Set(listings.map((listing) => listing.id));
	const storedIds = new Set(previous.map((listing) => listing.id));
	/** `<date> timed|untimed` for an id key (`YYYY-MM-DD[THH:mm]`, any `#n` removed). */
	const groupOf = (date: string, timed: boolean): string => `${date} ${timed ? 'timed' : 'untimed'}`;
	const candidates = new Map<string, Prior[]>();
	for (const listing of previous) {
		if (!listing.id.startsWith(prefix) || produced.has(listing.id)) continue;
		const key = listing.id.slice(prefix.length).replace(/#.*$/, '');
		const group = groupOf(key.slice(0, 10), key.includes('T'));
		candidates.set(group, [...(candidates.get(group) ?? []), { listing, n: 0 }]);
	}
	const live = (prior: Prior): number => ((prior.listing.removed_at ?? null) === null ? 0 : 1);
	for (const group of candidates.values()) group.sort((a, b) => live(a) - live(b) || compare(a.listing.id, b.listing.id));

	const newcomers = new Map<string, Listing[]>();
	for (const listing of listings) {
		if (storedIds.has(listing.id)) continue;
		// The stored side has the other timedness.
		const group = groupOf(listing.starts_at.slice(0, 10), !listing.time_known);
		newcomers.set(group, [...(newcomers.get(group) ?? []), listing]);
	}

	const carried: Record<string, string> = {};
	for (const [group, sorted] of newcomers) {
		const priors = candidates.get(group) ?? [];
		if (priors.length === 0) continue;
		const unmatched = [...priors];
		const done = new Set<Listing>();
		for (const matches of matchPasses(sorted, priors)) {
			for (const listing of sorted) {
				if (done.has(listing)) continue;
				const index = unmatched.findIndex((prior) => matches(listing, prior.listing));
				if (index === -1) continue;
				carried[listing.id] = unmatched[index]!.listing.id;
				done.add(listing);
				unmatched.splice(index, 1);
			}
		}
	}
	return carried;
}

/**
 * The centre's listings, ordered by id, the ids whose address is the centre fallback (the reader
 * gave none) and the history carry-over (new id → stored id). Shared by `normaliseCentre` and
 * `normaliseOutcome`.
 */
function buildListings(
	centre: Centre,
	raw: readonly RawListing[],
	pages: readonly PageSummary[],
	previous: readonly PriorListing[],
): { listings: Listing[]; centreAddressIds: string[]; carriedFrom: Record<string, string> } {
	const okUrls = okDetailUrls(pages);
	const fallbackAddress = formatAddress(centre.address);
	const groups = new Map<string, Unnamed[]>();
	/** Listings whose address came from the fallback. */
	const fromCentre = new Set<Unnamed>();
	for (const item of raw) {
		const listing: Unnamed = {
			centre_id: centre.centre_id,
			starts_at: startsAt(item.date, item.time ?? '00:00'),
			time_known: item.time !== null,
			place: item.place,
			address: item.address ?? fallbackAddress,
			status: item.status,
			deadline: item.deadline,
			registration_method: item.registration_method,
			source_url: item.source_url,
			link_ok: okUrls.has(withoutFragment(item.source_url)),
			eligibility: item.eligibility,
		};
		// The id key: the local minute, or the date alone when the time is not published (Story 3.10).
		const minute = item.time === null ? item.date : `${item.date}T${item.time}`;
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
	listings.sort((a, b) => compare(a.id, b.id));
	return { listings, centreAddressIds: centreAddressIds.sort(compare), carriedFrom: carryOver(centre.centre_id, listings, previous) };
}

/**
 * The centre's listings, ordered by id. Ids are `<centre_id>@<date>T<time>`, or `<centre_id>@<date>`
 * for a date whose time is not published (Story 3.10); dates with the same key
 * collapse exact duplicates, then keep the id of the stored listing they match in `previous` (the
 * centre's state listings, live and tombstoned), else take the lowest free `#n` in
 * `sameMinuteOrder` (AD-7, Story 3.8). With no `previous`, that is `#2`, `#3`, … in order.
 */
export function normaliseCentre(centre: Centre, raw: readonly RawListing[], pages: readonly PageSummary[], previous: readonly PriorListing[] = []): Listing[] {
	return buildListings(centre, raw, pages, previous).listings;
}

/**
 * A centre's outcome after normalise: `ok` carries `Listing`s, `centreAddressIds`, the ids whose
 * address is the centre fallback (for locate), and `carriedFrom`, new id → the stored id whose
 * history it takes (Story 3.10, for merge); `failed` and `skipped` pass through.
 */
export type NormalisedOutcome =
	| Exclude<CentreOutcome, { kind: 'ok' }>
	| { kind: 'ok'; listings: Listing[]; centreAddressIds: string[]; carriedFrom: Record<string, string> };

/**
 * Normalises an `ok` outcome with the centre's pages from this run and its stored listings
 * (`previous`, for stable same-minute ids). Output that fails `listingSchema` fails only this
 * centre (`failed('schema')`), like reader output.
 */
export function normaliseOutcome(centre: Centre, outcome: CentreOutcome, pages: readonly PageSummary[], previous: readonly PriorListing[]): NormalisedOutcome {
	if (outcome.kind !== 'ok') return outcome;
	const { listings, centreAddressIds, carriedFrom } = buildListings(centre, outcome.listings, pages, previous);
	if (!listings.every((listing) => listingSchema.safeParse(listing).success)) return { kind: 'failed', reason: 'schema' };
	return { kind: 'ok', listings, centreAddressIds, carriedFrom };
}
