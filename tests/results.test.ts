import { describe, expect, it } from 'vitest';
import type { SnapshotCentre } from '../shared/snapshot.ts';
import { allBookedOut, datedResults, sortedCards, undatedKind, type SortedCard } from '../web/src/search/results.ts';
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
	const d30 = coveredCentre('d30', 'ok');
	const d10 = coveredCentre('d10', 'ok');
	const u5 = coveredCentre('u5', 'ok');
	const unloc = snapshotCentre('unloc', { lat: null, lon: null });
	const listings = [
		snapshotListing('d30', '2026-12-01T10:00:00+01:00'),
		snapshotListing('d10', '2026-12-05T10:00:00+01:00'),
	];
	const results = datedResults(outcome([[u5, 5], [d10, 10], [d30, 30]], [unloc]), listings, NOW);

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
		const same = coveredCentre('same', 'ok');
		const other = coveredCentre('other', 'ok');
		const quiet = coveredCentre('quiet', 'ok');
		const loose = snapshotCentre('loose', { lat: null, lon: null });
		const lost = snapshotCentre('lost', { lat: null, lon: null });
		const tied = datedResults(
			outcome([[quiet, 12], [same, 12], [other, 12]], [loose, lost]),
			[
				snapshotListing('same', '2026-12-09T10:00:00+01:00'),
				snapshotListing('same', '2026-12-02T10:00:00+01:00'),
				snapshotListing('other', '2026-12-09T10:00:00+01:00'),
			],
			NOW,
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
		const loose = snapshotCentre('loose', { lat: null, lon: null });
		const datedLoose = coveredCentre('datedloose', 'ok', { lat: null, lon: null });
		const mixed = datedResults(outcome([[u5, 5]], [loose, datedLoose]), [snapshotListing('datedloose', '2026-12-09T10:00:00+01:00')], NOW);
		const sorted = sortedCards(mixed, 'nearest');
		if (sorted.sort !== 'nearest') throw new Error('expected nearest');
		expect(cardIds(sorted.cards)).toEqual(['u5', 'datedloose@2026-12-09T10:00', 'loose']);
	});
});

describe('allBookedOut', () => {
	const dated = (...statuses: Array<'free' | 'booked_out' | 'waitlist' | 'unknown'>) =>
		datedResults(
			outcome([[near, 3]]),
			statuses.map((status, i) => snapshotListing('near', `2026-12-0${i + 1}T10:00:00+01:00`, { status })),
			NOW,
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
