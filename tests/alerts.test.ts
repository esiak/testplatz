import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRunReport, failedReport } from '../pipeline/stages/report.ts';
import { buildCoverage } from '../shared/coverage.ts';
import type { Centre } from '../shared/directory.ts';
import { STATE_VERSION } from '../shared/state.ts';
import { parseReport, planAlerts, resolveStage, type AlertInput, type Report } from '../tools/alerts.ts';

const RUN_URL = 'https://github.com/o/r/actions/runs/1';
const NOW = new Date('2026-10-29T05:40:00.000Z');
const GREEN = { publish: 'success', build: 'success', deploy: 'success' };

const healthy: Report = {
	stage: null,
	runAt: '2026-10-29T05:17:00.000Z',
	all_fetched_failed: false,
	systems: [
		{ reader: 'itemkg', problem_down: null, disappeared: [] },
		{ reader: 'kuferweb', problem_down: null, disappeared: [] },
	],
};

const plan = (extra: Partial<AlertInput>) =>
	planAlerts({ stage: '', report: healthy, jobs: GREEN, openIssues: [], runUrl: RUN_URL, event: 'schedule', now: NOW, ...extra });

describe('planAlerts: failure issues', () => {
	it('all green: pings, closes a recovered system issue, files no failure issue', () => {
		const result = plan({ openIssues: [{ number: 7, title: 'Reader kuferweb: needs attention' }] });
		expect(result.ping).toBe(true);
		expect(result.actions).toEqual([{ kind: 'close', number: 7, comment: `Recovered in run ${RUN_URL}` }]);
	});

	it.each([
		['a failed test', 'tests', null, 'tests'],
		['a collect throw', 'fetch', null, 'fetch'],
		['an invalid snapshot', 'publish validation', null, 'publish validation'],
		['a pipeline step with no report', 'input', null, 'input'],
		['a rejected push', 'push', null, 'push'],
		['every fetched centre failed', 'every fetched centre failed', null, 'every fetched centre failed'],
	])('%s files "Pipeline failed: %s" with the run URL, and never pings', (_name, stage, report, expected) => {
		const result = plan({ stage, report, jobs: { publish: 'failure', build: 'skipped', deploy: 'skipped' } });
		expect(result.ping).toBe(false);
		expect(result.actions).toHaveLength(1);
		const action = result.actions[0]!;
		expect(action).toMatchObject({ kind: 'create', title: `Pipeline failed: ${expected}` });
		expect(action.kind === 'create' && action.body).toContain(`Run: ${RUN_URL}`);
		expect(action.kind === 'create' && action.body).toContain('Event: schedule');
		expect(action.kind === 'create' && action.body).toContain(`Time: ${NOW.toISOString()}`);
	});

	it('a failed test has no report, so no system issue is touched', () => {
		const result = plan({ stage: 'tests', report: null, jobs: { publish: 'failure', build: 'skipped', deploy: 'skipped' }, openIssues: [{ number: 3, title: 'Reader itemkg: needs attention' }] });
		expect(result.actions.map((a) => a.kind)).toEqual(['create']);
	});

	it('comments on the open issue with exactly that title instead of opening a second one', () => {
		const result = plan({
			stage: 'push',
			report: null,
			jobs: { publish: 'failure', build: 'skipped', deploy: 'skipped' },
			openIssues: [
				{ number: 9, title: 'Pipeline failed: push (old)' },
				{ number: 5, title: 'Pipeline failed: push' },
			],
		});
		expect(result.actions).toEqual([{ kind: 'comment', number: 5, body: expect.stringContaining(`Run: ${RUN_URL}`) }]);
	});

	it('never closes a failure issue on a green run', () => {
		expect(plan({ openIssues: [{ number: 5, title: 'Pipeline failed: push' }] }).actions).toEqual([]);
	});

	it('deploy fails: "Pipeline failed: deploy", system issues still evaluated, no ping', () => {
		const report: Report = { ...healthy, systems: [{ reader: 'itemkg', problem_down: { since: null }, disappeared: [] }] };
		const result = plan({ report, jobs: { publish: 'success', build: 'success', deploy: 'failure' } });
		expect(result.ping).toBe(false);
		expect(result.actions).toEqual([
			{ kind: 'create', title: 'Pipeline failed: deploy', body: expect.any(String) },
			{ kind: 'create', title: 'Reader itemkg: needs attention', body: expect.stringContaining('No centre read successfully yet') },
		]);
	});

	it('resolves the stage from the jobs when the publish job named none', () => {
		expect(resolveStage('', { publish: 'failure', build: 'skipped', deploy: 'skipped' })).toBe('setup');
		expect(resolveStage('', { publish: 'success', build: 'failure', deploy: 'skipped' })).toBe('build');
		expect(resolveStage('', { publish: 'success', build: 'success', deploy: 'failure' })).toBe('deploy');
		expect(resolveStage('', GREEN)).toBeNull();
		expect(resolveStage('', { publish: 'cancelled', build: 'skipped', deploy: 'skipped' })).toBeNull();
		expect(resolveStage('push', { publish: 'failure', build: 'skipped', deploy: 'skipped' })).toBe('push');
	});

	it('does not ping after a cancelled or skipped run', () => {
		expect(plan({ jobs: { publish: 'cancelled', build: 'skipped', deploy: 'skipped' } }).ping).toBe(false);
		expect(plan({ jobs: { publish: 'success', build: 'success', deploy: 'skipped' } }).ping).toBe(false);
		expect(plan({ jobs: { publish: 'skipped', build: 'skipped', deploy: 'skipped' } }).ping).toBe(false);
	});

	it('push run (Story 3.11): publish skipped, build and deploy green → ping, no failure issue, no reader issue touched', () => {
		const result = plan({
			stage: '',
			report: parseReport(''),
			event: 'push',
			jobs: { publish: 'skipped', build: 'success', deploy: 'success' },
			openIssues: [{ number: 4, title: 'Reader itemkg: needs attention' }],
		});
		expect(result.ping).toBe(true);
		expect(result.actions).toEqual([]);
	});

	it('push run whose build fails: "Pipeline failed: build", no ping', () => {
		const result = plan({ stage: '', report: null, event: 'push', jobs: { publish: 'skipped', build: 'failure', deploy: 'skipped' } });
		expect(result.ping).toBe(false);
		expect(result.actions).toEqual([{ kind: 'create', title: 'Pipeline failed: build', body: expect.stringContaining('Event: push') }]);
	});
});

describe('planAlerts: system issues', () => {
	const withSystem = (system: Report['systems'][number]): Report => ({ ...healthy, systems: [system] });

	it('system down > 24 h: creates "Reader itemkg: needs attention" naming the last success', () => {
		const result = plan({ report: withSystem({ reader: 'itemkg', problem_down: { since: '2026-10-27T23:17:00.000Z' }, disappeared: [] }) });
		expect(result.ping).toBe(true);
		expect(result.actions).toEqual([
			{ kind: 'create', title: 'Reader itemkg: needs attention', body: expect.stringContaining('- No centre read successfully since 2026-10-27 23:17 UTC') },
		]);
	});

	it('comments on the open system issue when the problem persists', () => {
		const result = plan({
			report: withSystem({ reader: 'itemkg', problem_down: { since: null }, disappeared: [] }),
			openIssues: [{ number: 11, title: 'Reader itemkg: needs attention' }],
		});
		expect(result.actions).toEqual([{ kind: 'comment', number: 11, body: expect.stringContaining('No centre read successfully yet') }]);
	});

	it('names disappeared centres even when the rest of the system is fine', () => {
		const result = plan({ report: withSystem({ reader: 'kuferweb', problem_down: null, disappeared: [{ centre_id: 'vhs-a', name: 'VHS A' }] }) });
		const action = result.actions[0]!;
		expect(action).toMatchObject({ kind: 'create', title: 'Reader kuferweb: needs attention' });
		expect(action.kind === 'create' && action.body).toContain('- VHS A (vhs-a): dates disappeared, check the page');
		expect(action.kind === 'create' && action.body).toContain(`Run: ${RUN_URL}`);
	});

	it('closes a disappeared-only issue once the system has no problem', () => {
		const result = plan({ openIssues: [{ number: 4, title: 'Reader kuferweb: needs attention' }] });
		expect(result.actions).toEqual([{ kind: 'close', number: 4, comment: `Recovered in run ${RUN_URL}` }]);
	});

	it('leaves issues of systems the report does not list alone', () => {
		expect(plan({ openIssues: [{ number: 4, title: 'Reader other: needs attention' }] }).actions).toEqual([]);
	});

	it('touches nothing for a healthy system without an open issue', () => {
		expect(plan({}).actions).toEqual([]);
	});
});

describe('parseReport', () => {
	it('reads the compact report, and treats empty or invalid text as absent', () => {
		expect(parseReport(JSON.stringify(healthy))).toEqual(healthy);
		expect(parseReport('')).toBeNull();
		expect(parseReport('{nope')).toBeNull();
		expect(parseReport('{"stage":null}')).toBeNull();
	});
});

describe('the run report contract: pipeline/stages/report.ts → tools/alerts.ts', () => {
	const RUN_AT = new Date('2026-10-29T05:17:00.000Z');
	const centre = (id: string, reader: Centre['reader']): Centre => ({
		centre_id: id,
		name: `VHS ${id}`,
		address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
		lat: 48.137,
		lon: 11.575,
		website: `https://${id}.example.de/`,
		test_page_url: `https://${id}.example.de/test`,
		reader,
		reader_config: { list_url: `https://${id}.example.de/kurse` },
		opted_out: false,
		source: 'rtpartner',
		verified_at: null,
	});

	it('a built report, through JSON, files the system issues', () => {
		const built = buildRunReport({
			runAt: RUN_AT,
			tally: { ok: 1, failed: 2, skipped: 0 },
			systems: [
				{ reader: 'itemkg', centres_covered: 2, centres_ok: 0, centres_failed: 2, last_success_at: '2026-10-27T23:17:00.000Z' },
				{ reader: 'kuferweb', centres_covered: 1, centres_ok: 1, centres_failed: 0, last_success_at: RUN_AT.toISOString() },
			],
			directory: [centre('a', 'kuferweb'), centre('b', 'itemkg')],
			priorState: {
				stateVersion: STATE_VERSION,
				centres: {
					a: {
						last_result: 'ok',
						last_checked_at: '2026-10-28T05:17:00.000Z',
						last_success_at: '2026-10-28T05:17:00.000Z',
						last_skip_reason: null,
						last_skip_at: null,
						last_robots_skip_at: null,
						listings: [
							{
								id: 'a@2026-11-20T10:00',
								centre_id: 'a',
								starts_at: '2026-11-20T10:00:00+01:00',
								time_known: true,
								place: null,
								address: 'Hauptstraße 1, 80331 München',
								status: 'free',
								deadline: null,
								registration_method: 'online',
								source_url: 'https://a.example.de/k/1',
								link_ok: true,
								eligibility: null,
								first_seen_at: '2026-10-28T05:17:00.000Z',
								removed_at: null,
								baseline: true,
							},
						],
					},
				},
			},
			outcomes: { a: { kind: 'ok', listings: [], carriedFrom: {} } },
			coverage: buildCoverage([centre('a', 'kuferweb'), centre('b', 'itemkg')], { a: { kind: 'ok', listings: [] } }),
		});
		const report = parseReport(JSON.stringify(built));
		expect(report).not.toBeNull();
		const result = plan({ report, openIssues: [] });
		expect(result.actions).toEqual([
			{ kind: 'create', title: 'Reader itemkg: needs attention', body: expect.stringContaining('- No centre read successfully since 2026-10-27 23:17 UTC') },
			{ kind: 'create', title: 'Reader kuferweb: needs attention', body: expect.stringContaining('- VHS a (a): dates disappeared, check the page') },
		]);
	});

	it('a failed report, through JSON, files the stage and touches no system issue', () => {
		const report = parseReport(JSON.stringify(failedReport('fetch', RUN_AT)));
		expect(report).not.toBeNull();
		const result = plan({
			stage: report!.stage!,
			report,
			jobs: { publish: 'failure', build: 'skipped', deploy: 'skipped' },
			openIssues: [{ number: 2, title: 'Reader itemkg: needs attention' }],
		});
		expect(result.actions).toEqual([{ kind: 'create', title: 'Pipeline failed: fetch', body: expect.any(String) }]);
	});
});

describe('node tools/alerts.ts (CLI)', () => {
	const SCRIPT = fileURLToPath(new URL('../tools/alerts.ts', import.meta.url));

	/**
	 * Runs the CLI with a fake `gh` first on PATH. The fake logs each call's argv as a JSON line,
	 * answers `issue list` with `list` (or fails when `list` is null) and fails any call whose argv
	 * contains `failOn`.
	 */
	function cli(env: Record<string, string>, fake: { list?: unknown; failOn?: string } = {}) {
		const dir = mkdtempSync(join(tmpdir(), 'bgt-alerts-'));
		const calls = join(dir, 'calls');
		const output = join(dir, 'github_output');
		writeFileSync(output, '');
		const list = fake.list === undefined ? [] : fake.list;
		writeFileSync(
			join(dir, 'gh'),
			`#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n');
if (${JSON.stringify(fake.failOn ?? null)} !== null && args.includes(${JSON.stringify(fake.failOn ?? '')})) process.exit(1);
if (args[0] === 'issue' && args[1] === 'list') {
	const list = ${JSON.stringify(list)};
	if (list === null) process.exit(1);
	process.stdout.write(JSON.stringify(list));
}
`,
		);
		chmodSync(join(dir, 'gh'), 0o755);
		const result = spawnSync(process.execPath, [SCRIPT], {
			encoding: 'utf8',
			env: {
				PATH: `${dir}${delimiter}${process.env.PATH!}`,
				GITHUB_OUTPUT: output,
				STAGE: '',
				REPORT: '',
				PUBLISH_RESULT: 'success',
				BUILD_RESULT: 'success',
				DEPLOY_RESULT: 'success',
				RUN_URL,
				EVENT: 'schedule',
				...env,
			},
		});
		const lines = existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter((l) => l !== '') : [];
		return { code: result.status, output: readFileSync(output, 'utf8'), calls: lines.map((l) => JSON.parse(l) as string[]) };
	}

	const LIST = ['issue', 'list', '--state', 'open', '--app', 'github-actions', '--json', 'number,title', '--limit', '200'];

	it('green run: writes ping=true, lists only the bot\'s open issues and closes a recovered one', () => {
		const result = cli({ REPORT: JSON.stringify(healthy) }, { list: [{ number: 7, title: 'Reader kuferweb: needs attention' }] });
		expect(result.code).toBe(0);
		expect(result.output).toBe('ping=true\n');
		expect(result.calls).toEqual([LIST, ['issue', 'close', '7', '--comment', `Recovered in run ${RUN_URL}`]]);
	});

	it('failed run: writes ping=false, comments on the open failure issue and creates a system issue', () => {
		const report: Report = { ...healthy, systems: [{ reader: 'itemkg', problem_down: { since: null }, disappeared: [] }] };
		const result = cli(
			{ STAGE: 'push', REPORT: JSON.stringify(report), PUBLISH_RESULT: 'failure', BUILD_RESULT: 'skipped', DEPLOY_RESULT: 'skipped' },
			{ list: [{ number: 3, title: 'Pipeline failed: push' }] },
		);
		expect(result.code).toBe(0);
		expect(result.output).toBe('ping=false\n');
		expect(result.calls[0]).toEqual(LIST);
		expect(result.calls[1]!.slice(0, 4)).toEqual(['issue', 'comment', '3', '--body']);
		expect(result.calls[1]![4]).toContain(`Run: ${RUN_URL}`);
		expect(result.calls[2]!.slice(0, 5)).toEqual(['issue', 'create', '--title', 'Reader itemkg: needs attention', '--body']);
		expect(result.calls[2]![5]).toContain('No centre read successfully yet');
		expect(result.calls).toHaveLength(3);
	});

	it('creates the failure issue from the job results when the publish job named no stage', () => {
		const result = cli({ BUILD_RESULT: 'failure', DEPLOY_RESULT: 'skipped' });
		expect(result.output).toBe('ping=false\n');
		expect(result.calls[1]!.slice(0, 4)).toEqual(['issue', 'create', '--title', 'Pipeline failed: build']);
	});

	it('writes ping= before listing issues, and exits 1 when the list fails', () => {
		const result = cli({ REPORT: JSON.stringify(healthy) }, { list: null });
		expect(result.code).toBe(1);
		expect(result.output).toBe('ping=true\n');
		expect(result.calls).toEqual([LIST]);
	});

	it('exits 1 after a failed action, still attempting the others', () => {
		const report: Report = { ...healthy, systems: [{ reader: 'itemkg', problem_down: { since: null }, disappeared: [] }] };
		const result = cli(
			{ STAGE: 'push', REPORT: JSON.stringify(report), PUBLISH_RESULT: 'failure', BUILD_RESULT: 'skipped', DEPLOY_RESULT: 'skipped' },
			{ list: [{ number: 3, title: 'Pipeline failed: push' }], failOn: 'comment' },
		);
		expect(result.code).toBe(1);
		expect(result.output).toBe('ping=false\n');
		expect(result.calls.map((c) => c[1])).toEqual(['list', 'comment', 'create']);
	});
});
