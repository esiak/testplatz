/**
 * The `monitor` job's alerts (Story 3.4): opens or comments on a "Pipeline failed: <stage>" issue
 * for a failed `pipeline.yml` run, opens, comments on or closes one "Reader <reader>: needs
 * attention" issue per reader system from the run report, and decides whether the dead-man check
 * is pinged (only when publish, build and deploy all succeeded).
 *
 *   node tools/alerts.ts
 *
 * Env: `STAGE` and `REPORT` (the publish job's outputs), `PUBLISH_RESULT`, `BUILD_RESULT`,
 * `DEPLOY_RESULT` (`needs.<job>.result`), `RUN_URL`, `EVENT`, `GH_TOKEN` for the `gh` CLI, and
 * `GITHUB_OUTPUT`, to which `ping=true|false` is written before any GitHub call. Exits 1 only when
 * a GitHub call fails. Imports only Node built-ins: the job runs without `npm ci`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** The run report as `pipeline/stages/report.ts` writes it (tools may not import stages). */
export interface Report {
	stage: string | null;
	runAt: string | null;
	all_fetched_failed: boolean;
	systems: { reader: string; problem_down: { since: string | null } | null; disappeared: { centre_id: string; name: string }[] }[];
}

export type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped' | string;

export interface Issue {
	number: number;
	title: string;
}

export type Action =
	| { kind: 'create'; title: string; body: string }
	| { kind: 'comment'; number: number; body: string }
	| { kind: 'close'; number: number; comment: string };

export interface AlertInput {
	/** The publish job's `stage` output; empty when its steps did not name one. */
	stage: string;
	/** The run report; `null` when the pipeline step wrote none. */
	report: Report | null;
	jobs: { publish: JobResult; build: JobResult; deploy: JobResult };
	openIssues: readonly Issue[];
	runUrl: string;
	event: string;
	now: Date;
}

export interface AlertPlan {
	actions: Action[];
	ping: boolean;
}

export const failureTitle = (stage: string): string => `Pipeline failed: ${stage}`;
export const systemTitle = (reader: string): string => `Reader ${reader}: needs attention`;

/** The failed stage: the publish job's output, else the first failed job; `null` when none failed. */
export function resolveStage(stage: string, jobs: AlertInput['jobs']): string | null {
	if (stage !== '') return stage;
	if (jobs.publish === 'failure') return 'setup';
	if (jobs.build === 'failure') return 'build';
	if (jobs.deploy === 'failure') return 'deploy';
	return null;
}

/** The dead-man check is pinged only when publish, build and deploy all succeeded. */
export const shouldPing = (jobs: AlertInput['jobs']): boolean => jobs.publish === 'success' && jobs.build === 'success' && jobs.deploy === 'success';

/** `2026-10-28 05:17 UTC`. */
const formatUtc = (iso: string): string => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The lowest-numbered open issue with exactly this title. */
const find = (issues: readonly Issue[], title: string): Issue | undefined =>
	[...issues].sort((a, b) => a.number - b.number).find((issue) => issue.title === title);

/** The actions for this run and whether to ping the dead-man check. */
export function planAlerts({ stage, report, jobs, openIssues, runUrl, event, now }: AlertInput): AlertPlan {
	const actions: Action[] = [];
	const runLines = `Run: ${runUrl}\nEvent: ${event}\nTime: ${now.toISOString()}`;

	const failed = resolveStage(stage, jobs);
	if (failed !== null) {
		const title = failureTitle(failed);
		const open = find(openIssues, title);
		if (open !== undefined) {
			actions.push({ kind: 'comment', number: open.number, body: `Failed again.\n\n${runLines}` });
		} else {
			const body =
				`The \`pipeline.yml\` run failed in stage **${failed}**. This issue is never closed automatically; ` +
				`close it once the cause is fixed.\n\n${runLines}`;
			actions.push({ kind: 'create', title, body });
		}
	}

	for (const system of report?.systems ?? []) {
		const problems: string[] = [];
		if (system.problem_down !== null) {
			const since = system.problem_down.since;
			problems.push(since === null ? 'No centre read successfully yet' : `No centre read successfully since ${formatUtc(since)}`);
		}
		for (const centre of system.disappeared) problems.push(`${centre.name} (${centre.centre_id}): dates disappeared, check the page`);

		const title = systemTitle(system.reader);
		const open = find(openIssues, title);
		if (problems.length > 0) {
			const body = `${problems.map((problem) => `- ${problem}`).join('\n')}\n\n${runLines}`;
			actions.push(open !== undefined ? { kind: 'comment', number: open.number, body } : { kind: 'create', title, body });
		} else if (open !== undefined) {
			actions.push({ kind: 'close', number: open.number, comment: `Recovered in run ${runUrl}` });
		}
	}

	return { actions, ping: shouldPing(jobs) };
}

/** The report from the `REPORT` output; `null` when empty or not a report. */
export function parseReport(text: string): Report | null {
	if (text.trim() === '') return null;
	try {
		const value = JSON.parse(text) as Report;
		return value !== null && typeof value === 'object' && Array.isArray(value.systems) ? value : null;
	} catch {
		return null;
	}
}

const gh = (args: string[]): string => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

function apply(action: Action): void {
	if (action.kind === 'create') gh(['issue', 'create', '--title', action.title, '--body', action.body]);
	else if (action.kind === 'comment') gh(['issue', 'comment', String(action.number), '--body', action.body]);
	else gh(['issue', 'close', String(action.number), '--comment', action.comment]);
}

const describe = (action: Action): string =>
	action.kind === 'create' ? `create "${action.title}"` : `${action.kind} #${action.number}`;

if (import.meta.main) {
	const env = (name: string): string => process.env[name] ?? '';
	const report = parseReport(env('REPORT'));
	if (report === null && env('REPORT').trim() !== '') console.log('::warning::the run report is not valid; reader systems not evaluated');
	const jobs = { publish: env('PUBLISH_RESULT'), build: env('BUILD_RESULT'), deploy: env('DEPLOY_RESULT') };
	const ping = shouldPing(jobs);
	// Written first, so the ping still happens when an issue call fails.
	const output = env('GITHUB_OUTPUT');
	if (output !== '') appendFileSync(output, `ping=${ping}\n`);

	let failures = 0;
	// Only the bot's own issues: in a public repo anyone can open an issue with the same title.
	let openIssues: Issue[] = [];
	try {
		openIssues = JSON.parse(gh(['issue', 'list', '--state', 'open', '--app', 'github-actions', '--json', 'number,title', '--limit', '200'])) as Issue[];
	} catch (caught) {
		console.error(`cannot list open issues: ${(caught as Error).message}`);
		process.exit(1);
	}
	const plan = planAlerts({ stage: env('STAGE'), report, jobs, openIssues, runUrl: env('RUN_URL'), event: env('EVENT'), now: new Date() });
	for (const action of plan.actions) {
		try {
			apply(action);
			console.log(describe(action));
		} catch (caught) {
			failures += 1;
			console.error(`::error::${describe(action)} failed: ${(caught as Error).message}`);
		}
	}
	console.log(`${plan.actions.length - failures} of ${plan.actions.length} issue actions done; ping=${plan.ping}`);
	process.exitCode = failures > 0 ? 1 : 0;
}
