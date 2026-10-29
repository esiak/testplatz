import type { SnapshotCentre, SnapshotListing } from '../../../shared/snapshot.ts';
import type { Outcome } from './search.ts';

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
