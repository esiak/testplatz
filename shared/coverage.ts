/**
 * Parse coverage (Story 4.1, `parse-coverage.md`): one pure classification of every directory
 * centre into exactly one category per run, shared by the daily run's statistics and the local
 * coverage script (Story 4.2). No I/O.
 *
 * Coverage = (`parsed` + `parsed-empty`) / (`parsed` + `parsed-empty` + `failed` + `no-reader`);
 * `unreachable`, `no-test-page`, `pdf-only`, `robots`, `opted-out` and `budget` lie outside it.
 */
import type { Centre } from './directory.ts';

/** The coverage categories, in their fixed report and log order. */
export const COVERAGE_CATEGORIES = [
	'parsed',
	'parsed-empty',
	'failed',
	'no-reader',
	'unreachable',
	'no-test-page',
	'pdf-only',
	'robots',
	'opted-out',
	'budget',
] as const;
export type CoverageCategory = (typeof COVERAGE_CATEGORIES)[number];

/** The categories counted in the coverage denominator. */
const IN_DENOMINATOR: readonly CoverageCategory[] = ['parsed', 'parsed-empty', 'failed', 'no-reader'];

/** A centre's outcome after normalise/locate, structurally (a `LocatedOutcome` fits). */
export type CoverageOutcome = { kind: 'ok'; listings: readonly unknown[] } | { kind: 'failed' | 'skipped'; reason: string };

/** The centre fields the classification reads. */
export type CoverageCentre = Pick<Centre, 'centre_id' | 'reader' | 'test_page_url' | 'opted_out' | 'pdf_only'>;

/** A centre's category; `reason` is set for `failed` only (`not-run` when there was no outcome). */
export interface Classification {
	category: CoverageCategory;
	reason: string | null;
}

/** Per reader: centres assigned, and how they landed (`skipped` = robots + budget + opted-out + pdf-only). */
export interface ReaderCoverage {
	assigned: number;
	parsed: number;
	'parsed-empty': number;
	failed: number;
	unreachable: number;
	skipped: number;
}

export interface Coverage {
	/** Count per category, all ten keys; sums to the directory size. */
	by_category: Record<CoverageCategory, number>;
	/** `failed` count per reason code, sorted by reason. */
	by_reason: Record<string, number>;
	/** Per reader present in the directory, `none` excluded, sorted by reader. */
	by_reader: Record<string, ReaderCoverage>;
	/** `percent` rounded to one decimal, `null` when the denominator is 0. */
	coverage: { percent: number | null; numerator: number; denominator: number };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The one category of a centre, given its outcome this run (`undefined` when it had none). */
export function classifyCentre(centre: CoverageCentre, outcome: CoverageOutcome | undefined): Classification {
	const is = (category: CoverageCategory): Classification => ({ category, reason: null });
	if (centre.opted_out || (outcome?.kind === 'skipped' && outcome.reason === 'opted-out')) return is('opted-out');
	if (centre.pdf_only === true) return is('pdf-only');
	if (outcome?.kind === 'ok') return is(outcome.listings.length > 0 ? 'parsed' : 'parsed-empty');
	if (outcome?.kind === 'failed') {
		if (outcome.reason === 'list-page') return is('unreachable');
		return { category: 'failed', reason: outcome.reason };
	}
	if (outcome?.kind === 'skipped') {
		if (outcome.reason === 'robots') return is('robots');
		if (outcome.reason === 'budget') return is('budget');
	}
	// No reader ran: no outcome for a reader-`none` centre, or `skipped:no-reader`.
	if (centre.reader === 'none' || (outcome?.kind === 'skipped' && outcome.reason === 'no-reader')) {
		return is(centre.test_page_url === null ? 'no-test-page' : 'no-reader');
	}
	// A reader is set but nothing ran this run (a replay after a directory edit), or an unknown skip.
	return { category: 'failed', reason: outcome === undefined ? 'not-run' : outcome.reason };
}

/** The coverage statistics of a run over the whole directory. */
export function buildCoverage(directory: readonly CoverageCentre[], outcomes: Readonly<Record<string, CoverageOutcome>>): Coverage {
	const byCategory = Object.fromEntries(COVERAGE_CATEGORIES.map((category) => [category, 0])) as Record<CoverageCategory, number>;
	const byReason = new Map<string, number>();
	const byReader = new Map<string, ReaderCoverage>();

	for (const centre of directory) {
		const { category, reason } = classifyCentre(centre, outcomes[centre.centre_id]);
		byCategory[category] += 1;
		if (reason !== null) byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
		if (centre.reader === 'none') continue;
		const entry = byReader.get(centre.reader) ?? { assigned: 0, parsed: 0, 'parsed-empty': 0, failed: 0, unreachable: 0, skipped: 0 };
		entry.assigned += 1;
		if (category === 'parsed' || category === 'parsed-empty' || category === 'failed' || category === 'unreachable') entry[category] += 1;
		else if (category === 'robots' || category === 'budget' || category === 'opted-out' || category === 'pdf-only') entry.skipped += 1;
		byReader.set(centre.reader, entry);
	}

	const numerator = byCategory.parsed + byCategory['parsed-empty'];
	const denominator = IN_DENOMINATOR.reduce((sum, category) => sum + byCategory[category], 0);
	const percent = denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
	const sorted = <T>(map: Map<string, T>): Record<string, T> => Object.fromEntries([...map].sort(([a], [b]) => compare(a, b)));
	return { by_category: byCategory, by_reason: sorted(byReason), by_reader: sorted(byReader), coverage: { percent, numerator, denominator } };
}

/** The run log line: `coverage <num>/<den> (<percent>%): parsed N, …, budget N` (`-` for the percent when the denominator is 0). */
export function formatCoverageLine({ by_category, coverage }: Coverage): string {
	const percent = coverage.percent === null ? '-' : `${coverage.percent}%`;
	const counts = COVERAGE_CATEGORIES.map((category) => `${category} ${by_category[category]}`).join(', ');
	return `coverage ${coverage.numerator}/${coverage.denominator} (${percent}): ${counts}`;
}
