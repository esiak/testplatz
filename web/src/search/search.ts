import { haversineKm } from '../../../shared/geo.ts';
import { normalizePlaceName, type PlaceRow } from '../../../shared/places.ts';
import type { SnapshotCentre } from '../../../shared/snapshot.ts';
import { parseFragment, serialiseFragment } from '../fragment.ts';

/** The allowed search radii in km, ascending. */
export const RADII = [10, 20, 40, 60, 100] as const;
export type Radius = (typeof RADII)[number];
export const DEFAULT_RADIUS: Radius = 40;

/** How many "Did you mean …?" links a place-not-found message shows at most. */
export const MAX_SUGGESTIONS = 3;

/** Missing or non-numeric → 40; otherwise the nearest allowed radius, ties → the larger. */
export function snapRadius(value: string | null | undefined): Radius {
	if (value == null || value.trim() === '') return DEFAULT_RADIUS;
	const km = Number(value);
	if (!Number.isFinite(km)) return DEFAULT_RADIUS;
	let best: Radius = RADII[0];
	for (const radius of RADII) {
		if (Math.abs(radius - km) <= Math.abs(best - km)) best = radius;
	}
	return best;
}

/** The next larger allowed radius, or null at the largest. */
export function nextRadius(radius: Radius): Radius | null {
	return RADII.find((r) => r > radius) ?? null;
}

export interface Search {
	/** The typed text, trimmed and non-empty. */
	q: string;
	r: Radius;
}

/** The search in a fragment: `q` trimmed (null when missing or blank), `r` snapped. */
export function parseSearchFragment(hash: string): { q: string | null; r: Radius } {
	const params = parseFragment(hash);
	const q = params.get('q')?.trim() ?? '';
	return { q: q || null, r: snapRadius(params.get('r')) };
}

/** `#q=<text>&r=<km>&lang=<lang>`. Never coordinates. */
export function searchFragment(q: string, r: Radius, lang: string): string {
	return serialiseFragment(new URLSearchParams([['q', q], ['r', String(r)], ['lang', lang]]));
}

export type Resolution = { kind: 'found'; place: PlaceRow } | { kind: 'outside_bavaria' } | { kind: 'not_found'; suggestions: string[] };

const POSTCODE = /^\d{5}$/;

/**
 * Resolves typed text to a place row. A 5-digit input matches postcodes, anything else the
 * normalised name. A Bavarian match wins (lowest key); matches only elsewhere are outside Bavaria.
 */
export function resolvePlace(input: string, places: readonly PlaceRow[]): Resolution {
	const text = input.trim();
	let matches: PlaceRow[];
	if (POSTCODE.test(text)) {
		matches = places.filter((row) => row.postcodes.includes(text));
	} else {
		const wanted = normalizePlaceName(text);
		matches = places.filter((row) => normalizePlaceName(row.name) === wanted);
	}
	const bavarian = matches.filter((row) => row.state === 'BY');
	if (bavarian.length > 0) {
		const place = bavarian.reduce((lowest, row) => (row.key < lowest.key ? row : lowest));
		return { kind: 'found', place };
	}
	if (matches.length > 0) return { kind: 'outside_bavaria' };
	return { kind: 'not_found', suggestions: didYouMean(text, places) };
}

/** Levenshtein distance, giving up (returning `max + 1`) once it must exceed `max`. */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
			current.push(value);
			if (value < rowMin) rowMin = value;
		}
		if (rowMin > max) return max + 1;
		previous = current;
	}
	return previous[b.length]!;
}

const MAX_SUGGESTION_DISTANCE = 2;

/**
 * Up to 3 Bavarian place names for an unknown input: names starting with it (input ≥ 2
 * characters), then names within edit distance 2; prefix matches first, then by distance, then
 * German collation. Input with digits gets none.
 */
export function didYouMean(input: string, places: readonly PlaceRow[]): string[] {
	if (/\d/.test(input)) return [];
	const wanted = normalizePlaceName(input);
	if (!wanted) return [];
	const names = new Set(places.filter((row) => row.state === 'BY').map((row) => row.name));
	const candidates: Array<{ name: string; prefix: boolean; distance: number }> = [];
	for (const name of names) {
		const normalised = normalizePlaceName(name);
		const prefix = wanted.length >= 2 && normalised.startsWith(wanted);
		const distance = levenshtein(normalised, wanted, prefix ? Number.POSITIVE_INFINITY : MAX_SUGGESTION_DISTANCE);
		if (prefix || distance <= MAX_SUGGESTION_DISTANCE) candidates.push({ name, prefix, distance });
	}
	return candidates
		.sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.distance - b.distance || a.name.localeCompare(b.name, 'de'))
		.slice(0, MAX_SUGGESTIONS)
		.map((candidate) => candidate.name);
}

export interface CentreInRange {
	centre: SnapshotCentre;
	distanceKm: number;
}

/**
 * Every centre with coordinates within `radiusKm` of the origin, once each, nearest first,
 * then by name (German collation), then by id. Centres without coordinates are left out.
 */
export function centresInRange(centres: readonly SnapshotCentre[], origin: { lat: number; lon: number }, radiusKm: number): CentreInRange[] {
	const out: CentreInRange[] = [];
	for (const centre of centres) {
		if (centre.lat === null || centre.lon === null) continue;
		const distanceKm = haversineKm(origin.lat, origin.lon, centre.lat, centre.lon);
		if (distanceKm <= radiusKm) out.push({ centre, distanceKm });
	}
	return out.sort(
		(a, b) =>
			a.distanceKm - b.distanceKm ||
			a.centre.name.localeCompare(b.centre.name, 'de') ||
			(a.centre.centre_id < b.centre.centre_id ? -1 : a.centre.centre_id > b.centre.centre_id ? 1 : 0),
	);
}

export type FieldErrorCode = 'place_not_found' | 'outside_bavaria';

/** What a search shows. Field errors are codes so a language switch re-renders them. */
export type Outcome =
	| { kind: 'field_error'; code: FieldErrorCode; suggestions: string[] }
	| { kind: 'results'; search: Search; items: CentreInRange[] }
	| { kind: 'no_centres'; search: Search };

export function runSearch(search: Search, places: readonly PlaceRow[], centres: readonly SnapshotCentre[]): Outcome {
	const resolution = resolvePlace(search.q, places);
	if (resolution.kind === 'outside_bavaria') return { kind: 'field_error', code: 'outside_bavaria', suggestions: [] };
	if (resolution.kind === 'not_found') return { kind: 'field_error', code: 'place_not_found', suggestions: resolution.suggestions };
	const items = centresInRange(centres, resolution.place, search.r);
	return items.length > 0 ? { kind: 'results', search, items } : { kind: 'no_centres', search };
}

/** The hostname a URL opens, without a leading `www.`; null for an unparsable URL. */
export function destinationDomain(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, '') || null;
	} catch {
		return null;
	}
}

/** `street, postcode city`. */
export function formatAddress(address: SnapshotCentre['address']): string {
	return `${address.street}, ${address.postcode} ${address.city}`;
}

/** Google Maps search for an address. Nothing loads from Google until the link is followed. */
export function mapsUrl(address: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
