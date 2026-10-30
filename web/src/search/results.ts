import type { SnapshotCentre, SnapshotListing } from '../../../shared/snapshot.ts';
import type { Outcome, Sort } from './search.ts';

/** One result card: an upcoming date of a centre the search shows. */
export interface DatedResult {
	listing: SnapshotListing;
	centre: SnapshotCentre;
	/** null for a centre without a map position. */
	distanceKm: number | null;
}

/** A centre the search shows that has no upcoming date. */
export interface UndatedResult {
	centre: SnapshotCentre;
	distanceKm: number | null;
}

/**
 * The card a shown centre without an upcoming date gets, coverage first (AD-8): a checked centre
 * whose last check succeeded has nothing listed; one whose check failed or never ran is not checked
 * right now; a centre without a reader is not checked automatically.
 */
export type UndatedKind = 'no_dates' | 'not_checked_right_now' | 'not_checked';

export function undatedKind(centre: Pick<SnapshotCentre, 'coverage' | 'last_result'>): UndatedKind {
	if (centre.coverage === 'not_checked') return 'not_checked';
	return centre.last_result === 'ok' ? 'no_dates' : 'not_checked_right_now';
}

export interface Results {
	dated: DatedResult[];
	undated: UndatedResult[];
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The cards of a results outcome. Dates: listings of a shown centre (in range or unlocated in
 * place) starting at or after `now`, ordered by start, then distance (unknown last), then id.
 * Undated: the shown centres without such a date, in the outcome's order.
 */
export function datedResults(outcome: Extract<Outcome, { kind: 'results' }>, listings: readonly SnapshotListing[], now: number): Results {
	const shown = new Map<string, UndatedResult>();
	for (const item of outcome.items) shown.set(item.centre.centre_id, { centre: item.centre, distanceKm: item.distanceKm });
	for (const centre of outcome.unlocated) shown.set(centre.centre_id, { centre, distanceKm: null });

	const dated: Array<DatedResult & { start: number }> = [];
	for (const listing of listings) {
		const entry = shown.get(listing.centre_id);
		if (!entry) continue;
		const start = Date.parse(listing.starts_at);
		if (!(start >= now)) continue;
		dated.push({ listing, centre: entry.centre, distanceKm: entry.distanceKm, start });
	}
	dated.sort(
		(a, b) =>
			a.start - b.start ||
			(a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
			byId(a.listing.id, b.listing.id),
	);

	const withDates = new Set(dated.map((entry) => entry.listing.centre_id));
	const undated = [...shown.values()].filter((entry) => !withDates.has(entry.centre.centre_id));
	return { dated: dated.map(({ listing, centre, distanceKm }) => ({ listing, centre, distanceKm })), undated };
}

/** One card in a sorted list: a date, or a centre without one. */
export type SortedCard = { kind: 'dated'; result: DatedResult } | { kind: 'undated'; item: UndatedResult };

/**
 * The cards in display order. Soonest: the dated cards in `datedResults` order, then (in a second
 * group, under the "No dates to show" heading) the undated cards in the outcome's order. Nearest:
 * one group, by distance (unknown last), then dated before undated, then start, then id; undated
 * ties keep the outcome's order.
 */
export type SortedCards = { sort: 'soonest'; dated: SortedCard[]; undated: SortedCard[] } | { sort: 'nearest'; cards: SortedCard[] };

const distanceOrLast = (km: number | null): number => km ?? Number.POSITIVE_INFINITY;

export function sortedCards(results: Results, sort: Sort): SortedCards {
	const dated = results.dated.map((result): SortedCard => ({ kind: 'dated', result }));
	const undated = results.undated.map((item): SortedCard => ({ kind: 'undated', item }));
	if (sort === 'soonest') return { sort, dated, undated };

	const keyed = [...dated, ...undated].map((card, index) => ({ card, index }));
	keyed.sort((a, b) => {
		const da = distanceOrLast(a.card.kind === 'dated' ? a.card.result.distanceKm : a.card.item.distanceKm);
		const db = distanceOrLast(b.card.kind === 'dated' ? b.card.result.distanceKm : b.card.item.distanceKm);
		// Infinity - Infinity is NaN: two unknown distances tie.
		if (da !== db) return da < db ? -1 : 1;
		if (a.card.kind !== b.card.kind) return a.card.kind === 'dated' ? -1 : 1;
		if (a.card.kind === 'dated' && b.card.kind === 'dated') {
			const byStart = Date.parse(a.card.result.listing.starts_at) - Date.parse(b.card.result.listing.starts_at);
			return byStart || byId(a.card.result.listing.id, b.card.result.listing.id);
		}
		return a.index - b.index;
	});
	return { sort, cards: keyed.map(({ card }) => card) };
}

/** True when there is a dated card and every one is booked out or waitlist only. */
export function allBookedOut(dated: readonly DatedResult[]): boolean {
	return dated.length > 0 && dated.every(({ listing }) => listing.status === 'booked_out' || listing.status === 'waitlist');
}
