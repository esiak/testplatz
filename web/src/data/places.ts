import { PLACES_SCHEMA_VERSION, placesSchema, type Places } from '../../../shared/places.ts';
import { loadJson } from './load-json.ts';

/** Same-origin URL of the published place table. */
export const PLACES_URL = `${import.meta.env.BASE_URL}places.json`;

/**
 * Fetches and validates `places.json`. Throws on a network error, a non-2xx response, invalid
 * JSON or a schema mismatch; a `schemaVersion` mismatch throws a `SchemaVersionError`.
 */
export function loadPlaces(fetchImpl: typeof fetch = fetch): Promise<Places> {
	return loadJson(PLACES_URL, 'places.json', placesSchema, PLACES_SCHEMA_VERSION, fetchImpl);
}
