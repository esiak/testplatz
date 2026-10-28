import { PLACES_SCHEMA_VERSION, type PlaceRow, type Places } from '../../shared/places.ts';

/** A valid place row; the state follows the key's first two digits (`09` = BY, `01` = SH). */
export function placeRow(key: string, name: string, extra: Partial<PlaceRow> = {}): PlaceRow {
	const state = key.startsWith('09') ? 'BY' : key.startsWith('01') ? 'SH' : 'HH';
	return { key, name, postcodes: [], district: name, state, lat: 48.137, lon: 11.575, ...extra };
}

/** A partial place table holding `rows`, sorted by key. */
export function placesOf(rows: PlaceRow[]): Places {
	return {
		schemaVersion: PLACES_SCHEMA_VERSION,
		data_timestamp: '2026-10-27T19:17:35Z',
		attribution: 'Place data © OpenStreetMap contributors, ODbL 1.0',
		complete: false,
		missing: ['bavaria'],
		bavaria: [],
		places: [...rows].sort((a, b) => (a.key < b.key ? -1 : 1)),
	};
}

/** A small table: Nürnberg, München, Augsburg, Fürth (BY); Kiel (SH); a "Neustadt" in BY and SH. */
export const PLACE_ROWS = {
	nuernberg: placeRow('09564000', 'Nürnberg', { postcodes: ['90402', '90443'], lat: 49.4539, lon: 11.0773 }),
	muenchen: placeRow('09162000', 'München', { postcodes: ['80331'], lat: 48.1374, lon: 11.5755 }),
	augsburg: placeRow('09761000', 'Augsburg', { postcodes: ['86150'], lat: 48.369, lon: 10.898 }),
	fuerth: placeRow('09563000', 'Fürth', { postcodes: ['90762'], lat: 49.4771, lon: 10.9887 }),
	kiel: placeRow('01002000', 'Kiel', { postcodes: ['24103'], lat: 54.3227, lon: 10.1356 }),
	neustadtSh: placeRow('01055033', 'Neustadt', { postcodes: ['23730'], lat: 54.1, lon: 10.8 }),
	neustadtBy2: placeRow('09575150', 'Neustadt', { postcodes: ['91413'], lat: 49.58, lon: 10.61 }),
	neustadtBy1: placeRow('09372147', 'Neustadt', { postcodes: ['92660'], lat: 49.73, lon: 12.17 }),
} as const;

export const smallPlaces = (): Places => placesOf(Object.values(PLACE_ROWS));
