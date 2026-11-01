/**
 * The pipeline entry point (`npm run pipeline`, AD-1, AD-12): fetch → parse → normalise → locate →
 * merge → publish, with one `runAt` for the whole run. Logs one line per centre (id, reader,
 * outcome, listing count, duration; never page content or URLs), one line per origin whose
 * robots.txt was unusable (host and reason only, Story 3.12; not on replays), one line per test address that
 * fell back to its centre, a locate summary and a run summary line. Exits 1 when anything fails; a
 * bad directory, state file, visit log, venue cache or replay file writes nothing. A failed
 * address lookup never fails the run.
 *
 *   node pipeline/stages/run.ts                          # collect and publish
 *   node pipeline/stages/run.ts --save-collect <file>    # … and save the replay input after collect
 *   node pipeline/stages/run.ts --from-collect <file>    # no provider fetch: normalise → locate → merge → publish from the file
 *   node pipeline/stages/run.ts --report <file>          # … and write the run report (Story 3.4) on every exit
 *   node pipeline/stages/run.ts --save-visits <file>     # … and write this run's visits as soon as collect returns or throws
 *
 * The run report (see `report.ts`) names the failing stage (`input`, `fetch`, `state write`,
 * `publish validation`), whether every fetched centre failed (the run still writes its data and
 * exits 0; the workflow fails the job after committing), and per-system health for the alerts.
 * It can be combined with either of the other flags.
 *
 * `--save-visits` (Story 3.11) writes the hosts this run contacted as a visit array right after
 * collect, also when collect throws and before any later step can fail, so the workflow can record
 * them in `data/state/visits.json` when the run fails. It is ignored with `--from-collect`.
 *
 * `--from-collect` re-reads the directory, state, visit log and venue cache from disk and reuses
 * the saved `runAt`, so after a rejected push it applies the same run on top of the newest
 * upstream. Locate runs on replays too: addresses cached upstream need no lookup, but uncached
 * test addresses may still be looked up on Nominatim (within the per-run cap).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { directorySchema, type Centre } from '../../shared/directory.ts';
import type { Snapshot } from '../../shared/snapshot.ts';
import type { State } from '../../shared/state.ts';
import type { Venues } from '../../shared/venues.ts';
import type { Visit } from '../../shared/visits.ts';
import { readVisitLog } from '../fetch/visits.ts';
import { itemkgReader } from '../readers/itemkg/index.ts';
import { kuferwebReader } from '../readers/kuferweb/index.ts';
import { CollectError, collectRun, type CollectOptions, type ReaderRegistry } from './collect.ts';
import { locateRun, type LocateOptions } from './locate.ts';
import { mergeRun, readState, readVenues, serializeState, serializeVenues, serializeVisitLog, writeMergeResult } from './merge.ts';
import { normaliseOutcome, type NormalisedOutcome } from './normalise.ts';
import { DIRECTORY_PATH, SNAPSHOT_PATH, STATE_PATH, VENUES_PATH, VISIT_LOG_PATH } from './paths.ts';
import { buildSnapshot, writeSnapshot } from './publish.ts';
import { loadReplay, saveReplay, saveVisits, type Replay } from './replay.ts';
import { buildRunReport, failedReport, writeReport, type RunReport } from './report.ts';

/** The readers a scheduled run uses. */
export const READER_REGISTRY: ReaderRegistry = { kuferweb: kuferwebReader, itemkg: itemkgReader };

export interface RunOptions {
	directoryPath?: string;
	statePath?: string;
	visitLogPath?: string;
	venuesPath?: string;
	snapshotPath?: string;
	/** The run's clock (`runAt`); ignored with `fromCollect`, which reuses the saved one. */
	now?: () => Date;
	/** Millisecond clock for per-centre durations. */
	clock?: () => number;
	readers?: ReaderRegistry;
	clientOptions?: CollectOptions['clientOptions'];
	/** Nominatim transport and cap for locate (tests pass a fake `fetchImpl` and `sleep`). */
	locate?: LocateOptions;
	/** Write this run's replay input here after collect. */
	saveCollect?: string;
	/** Skip fetch and replay this file. */
	fromCollect?: string;
	/** Write the run report here on every exit (Story 3.4). */
	reportPath?: string;
	/** Write this run's visits here right after collect, also when it throws (Story 3.11). Not on replays. */
	saveVisits?: string;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

/** The directory at `path`, validated. Throws, naming the path. */
function readDirectory(path: string): Centre[] {
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (caught) {
		throw new Error(`cannot read the directory ${path}: ${(caught as Error).message}`);
	}
	const directory = directorySchema.safeParse(data);
	if (!directory.success) throw new Error(`the directory ${path} fails the schema:\n${directory.error.message}`);
	return directory.data;
}

/** `ok` / `failed:<reason>` / `skipped:<reason>`; `-` for a centre with no outcome this run. */
const outcomeCode = (outcome: NormalisedOutcome | undefined): string =>
	outcome === undefined ? '-' : outcome.kind === 'ok' ? 'ok' : `${outcome.kind}:${outcome.reason}`;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One log line per origin whose robots.txt was unusable, host only, sorted by host (Story 3.12). */
function logRobotsUnavailable(robotsUnavailable: Readonly<Record<string, string>>, log: (line: string) => void): void {
	for (const [host, reason] of Object.entries(robotsUnavailable)
		.map(([origin, why]) => [URL.canParse(origin) ? new URL(origin).host : origin, why] as const)
		.sort(([a], [b]) => compare(a, b))) {
		log(`robots ${host}: unusable (${reason}), treated as disallow all`);
	}
}

/** Runs the pipeline and writes the run report when `reportPath` is set. Returns the exit code. */
export async function runPipeline(options: RunOptions = {}): Promise<number> {
	const { code, report } = await run(options);
	if (options.reportPath !== undefined) {
		try {
			writeReport(options.reportPath, report);
		} catch (caught) {
			// The run's own result stands; the monitor treats a missing report as unknown.
			(options.error ?? console.error)(`cannot write the run report ${options.reportPath}: ${(caught as Error).message}`);
		}
	}
	return code;
}

interface RunResult {
	code: number;
	report: RunReport;
}

async function run(options: RunOptions): Promise<RunResult> {
	const {
		directoryPath = DIRECTORY_PATH,
		statePath = STATE_PATH,
		visitLogPath = VISIT_LOG_PATH,
		venuesPath = VENUES_PATH,
		snapshotPath = SNAPSHOT_PATH,
		now = () => new Date(),
		clock,
		readers = READER_REGISTRY,
		clientOptions,
		locate,
		saveCollect,
		fromCollect,
		saveVisits: saveVisitsPath,
		log = console.log,
		error = console.error,
	} = options;

	if (saveCollect !== undefined && fromCollect !== undefined) {
		error('--save-collect and --from-collect cannot be combined; nothing written');
		return { code: 1, report: failedReport('input') };
	}

	let directory: Centre[];
	let visitLog: Visit[];
	let state: State;
	let venues: Venues;
	let replay: Replay | null = null;
	try {
		directory = readDirectory(directoryPath);
		visitLog = readVisitLog(visitLogPath);
		state = readState(statePath, log);
		venues = readVenues(venuesPath);
		if (fromCollect !== undefined) replay = loadReplay(fromCollect);
	} catch (caught) {
		error(`${(caught as Error).message}\nnothing written`);
		return { code: 1, report: failedReport('input') };
	}

	// Fetch and parse, or the saved result of both.
	let collected: Replay;
	let durations: Record<string, number> | null = null;
	let robotsUnavailable: Record<string, string> = {};
	if (replay !== null) {
		collected = replay;
	} else {
		const runAt = now();
		/** Saves this run's visits for the workflow; a failure is logged and the run goes on. */
		const saveRunVisits = (visits: Visit[]): void => {
			if (saveVisitsPath === undefined) return;
			try {
				saveVisits(visits, saveVisitsPath);
			} catch (caught) {
				error(`cannot save the visits file ${saveVisitsPath}: ${(caught as Error).message}`);
			}
		};
		try {
			const result = await collectRun(directory, readers, { log: visitLog, runAt, clientOptions, clock });
			collected = { runAt, outcomes: result.outcomes, visits: result.visits, pages: result.pages };
			durations = result.durations;
			robotsUnavailable = result.robotsUnavailable;
		} catch (caught) {
			saveRunVisits(caught instanceof CollectError ? caught.visits : []);
			if (caught instanceof CollectError) logRobotsUnavailable(caught.robotsUnavailable, log);
			error(`collect failed, nothing written: ${(caught as Error).message}`);
			return { code: 1, report: failedReport('fetch', runAt) };
		}
		saveRunVisits(collected.visits);
		if (saveCollect !== undefined) {
			try {
				saveReplay(collected, saveCollect);
			} catch (caught) {
				error(`cannot save the replay file ${saveCollect}, nothing else written: ${(caught as Error).message}`);
				return { code: 1, report: failedReport('fetch', runAt) };
			}
		}
	}
	const { runAt } = collected;

	// Normalise every directory centre that has an outcome; outcomes of centres no longer in the
	// directory (a replay after a directory edit) are dropped.
	const outcomes: Record<string, NormalisedOutcome> = {};
	for (const centre of directory) {
		const outcome = collected.outcomes[centre.centre_id];
		if (outcome !== undefined) {
			const previous = state.centres[centre.centre_id]?.listings ?? [];
			outcomes[centre.centre_id] = normaliseOutcome(centre, outcome, collected.pages[centre.centre_id] ?? [], previous);
		}
	}

	const tally = { ok: 0, failed: 0, skipped: 0 };
	for (const centre of [...directory].sort((a, b) => compare(a.centre_id, b.centre_id))) {
		const outcome = outcomes[centre.centre_id];
		if (outcome !== undefined) tally[outcome.kind] += 1;
		const count = outcome?.kind === 'ok' ? outcome.listings.length : 0;
		const duration = durations?.[centre.centre_id];
		log(`${centre.centre_id} ${centre.reader} ${outcomeCode(outcome)} ${count} ${duration === undefined ? '-' : `${duration}ms`}`);
	}
	logRobotsUnavailable(robotsUnavailable, log);

	// Locate: coordinates for every listing; new lookups go to merge. Never fails the run.
	const located = await locateRun({ directory, outcomes, venues, runAt, log, ...locate });

	// Merge: only written when this run changed the state, the visit log or the venue cache.
	const merged = mergeRun({ state, log: visitLog, outcomes: located.outcomes, visits: collected.visits, venues, lookups: located.lookups, runAt });
	const stateChanged =
		serializeState(merged.state) !== serializeState(state) ||
		serializeVisitLog(merged.log) !== serializeVisitLog(visitLog) ||
		serializeVenues(merged.venues) !== serializeVenues(venues);
	if (stateChanged) {
		try {
			writeMergeResult(merged, { statePath, visitLogPath, venuesPath });
		} catch (caught) {
			error(`cannot write the state, snapshot not published: ${(caught as Error).message}`);
			return { code: 1, report: failedReport('state write', runAt) };
		}
	}

	// Publish.
	const registered = (Object.keys(readers) as (keyof ReaderRegistry)[]).filter((system) => readers[system] !== undefined);
	let published: 'written' | 'unchanged';
	let listingCount: number;
	let systems: Snapshot['systems'];
	try {
		const snapshot = buildSnapshot({ centres: directory, state: merged.state, outcomes: located.outcomes, readers: registered, runAt });
		listingCount = snapshot.listings.length;
		systems = snapshot.systems;
		published = writeSnapshot(snapshot, snapshotPath);
	} catch (caught) {
		error(`cannot publish the snapshot, the last good file is left as it is: ${(caught as Error).message}`);
		return { code: 1, report: failedReport('publish validation', runAt) };
	}

	log(
		`run ${runAt.toISOString()}${replay !== null ? ' (replay)' : ''}: ${directory.length} centres, ${tally.ok} ok, ${tally.failed} failed, ` +
			`${tally.skipped} skipped; state ${stateChanged ? 'written' : 'unchanged'}; ${listingCount} listings, snapshot ${published}`,
	);
	const report = buildRunReport({ runAt, tally, systems, directory, priorState: state, outcomes: located.outcomes });
	if (report.all_fetched_failed) error(`every fetched centre failed (${tally.failed} failed, ${tally.skipped} skipped); the data is written`);
	return { code: 0, report };
}

export type CliOptions = Pick<RunOptions, 'saveCollect' | 'fromCollect' | 'reportPath' | 'saveVisits'>;

/** Parses the CLI arguments into run options. Throws on unknown or incomplete arguments. */
export function parseCliArgs(args: readonly string[]): CliOptions {
	const { values } = parseArgs({
		args: [...args],
		options: { 'save-collect': { type: 'string' }, 'from-collect': { type: 'string' }, report: { type: 'string' }, 'save-visits': { type: 'string' } },
		strict: true,
		allowPositionals: false,
	});
	return { saveCollect: values['save-collect'], fromCollect: values['from-collect'], reportPath: values.report, saveVisits: values['save-visits'] };
}

if (import.meta.main) {
	let cli: CliOptions;
	try {
		cli = parseCliArgs(process.argv.slice(2));
	} catch (caught) {
		console.error(`${(caught as Error).message}\nusage: node pipeline/stages/run.ts [--save-collect <file> | --from-collect <file>] [--report <file>] [--save-visits <file>]`);
		process.exit(1);
	}
	process.exitCode = await runPipeline(cli);
}
