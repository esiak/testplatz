/**
 * Merge stage (AD-6, AD-5 persistence): applies this run's centre outcomes to the history in
 * `data/state/state.json` and appends this run's visits to `data/state/visits.json`. The only
 * module that writes `data/state/`. `mergeRun` is pure; `writeMergeResult` validates both files
 * before writing either, then writes each atomically (temp file + rename), visit log first.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { emptyState, sortListings, STATE_VERSION, stateSchema, type CentreState, type State, type StoredListing } from '../../shared/state.ts';
import { visitLogSchema, type Visit } from '../../shared/visits.ts';
import { VISIT_WINDOW_MS } from '../config.ts';
import type { NormalisedOutcome } from './normalise.ts';
import { STATE_PATH, VISIT_LOG_PATH } from './paths.ts';

export interface MergeInput {
	state: State;
	/** The visit log as read at run start. */
	log: readonly Visit[];
	/** This run's normalised outcome per `centre_id`; centres without one are untouched. */
	outcomes: Readonly<Record<string, NormalisedOutcome>>;
	/** This run's visits from collect. */
	visits: readonly Visit[];
	runAt: Date;
}

export interface MergeResult {
	state: State;
	log: Visit[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `ok`: upsert this run's listings (keeping `first_seen_at`/`baseline`), tombstone the rest. */
function applyOk(previous: CentreState | undefined, listings: Extract<NormalisedOutcome, { kind: 'ok' }>['listings'], at: string): CentreState {
	const stored = new Map((previous?.listings ?? []).map((listing) => [listing.id, listing]));
	const baseline = (previous?.last_success_at ?? null) === null;
	const seen = new Set<string>();
	const merged: StoredListing[] = listings.map((listing) => {
		seen.add(listing.id);
		const old = stored.get(listing.id);
		return { ...listing, first_seen_at: old?.first_seen_at ?? at, removed_at: null, baseline: old?.baseline ?? baseline };
	});
	for (const old of stored.values()) {
		if (!seen.has(old.id)) merged.push({ ...old, removed_at: old.removed_at ?? at });
	}
	return { last_result: 'ok', last_checked_at: at, last_success_at: at, listings: sortListings(merged) };
}

/**
 * The state and visit log after this run. Per outcome: `ok` sets `last_checked_at` and
 * `last_success_at`, replaces the listings and tombstones missing ones; `failed` sets
 * `last_checked_at` and keeps the listings; `skipped` changes nothing. Then every listing whose
 * `starts_at` is not after `runAt` is dropped. The log keeps entries newer than the 24 h window,
 * without exact `(host, at)` duplicates, so re-running merge for the same run charges no host twice.
 */
export function mergeRun({ state, log, outcomes, visits, runAt }: MergeInput): MergeResult {
	const at = runAt.toISOString();
	const now = runAt.getTime();
	const centres: Record<string, CentreState> = { ...state.centres };

	for (const [centreId, outcome] of Object.entries(outcomes)) {
		const previous = centres[centreId];
		if (outcome.kind === 'skipped') continue;
		if (outcome.kind === 'failed') {
			centres[centreId] = {
				last_result: 'failed',
				last_checked_at: at,
				last_success_at: previous?.last_success_at ?? null,
				listings: previous?.listings ?? [],
			};
			continue;
		}
		centres[centreId] = applyOk(previous, outcome.listings, at);
	}

	const sorted: Record<string, CentreState> = {};
	for (const centreId of Object.keys(centres).sort(compare)) {
		const centre = centres[centreId]!;
		const upcoming = centre.listings.filter((listing) => Date.parse(listing.starts_at) > now);
		sorted[centreId] = upcoming.length === centre.listings.length ? centre : { ...centre, listings: upcoming };
	}

	const since = now - VISIT_WINDOW_MS;
	const seen = new Set<string>();
	const mergedLog = [...log, ...visits]
		.filter((visit) => {
			const key = `${visit.host}\n${visit.at}`;
			if (seen.has(key) || Date.parse(visit.at) <= since) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || compare(a.host, b.host));

	return { state: { stateVersion: STATE_VERSION, centres: sorted }, log: mergedLog };
}

/**
 * The state at `path`. A missing file is the empty state; any other read error, invalid JSON, a
 * different `stateVersion` or a schema failure throws, naming the path.
 */
export function readState(path: string = STATE_PATH): State {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
		throw new Error(`cannot read state file ${path}: ${(error as Error).message}`);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		throw new Error(`state file ${path} is not valid JSON: ${(error as Error).message}`);
	}
	const version = typeof data === 'object' && data !== null ? (data as { stateVersion?: unknown }).stateVersion : undefined;
	if (version !== STATE_VERSION) {
		throw new Error(`state file ${path} has stateVersion ${JSON.stringify(version)}, expected ${STATE_VERSION}`);
	}
	const parsed = stateSchema.safeParse(data);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new Error(`state file ${path} is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
	}
	return parsed.data;
}

/** The file text: centres sorted by id, tab-indented, trailing newline. */
export function serializeState(state: State): string {
	const centres = Object.fromEntries(
		Object.keys(state.centres)
			.sort(compare)
			.map((centreId) => [centreId, { ...state.centres[centreId]!, listings: sortListings(state.centres[centreId]!.listings) }]),
	);
	return `${JSON.stringify({ stateVersion: state.stateVersion, centres }, null, '\t')}\n`;
}

/** The visit log file text: tab-indented, trailing newline. */
export const serializeVisitLog = (log: readonly Visit[]): string => `${JSON.stringify(log, null, '\t')}\n`;

/** Writes `text` to `path` via a temp file in the same directory and a rename. */
function writeAtomic(path: string, text: string): void {
	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });
	const temp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
	try {
		writeFileSync(temp, text);
		renameSync(temp, path);
	} catch (caught) {
		rmSync(temp, { force: true });
		throw caught;
	}
}

export interface MergePaths {
	statePath: string;
	visitLogPath: string;
}

/**
 * Validates the state and the visit log, then writes each atomically: the visit log first, then
 * the state. If the second write fails, this run's visits are still on record (the budget never
 * under-counts) while the state stays at the previous run, which a rerun repeats safely. Throws,
 * writing nothing, when either fails its schema.
 */
export function writeMergeResult(result: MergeResult, { statePath, visitLogPath }: MergePaths = { statePath: STATE_PATH, visitLogPath: VISIT_LOG_PATH }): void {
	const state = stateSchema.safeParse(result.state);
	if (!state.success) throw new Error(`state fails the schema, nothing written:\n${state.error.message}`);
	const log = visitLogSchema.safeParse(result.log);
	if (!log.success) throw new Error(`visit log fails the schema, nothing written:\n${log.error.message}`);
	writeAtomic(visitLogPath, serializeVisitLog(log.data));
	writeAtomic(statePath, serializeState(state.data));
}
