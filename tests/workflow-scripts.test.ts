import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Runs the bash of pipeline.yml's alert steps (Story 3.4) as GitHub would (`bash -e -o pipefail`),
 * with a temp RUNNER_TEMP and GITHUB_OUTPUT, so their behaviour is tested, not just their text.
 */

type Step = { id?: string; name?: string; run?: string };
const workflow = parse(readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8')) as {
	jobs: Record<string, { steps: Step[] }>;
};
const script = (jobName: string, match: (step: Step) => boolean): string => {
	const step = workflow.jobs[jobName]!.steps.find(match);
	if (step?.run === undefined) throw new Error(`no such step in ${jobName}`);
	return step.run;
};

const has = (command: string): boolean => spawnSync('bash', ['-c', `command -v ${command}`]).status === 0;
const missing = !has('bash') || !has('jq');

interface Result {
	code: number | null;
	stdout: string;
	output: Record<string, string>;
	dir: string;
}

/** Runs `run` in a fresh temp dir; `report` (if given) is written to $RUNNER_TEMP/report.json. */
function runStep(run: string, env: Record<string, string> = {}, options: { report?: unknown; path?: string } = {}): Result {
	const dir = mkdtempSync(join(tmpdir(), 'bgt-step-'));
	const output = join(dir, 'github_output');
	writeFileSync(output, '');
	if (options.report !== undefined) writeFileSync(join(dir, 'report.json'), `${JSON.stringify(options.report)}\n`);
	const scriptPath = join(dir, 'step.sh');
	writeFileSync(scriptPath, run);
	const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', scriptPath], {
		encoding: 'utf8',
		env: {
			PATH: options.path === undefined ? process.env.PATH! : `${options.path}${delimiter}${process.env.PATH!}`,
			RUNNER_TEMP: dir,
			GITHUB_OUTPUT: output,
			...env,
		},
	});
	const lines = readFileSync(output, 'utf8').split('\n').filter((line) => line !== '');
	const parsed = Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
	return { code: result.status, stdout: result.stdout, output: parsed, dir };
}

const REPORT = { stage: null, runAt: '2026-10-29T05:17:00.000Z', all_fetched_failed: false, systems: [{ reader: 'itemkg', problem_down: null, disappeared: [] }] };

describe.skipIf(missing)('pipeline.yml publish job: stage step', () => {
	const run = script('publish', (s) => s.id === 'stage');
	const ALL_SUCCESS = {
		CHECKOUT: 'success',
		SETUP_NODE: 'success',
		INSTALL: 'success',
		TYPECHECK: 'success',
		TEST: 'success',
		PIPELINE: 'success',
		COMMIT: 'success',
		ALL_FAILED: 'success',
	};
	/** A failed step skips the ones after it, as in a real run. */
	const failedAt = (name: keyof typeof ALL_SUCCESS): Record<string, string> => {
		const keys = Object.keys(ALL_SUCCESS);
		const at = keys.indexOf(name);
		return Object.fromEntries(keys.map((key, i) => [key, i < at ? 'success' : i === at ? 'failure' : 'skipped']));
	};

	it.each<[string, Record<string, string>, unknown, string]>([
		['pipeline failed with no report', failedAt('PIPELINE'), undefined, 'input'],
		['pipeline failed with a publish validation report', failedAt('PIPELINE'), { ...REPORT, stage: 'publish validation', systems: [] }, 'publish validation'],
		['pipeline failed with a fetch report', failedAt('PIPELINE'), { ...REPORT, stage: 'fetch', systems: [] }, 'fetch'],
		['tests failed', failedAt('TEST'), undefined, 'tests'],
		['type-check failed', failedAt('TYPECHECK'), undefined, 'tests'],
		['npm ci failed', failedAt('INSTALL'), undefined, 'setup'],
		['checkout failed', failedAt('CHECKOUT'), undefined, 'setup'],
		['the push failed', failedAt('COMMIT'), REPORT, 'push'],
		['the push failed with no report', failedAt('COMMIT'), undefined, 'push'],
		['the replay after a rejected push failed in publish', failedAt('COMMIT'), { ...REPORT, stage: 'publish validation', systems: [] }, 'publish validation'],
		['every fetched centre failed', failedAt('ALL_FAILED'), { ...REPORT, all_fetched_failed: true }, 'every fetched centre failed'],
	])('%s → stage=%s', (_name, env, report, stage) => {
		const result = runStep(run, env, { report });
		expect(result.code).toBe(0);
		expect(result.output.stage).toBe(stage);
	});

	it('success: an empty stage and the compact report', () => {
		const result = runStep(run, ALL_SUCCESS, { report: REPORT });
		expect(result.code).toBe(0);
		expect(result.output).toEqual({ stage: '', report: JSON.stringify(REPORT) });
	});

	it('no report: an empty report output', () => {
		const result = runStep(run, failedAt('TEST'));
		expect(result.output.report).toBe('');
	});
});

describe.skipIf(missing)('pipeline.yml publish job: all-failed step', () => {
	const run = script('publish', (s) => s.id === 'all-failed');

	it('exits 1 when every fetched centre failed', () => {
		const result = runStep(run, {}, { report: { ...REPORT, all_fetched_failed: true } });
		expect(result.code).toBe(1);
		expect(result.stdout).toContain('::error::');
	});

	it('exits 0 otherwise', () => {
		expect(runStep(run, {}, { report: REPORT }).code).toBe(0);
	});

	it('exits 0 with a warning when there is no report', () => {
		const result = runStep(run);
		expect(result.code).toBe(0);
		expect(result.stdout).toMatch(/^::warning::/m);
	});
});

describe.skipIf(missing)('pipeline.yml monitor job: dead-man ping step', () => {
	const run = script('monitor', (s) => s.run?.includes('curl') === true);

	/** A directory with a fake `curl` that records its arguments and exits with `status`. */
	function fakeCurl(status: number): { bin: string; calls: () => string[] } {
		const bin = mkdtempSync(join(tmpdir(), 'bgt-curl-'));
		const log = join(bin, 'calls');
		writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${log}"\nexit ${status}\n`);
		chmodSync(join(bin, 'curl'), 0o755);
		return { bin, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : []) };
	}

	it('warns and does not call curl when DEADMAN_PING_URL is empty', () => {
		const curl = fakeCurl(0);
		const result = runStep(run, { DEADMAN_PING_URL: '' }, { path: curl.bin });
		expect(result.code).toBe(0);
		expect(result.stdout).toMatch(/^::warning::/m);
		expect(curl.calls()).toEqual([]);
	});

	it('pings the URL once', () => {
		const curl = fakeCurl(0);
		const result = runStep(run, { DEADMAN_PING_URL: 'https://hc-ping.example/abc' }, { path: curl.bin });
		expect(result.code).toBe(0);
		expect(result.stdout).not.toContain('::warning::');
		expect(curl.calls()).toEqual(['-fsS -m 10 --retry 3 https://hc-ping.example/abc']);
	});

	it('only warns when the ping fails', () => {
		const curl = fakeCurl(22);
		const result = runStep(run, { DEADMAN_PING_URL: 'https://hc-ping.example/abc' }, { path: curl.bin });
		expect(result.code).toBe(0);
		expect(result.stdout).toMatch(/^::warning::/m);
		expect(curl.calls()).toHaveLength(1);
	});
});
