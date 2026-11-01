/**
 * Records a failed run's visits (Story 3.11): adds the visits in `<visits-file>` (written by
 * `run.ts --save-visits`) to `data/state/visits.json` with merge's rule (dedupe by host + `at`,
 * drop visits older than the 24 h window before now, sorted), so the budget never under-counts.
 * Writes the visit log atomically through merge and touches no other file. Exits 1, writing
 * nothing, when either file is unreadable or not a visit array.
 *
 *   node pipeline/stages/record-visits.ts <visits-file>
 */
import { readFileSync } from 'node:fs';
import { visitLogSchema, type Visit } from '../../shared/visits.ts';
import { readVisitLog } from '../fetch/visits.ts';
import { mergeVisitLog, writeVisitLog } from './merge.ts';
import { VISIT_LOG_PATH } from './paths.ts';

export interface RecordVisitsOptions {
	visitLogPath?: string;
	now?: () => Date;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

/** The visits file at `path`. Throws, naming the file, when it is unreadable, not JSON or not a visit array. */
export function readVisitsFile(path: string): Visit[] {
	let data: unknown;
	try {
		data = JSON.parse(readFileSync(path, 'utf8'));
	} catch (caught) {
		throw new Error(`cannot read visits file ${path}: ${(caught as Error).message}`);
	}
	const parsed = visitLogSchema.safeParse(data);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new Error(`visits file ${path} is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
	}
	return parsed.data;
}

/** Adds the visits in `visitsPath` to the visit log. Returns the exit code. */
export function recordVisits(visitsPath: string, { visitLogPath = VISIT_LOG_PATH, now = () => new Date(), log = console.log, error = console.error }: RecordVisitsOptions = {}): number {
	let visits: Visit[];
	let current: Visit[];
	try {
		visits = readVisitsFile(visitsPath);
		current = readVisitLog(visitLogPath);
	} catch (caught) {
		error(`${(caught as Error).message}\nnothing written`);
		return 1;
	}
	// Only a visit the log lacks (and that is still in the window) causes a write, so recording
	// visits already on main changes nothing, not even by pruning old entries.
	const at = now();
	const known = new Set(current.map((visit) => `${visit.host}\n${visit.at}`));
	const fresh = mergeVisitLog([], visits, at).filter((visit) => !known.has(`${visit.host}\n${visit.at}`));
	if (fresh.length === 0) {
		log(`visit log unchanged (${visits.length} visits already recorded or older than the window)`);
		return 0;
	}
	const merged = mergeVisitLog(current, fresh, at);
	try {
		writeVisitLog(merged, visitLogPath);
	} catch (caught) {
		error(`cannot write the visit log ${visitLogPath}: ${(caught as Error).message}`);
		return 1;
	}
	log(`visit log written: ${fresh.length} new visits recorded, ${merged.length} entries`);
	return 0;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args.length !== 1 || args[0]!.startsWith('-')) {
		console.error('usage: node pipeline/stages/record-visits.ts <visits-file>');
		process.exit(1);
	}
	process.exitCode = recordVisits(args[0]!);
}
