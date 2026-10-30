import { haversineKm } from '../../../shared/geo.ts';
import { normalizePlaceName, type OtherPlace, type PlaceRow } from '../../../shared/places.ts';
import type { SnapshotCentre, SnapshotListing } from '../../../shared/snapshot.ts';
import { isUnlocated } from '../data/snapshot.ts';
import { parseFragment, serialiseFragment } from '../fragment.ts';
import type { DatedResult, Results, UndatedResult } from './results.ts';

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

/** How the result cards are ordered. */
export const SORTS = ['soonest', 'nearest'] as const;
export type Sort = (typeof SORTS)[number];
export const DEFAULT_SORT: Sort = 'soonest';

/** The fragment's `sort`; missing or unknown → soonest. */
export function parseSort(hash: string): Sort {
	const value = parseFragment(hash).get('sort');
	return SORTS.find((sort) => sort === value) ?? DEFAULT_SORT;
}

/** `#q=<text>&r=<km>&sort=<sort>&lang=<lang>`. Never coordinates. */
export function searchFragment(q: string, r: Radius, sort: Sort, lang: string): string {
	return serialiseFragment(new URLSearchParams([['q', q], ['r', String(r)], ['sort', sort], ['lang', lang]]));
}

export type Resolution =
	| { kind: 'found'; place: PlaceRow }
	| { kind: 'several' }
	| { kind: 'outside_bavaria' }
	| { kind: 'not_found'; suggestions: string[] };

const POSTCODE = /^\d{5}$/;
/** `"<5 digits> <name>"`: the pick text of a town whose name several Bavarian towns share. */
const QUALIFIED = /^(\d{5})\s+(\S.*)$/;
const POSTCODE_PREFIX = /^\d{2,5}$/;

/** At most this many place suggestions while typing (DESIGN `place-suggestions.max-items`). */
export const MAX_PLACE_SUGGESTIONS = 6;
/** Suggestions start at this many characters (trimmed). */
export const MIN_SUGGESTION_CHARS = 2;

interface IndexedRow {
	row: PlaceRow;
	/** `normalizePlaceName(row.name)`. */
	name: string;
	/** The row's smallest postcode; null when it has none. */
	label: string | null;
}

interface PlaceIndex {
	/** Bavarian rows only, in input order. */
	bavarian: IndexedRow[];
	/** Normalised names whose Bavarian rows have more than one distinct label postcode. */
	ambiguous: Set<string>;
}

const indexes = new WeakMap<readonly PlaceRow[], PlaceIndex>();
const otherIndexes = new WeakMap<readonly OtherPlace[], Set<string>>();

/** The normalised names of the name-only municipalities outside Bavaria, built once per array. */
function otherNames(others: readonly OtherPlace[]): Set<string> {
	const cached = otherIndexes.get(others);
	if (cached) return cached;
	const names = new Set(others.map((entry) => normalizePlaceName(entry.name)));
	otherIndexes.set(others, names);
	return names;
}

const smallest = (values: readonly string[]): string | null => values.reduce<string | null>((min, v) => (min === null || v < min ? v : min), null);

/** Built once per rows array: normalised names, label postcodes and the ambiguous names. */
function placeIndex(places: readonly PlaceRow[]): PlaceIndex {
	const cached = indexes.get(places);
	if (cached) return cached;
	const bavarian: IndexedRow[] = [];
	const labels = new Map<string, Set<string | null>>();
	for (const row of places) {
		if (row.state !== 'BY') continue;
		const entry = { row, name: normalizePlaceName(row.name), label: smallest(row.postcodes) };
		bavarian.push(entry);
		const set = labels.get(entry.name) ?? new Set();
		set.add(entry.label);
		labels.set(entry.name, set);
	}
	const ambiguous = new Set([...labels].filter(([, set]) => set.size > 1).map(([name]) => name));
	const index = { bavarian, ambiguous };
	indexes.set(places, index);
	return index;
}

const lowestKey = (rows: readonly PlaceRow[]): PlaceRow => rows.reduce((lowest, row) => (row.key < lowest.key ? row : lowest));

/** The row's smallest postcode, or null when it has none. */
export function labelPostcode(row: PlaceRow): string | null {
	return smallest(row.postcodes);
}

/** True when several Bavarian towns share this name under different label postcodes. */
export function isAmbiguousName(name: string, places: readonly PlaceRow[]): boolean {
	return placeIndex(places).ambiguous.has(normalizePlaceName(name));
}

/** The one pick-text rule: the name, or `"<label postcode> <name>"` when the name is ambiguous. */
function pickTextOf(entry: IndexedRow, index: PlaceIndex): string {
	return entry.label !== null && index.ambiguous.has(entry.name) ? `${entry.label} ${entry.row.name}` : entry.row.name;
}

/** What the field shows, and searches for, when a suggestion is picked: the name, or `"<label postcode> <name>"` when ambiguous. */
export function pickText(row: PlaceRow, places: readonly PlaceRow[]): string {
	const index = placeIndex(places);
	return pickTextOf({ row, name: normalizePlaceName(row.name), label: labelPostcode(row) }, index);
}

export interface PlaceSuggestion {
	place: PlaceRow;
	/** The field text a pick writes and searches for. */
	pickText: string;
	/** The meta line under the name; null for none. `district` is set only for an ambiguous name. */
	meta: { postcode: string; district: string | null } | null;
}

/**
 * Up to 6 Bavarian towns for typed text (at least 2 characters, trimmed). Digits match postcode
 * prefixes, ordered by the matched postcode; anything else matches normalised name prefixes,
 * exact matches first. Then German collation and key. Rows with the same pick text collapse,
 * then at most `limit` rows are kept.
 */
export function suggestPlaces(input: string, places: readonly PlaceRow[], limit: number = MAX_PLACE_SUGGESTIONS): PlaceSuggestion[] {
	const text = input.trim();
	if (text.length < MIN_SUGGESTION_CHARS) return [];
	const index = placeIndex(places);
	type Candidate = { entry: IndexedRow; sortKey: string; exact: boolean };
	const candidates: Candidate[] = [];
	const postcodeInput = POSTCODE_PREFIX.test(text);
	if (postcodeInput) {
		for (const entry of index.bavarian) {
			const matched = smallest(entry.row.postcodes.filter((postcode) => postcode.startsWith(text)));
			if (matched !== null) candidates.push({ entry, sortKey: matched, exact: false });
		}
	} else {
		const wanted = normalizePlaceName(text);
		if (!wanted) return [];
		for (const entry of index.bavarian) {
			if (entry.name.startsWith(wanted)) candidates.push({ entry, sortKey: '', exact: entry.name === wanted });
		}
	}
	candidates.sort(
		(a, b) =>
			(a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0) ||
			Number(b.exact) - Number(a.exact) ||
			a.entry.row.name.localeCompare(b.entry.row.name, 'de') ||
			(a.entry.row.key < b.entry.row.key ? -1 : a.entry.row.key > b.entry.row.key ? 1 : 0),
	);
	const out: PlaceSuggestion[] = [];
	const seen = new Set<string>();
	for (const { entry, sortKey } of candidates) {
		const pick = pickTextOf(entry, index);
		const ambiguous = pick !== entry.row.name;
		if (seen.has(pick)) continue;
		seen.add(pick);
		const district = ambiguous ? entry.row.district : null;
		const meta = postcodeInput ? { postcode: sortKey, district } : ambiguous ? { postcode: entry.label!, district } : null;
		out.push({ place: entry.row, pickText: pick, meta });
		if (out.length >= limit) break;
	}
	return out;
}

/**
 * The Bavarian rows whose normalised name starts with `wanted` plus a space (whole leading words,
 * as in "Lindau" → "Lindau (Bodensee)"): one name (not ambiguous) is found, several are several.
 */
function leadingWordsMatch(wanted: string, index: PlaceIndex): Resolution | null {
	const matches = index.bavarian.filter((entry) => entry.name.startsWith(`${wanted} `));
	if (matches.length === 0) return null;
	const names = new Set(matches.map((entry) => entry.name));
	if (names.size > 1 || index.ambiguous.has(matches[0]!.name)) return { kind: 'several' };
	return { kind: 'found', place: lowestKey(matches.map((entry) => entry.row)) };
}

/**
 * Resolves typed text to a place row.
 * - `"<postcode> <name>"` matches rows with that postcode whose name is the name, or starts with
 *   it plus a space; a Bavarian match wins (exact name first, then lowest key).
 * - A 5-digit input matches postcodes.
 * - A name resolves in tiers: an exact Bavarian name (`several` when Bavarian towns share it
 *   under different label postcodes); then Bavarian names starting with it as whole words; then an
 *   exact name outside Bavaria, in `places` or in the name-only `others`, is outside Bavaria.
 */
export function resolvePlace(input: string, places: readonly PlaceRow[], others: readonly OtherPlace[] = []): Resolution {
	const text = input.trim();
	const qualified = QUALIFIED.exec(text);
	if (qualified) {
		const [, postcode, name] = qualified as unknown as [string, string, string];
		const wanted = normalizePlaceName(name);
		const withPostcode = places.filter((row) => row.postcodes.includes(postcode));
		const exact = withPostcode.filter((row) => normalizePlaceName(row.name) === wanted);
		const leading = withPostcode.filter((row) => normalizePlaceName(row.name).startsWith(`${wanted} `));
		for (const rows of [exact, leading]) {
			const bavarian = rows.filter((row) => row.state === 'BY');
			if (bavarian.length > 0) return { kind: 'found', place: lowestKey(bavarian) };
		}
		if (exact.length > 0 || leading.length > 0) return { kind: 'outside_bavaria' };
	}
	if (POSTCODE.test(text)) {
		const matches = places.filter((row) => row.postcodes.includes(text));
		const bavarian = matches.filter((row) => row.state === 'BY');
		if (bavarian.length > 0) return { kind: 'found', place: lowestKey(bavarian) };
		if (matches.length > 0) return { kind: 'outside_bavaria' };
	} else {
		const wanted = normalizePlaceName(text);
		const index = placeIndex(places);
		if (wanted) {
			if (index.ambiguous.has(wanted)) return { kind: 'several' };
			const bavarian = index.bavarian.filter((entry) => entry.name === wanted).map((entry) => entry.row);
			if (bavarian.length > 0) return { kind: 'found', place: lowestKey(bavarian) };
			const leading = leadingWordsMatch(wanted, index);
			if (leading) return leading;
			if (places.some((row) => row.state !== 'BY' && normalizePlaceName(row.name) === wanted) || otherNames(others).has(wanted)) {
				return { kind: 'outside_bavaria' };
			}
		}
	}
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

const byNameThenId = (a: SnapshotCentre, b: SnapshotCentre): number =>
	a.name.localeCompare(b.name, 'de') || (a.centre_id < b.centre_id ? -1 : a.centre_id > b.centre_id ? 1 : 0);

/**
 * Every centre with coordinates within `radiusKm` of the origin, once each, nearest first,
 * then by name (German collation), then by id. Centres without coordinates are left out here;
 * `unlocatedInPlace` matches those by place instead.
 */
export function centresInRange(centres: readonly SnapshotCentre[], origin: { lat: number; lon: number }, radiusKm: number): CentreInRange[] {
	const out: CentreInRange[] = [];
	for (const centre of centres) {
		if (centre.lat === null || centre.lon === null) continue;
		const distanceKm = haversineKm(origin.lat, origin.lon, centre.lat, centre.lon);
		if (distanceKm <= radiusKm) out.push({ centre, distanceKm });
	}
	return out.sort((a, b) => a.distanceKm - b.distanceKm || byNameThenId(a.centre, b.centre));
}

/**
 * Centres without coordinates in the searched place: the address postcode is one of the place's
 * postcodes, or the address city is the place's name (normalised). Sorted by name, then id.
 * The distance stays unknown; it is never guessed.
 */
export function unlocatedInPlace(centres: readonly SnapshotCentre[], place: PlaceRow): SnapshotCentre[] {
	const name = normalizePlaceName(place.name);
	return centres
		.filter(
			(centre) =>
				isUnlocated(centre) && (place.postcodes.includes(centre.address.postcode) || normalizePlaceName(centre.address.city) === name),
		)
		.sort(byNameThenId);
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The cards a search shows (FR2, AD-8), by test address.
 *
 * Dated: every listing starting at or after `now`, placed at its own coordinates when both are
 * numbers, else at its centre's when the centre is located. A placed listing is a card when it lies
 * within `radiusKm`, with that distance; an unplaced one is a card with distance unknown when its
 * centre is in the place (`unlocatedInPlace`), otherwise it is not shown. Ordered by start, then
 * distance (unknown last), then listing id.
 *
 * Undated: centres with no current listing, selected by their own coordinates as in Epic 1: in
 * range nearest first, then unlocated centres in the place. A centre with a current listing never
 * gets an undated card, even when none of its listings is selected.
 */
export function selectCards(
	centres: readonly SnapshotCentre[],
	listings: readonly SnapshotListing[],
	place: PlaceRow,
	radiusKm: number,
	now: number,
): Results {
	const byId = new Map(centres.map((centre) => [centre.centre_id, centre]));
	const inPlace = new Set(unlocatedInPlace(centres, place).map((centre) => centre.centre_id));
	const withCurrent = new Set<string>();

	const dated: Array<DatedResult & { start: number }> = [];
	for (const listing of listings) {
		const centre = byId.get(listing.centre_id);
		if (!centre) continue;
		const start = Date.parse(listing.starts_at);
		if (!(start >= now)) continue;
		withCurrent.add(centre.centre_id);
		const position =
			typeof listing.lat === 'number' && typeof listing.lon === 'number'
				? { lat: listing.lat, lon: listing.lon }
				: centre.lat !== null && centre.lon !== null
					? { lat: centre.lat, lon: centre.lon }
					: null;
		if (position) {
			const distanceKm = haversineKm(place.lat, place.lon, position.lat, position.lon);
			if (distanceKm <= radiusKm) dated.push({ listing, centre, distanceKm, start });
		} else if (inPlace.has(centre.centre_id)) {
			dated.push({ listing, centre, distanceKm: null, start });
		}
	}
	dated.sort(
		(a, b) =>
			a.start - b.start ||
			(a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
			byText(a.listing.id, b.listing.id),
	);

	const withoutCurrent = centres.filter((centre) => !withCurrent.has(centre.centre_id));
	const undated: UndatedResult[] = [
		...centresInRange(withoutCurrent, place, radiusKm),
		...unlocatedInPlace(withoutCurrent, place).map((centre) => ({ centre, distanceKm: null })),
	];
	return { dated: dated.map(({ listing, centre, distanceKm }) => ({ listing, centre, distanceKm })), undated };
}

export type FieldErrorCode = 'place_not_found' | 'outside_bavaria' | 'several_places';

/** What a search shows. Field errors are codes so a language switch re-renders them. */
export type Outcome =
	| { kind: 'field_error'; code: FieldErrorCode; suggestions: string[] }
	| {
			kind: 'results';
			search: Search;
			/** Result cards, by start, then distance (unknown last), then listing id. */
			dated: DatedResult[];
			/** Centres without a current date: in range nearest first, then unlocated centres in the place. */
			undated: UndatedResult[];
			/** Centres without coordinates whose address does not match the place. */
			hiddenUnlocated: number;
	  }
	| { kind: 'no_centres'; search: Search; hiddenUnlocated: number };

export type SearchResolution = Resolution | { kind: 'suggested'; place: PlaceRow; text: string };

/**
 * The search rule for every search: an exact `resolvePlace` result (found, several, outside
 * Bavaria) decides; otherwise the text's suggestions do (collapsed, not capped): exactly one is
 * searched under its pick text, two or more are several, none is place-not-found.
 */
export function resolveSearch(input: string, places: readonly PlaceRow[], others: readonly OtherPlace[] = []): SearchResolution {
	const exact = resolvePlace(input, places, others);
	if (exact.kind !== 'not_found') return exact;
	// Two rows are enough to tell one suggestion from several.
	const suggestions = suggestPlaces(input, places, 2);
	if (suggestions.length === 1) return { kind: 'suggested', place: suggestions[0]!.place, text: suggestions[0]!.pickText };
	if (suggestions.length > 1) return { kind: 'several' };
	return exact;
}

/**
 * Runs a search against the clock reading `now`. When a single suggestion decides, the outcome's
 * `search.q` is its pick text. The cards come from `selectCards`; `no_centres` exactly when there
 * are none. Centres without coordinates outside the searched place are counted in `hiddenUnlocated`.
 */
export function runSearch(
	search: Search,
	places: readonly PlaceRow[],
	centres: readonly SnapshotCentre[],
	listings: readonly SnapshotListing[],
	now: number,
	others: readonly OtherPlace[] = [],
): Outcome {
	const resolution = resolveSearch(search.q, places, others);
	if (resolution.kind === 'several') return { kind: 'field_error', code: 'several_places', suggestions: [] };
	if (resolution.kind === 'outside_bavaria') return { kind: 'field_error', code: 'outside_bavaria', suggestions: [] };
	if (resolution.kind === 'not_found') return { kind: 'field_error', code: 'place_not_found', suggestions: resolution.suggestions };
	const searched = resolution.kind === 'suggested' ? { q: resolution.text, r: search.r } : search;
	const { dated, undated } = selectCards(centres, listings, resolution.place, search.r, now);
	const hiddenUnlocated = centres.filter(isUnlocated).length - unlocatedInPlace(centres, resolution.place).length;
	return dated.length > 0 || undated.length > 0
		? { kind: 'results', search: searched, dated, undated, hiddenUnlocated }
		: { kind: 'no_centres', search: searched, hiddenUnlocated };
}

/** The hostname a URL opens, without a leading `www.`; null for an unparsable URL. */
export function destinationDomain(url: string): string | null {
	try {
		return new URL(url).hostname.replace(/^www\./, '') || null;
	} catch {
		return null;
	}
}

/** `street, postcode city` (shared with the pipeline's listing address fallback). */
export { formatAddress } from '../../../shared/directory.ts';

/** Google Maps search for an address. Nothing loads from Google until the link is followed. */
export function mapsUrl(address: string): string {
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
