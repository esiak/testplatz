import { z } from 'zod';

/**
 * The place table contract (AD-9): `data/public/places.json`, built offline by tools/build-places
 * from OpenStreetMap (ODbL) and read by search. Every name match goes through `normalizePlaceName`.
 */

/** State code for the first two digits of an amtlicher Gemeindeschlüssel (AGS). */
export const STATE_CODES = {
	'01': 'SH',
	'02': 'HH',
	'03': 'NI',
	'04': 'HB',
	'05': 'NW',
	'06': 'HE',
	'07': 'RP',
	'08': 'BW',
	'09': 'BY',
	'10': 'SL',
	'11': 'BE',
	'12': 'BB',
	'13': 'MV',
	'14': 'SN',
	'15': 'ST',
	'16': 'TH',
} as const;

export type StatePrefix = keyof typeof STATE_CODES;
export type StateCode = (typeof STATE_CODES)[StatePrefix];

const STATE_VALUES = Object.values(STATE_CODES) as [StateCode, ...StateCode[]];

/** The state code for an AGS, or null when its first two digits are not a German state. */
export const stateForKey = (key: string): StateCode | null =>
	Object.hasOwn(STATE_CODES, key.slice(0, 2)) ? STATE_CODES[key.slice(0, 2) as StatePrefix] : null;

export const PLACES_SCHEMA_VERSION = 1;

/**
 * The one place-name normaliser: lowercase, `ß`→`ss`, `ä/ö/ü`→`a/o/u`, then `ae/oe/ue`→`a/o/u`,
 * other diacritics stripped, whitespace collapsed and trimmed. "Günzburg", "Guenzburg" and
 * "gunzburg" all give the same value.
 */
export function normalizePlaceName(name: string): string {
	return name
		.toLowerCase()
		.replaceAll('ß', 'ss')
		.replaceAll('ä', 'a')
		.replaceAll('ö', 'o')
		.replaceAll('ü', 'u')
		.replaceAll('ae', 'a')
		.replaceAll('oe', 'o')
		.replaceAll('ue', 'u')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** A point `[lon, lat]`. */
const pointSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/** A closed ring: at least 4 points, first equals last. */
const ringSchema = z
	.array(pointSchema)
	.min(4)
	.refine((ring) => ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1], 'ring is not closed');

const isSortedUnique = (values: readonly string[]): boolean => values.every((v, i) => i === 0 || values[i - 1]! < v);

export const placeRowSchema = z
	.strictObject({
		/** The 8-digit AGS. */
		key: z.string().regex(/^\d{8}$/),
		name: z.string().trim().min(1),
		/** 5-digit postcodes, sorted and unique; may be empty. */
		postcodes: z
			.array(z.string().regex(/^\d{5}$/))
			.refine(isSortedUnique, 'postcodes must be sorted and unique'),
		district: z.string().trim().min(1),
		state: z.enum(STATE_VALUES),
		lat: z.number().min(47).max(55.1),
		lon: z.number().min(5.8).max(15.1),
	})
	.refine((row) => stateForKey(row.key) === row.state, { message: 'state does not match the key', path: ['state'] });

export type PlaceRow = z.infer<typeof placeRowSchema>;

export const placesSchema = z
	.strictObject({
		schemaVersion: z.literal(PLACES_SCHEMA_VERSION),
		/** The OSM data timestamp (oldest among the responses used), ISO 8601. */
		data_timestamp: z.iso.datetime(),
		attribution: z.string().min(1),
		/**
		 * True when every query was included. A partial build (`--cached-only`) is false and names
		 * the queries left out in `missing`; search must then treat absent states and an empty
		 * boundary as unknown, not as "outside Bavaria".
		 */
		complete: z.boolean(),
		/** Names of the queries not included (`ags-<prefix>`, `bavaria`), sorted; empty when complete. */
		missing: z.array(z.string().regex(/^(ags-\d{3}|bavaria)$/)).refine(isSortedUnique, 'missing must be sorted and unique'),
		/** Simplified Bavaria boundary: rings of `[lon, lat]`, read with the even-odd rule. Empty only when `bavaria` is missing. */
		bavaria: z.array(ringSchema),
		places: z.array(placeRowSchema).min(1),
	})
	.refine((file) => isSortedUnique(file.places.map((row) => row.key)), {
		message: 'places must be sorted by key with unique keys',
		path: ['places'],
	})
	.refine((file) => file.complete === (file.missing.length === 0), {
		message: 'complete must be true exactly when nothing is missing',
		path: ['complete'],
	})
	.refine((file) => (file.bavaria.length === 0) === file.missing.includes('bavaria'), {
		message: 'bavaria must be empty exactly when the bavaria query is missing',
		path: ['bavaria'],
	});

export type Places = z.infer<typeof placesSchema>;

/** Even-odd point-in-polygon test of `(lat, lon)` against rings of `[lon, lat]` points. */
export function isInBoundary(lat: number, lon: number, rings: readonly (readonly (readonly number[])[])[]): boolean {
	let inside = false;
	for (const ring of rings) {
		for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
			const [xi, yi] = ring[i]! as [number, number];
			const [xj, yj] = ring[j]! as [number, number];
			if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
		}
	}
	return inside;
}
