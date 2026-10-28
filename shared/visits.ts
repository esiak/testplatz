import { z } from 'zod';

/**
 * The per-host visit log (AD-5). A visit is one host contacted in one run, at the run's clock.
 * Fetch reads the log to enforce the budget; merge (Story 2.5) persists this run's visits.
 */

export const visitSchema = z.strictObject({
	host: z.string().min(1),
	/** The run's clock as a UTC ISO datetime (`…Z`). */
	at: z.iso.datetime(),
});

export const visitLogSchema = z.array(visitSchema);

export type Visit = z.infer<typeof visitSchema>;

/**
 * How many visits to `host` in `log` are newer than `runAt - windowMs`. A visit exactly
 * `windowMs` old no longer counts; a visit after `runAt` does.
 */
export function visitsInWindow(log: readonly Visit[], host: string, runAt: Date, windowMs: number): number {
	const since = runAt.getTime() - windowMs;
	return log.filter((visit) => visit.host === host && Date.parse(visit.at) > since).length;
}
