import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { haversineKm } from '../shared/geo.ts';
import { normalizePlaceName, placesSchema } from '../shared/places.ts';
import { snapshotSchema } from '../shared/snapshot.ts';
import {
	centresInRange,
	DEFAULT_RADIUS,
	destinationDomain,
	didYouMean,
	formatAddress,
	levenshtein,
	mapsUrl,
	nextRadius,
	parseSearchFragment,
	RADII,
	resolvePlace,
	runSearch,
	searchFragment,
	snapRadius,
} from '../web/src/search/search.ts';
import { PLACE_ROWS, placeRow, smallPlaces } from './fixtures/places.ts';
import { snapshotCentre } from './fixtures/snapshot.ts';

const places = smallPlaces().places;

describe('snapRadius', () => {
	it('keeps allowed values', () => {
		for (const r of RADII) expect(snapRadius(String(r))).toBe(r);
	});

	it('defaults to 40 for missing or non-numeric values', () => {
		expect(DEFAULT_RADIUS).toBe(40);
		for (const value of [null, undefined, '', '  ', 'abc', 'NaN', 'Infinity']) expect(snapRadius(value)).toBe(40);
	});

	it('snaps to the nearest allowed value, ties to the larger', () => {
		expect(snapRadius('35')).toBe(40);
		expect(snapRadius('30')).toBe(40);
		expect(snapRadius('15')).toBe(20);
		expect(snapRadius('12')).toBe(10);
		expect(snapRadius('80')).toBe(100);
		expect(snapRadius('70')).toBe(60);
		expect(snapRadius('0')).toBe(10);
		expect(snapRadius('-5')).toBe(10);
		expect(snapRadius('500')).toBe(100);
		expect(snapRadius('20.4')).toBe(20);
	});

	it('names the next radius', () => {
		expect(nextRadius(10)).toBe(20);
		expect(nextRadius(60)).toBe(100);
		expect(nextRadius(100)).toBeNull();
	});
});

describe('search fragment', () => {
	it('writes q, r and lang in that order', () => {
		expect(searchFragment('Nürnberg', 20, 'de')).toBe('#q=N%C3%BCrnberg&r=20&lang=de');
		expect(searchFragment('Neu-Ulm', 40, 'en')).toBe('#q=Neu-Ulm&r=40&lang=en');
	});

	it('reads q trimmed and r snapped', () => {
		expect(parseSearchFragment('#q=Augsburg&r=20&lang=en')).toEqual({ q: 'Augsburg', r: 20 });
		expect(parseSearchFragment('#q=+F%C3%BCrth+&r=35')).toEqual({ q: 'Fürth', r: 40 });
		expect(parseSearchFragment('#q=Atlantis')).toEqual({ q: 'Atlantis', r: 40 });
		expect(parseSearchFragment('#r=abc&q=Ulm')).toEqual({ q: 'Ulm', r: 40 });
	});

	it('has no q when it is missing or blank', () => {
		expect(parseSearchFragment('')).toEqual({ q: null, r: 40 });
		expect(parseSearchFragment('#lang=en')).toEqual({ q: null, r: 40 });
		expect(parseSearchFragment('#q=%20&r=20')).toEqual({ q: null, r: 20 });
	});

	it('round-trips', () => {
		expect(parseSearchFragment(searchFragment('Bad Tölz', 60, 'de'))).toEqual({ q: 'Bad Tölz', r: 60 });
	});
});

describe('resolvePlace', () => {
	it('finds a town by name, ignoring case and umlaut spelling', () => {
		for (const input of ['Nürnberg', 'nuernberg', 'NÜRNBERG', '  nurnberg ']) {
			expect(resolvePlace(input, places)).toEqual({ kind: 'found', place: PLACE_ROWS.nuernberg });
		}
	});

	it('finds a town by postcode', () => {
		expect(resolvePlace('90443', places)).toEqual({ kind: 'found', place: PLACE_ROWS.nuernberg });
	});

	it('uses the lowest-key Bavarian row when a name exists in BY and another state', () => {
		expect(resolvePlace('Neustadt', places)).toEqual({ kind: 'found', place: PLACE_ROWS.neustadtBy1 });
	});

	it('uses the lowest-key Bavarian row among several postcode matches', () => {
		const rows = [placeRow('09100001', 'B', { postcodes: ['90000'] }), placeRow('09100000', 'A', { postcodes: ['90000'] })];
		expect(resolvePlace('90000', rows)).toEqual({ kind: 'found', place: rows[1] });
	});

	it('reports a non-Bavarian place as outside Bavaria', () => {
		expect(resolvePlace('Kiel', places)).toEqual({ kind: 'outside_bavaria' });
		expect(resolvePlace('24103', places)).toEqual({ kind: 'outside_bavaria' });
	});

	it('reports an unknown place with Bavarian suggestions', () => {
		const result = resolvePlace('Nurnbreg', places);
		expect(result).toEqual({ kind: 'not_found', suggestions: ['Nürnberg'] });
	});

	it('reports unknown digits without suggestions', () => {
		expect(resolvePlace('12', places)).toEqual({ kind: 'not_found', suggestions: [] });
		expect(resolvePlace('99999', places)).toEqual({ kind: 'not_found', suggestions: [] });
	});

	it('matches a 4- or 6-digit input against names, not postcodes', () => {
		expect(resolvePlace('9044', places).kind).toBe('not_found');
	});
});

describe('didYouMean', () => {
	it('lists prefix matches first, then by distance, then German collation, at most 3', () => {
		const rows = [
			placeRow('09000001', 'Ansbach'),
			placeRow('09000002', 'Amberg'),
			placeRow('09000003', 'Amerang'),
			placeRow('09000004', 'Amberg'), // duplicate name
			placeRow('09000005', 'Aschau'),
			placeRow('09000006', 'Kamberg'),
		];
		// "amb": prefix → Amberg; distance ≤ 2 → … none other except via prefix.
		expect(didYouMean('Amb', rows)).toEqual(['Amberg']);
		// "amberk": Amberg (distance 1), Kamberg (distance 2).
		expect(didYouMean('Amberk', rows)).toEqual(['Amberg', 'Kamberg']);
		// "am": prefix Amberg, Amerang (collation), then short names within 2.
		expect(didYouMean('Am', rows).slice(0, 2)).toEqual(['Amberg', 'Amerang']);
	});

	it('orders equal-distance names by German collation', () => {
		const rows = [placeRow('09000001', 'Öd'), placeRow('09000002', 'Od'), placeRow('09000003', 'Zd')];
		expect(didYouMean('xd', rows)).toEqual(['Od', 'Öd', 'Zd']);
	});

	it('suggests only Bavarian names', () => {
		const rows = [placeRow('01000001', 'Kiel'), placeRow('09000001', 'Kiefersfelden')];
		expect(didYouMean('Kiell', rows)).toEqual([]);
		expect(didYouMean('Kie', rows)).toEqual(['Kiefersfelden']);
	});

	it('gives no prefix matches for a 1-character input', () => {
		const rows = [placeRow('09000001', 'Augsburg')];
		expect(didYouMean('A', rows)).toEqual([]);
	});

	it('gives none for input with digits or blank input', () => {
		expect(didYouMean('12', places)).toEqual([]);
		expect(didYouMean('   ', places)).toEqual([]);
	});

	it('caps at three suggestions', () => {
		const rows = ['Aa', 'Ab', 'Ac', 'Ad'].map((name, i) => placeRow(`0900000${i}`, name));
		expect(didYouMean('Ax', rows)).toEqual(['Aa', 'Ab', 'Ac']);
	});
});

describe('levenshtein', () => {
	it('counts edits and stops early above the bound', () => {
		expect(levenshtein('kitten', 'sitting')).toBe(3);
		expect(levenshtein('', 'abc')).toBe(3);
		expect(levenshtein('same', 'same')).toBe(0);
		expect(levenshtein('kitten', 'sitting', 2)).toBe(3);
		expect(levenshtein('a', 'abcdef', 2)).toBe(3);
	});
});

describe('centresInRange', () => {
	const origin = { lat: 49.4539, lon: 11.0773 };

	it('lists every centre with coordinates within the radius once, nearest first', () => {
		const centres = [
			snapshotCentre('far', { lat: 48.1374, lon: 11.5755 }), // München, ~151 km
			snapshotCentre('near', { lat: 49.4771, lon: 10.9887 }), // Fürth, ~7 km
			snapshotCentre('here', { lat: 49.4539, lon: 11.0773 }),
		];
		const result = centresInRange(centres, origin, 20);
		expect(result.map((r) => r.centre.centre_id)).toEqual(['here', 'near']);
		expect(result[0]!.distanceKm).toBe(0);
		expect(Math.round(result[1]!.distanceKm)).toBe(7);
	});

	it('includes a centre exactly at the radius', () => {
		const lat = 49.4539 + 20 / 111.195;
		const centre = snapshotCentre('edge', { lat, lon: 11.0773 });
		const d = haversineKm(origin.lat, origin.lon, lat, 11.0773);
		expect(centresInRange([centre], origin, d)).toHaveLength(1);
	});

	it('leaves out centres without coordinates', () => {
		const centres = [snapshotCentre('a', { lat: null, lon: null }), snapshotCentre('b', { lat: 49.45, lon: null })];
		expect(centresInRange(centres, origin, 100)).toEqual([]);
	});

	it('breaks distance ties by name (German collation), then centre_id', () => {
		const at = { lat: 49.46, lon: 11.08 };
		const centres = [
			snapshotCentre('z2', { ...at, name: 'Zentrum' }),
			snapshotCentre('oe', { ...at, name: 'Ötztal' }),
			snapshotCentre('z1', { ...at, name: 'Zentrum' }),
			snapshotCentre('o', { ...at, name: 'Ost' }),
		];
		expect(centresInRange(centres, origin, 10).map((r) => r.centre.centre_id)).toEqual(['o', 'oe', 'z1', 'z2']);
	});
});

describe('runSearch', () => {
	const centres = [snapshotCentre('nbg', { lat: 49.45, lon: 11.08 }), snapshotCentre('muc', { lat: 48.137, lon: 11.575 })];

	it('returns results for a found place', () => {
		const outcome = runSearch({ q: 'Nürnberg', r: 20 }, places, centres);
		expect(outcome.kind).toBe('results');
		if (outcome.kind === 'results') expect(outcome.items.map((i) => i.centre.centre_id)).toEqual(['nbg']);
	});

	it('returns no centres when nothing is in range', () => {
		expect(runSearch({ q: 'Augsburg', r: 10 }, places, centres)).toEqual({ kind: 'no_centres', search: { q: 'Augsburg', r: 10 } });
	});

	it('returns field errors as codes', () => {
		expect(runSearch({ q: 'Kiel', r: 40 }, places, centres)).toEqual({ kind: 'field_error', code: 'outside_bavaria', suggestions: [] });
		expect(runSearch({ q: 'Atlantis', r: 40 }, places, centres)).toMatchObject({ kind: 'field_error', code: 'place_not_found' });
	});
});

describe('card helpers', () => {
	it('names the destination domain without www', () => {
		expect(destinationDomain('https://www.vhs-guenzburg.de/kurs/123')).toBe('vhs-guenzburg.de');
		expect(destinationDomain('https://kurse.vhs.de/')).toBe('kurse.vhs.de');
		expect(destinationDomain('not a url')).toBeNull();
	});

	it('formats the address and its Google Maps link', () => {
		const address = formatAddress({ street: 'Krankenhausstr. 40', postcode: '89312', city: 'Günzburg' });
		expect(address).toBe('Krankenhausstr. 40, 89312 Günzburg');
		expect(mapsUrl(address)).toBe('https://www.google.com/maps/search/?api=1&query=Krankenhausstr.%2040%2C%2089312%20G%C3%BCnzburg');
	});
});

describe('the committed data files', () => {
	const read = (rel: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../data/public/${rel}`, import.meta.url)), 'utf8'));
	const placeFile = placesSchema.parse(read('places.json'));
	const snapshot = snapshotSchema.parse(read('snapshot.json'));
	const bavarian = placeFile.places.filter((row) => row.state === 'BY');

	it('resolve a Bavarian town and list exactly the centres in range, sorted', () => {
		// The Bavarian town with the most centres within 40 km, derived from the files.
		const centred = snapshot.centres.filter((c) => c.lat !== null && c.lon !== null);
		const town = bavarian
			.map((row) => ({ row, count: centred.filter((c) => haversineKm(row.lat, row.lon, c.lat!, c.lon!) <= 40).length }))
			.sort((a, b) => b.count - a.count)[0]!.row;

		const resolution = resolvePlace(town.name, placeFile.places);
		expect(resolution.kind).toBe('found');
		if (resolution.kind !== 'found') return;
		expect(resolution.place.state).toBe('BY');
		expect(normalizePlaceName(resolution.place.name)).toBe(normalizePlaceName(town.name));

		for (const radius of RADII) {
			const result = centresInRange(snapshot.centres, resolution.place, radius);
			const ids = result.map((r) => r.centre.centre_id);
			expect(new Set(ids).size).toBe(ids.length);
			for (const item of result) expect(item.distanceKm).toBeLessThanOrEqual(radius);
			const distances = result.map((r) => r.distanceKm);
			expect(distances).toEqual([...distances].sort((a, b) => a - b));
			const expected = centred
				.filter((c) => haversineKm(resolution.place.lat, resolution.place.lon, c.lat!, c.lon!) <= radius)
				.map((c) => c.centre_id)
				.sort();
			expect([...ids].sort()).toEqual(expected);
		}
	});

	it('resolve every Bavarian postcode to a Bavarian row', () => {
		const sample = bavarian.flatMap((row) => row.postcodes.slice(0, 1)).slice(0, 200);
		for (const postcode of sample) {
			const resolution = resolvePlace(postcode, placeFile.places);
			expect(resolution.kind, postcode).toBe('found');
			if (resolution.kind === 'found') expect(resolution.place.postcodes).toContain(postcode);
		}
	});

	it('suggest only Bavarian names for a misspelt Bavarian town', () => {
		const resolution = resolvePlace('Nurnbreg', placeFile.places);
		expect(resolution.kind).toBe('not_found');
		if (resolution.kind !== 'not_found') throw new Error('unreachable');
		expect(resolution.suggestions.length).toBeGreaterThan(0);
		expect(resolution.suggestions.length).toBeLessThanOrEqual(3);
		const byNames = new Set(bavarian.map((row) => row.name));
		for (const name of resolution.suggestions) expect(byNames.has(name)).toBe(true);
	});
});
