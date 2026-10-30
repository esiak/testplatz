/**
 * Locate stage (FR36): gives every listing of an `ok` outcome `lat`, `lon` and `location`, between
 * normalise and merge. Per listing, in order:
 *
 *   1. address from normalise's centre fallback → centre coordinates, `centre` (no provider address);
 *   2. the centre is located and the address equals the centre's (`normaliseAddress`) → centre
 *      coordinates, `venue`, no request;
 *   3. not a `street, NNNNN city` address → centre (unparseable address);
 *   4. the venue cache: a hit → `venue`; a miss younger than 30 days → centre with its reason;
 *   5. one Nominatim lookup per distinct address per run, serial and polite, at most `maxLookups`:
 *      an accepted hit → `venue` (cached), no match or rejected → centre (cached as a miss), a
 *      failed request → centre (nothing cached);
 *   6. over the cap → centre (lookup cap reached, nothing cached).
 *
 * The centre fallback copies the centre's `lat`/`lon`, which may both be null. A lookup failure
 * never fails the run or a centre. Locate never writes files: the new cache entries go to merge.
 */
import { normaliseAddress, parseAddress } from '../../shared/address.ts';
import { formatAddress, type Address, type Centre } from '../../shared/directory.ts';
import type { Listing, LocatedListing, Location } from '../../shared/listing.ts';
import { VENUE_MISS_RETRY_MS, type VenueEntry, type Venues } from '../../shared/venues.ts';
import { LOCATE_MAX_LOOKUPS_PER_RUN, NOMINATIM_DELAY_MS, NOMINATIM_ROBOTS_EXEMPT } from '../config.ts';
import { createFetchClient, type FetchClient, type FetchImpl } from '../fetch/index.ts';
import { assessHit, parseNominatim, searchUrl } from '../fetch/nominatim.ts';
import type { NormalisedOutcome } from './normalise.ts';

/** The shortest pause between two Nominatim requests, whatever the options say (OSMF policy). */
const MIN_DELAY_MS = 1000;

/** A centre's outcome after locate: `ok` carries located listings; `failed` and `skipped` pass through. */
export type LocatedOutcome = Exclude<NormalisedOutcome, { kind: 'ok' }> | { kind: 'ok'; listings: LocatedListing[] };

/** Where a listing's coordinates come from, and why it fell back to the centre (null for `venue`). */
export interface Placement {
	lat: number | null;
	lon: number | null;
	location: Location;
	reason: string | null;
}

/** What rules 1–4 decide for one listing: placed, or a lookup of `address` under `key` is needed. */
export type Decision =
	| { kind: 'placed'; placement: Placement; fromCache: boolean }
	| { kind: 'lookup'; key: string; address: Address };

const atCentre = (centre: Centre, reason: string): Placement => ({ lat: centre.lat, lon: centre.lon, location: 'centre', reason });

/**
 * Pure: rules 1–4 for one listing. `fromCentreAddress` = normalise used the centre fallback;
 * `venues` is the cache as read at run start; `runAt` dates cached misses.
 */
export function decideLocation(listing: Pick<Listing, 'address'>, centre: Centre, fromCentreAddress: boolean, venues: Venues, runAt: Date): Decision {
	if (fromCentreAddress) return { kind: 'placed', placement: atCentre(centre, 'no provider address'), fromCache: false };
	const key = normaliseAddress(listing.address);
	if (centre.lat !== null && centre.lon !== null && key === normaliseAddress(formatAddress(centre.address))) {
		return { kind: 'placed', placement: { lat: centre.lat, lon: centre.lon, location: 'venue', reason: null }, fromCache: false };
	}
	const address = parseAddress(listing.address);
	if (address === null) return { kind: 'placed', placement: atCentre(centre, 'unparseable address'), fromCache: false };
	const cached = venues.entries[key];
	if (cached !== undefined) {
		if (cached.reason === null && cached.lat !== null && cached.lon !== null) {
			return { kind: 'placed', placement: { lat: cached.lat, lon: cached.lon, location: 'venue', reason: null }, fromCache: true };
		}
		if (cached.reason !== null && runAt.getTime() - Date.parse(cached.fetched_at) < VENUE_MISS_RETRY_MS) {
			return { kind: 'placed', placement: atCentre(centre, cached.reason), fromCache: true };
		}
	}
	return { kind: 'lookup', key, address };
}

/** The result of one address's lookup this run (shared by every listing with that address). */
type LookupResult = { kind: 'hit'; lat: number; lon: number } | { kind: 'miss'; reason: string };

export interface LocateOptions {
	fetchImpl?: FetchImpl;
	/** Pause between two requests; never below 1 s. */
	delayMs?: number;
	timeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
	/** At most this many Nominatim requests this run (default `LOCATE_MAX_LOOKUPS_PER_RUN`). */
	maxLookups?: number;
}

export interface LocateInput extends LocateOptions {
	directory: readonly Centre[];
	outcomes: Readonly<Record<string, NormalisedOutcome>>;
	/** The venue cache as read at run start. */
	venues: Venues;
	runAt: Date;
	log?: (line: string) => void;
}

export interface LocateStats {
	venue: number;
	centre: number;
	/** Nominatim requests sent. */
	requests: number;
	/** Distinct addresses answered by the venue cache. */
	cacheHits: number;
}

export interface LocateResult {
	outcomes: Record<string, LocatedOutcome>;
	/** This run's new cache entries (hits and misses), keyed by normalised address, for merge. */
	lookups: Record<string, VenueEntry>;
	stats: LocateStats;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Locates every `ok` outcome's listings. Logs one line per distinct fallback, then a summary. */
export async function locateRun(input: LocateInput): Promise<LocateResult> {
	const { directory, outcomes, venues, runAt, log = () => {} } = input;
	const maxLookups = input.maxLookups ?? LOCATE_MAX_LOOKUPS_PER_RUN;
	const at = runAt.toISOString();
	const centres = new Map(directory.map((centre) => [centre.centre_id, centre]));

	let client: FetchClient | null = null;
	const nominatim = (): FetchClient =>
		(client ??= createFetchClient({
			fetchImpl: input.fetchImpl,
			delayMs: Math.max(input.delayMs ?? NOMINATIM_DELAY_MS, MIN_DELAY_MS),
			timeoutMs: input.timeoutMs,
			sleep: input.sleep,
			robotsExempt: [NOMINATIM_ROBOTS_EXEMPT],
		}));

	const stats: LocateStats = { venue: 0, centre: 0, requests: 0, cacheHits: 0 };
	const lookups: Record<string, VenueEntry> = {};
	const results = new Map<string, LookupResult>();
	const cacheKeys = new Set<string>();
	const logged = new Set<string>();

	async function lookup(key: string, address: Address): Promise<LookupResult> {
		const known = results.get(key);
		if (known !== undefined) return known;
		let result: LookupResult;
		if (stats.requests >= maxLookups) {
			result = { kind: 'miss', reason: 'lookup cap reached' };
		} else {
			stats.requests += 1;
			const response = await nominatim().get(searchUrl(address));
			const parsed = response.ok ? parseNominatim(response.text) : null;
			if (parsed === null) {
				const why = !response.ok ? `${response.reason}${response.status !== null ? ` ${response.status}` : ''}` : 'invalid response body';
				result = { kind: 'miss', reason: `lookup failed: ${why}` };
			} else {
				const verdict = assessHit(parsed.result, address.postcode);
				if (verdict.ok) {
					result = { kind: 'hit', lat: verdict.lat, lon: verdict.lon };
					lookups[key] = { fetched_at: at, lat: verdict.lat, lon: verdict.lon, reason: null };
				} else {
					result = { kind: 'miss', reason: verdict.reason };
					lookups[key] = { fetched_at: at, lat: null, lon: null, reason: verdict.reason };
				}
			}
		}
		results.set(key, result);
		return result;
	}

	const located: Record<string, LocatedOutcome> = {};
	for (const centreId of Object.keys(outcomes).sort(compare)) {
		const outcome = outcomes[centreId]!;
		const centre = centres.get(centreId);
		if (outcome.kind !== 'ok' || centre === undefined) {
			if (outcome.kind !== 'ok') located[centreId] = outcome;
			continue;
		}
		const fromCentre = new Set(outcome.centreAddressIds);
		const listings: LocatedListing[] = [];
		for (const listing of outcome.listings) {
			const decision = decideLocation(listing, centre, fromCentre.has(listing.id), venues, runAt);
			let placement: Placement;
			if (decision.kind === 'placed') {
				placement = decision.placement;
				if (decision.fromCache) cacheKeys.add(normaliseAddress(listing.address));
			} else {
				const result = await lookup(decision.key, decision.address);
				placement =
					result.kind === 'hit' ? { lat: result.lat, lon: result.lon, location: 'venue', reason: null } : atCentre(centre, result.reason);
			}
			stats[placement.location] += 1;
			if (placement.reason !== null) {
				const line = `locate ${centreId}: "${listing.address}" at the centre (${placement.reason})`;
				if (!logged.has(line)) {
					logged.add(line);
					log(line);
				}
			}
			listings.push({ ...listing, lat: placement.lat, lon: placement.lon, location: placement.location });
		}
		located[centreId] = { kind: 'ok', listings };
	}
	stats.cacheHits = cacheKeys.size;
	log(`locate: ${stats.venue} at venue, ${stats.centre} at centre; ${stats.requests} requests, ${stats.cacheHits} cache hits`);
	return { outcomes: located, lookups, stats };
}
