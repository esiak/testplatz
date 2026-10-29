import { describe, expect, it } from 'vitest';
import type { SnapshotCentre } from '../shared/snapshot.ts';
import { datedResults } from '../web/src/search/results.ts';
import type { Outcome } from '../web/src/search/search.ts';
import { coveredCentre, snapshotCentre, snapshotListing } from './fixtures/snapshot.ts';

type ResultsOutcome = Extract<Outcome, { kind: 'results' }>;

const near = coveredCentre('near', 'ok');
const far = coveredCentre('far', 'ok');
const uncovered = snapshotCentre('uncovered');
const nowhere = coveredCentre('nowhere', 'ok', { lat: null, lon: null });
const outside = coveredCentre('outside', 'ok');

function outcome(items: Array<[SnapshotCentre, number]>, unlocated: SnapshotCentre[] = []): ResultsOutcome {
	return {
		kind: 'results',
		search: { q: 'Nürnberg', r: 40 },
		items: items.map(([centre, distanceKm]) => ({ centre, distanceKm })),
		unlocated,
		hiddenUnlocated: 0,
	};
}

const NOW = Date.parse('2026-11-01T09:00:00Z');
const ids = (results: ReturnType<typeof datedResults>) => results.dated.map((entry) => entry.listing.id);
const undatedIds = (results: ReturnType<typeof datedResults>) => results.undated.map((entry) => entry.centre.centre_id);

describe('datedResults', () => {
	it('gives one entry per upcoming date of a shown centre, and leaves that centre out of the undated list', () => {
		const listings = [snapshotListing('near', '2026-12-09T10:00:00+01:00'), snapshotListing('near', '2026-12-10T10:00:00+01:00')];
		const results = datedResults(outcome([[near, 3], [uncovered, 5]]), listings, NOW);
		expect(ids(results)).toEqual(['near@2026-12-09T10:00', 'near@2026-12-10T10:00']);
		expect(results.dated[0]).toMatchObject({ centre: near, distanceKm: 3 });
		expect(undatedIds(results)).toEqual(['uncovered']);
	});

	it('hides dates before now, keeps one starting exactly now, and reverts a centre with only past dates', () => {
		const listings = [
			snapshotListing('near', '2026-11-01T09:59:00+01:00'),
			snapshotListing('near', '2026-11-01T10:00:00+01:00'),
			snapshotListing('far', '2026-10-31T10:00:00+01:00'),
		];
		const results = datedResults(outcome([[near, 3], [far, 10]]), listings, NOW);
		expect(ids(results)).toEqual(['near@2026-11-01T10:00']);
		expect(undatedIds(results)).toEqual(['far']);
	});

	it('ignores listings of centres the search does not show', () => {
		const listings = [snapshotListing('outside', '2026-12-09T10:00:00+01:00')];
		const results = datedResults(outcome([[near, 3]]), listings, NOW);
		expect(results.dated).toEqual([]);
		expect(undatedIds(results)).toEqual(['near']);
	});

	it('orders by start, then distance with unknown last, then id', () => {
		const listings = [
			snapshotListing('nowhere', '2026-12-09T10:00:00+01:00'),
			snapshotListing('far', '2026-12-09T10:00:00+01:00'),
			snapshotListing('near', '2026-12-09T10:00:00+01:00', { id: 'near@2026-12-09T10:00#2' }),
			snapshotListing('near', '2026-12-09T10:00:00+01:00'),
			snapshotListing('far', '2026-12-08T18:00:00+01:00'),
		];
		const results = datedResults(outcome([[near, 3], [far, 10]], [nowhere]), listings, NOW);
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
		const listings = [snapshotListing('near', '2027-10-31T02:00:00+01:00'), snapshotListing('far', '2027-10-31T02:30:00+02:00')];
		const results = datedResults(outcome([[near, 3], [far, 10]]), listings, NOW);
		expect(ids(results)).toEqual(['far@2027-10-31T02:30', 'near@2027-10-31T02:00']);
	});

	it('keeps the undated centres in outcome order: in range nearest first, then unlocated', () => {
		const results = datedResults(outcome([[near, 3], [uncovered, 5], [far, 10]], [nowhere]), [], NOW);
		expect(undatedIds(results)).toEqual(['near', 'uncovered', 'far', 'nowhere']);
		expect(results.undated.map((entry) => entry.distanceKm)).toEqual([3, 5, 10, null]);
	});

	it('never filters or reorders by eligibility', () => {
		const listings = [
			snapshotListing('near', '2026-12-10T10:00:00+01:00', { eligibility: 'Nur für Personen mit Hauptwohnsitz in München.' }),
			snapshotListing('far', '2026-12-09T10:00:00+01:00'),
		];
		expect(ids(datedResults(outcome([[near, 3], [far, 10]]), listings, NOW))).toEqual(['far@2026-12-09T10:00', 'near@2026-12-10T10:00']);
	});
});
