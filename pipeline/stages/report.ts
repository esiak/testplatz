/**
 * The run report (Story 3.4): a small JSON file `run.ts --report <file>` writes on every exit, so
 * the workflow's `monitor` job can tell the operator what broke without installing dependencies.
 *
 * - `stage`: the stage that made the run exit 1, or `null` when it exited 0;
 * - `all_fetched_failed`: ≥ 1 centre `failed` and none `ok` (`skipped` is not fetched);
 * - `systems`: per reader system, whether it is down (no centre `ok` and no success for more than
 *   `SYSTEM_DOWN_MS`, or never) and which of its centres' dates disappeared (`ok` with zero
 *   listings while the state before merge still held an upcoming live listing).
 *
 * - `coverage`: the parse coverage statistics (Story 4.1, `shared/coverage.ts`).
 *
 * Systems are empty and coverage is `null` on a failed run: the monitor only evaluates them from a
 * run that published.
 */
import { writeFileSync } from 'node:fs';
import type { Coverage } from '../../shared/coverage.ts';
import type { Centre } from '../../shared/directory.ts';
import type { SnapshotSystem } from '../../shared/snapshot.ts';
import type { State } from '../../shared/state.ts';
import { SYSTEM_DOWN_MS } from '../config.ts';
import type { LocatedOutcome } from './locate.ts';

/** The stages `run.ts` itself can fail in. */
export type ReportStage = 'input' | 'fetch' | 'state write' | 'publish validation';

export interface SystemReport {
	reader: string;
	/** Set when the system is down; `since` is its newest success, `null` when it never succeeded. */
	problem_down: { since: string | null } | null;
	/** Centres whose dates disappeared this run, by `centre_id`. */
	disappeared: { centre_id: string; name: string }[];
}

export interface RunReport {
	stage: ReportStage | null;
	runAt: string | null;
	all_fetched_failed: boolean;
	systems: SystemReport[];
	/** Parse coverage of a run that published; `null` on a failed run. */
	coverage: Coverage | null;
}

export interface RunReportInput {
	runAt: Date;
	tally: { ok: number; failed: number; skipped: number };
	/** The published snapshot's `systems[]`. */
	systems: readonly SnapshotSystem[];
	directory: readonly Centre[];
	/** The state before this run's merge. */
	priorState: State;
	/** This run's located outcomes per `centre_id`. */
	outcomes: Readonly<Record<string, LocatedOutcome>>;
	/** This run's parse coverage. */
	coverage: Coverage;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The report of a run that published. */
export function buildRunReport({ runAt, tally, systems, directory, priorState, outcomes, coverage }: RunReportInput): RunReport {
	const now = runAt.getTime();
	const disappeared = new Map<string, SystemReport['disappeared']>();
	for (const centre of [...directory].sort((a, b) => compare(a.centre_id, b.centre_id))) {
		const outcome = outcomes[centre.centre_id];
		if (outcome?.kind !== 'ok' || outcome.listings.length > 0) continue;
		const prior = priorState.centres[centre.centre_id]?.listings ?? [];
		if (!prior.some((listing) => listing.removed_at === null && Date.parse(listing.starts_at) >= now)) continue;
		const list = disappeared.get(centre.reader) ?? [];
		list.push({ centre_id: centre.centre_id, name: centre.name });
		disappeared.set(centre.reader, list);
	}

	return {
		stage: null,
		runAt: runAt.toISOString(),
		all_fetched_failed: tally.failed >= 1 && tally.ok === 0,
		systems: systems.map((system) => {
			const since = system.last_success_at;
			const down =
				system.centres_covered >= 1 && system.centres_ok === 0 && (since === null || now - Date.parse(since) > SYSTEM_DOWN_MS);
			return { reader: system.reader, problem_down: down ? { since } : null, disappeared: disappeared.get(system.reader) ?? [] };
		}),
		coverage,
	};
}

/** The report of a run that exited 1 in `stage` (a `--save-collect` write failure reports `fetch`). */
export const failedReport = (stage: ReportStage, runAt: Date | null = null): RunReport => ({
	stage,
	runAt: runAt === null ? null : runAt.toISOString(),
	all_fetched_failed: false,
	systems: [],
	coverage: null,
});

/** Writes the report as one line of JSON. Throws when the file cannot be written. */
export function writeReport(path: string, report: RunReport): void {
	writeFileSync(path, `${JSON.stringify(report)}\n`);
}
