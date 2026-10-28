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
	isAmbiguousName,
	labelPostcode,
	levenshtein,
	MAX_PLACE_SUGGESTIONS,
	mapsUrl,
	nextRadius,
	parseSearchFragment,
	pickText,
	RADII,
	resolveSearch,
	resolvePlace,
	runSearch,
	searchFragment,
	snapRadius,
	suggestPlaces,
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

	it('uses the Bavarian row when a name exists in BY and another state', () => {
		const rows = [placeRow('01000001', 'Wald', { postcodes: ['24000'] }), placeRow('09000002', 'Wald', { postcodes: ['93000'] })];
		expect(resolvePlace('Wald', rows)).toEqual({ kind: 'found', place: rows[1] });
	});

	it('reports several places for a name Bavarian towns share under different postcodes', () => {
		for (const input of ['Kastl', ' kastl ', 'Neustadt']) expect(resolvePlace(input, places), input).toEqual({ kind: 'several' });
	});

	it('uses the lowest-key row for a name whose Bavarian rows share one label postcode', () => {
		expect(resolvePlace('Chiemsee', places)).toEqual({ kind: 'found', place: PLACE_ROWS.chiemsee });
	});

	it('resolves the qualified form "<postcode> <name>" to that row, Bavarian rows first', () => {
		expect(resolvePlace('92280 Kastl', places)).toEqual({ kind: 'found', place: PLACE_ROWS.kastlAs });
		expect(resolvePlace('84556  kastl', places)).toEqual({ kind: 'found', place: PLACE_ROWS.kastlAoe });
		expect(resolvePlace('95506 Kastl', places)).toEqual({ kind: 'found', place: PLACE_ROWS.kastlTir });
		expect(resolvePlace('91413 Neustadt', places)).toEqual({ kind: 'found', place: PLACE_ROWS.neustadtBy2 });
		expect(resolvePlace('83209 Chiemsee', places)).toEqual({ kind: 'found', place: PLACE_ROWS.chiemsee });
	});

	it('reports a qualified form matching only outside Bavaria as outside Bavaria', () => {
		expect(resolvePlace('24999 Kastl', places)).toEqual({ kind: 'outside_bavaria' });
	});

	it('handles a qualified form that matches no row as plain text', () => {
		expect(resolvePlace('99999 Kastl', places)).toEqual({ kind: 'not_found', suggestions: [] });
		expect(resolvePlace('90402 München', places)).toEqual({ kind: 'not_found', suggestions: [] });
	});

	it('keeps a 5-digit postcode on the lowest-key Bavarian row', () => {
		expect(resolvePlace('89231', places)).toEqual({ kind: 'found', place: PLACE_ROWS.neuUlm });
		expect(resolvePlace('92280', places)).toEqual({ kind: 'found', place: PLACE_ROWS.kastlAs });
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

describe('suggestPlaces', () => {
	const picks = (input: string) => suggestPlaces(input, places).map((s) => s.pickText);

	it('suggests nothing below 2 characters (trimmed)', () => {
		for (const input of ['', 'M', ' M ', '8', '  ']) expect(suggestPlaces(input, places), input).toEqual([]);
	});

	it('matches name prefixes ignoring case and umlaut spelling', () => {
		for (const input of ['nü', 'nue', 'NU', 'Nürnb', ' nurnberg ']) expect(picks(input), input).toEqual(['Nürnberg']);
		expect(picks('Mün')).toEqual(['München']);
		expect(picks('Fu')).toEqual(['Fürth']);
	});

	it('suggests only Bavarian rows', () => {
		expect(picks('Kiel')).toEqual([]);
		for (const s of suggestPlaces('Kastl', places)) expect(s.place.state).toBe('BY');
	});

	it('qualifies same-name towns with their label postcode, with postcode and district meta', () => {
		expect(suggestPlaces('Kastl', places)).toEqual([
			{ place: PLACE_ROWS.kastlAoe, pickText: '84556 Kastl', meta: { postcode: '84556', district: 'Landkreis Altötting' } },
			{ place: PLACE_ROWS.kastlAs, pickText: '92280 Kastl', meta: { postcode: '92280', district: 'Landkreis Amberg-Sulzbach' } },
			{ place: PLACE_ROWS.kastlTir, pickText: '95506 Kastl', meta: { postcode: '95506', district: 'Landkreis Tirschenreuth' } },
		]);
	});

	it('gives unique names no meta line', () => {
		expect(suggestPlaces('Augs', places)).toEqual([{ place: PLACE_ROWS.augsburg, pickText: 'Augsburg', meta: null }]);
	});

	it('puts exact matches first, then German collation, then key', () => {
		const rows = [
			placeRow('09000001', 'Aub'),
			placeRow('09000002', 'Aubstadt'),
			placeRow('09000003', 'Au', { postcodes: ['84000'] }),
			placeRow('09000004', 'Äu'),
		];
		// "Äu" normalises like "Au", so both are exact matches and come first, in German collation.
		expect(suggestPlaces('Au', rows).map((s) => s.place.key)).toEqual(['09000003', '09000004', '09000001', '09000002']);
		const ties = [placeRow('09000009', 'Zell', { postcodes: ['97000'] }), placeRow('09000008', 'Zell', { postcodes: ['97000'] })];
		expect(suggestPlaces('Zel', ties).map((s) => s.place.key)).toEqual(['09000008']);
	});

	it('collapses rows with the same name and label postcode into the lowest-key row', () => {
		expect(suggestPlaces('Chiemsee', places)).toEqual([{ place: PLACE_ROWS.chiemsee, pickText: 'Chiemsee', meta: null }]);
	});

	it('matches postcode prefixes for 2–5 digits, with the smallest matched postcode as meta', () => {
		expect(suggestPlaces('8923', places)).toEqual([{ place: PLACE_ROWS.neuUlm, pickText: 'Neu-Ulm', meta: { postcode: '89231', district: null } }]);
		expect(suggestPlaces('89233', places)).toEqual([{ place: PLACE_ROWS.neuUlm, pickText: 'Neu-Ulm', meta: { postcode: '89233', district: null } }]);
		expect(suggestPlaces('892330', places)).toEqual([]);
		expect(suggestPlaces('24', places)).toEqual([]); // Kiel and the SH Kastl are not Bavarian
	});

	it('orders postcode matches by the matched postcode, then name', () => {
		expect(picks('9')).toEqual([]);
		expect(suggestPlaces('9', places)).toEqual([]);
		expect(suggestPlaces('90', places).map((s) => [s.pickText, s.meta?.postcode])).toEqual([
			['Nürnberg', '90402'],
			['Fürth', '90762'],
		]);
	});

	it('adds the district to postcode meta for an ambiguous name', () => {
		expect(suggestPlaces('92', places)).toEqual([
			{ place: PLACE_ROWS.kastlAs, pickText: '92280 Kastl', meta: { postcode: '92280', district: 'Landkreis Amberg-Sulzbach' } },
			{ place: PLACE_ROWS.neustadtBy1, pickText: '92660 Neustadt', meta: { postcode: '92660', district: 'Neustadt' } },
		]);
	});

	it('caps the list at 6 rows', () => {
		expect(MAX_PLACE_SUGGESTIONS).toBe(6);
		expect(picks('Ober')).toEqual(['Oberammergau', 'Oberasbach', 'Oberau', 'Oberaudorf', 'Oberaurach', 'Oberbergkirchen']);
	});

	it('names the pick text and label postcode', () => {
		expect(labelPostcode(PLACE_ROWS.neuUlm)).toBe('89231');
		expect(labelPostcode(PLACE_ROWS.oberau)).toBeNull();
		expect(isAmbiguousName('KASTL', places)).toBe(true);
		expect(isAmbiguousName('Chiemsee', places)).toBe(false);
		expect(pickText(PLACE_ROWS.kastlTir, places)).toBe('95506 Kastl');
		expect(pickText(PLACE_ROWS.neuUlm, places)).toBe('Neu-Ulm');
	});
});

describe('resolveSearch', () => {
	it('lets an exact result decide: found, several or outside Bavaria', () => {
		expect(resolveSearch('Augsburg', places)).toEqual({ kind: 'found', place: PLACE_ROWS.augsburg });
		expect(resolveSearch('Au', places)).toEqual({ kind: 'found', place: PLACE_ROWS.au });
		expect(resolveSearch('Kastl', places)).toEqual({ kind: 'several' });
		expect(resolveSearch('Kiel', places)).toEqual({ kind: 'outside_bavaria' });
		expect(resolveSearch('92280 Kastl', places)).toEqual({ kind: 'found', place: PLACE_ROWS.kastlAs });
		expect(resolveSearch('89231', places)).toEqual({ kind: 'found', place: PLACE_ROWS.neuUlm });
	});

	it('searches the only suggestion under its pick text', () => {
		expect(resolveSearch('Augs', places)).toEqual({ kind: 'suggested', place: PLACE_ROWS.augsburg, text: 'Augsburg' });
		expect(resolveSearch(' nurnb ', places)).toEqual({ kind: 'suggested', place: PLACE_ROWS.nuernberg, text: 'Nürnberg' });
		expect(resolveSearch('8923', places)).toEqual({ kind: 'suggested', place: PLACE_ROWS.neuUlm, text: 'Neu-Ulm' });
		expect(resolveSearch('Kas', places)).toEqual({ kind: 'several' });
		expect(resolveSearch('Chiem', places)).toEqual({ kind: 'suggested', place: PLACE_ROWS.chiemsee, text: 'Chiemsee' });
	});

	it('reports several when two or more suggestions match, even beyond the cap of 6', () => {
		expect(resolveSearch('Ober', places)).toEqual({ kind: 'several' });
		expect(resolveSearch('Neu', places)).toEqual({ kind: 'several' });
		expect(resolveSearch('90', places)).toEqual({ kind: 'several' });
	});

	it('reports place-not-found with did-you-mean when nothing is suggested', () => {
		expect(resolveSearch('Nurnbreg', places)).toEqual({ kind: 'not_found', suggestions: ['Nürnberg'] });
		expect(resolveSearch('M', places)).toMatchObject({ kind: 'not_found' });
		expect(resolveSearch('99999', places)).toEqual({ kind: 'not_found', suggestions: [] });
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

	it('searches a single suggestion and reports its pick text as the search', () => {
		expect(runSearch({ q: 'Nürnb', r: 20 }, places, centres)).toMatchObject({ kind: 'results', search: { q: 'Nürnberg', r: 20 } });
		expect(runSearch({ q: 'Augs', r: 10 }, places, centres)).toEqual({ kind: 'no_centres', search: { q: 'Augsburg', r: 10 } });
		expect(runSearch({ q: 'Ober', r: 40 }, places, centres)).toEqual({ kind: 'field_error', code: 'several_places', suggestions: [] });
	});

	it('returns field errors as codes', () => {
		expect(runSearch({ q: 'Kiel', r: 40 }, places, centres)).toEqual({ kind: 'field_error', code: 'outside_bavaria', suggestions: [] });
		expect(runSearch({ q: 'Kastl', r: 40 }, places, centres)).toEqual({ kind: 'field_error', code: 'several_places', suggestions: [] });
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

	it('resolve every Bavarian row\'s pick text to a row with the same name and label postcode', () => {
		for (const row of bavarian) {
			const text = pickText(row, placeFile.places);
			const resolution = resolvePlace(text, placeFile.places);
			expect(resolution.kind, text).toBe('found');
			if (resolution.kind !== 'found') continue;
			expect(normalizePlaceName(resolution.place.name), text).toBe(normalizePlaceName(row.name));
			expect(labelPostcode(resolution.place), text).toBe(labelPostcode(row));
		}
	});

	it('suggest at most 6 Bavarian rows with distinct pick texts for every 2- and 3-character prefix', () => {
		const prefixes = new Set<string>();
		for (const row of bavarian) {
			prefixes.add(row.name.slice(0, 2));
			prefixes.add(row.name.slice(0, 3));
			for (const postcode of row.postcodes) prefixes.add(postcode.slice(0, 3));
		}
		for (const prefix of prefixes) {
			const list = suggestPlaces(prefix, placeFile.places);
			expect(list.length, prefix).toBeGreaterThan(0);
			expect(list.length, prefix).toBeLessThanOrEqual(6);
			expect(new Set(list.map((s) => s.pickText)).size, prefix).toBe(list.length);
			for (const s of list) expect(s.place.state, prefix).toBe('BY');
		}
	});

	it('resolve every postcode-input suggestion\'s pick text to the row it showed', () => {
		const postcodes = new Set(bavarian.flatMap((row) => row.postcodes));
		for (const postcode of postcodes) {
			for (const suggestion of suggestPlaces(postcode, placeFile.places)) {
				const resolution = resolveSearch(suggestion.pickText, placeFile.places);
				expect(resolution.kind, `${postcode} → ${suggestion.pickText}`).toBe('found');
				if (resolution.kind === 'found') expect(resolution.place.key, `${postcode} → ${suggestion.pickText}`).toBe(suggestion.place.key);
			}
		}
	});

	it('follow the suggestions shown when no exact match decides', () => {
		for (const text of ['Augs', 'Ober', 'Mün', 'Hof', 'Gunz', '8923']) {
			const exact = resolvePlace(text, placeFile.places);
			const shown = suggestPlaces(text, placeFile.places, Number.POSITIVE_INFINITY);
			const resolution = resolveSearch(text, placeFile.places);
			if (exact.kind !== 'not_found') expect(resolution, text).toEqual(exact);
			else if (shown.length === 1) expect(resolution, text).toEqual({ kind: 'suggested', place: shown[0]!.place, text: shown[0]!.pickText });
			else if (shown.length > 1) expect(resolution, text).toEqual({ kind: 'several' });
			else expect(resolution, text).toEqual(exact);
		}
		expect(resolveSearch('Ober', placeFile.places).kind).toBe('several');
		expect(resolveSearch('Mün', placeFile.places).kind).toBe('several');
		expect(resolveSearch('Hof', placeFile.places).kind).toBe('found');
		expect(resolveSearch('Augs', placeFile.places)).toMatchObject({ kind: 'suggested', text: 'Augsburg' });
	});

	it('report several places for every same-name Bavarian group with different label postcodes', () => {
		const labels = new Map<string, Set<string | null>>();
		for (const row of bavarian) {
			const name = normalizePlaceName(row.name);
			labels.set(name, (labels.get(name) ?? new Set()).add(labelPostcode(row)));
		}
		const ambiguous = [...labels].filter(([, set]) => set.size > 1);
		expect(ambiguous.length).toBeGreaterThan(0);
		for (const [name] of ambiguous) {
			expect(resolvePlace(name, placeFile.places).kind, name).toBe('several');
			const exact = suggestPlaces(name, placeFile.places).filter((s) => normalizePlaceName(s.place.name) === name);
			expect(exact.length, name).toBeGreaterThan(1);
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
