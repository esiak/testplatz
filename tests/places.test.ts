import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isInBoundary, normalizePlaceName, placeRowSchema, placesSchema, STATE_CODES, stateForKey, type PlaceRow, type Places } from '../shared/places.ts';
import { PLACES_PATH } from '../tools/paths.ts';

const row = (overrides: Partial<PlaceRow> = {}): PlaceRow => ({
	key: '09162000',
	name: 'München',
	postcodes: ['80331', '80333'],
	district: 'München',
	state: 'BY',
	lat: 48.1371,
	lon: 11.5754,
	...overrides,
});

const SQUARE = [
	[9, 47],
	[14, 47],
	[14, 51],
	[9, 51],
	[9, 47],
];
const HOLE = [
	[12, 49],
	[12.5, 49],
	[12.5, 49.5],
	[12, 49.5],
	[12, 49],
];

const file = (overrides: Partial<Places> = {}): Places => ({
	schemaVersion: 1,
	data_timestamp: '2026-10-27T08:00:00Z',
	attribution: 'Place data © OpenStreetMap contributors, ODbL 1.0',
	complete: true,
	missing: [],
	bavaria: [SQUARE as [number, number][]],
	places: [row()],
	...overrides,
});

describe('normalizePlaceName', () => {
	it('folds umlauts and their ae/oe/ue spellings to one value', () => {
		const values = ['Gunzburg', 'Guenzburg', 'günzburg', 'Günzburg', 'GÜNZBURG'].map(normalizePlaceName);
		expect(new Set(values)).toEqual(new Set(['gunzburg']));
		expect(normalizePlaceName('Köln')).toBe(normalizePlaceName('Koeln'));
		expect(normalizePlaceName('Bad Tölz')).toBe('bad tolz');
	});

	it('folds ß and strips other diacritics', () => {
		expect(normalizePlaceName('Großweil')).toBe('grossweil');
		expect(normalizePlaceName('Grossweil')).toBe('grossweil');
		expect(normalizePlaceName('Château')).toBe('chateau');
		// A decomposed umlaut (a + combining diaeresis) folds the same way.
		expect(normalizePlaceName('München')).toBe(normalizePlaceName('München'));
	});

	it('collapses whitespace and trims', () => {
		expect(normalizePlaceName('  Neustadt   an der\tDonau ')).toBe('neustadt an der donau');
	});
});

describe('STATE_CODES / stateForKey', () => {
	it('maps all 16 AGS state prefixes', () => {
		expect(Object.keys(STATE_CODES)).toHaveLength(16);
		expect(stateForKey('09162000')).toBe('BY');
		expect(stateForKey('11000000')).toBe('BE');
		expect(stateForKey('17000000')).toBeNull();
	});
});

describe('placeRowSchema / placesSchema', () => {
	it('accepts a valid file', () => {
		expect(placesSchema.safeParse(file()).success).toBe(true);
		expect(placeRowSchema.safeParse(row({ postcodes: [] })).success).toBe(true);
	});

	it.each([
		['a 7-digit key', { key: '0916200' }],
		['an empty name', { name: ' ' }],
		['a 4-digit postcode', { postcodes: ['6691'] }],
		['unsorted postcodes', { postcodes: ['80333', '80331'] }],
		['duplicate postcodes', { postcodes: ['80331', '80331'] }],
		['a state that does not match the key', { state: 'BW' as const }],
		['an unknown state', { state: 'XX' as never }],
		['a point outside Germany', { lat: 60 }],
	])('rejects a row with %s', (_label, overrides) => {
		expect(placeRowSchema.safeParse(row(overrides)).success).toBe(false);
	});

	it('rejects extra fields, unsorted or duplicate keys, open rings and a wrong version', () => {
		expect(placeRowSchema.safeParse({ ...row(), extra: 1 }).success).toBe(false);
		expect(placesSchema.safeParse(file({ places: [row({ key: '09162001' }), row()] })).success).toBe(false);
		expect(placesSchema.safeParse(file({ places: [row(), row()] })).success).toBe(false);
		expect(placesSchema.safeParse(file({ bavaria: [SQUARE.slice(0, 4) as [number, number][]] })).success).toBe(false);
		expect(placesSchema.safeParse({ ...file(), schemaVersion: 2 }).success).toBe(false);
		expect(placesSchema.safeParse(file({ data_timestamp: 'yesterday' })).success).toBe(false);
		// complete ⇔ nothing missing; an empty boundary ⇔ the bavaria query is missing.
		expect(placesSchema.safeParse(file({ complete: false })).success).toBe(false);
		expect(placesSchema.safeParse(file({ missing: ['ags-091'] })).success).toBe(false);
		expect(placesSchema.safeParse(file({ complete: false, missing: ['ags-091'] })).success).toBe(true);
		expect(placesSchema.safeParse(file({ complete: false, missing: ['ags-091'], bavaria: [] })).success).toBe(false);
		expect(placesSchema.safeParse(file({ complete: false, missing: ['ags-091', 'bavaria'], bavaria: [] })).success).toBe(true);
		expect(placesSchema.safeParse(file({ complete: false, missing: ['bavaria'] })).success).toBe(false);
		expect(placesSchema.safeParse(file({ complete: false, missing: ['bavaria', 'ags-091'], bavaria: [] })).success).toBe(false);
		expect(placesSchema.safeParse(file({ complete: false, missing: ['state-09'] })).success).toBe(false);
	});
});

describe('isInBoundary', () => {
	const rings = [SQUARE, HOLE];

	it('uses the even-odd rule, so a hole is outside', () => {
		expect(isInBoundary(48, 11, rings)).toBe(true);
		expect(isInBoundary(49.25, 12.25, rings)).toBe(false);
		expect(isInBoundary(52.52, 13.405, rings)).toBe(false);
		expect(isInBoundary(48, 8, rings)).toBe(false);
	});
});

describe('committed places.json', () => {
	const data = placesSchema.parse(JSON.parse(readFileSync(PLACES_PATH, 'utf8')));

	it('covers all 16 states when complete, and Bavaria in every build', () => {
		if (data.complete) expect(new Set(data.places.map((r) => r.state))).toEqual(new Set(Object.values(STATE_CODES)));
		expect(data.missing.some((name) => name.startsWith('ags-09'))).toBe(false);
		expect(data.places.filter((r) => r.state === 'BY').length).toBeGreaterThan(2000);
	});

	it.runIf(!data.missing.includes('bavaria'))('has a Bavaria boundary containing Munich and excluding Berlin', () => {
		expect(isInBoundary(48.137, 11.575, data.bavaria)).toBe(true);
		expect(isInBoundary(52.52, 13.405, data.bavaria)).toBe(false);
	});

	it('has München as a kreisfreie Stadt and distinct districts for the Bavarian Hausen rows', () => {
		expect(data.places.find((r) => r.key === '09162000')).toMatchObject({ name: 'München', district: 'München', state: 'BY' });
		const hausen = data.places.filter((r) => r.state === 'BY' && r.name === 'Hausen');
		expect(hausen.length).toBeGreaterThanOrEqual(2);
		expect(new Set(hausen.map((r) => r.district)).size).toBe(hausen.length);
	});
});
