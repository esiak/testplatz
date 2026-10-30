/**
 * The shared Nominatim lookup (AD-5): the structured `/search` URL, the response parser and the
 * acceptance rules. Used by tools/geocode (centres, manual) and pipeline/stages/locate (test dates),
 * both through `createFetchClient` with the Nominatim robots exemption and delay.
 */
import { z } from 'zod';
import { isInBavariaBox, type Address } from '../../shared/directory.ts';
import { NOMINATIM_SEARCH_URL } from '../config.ts';

/** Nominatim `place_rank` from which a match is street-level or finer. */
export const MIN_PLACE_RANK = 26;

/** The raw fields of Nominatim's first match that the acceptance rules need. */
export interface NominatimHit {
	lat: number;
	lon: number;
	state_code: string | null;
	postcode: string | null;
	place_rank: number;
	display_name: string;
}

export const hitSchema = z.strictObject({
	lat: z.number(),
	lon: z.number(),
	state_code: z.string().nullable(),
	postcode: z.string().nullable(),
	place_rank: z.number(),
	display_name: z.string(),
});

export type Assessment = { ok: true; lat: number; lon: number } | { ok: false; reason: string };

/** The structured `/search` URL for one address. */
export function searchUrl(address: Address): string {
	const params = new URLSearchParams({
		street: address.street,
		postalcode: address.postcode,
		city: address.city,
		country: 'Germany',
		format: 'jsonv2',
		addressdetails: '1',
		limit: '1',
	});
	return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

const toNumber = (value: unknown): number | null => {
	const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : typeof value === 'number' ? value : NaN;
	return Number.isFinite(n) ? n : null;
};

/**
 * Parses a `/search` response body. `{ result: null }` for an empty array (no match),
 * `{ result: hit }` for the first match, or null when the body is not usable (not JSON,
 * not an array, or a first match without coordinates or place_rank).
 */
export function parseNominatim(text: string): { result: NominatimHit | null } | null {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (!Array.isArray(data)) return null;
	if (data.length === 0) return { result: null };
	const first: unknown = data[0];
	if (first === null || typeof first !== 'object') return null;
	const record = first as Record<string, unknown>;
	const lat = toNumber(record['lat']);
	const lon = toNumber(record['lon']);
	const placeRank = toNumber(record['place_rank']);
	if (lat === null || lon === null || placeRank === null) return null;
	const address = record['address'] !== null && typeof record['address'] === 'object' ? (record['address'] as Record<string, unknown>) : {};
	const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
	return {
		result: {
			lat,
			lon,
			state_code: str(address['ISO3166-2-lvl4']),
			postcode: str(address['postcode']),
			place_rank: placeRank,
			display_name: str(record['display_name']) ?? '',
		},
	};
}

export const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Pure: the acceptance rules, in order, for a hit on an address with `postcode`. Accepted
 * coordinates are rounded to 6 decimals.
 */
export function assessHit(result: NominatimHit | null, postcode: string): Assessment {
	if (result === null) return { ok: false, reason: 'no match' };
	const lat = round6(result.lat);
	const lon = round6(result.lon);
	if (result.state_code !== 'DE-BY' || !isInBavariaBox(lat, lon)) return { ok: false, reason: 'outside Bavaria' };
	if (result.place_rank < MIN_PLACE_RANK) return { ok: false, reason: `imprecise match (place_rank ${result.place_rank})` };
	if (result.postcode !== null && result.postcode !== postcode) {
		return { ok: false, reason: `postcode mismatch (${result.postcode})` };
	}
	return { ok: true, lat, lon };
}
