import { describe, expect, it } from 'vitest';
import { haversineKm } from '../shared/geo.ts';
import type { SnapshotCentre, SnapshotListing } from '../shared/snapshot.ts';
import { allBookedOut, sortedCards, undatedKind, type Results, type SortedCard } from '../web/src/search/results.ts';
import { selectCards } from '../web/src/search/search.ts';
import { placeRow } from './fixtures/places.ts';
import { coveredCentre, snapshotCentre, snapshotListing } from './fixtures/snapshot.ts';

// Herrsching and Starnberg, about 12.6 km apart.
const HERRSCHING = placeRow('09188127', 'Herrsching a.Ammersee', { postcodes: ['82211'], lat: 47.9993, lon: 11.1716 });
const STARNBERG_AT = { lat: 47.9973, lon: 11.3398 };
const PLACE = HERRSCHING;

/** A point `km` north of the searched place (about 111.2 km per degree of latitude). */
const at = (km: number) => ({ lat: PLACE.lat + km / 111.1951, lon: PLACE.lon });
/** A listing of `centre` at the centre's own coordinates. */
const placedAt = (centre: SnapshotCentre, startsAt: string, extra: Partial<SnapshotListing> = {}) =>
	snapshotListing(centre.centre_id, startsAt, { lat: centre.lat, lon: centre.lon, ...extra });

const near = coveredCentre('near', 'ok', at(3));
const far = coveredCentre('far', 'ok', at(10));
const uncovered = snapshotCentre('uncovered', at(5));
const outside = coveredCentre('outside', 'ok', at(60));
/** No coordinates, in Herrsching by postcode. */
const nowhere = coveredCentre('nowhere', 'ok', {
	lat: null,
	lon: null,
	address: { street: 'Hauptstraße 1', postcode: '82211', city: 'Breitbrunn' },
});
/** No coordinates, elsewhere. */
const lost = coveredCentre('lost', 'ok', { lat: null, lon: null, address: { street: 'Hauptstraße 1', postcode: '96317', city: 'Kronach' } });

const NOW = Date.parse('2026-11-01T09:00:00Z');
const ids = (results: Results) => results.dated.map((entry) => entry.listing.id);
const undatedIds = (results: Results) => results.undated.map((entry) => entry.centre.centre_id);
const select = (centres: SnapshotCentre[], listings: SnapshotListing[], r = 40) => selectCards(centres, listings, PLACE, r, NOW);

describe('selectCards', () => {
	it('gives a date in town of a centre far away a result card at the date\'s distance, and no undated card', () => {
		const starnberg = coveredCentre('starnberg', 'ok', STARNBERG_AT);
		expect(haversineKm(PLACE.lat, PLACE.lon, STARNBERG_AT.lat, STARNBERG_AT.lon)).toBeGreaterThan(10);
		const listing = snapshotListing('starnberg', '2026-12-09T10:00:00+01:00', { lat: PLACE.lat, lon: PLACE.lon });
		const results = select([starnberg], [listing], 10);
		expect(ids(results)).toEqual(['starnberg@2026-12-09T10:00']);
		expect(results.dated[0]!.distanceKm).toBeCloseTo(0, 6);
		expect(results.undated).toEqual([]);
	});

	it('leaves out a centre in range whose only current date is outside the radius', () => {
		const starnberg = coveredCentre('starnberg', 'ok', STARNBERG_AT);
		const listing = snapshotListing('starnberg', '2026-12-09T10:00:00+01:00', { lat: PLACE.lat, lon: PLACE.lon });
		const starnbergPlace = placeRow('09188139', 'Starnberg', { postcodes: ['82319'], ...STARNBERG_AT });
		const results = selectCards([starnberg], [listing], starnbergPlace, 5, NOW);
		expect(results).toEqual({ dated: [], undated: [] });
	});

	it('shows only the dates of a centre that lie in range', () => {
		const listings = [
			placedAt(near, '2026-12-09T10:00:00+01:00'),
			snapshotListing('near', '2026-12-10T10:00:00+01:00', at(50)),
		];
		const results = select([near], listings);
		expect(ids(results)).toEqual(['near@2026-12-09T10:00']);
		expect(results.dated[0]!.distanceKm).toBeCloseTo(3, 3);
		expect(results.undated).toEqual([]);
	});

	it('gives a covered centre in range with only past dates a no-dates card by the centre\'s distance', () => {
		const results = select([near], [placedAt(near, '2026-10-31T10:00:00+01:00')]);
		expect(results.dated).toEqual([]);
		expect(undatedIds(results)).toEqual(['near']);
		expect(results.undated[0]!.distanceKm).toBeCloseTo(3, 3);
		expect(undatedKind(results.undated[0]!.centre)).toBe('no_dates');
	});

	it('gives an uncovered centre in range an undated card by the centre\'s distance', () => {
		const results = select([uncovered], []);
		expect(undatedIds(results)).toEqual(['uncovered']);
		expect(results.undated[0]!.distanceKm).toBeCloseTo(5, 3);
	});

	it('places a date without coordinates at its located centre', () => {
		const listing = snapshotListing('near', '2026-12-09T10:00:00+01:00', { lat: null, lon: null, location: 'centre' });
		const results = select([near], [listing]);
		expect(ids(results)).toEqual(['near@2026-12-09T10:00']);
		expect(results.dated[0]!.distanceKm).toBeCloseTo(3, 3);
		expect(select([outside], [{ ...listing, centre_id: 'outside', id: 'outside@x' }])).toEqual({ dated: [], undated: [] });
	});

	it('shows a date with no coordinates at all with distance unknown when its centre is in the place', () => {
		const listing = snapshotListing('nowhere', '2026-12-09T10:00:00+01:00', { lat: null, lon: null, location: 'centre' });
		const results = select([nowhere], [listing], 10);
		expect(ids(results)).toEqual(['nowhere@2026-12-09T10:00']);
		expect(results.dated[0]!.distanceKm).toBeNull();
		expect(results.undated).toEqual([]);
	});

	it('places a date with its own coordinates there, even when its centre has none and is elsewhere', () => {
		const results = select([lost], [snapshotListing('lost', '2026-12-09T10:00:00+01:00', at(2))]);
		expect(ids(results)).toEqual(['lost@2026-12-09T10:00']);
		expect(results.dated[0]!.distanceKm).toBeCloseTo(2, 3);
		expect(results.undated).toEqual([]);
	});

	it('does not show a date with no coordinates at all when its centre is elsewhere', () => {
		const listing = snapshotListing('lost', '2026-12-09T10:00:00+01:00', { lat: null, lon: null, location: 'centre' });
		expect(select([lost], [listing])).toEqual({ dated: [], undated: [] });
	});

	it('shows a date exactly at the radius', () => {
		const spot = at(7);
		const r = haversineKm(PLACE.lat, PLACE.lon, spot.lat, spot.lon);
		const results = select([outside], [snapshotListing('outside', '2026-12-09T10:00:00+01:00', spot)], r);
		expect(ids(results)).toEqual(['outside@2026-12-09T10:00']);
		expect(results.dated[0]!.distanceKm).toBe(r);
	});

	it('hides dates before now, keeps one starting exactly now, and reverts a centre with only past dates', () => {
		const listings = [
			placedAt(near, '2026-11-01T09:59:00+01:00'),
			placedAt(near, '2026-11-01T10:00:00+01:00'),
			placedAt(far, '2026-10-31T10:00:00+01:00'),
		];
		const results = select([near, far], listings);
		expect(ids(results)).toEqual(['near@2026-11-01T10:00']);
		expect(undatedIds(results)).toEqual(['far']);
	});

	it('ignores listings of centres not in the snapshot', () => {
		expect(select([near], [placedAt(outside, '2026-12-09T10:00:00+01:00', at(1))])).toMatchObject({ dated: [] });
	});

	it('orders by start, then distance with unknown last, then id', () => {
		const listings = [
			snapshotListing('nowhere', '2026-12-09T10:00:00+01:00', { lat: null, lon: null }),
			placedAt(far, '2026-12-09T10:00:00+01:00'),
			placedAt(near, '2026-12-09T10:00:00+01:00', { id: 'near@2026-12-09T10:00#2' }),
			placedAt(near, '2026-12-09T10:00:00+01:00'),
			placedAt(far, '2026-12-08T18:00:00+01:00'),
		];
		const results = select([near, far, nowhere], listings);
		expect(ids(results)).toEqual([
			'far@2026-12-08T18:00',
			'near@2026-12-09T10:00',
			'near@2026-12-09T10:00#2',
			'far@2026-12-09T10:00',
			'nowhere@2026-12-09T10:00',
		]);
		expect(results.dated.at(-1)!.distanceKm).toBeNull();
	});

	it('compares instants across the summer-time change', () => {
		// 02:30 CEST (00:30Z) comes before 02:00 CET (01:00Z) on the night the clocks go back.
		const listings = [placedAt(near, '2027-10-31T02:00:00+01:00'), placedAt(far, '2027-10-31T02:30:00+02:00')];
		expect(ids(select([near, far], listings))).toEqual(['far@2027-10-31T02:30', 'near@2027-10-31T02:00']);
	});

	it('orders the undated centres: in range nearest first, then unlocated in the place; the rest are not shown', () => {
		const results = select([far, nowhere, outside, uncovered, lost, near], []);
		expect(undatedIds(results)).toEqual(['near', 'uncovered', 'far', 'nowhere']);
		expect(results.undated.map((entry) => entry.distanceKm && Math.round(entry.distanceKm))).toEqual([3, 5, 10, null]);
	});

	it('never filters or reorders by eligibility', () => {
		const listings = [
			placedAt(near, '2026-12-10T10:00:00+01:00', { eligibility: 'Nur für Personen mit Hauptwohnsitz in München.' }),
			placedAt(far, '2026-12-09T10:00:00+01:00'),
		];
		expect(ids(select([near, far], listings))).toEqual(['far@2026-12-09T10:00', 'near@2026-12-10T10:00']);
	});
});

describe('undatedKind', () => {
	it('gives a covered centre whose last check succeeded the no-dates card', () => {
		expect(undatedKind(coveredCentre('c', 'ok'))).toBe('no_dates');
	});

	it('gives a covered centre whose check failed or never ran the "not checked right now" card', () => {
		expect(undatedKind(coveredCentre('c', 'failed'))).toBe('not_checked_right_now');
		expect(undatedKind(coveredCentre('c', null))).toBe('not_checked_right_now');
	});

	it('gives a centre without coverage the uncovered card, whatever its last result', () => {
		expect(undatedKind(snapshotCentre('u'))).toBe('not_checked');
		expect(undatedKind({ coverage: 'not_checked', last_result: 'ok' })).toBe('not_checked');
		expect(undatedKind({ coverage: 'not_checked', last_result: 'failed' })).toBe('not_checked');
	});
});

const cardIds = (cards: SortedCard[]) =>
	cards.map((card) => (card.kind === 'dated' ? card.result.listing.id : card.item.centre.centre_id));

describe('sortedCards', () => {
	const d30 = coveredCentre('d30', 'ok', at(30));
	const d10 = coveredCentre('d10', 'ok', at(10));
	const u5 = coveredCentre('u5', 'ok', at(5));
	const unloc = snapshotCentre('unloc', { ...nowhere, centre_id: 'unloc', coverage: 'not_checked' });
	const listings = [placedAt(d30, '2026-12-01T10:00:00+01:00'), placedAt(d10, '2026-12-05T10:00:00+01:00')];
	const results = select([d30, unloc, d10, u5], listings);

	it('soonest: dated cards in date order, then the undated cards in outcome order', () => {
		const sorted = sortedCards(results, 'soonest');
		if (sorted.sort !== 'soonest') throw new Error('expected soonest');
		expect(cardIds(sorted.dated)).toEqual(['d30@2026-12-01T10:00', 'd10@2026-12-05T10:00']);
		expect(cardIds(sorted.undated)).toEqual(['u5', 'unloc']);
	});

	it('nearest: one list by distance, unknown last', () => {
		const sorted = sortedCards(results, 'nearest');
		if (sorted.sort !== 'nearest') throw new Error('expected nearest');
		expect(cardIds(sorted.cards)).toEqual(['u5', 'd10@2026-12-05T10:00', 'd30@2026-12-01T10:00', 'unloc']);
	});

	it('nearest: at one distance, dated before undated, then start, then id; undated ties keep outcome order', () => {
		const same = coveredCentre('same', 'ok', { ...at(12), name: 'B' });
		const other = coveredCentre('other', 'ok', { ...at(12), name: 'C' });
		const quiet = coveredCentre('quiet', 'ok', { ...at(12), name: 'A' });
		const loose = snapshotCentre('loose', { ...nowhere, centre_id: 'loose', name: 'D', coverage: 'not_checked' });
		const gone = snapshotCentre('lost', { ...nowhere, centre_id: 'lost', name: 'E', coverage: 'not_checked' });
		const tied = select(
			[other, gone, same, loose, quiet],
			[
				placedAt(same, '2026-12-09T10:00:00+01:00'),
				placedAt(same, '2026-12-02T10:00:00+01:00'),
				placedAt(other, '2026-12-09T10:00:00+01:00'),
			],
		);
		const sorted = sortedCards(tied, 'nearest');
		if (sorted.sort !== 'nearest') throw new Error('expected nearest');
		expect(cardIds(sorted.cards)).toEqual([
			'same@2026-12-02T10:00',
			'other@2026-12-09T10:00',
			'same@2026-12-09T10:00',
			'quiet',
			'loose',
			'lost',
		]);
	});

	it('nearest: an unlocated dated card sorts with the unknown distances, before unlocated undated ones', () => {
		const loose = snapshotCentre('loose', { ...nowhere, centre_id: 'loose', name: 'A', coverage: 'not_checked' });
		const datedLoose = coveredCentre('datedloose', 'ok', { ...nowhere, centre_id: 'datedloose', name: 'B' });
		const mixed = select([loose, u5, datedLoose], [snapshotListing('datedloose', '2026-12-09T10:00:00+01:00', { lat: null, lon: null })]);
		const sorted = sortedCards(mixed, 'nearest');
		if (sorted.sort !== 'nearest') throw new Error('expected nearest');
		expect(cardIds(sorted.cards)).toEqual(['u5', 'datedloose@2026-12-09T10:00', 'loose']);
	});
});

describe('allBookedOut', () => {
	const dated = (...statuses: Array<'free' | 'booked_out' | 'waitlist' | 'unknown'>) =>
		select(
			[near],
			statuses.map((status, i) => placedAt(near, `2026-12-0${i + 1}T10:00:00+01:00`, { status })),
		).dated;

	it('is true when every dated card is booked out or waitlist', () => {
		expect(allBookedOut(dated('booked_out'))).toBe(true);
		expect(allBookedOut(dated('booked_out', 'waitlist'))).toBe(true);
	});

	it('is false with a free or unknown date, or no dates at all', () => {
		expect(allBookedOut(dated('booked_out', 'free'))).toBe(false);
		expect(allBookedOut(dated('booked_out', 'unknown'))).toBe(false);
		expect(allBookedOut([])).toBe(false);
	});
});
