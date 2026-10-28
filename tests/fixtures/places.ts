import { PLACES_SCHEMA_VERSION, type OtherPlace, type PlaceRow, type Places } from '../../shared/places.ts';

/** A valid place row; the state follows the key's first two digits (`09` = BY, `01` = SH). */
export function placeRow(key: string, name: string, extra: Partial<PlaceRow> = {}): PlaceRow {
	const state = key.startsWith('09') ? 'BY' : key.startsWith('01') ? 'SH' : 'HH';
	return { key, name, postcodes: [], district: name, state, lat: 48.137, lon: 11.575, ...extra };
}

/**
 * A partial place table holding `rows` and the name-only `others`, each sorted by key. `missing`
 * lists `bavaria` and the key prefix of every `others` entry.
 */
export function placesOf(rows: PlaceRow[], others: OtherPlace[] = []): Places {
	const prefixes = [...new Set(others.map((entry) => `ags-${entry.key.slice(0, 3)}`))];
	return {
		schemaVersion: PLACES_SCHEMA_VERSION,
		data_timestamp: '2026-10-27T19:17:35Z',
		attribution: 'Place data © OpenStreetMap contributors, ODbL 1.0',
		complete: false,
		missing: [...prefixes, 'bavaria'].sort(),
		bavaria: [],
		places: [...rows].sort((a, b) => (a.key < b.key ? -1 : 1)),
		others: [...others].sort((a, b) => (a.key < b.key ? -1 : 1)),
	};
}

/**
 * A small table: Nürnberg, München, Augsburg, Fürth (BY); Kiel (SH); a "Neustadt" twice in BY
 * (different postcodes) and once in SH; three Bavarian "Kastl" towns plus an SH namesake; two
 * "Chiemsee" rows sharing a postcode; Au (a prefix of Augsburg); Neu-Ulm; and seven "Ober…" towns.
 */
export const PLACE_ROWS = {
	nuernberg: placeRow('09564000', 'Nürnberg', { postcodes: ['90402', '90443'], lat: 49.4539, lon: 11.0773 }),
	muenchen: placeRow('09162000', 'München', { postcodes: ['80331'], lat: 48.1374, lon: 11.5755 }),
	augsburg: placeRow('09761000', 'Augsburg', { postcodes: ['86150'], lat: 48.369, lon: 10.898 }),
	fuerth: placeRow('09563000', 'Fürth', { postcodes: ['90762'], lat: 49.4771, lon: 10.9887 }),
	kiel: placeRow('01002000', 'Kiel', { postcodes: ['24103'], lat: 54.3227, lon: 10.1356 }),
	neustadtSh: placeRow('01055033', 'Neustadt', { postcodes: ['23730'], lat: 54.1, lon: 10.8 }),
	neustadtBy2: placeRow('09575150', 'Neustadt', { postcodes: ['91413'], lat: 49.58, lon: 10.61 }),
	neustadtBy1: placeRow('09372147', 'Neustadt', { postcodes: ['92660'], lat: 49.73, lon: 12.17 }),
	kastlAoe: placeRow('09171121', 'Kastl', { postcodes: ['84556'], district: 'Landkreis Altötting', lat: 48.2, lon: 12.7 }),
	kastlAs: placeRow('09371135', 'Kastl', { postcodes: ['92280'], district: 'Landkreis Amberg-Sulzbach', lat: 49.37, lon: 11.68 }),
	kastlTir: placeRow('09377128', 'Kastl', { postcodes: ['95506'], district: 'Landkreis Tirschenreuth', lat: 49.85, lon: 12.0 }),
	// Deliberately shares 92280 with kastlAs: "92280 Kastl" and "92280" must still pick the Bavarian row.
	kastlSh: placeRow('01058099', 'Kastl', { postcodes: ['24999', '92280'], district: 'Kreis Rendsburg-Eckernförde', lat: 54.3, lon: 9.7 }),
	chiemsee: placeRow('09187128', 'Chiemsee', { postcodes: ['83209'], district: 'Landkreis Rosenheim', lat: 47.87, lon: 12.42 }),
	chiemseeArea: placeRow('09187451', 'Chiemsee', { postcodes: ['83209', '83256'], district: 'Landkreis Rosenheim', lat: 47.9, lon: 12.45 }),
	au: placeRow('09273111', 'Au', { postcodes: ['84072'], district: 'Landkreis Kelheim', lat: 48.56, lon: 11.74 }),
	neuUlm: placeRow('09775135', 'Neu-Ulm', { postcodes: ['89231', '89233'], district: 'Landkreis Neu-Ulm', lat: 48.3953, lon: 10.0005 }),
	oberding: placeRow('09177130', 'Oberding'),
	oberaurach: placeRow('09674221', 'Oberaurach'),
	oberau: placeRow('09180125', 'Oberau'),
	oberammergau: placeRow('09180124', 'Oberammergau'),
	oberbergkirchen: placeRow('09183133', 'Oberbergkirchen'),
	oberasbach: placeRow('09573125', 'Oberasbach'),
	oberaudorf: placeRow('09187157', 'Oberaudorf'),
	// "Lindau" is only exact in SH; the Bavarian town carries a qualifier.
	lindauSh: placeRow('01058096', 'Lindau', { postcodes: ['24214'], district: 'Kreis Rendsburg-Eckernförde', lat: 54.42, lon: 9.92 }),
	lindauBy: placeRow('09776116', 'Lindau (Bodensee)', { postcodes: ['88131'], district: 'Landkreis Lindau (Bodensee)', lat: 47.5459, lon: 9.6842 }),
	// Two Bavarian towns start with "Neuburg"; neither is exactly "Neuburg".
	neuburgDonau: placeRow('09185149', 'Neuburg an der Donau', {
		postcodes: ['86633'],
		district: 'Landkreis Neuburg-Schrobenhausen',
		lat: 48.73,
		lon: 11.18,
	}),
	neuburgInn: placeRow('09275137', 'Neuburg am Inn', { postcodes: ['94127'], district: 'Landkreis Passau', lat: 48.5, lon: 13.45 }),
	// The only suggestion for "Essen": it must not be searched for the NRW city.
	essenbach: placeRow('09274121', 'Essenbach', { postcodes: ['84051'], district: 'Landkreis Landshut', lat: 48.61, lon: 12.21 }),
} as const;

/** Name-only municipalities outside Bavaria (key prefixes left out of the build). */
export const OTHER_PLACES: OtherPlace[] = [{ key: '05113000', name: 'Essen', state: 'NW' }];

export const smallPlaces = (): Places => placesOf(Object.values(PLACE_ROWS), OTHER_PLACES);
