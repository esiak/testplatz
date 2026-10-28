/**
 * Read-only access to the per-host visit log (AD-5). Fetch reads it to enforce the budget and
 * never writes it; merge (Story 2.5) persists this run's visits.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { visitLogSchema, visitsInWindow, type Visit } from '../../shared/visits.ts';
import { VISIT_LIMIT_PER_HOST, VISIT_WINDOW_MS } from '../config.ts';

export const VISIT_LOG_PATH = fileURLToPath(new URL('../../data/state/visits.json', import.meta.url));

/**
 * The visit log at `path`. A missing file is an empty log; any other read error, invalid JSON or
 * a schema failure throws (naming the path), so a run never ignores the budget.
 */
export function readVisitLog(path: string): Visit[] {
	let text: string;
	try {
		text = readFileSync(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw new Error(`cannot read visit log ${path}: ${(error as Error).message}`);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		throw new Error(`visit log ${path} is not valid JSON: ${(error as Error).message}`);
	}
	const parsed = visitLogSchema.safeParse(data);
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new Error(`visit log ${path} is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
	}
	return parsed.data;
}

/** Whether `host` has used its visit budget in the window before `runAt`, so it must not be contacted. */
export function overBudget(log: readonly Visit[], host: string, runAt: Date): boolean {
	return visitsInWindow(log, host, runAt, VISIT_WINDOW_MS) >= VISIT_LIMIT_PER_HOST;
}
