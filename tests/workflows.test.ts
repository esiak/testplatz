import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const read = (name: string): string =>
	readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Returns the `paths-ignore` entries listed under one top-level `on:` trigger. */
function pathsIgnore(workflow: string, trigger: string): string[] {
	const block = workflow.match(new RegExp(`^  ${trigger}:\\n((?:    .*\\n|\\s*\\n)*)`, 'm'))?.[1] ?? '';
	const list = block.match(/^    paths-ignore:\n((?:      - .*\n)*)/m)?.[1] ?? '';
	return [...list.matchAll(/- '([^']+)'/g)].map((m) => m[1]!);
}

/** Returns the body of one job under `jobs:` (up to the next job or end of file). */
function job(workflow: string, name: string): string {
	return workflow.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)*)`, 'm'))?.[1] ?? '';
}

describe('ci.yml', () => {
	const ci = read('ci.yml');

	it.each(['push', 'pull_request'])('skips %s events that only touch bot-owned data, but not places.json', (trigger) => {
		expect(pathsIgnore(ci, trigger).sort()).toEqual(['data/public/snapshot.json', 'data/state/**']);
	});

	it('runs push checks on main only, so a PR branch is not checked twice', () => {
		expect(ci).toMatch(/^  push:\n    branches: \[main\]\n/m);
	});

	it('runs type-check and tests', () => {
		expect(ci).toContain('run: npm run typecheck');
		expect(ci).toContain('run: npm test');
	});

	it('validates the centre directory right after the type-check', () => {
		const steps: string[] = ci.match(/^      - run: .*$/gm) ?? [];
		const typecheck = steps.indexOf('      - run: npm run typecheck');
		expect(typecheck).toBeGreaterThanOrEqual(0);
		expect(steps[typecheck + 1]).toBe('      - run: npm run check:directory');
	});

	it('runs on directory changes (data/directory/** is not ignored)', () => {
		for (const trigger of ['push', 'pull_request']) {
			expect(pathsIgnore(ci, trigger).some((p) => 'data/directory/centres.json'.startsWith(p.replace('**', '')))).toBe(false);
		}
	});
});

describe('pipeline.yml', () => {
	const pipeline = read('pipeline.yml');
	const publish = job(pipeline, 'publish');
	const build = job(pipeline, 'build');
	const deploy = job(pipeline, 'deploy');
	const monitor = job(pipeline, 'monitor');

	it('is scheduled once a day at 05:17 UTC, and also runs on push to main and on dispatch', () => {
		const on = (parse(pipeline) as { on: Record<string, unknown> }).on;
		expect(Object.keys(on).sort()).toEqual(['push', 'schedule', 'workflow_dispatch']);
		expect(on.schedule).toEqual([{ cron: '17 5 * * *' }]);
		expect(on.push).toEqual({ branches: ['main'] });
	});

	it('runs from main or dispatch in one non-cancelling concurrency group, and only for main', () => {
		expect(pipeline).toMatch(/^  push:\n    branches: \[main\]\n/m);
		expect(pipeline).toContain('workflow_dispatch:');
		expect(pipeline).toMatch(/concurrency:\n\s+group: pipeline\n\s+cancel-in-progress: false/);
		expect(publish).toMatch(/^    if: github\.ref == 'refs\/heads\/main'$/m);
		expect(deploy).toMatch(/uses: actions\/deploy-pages@v\d+/);
	});

	it('chains publish → build → deploy', () => {
		expect(build).toMatch(/^    needs: publish$/m);
		expect(deploy).toMatch(/^    needs: build$/m);
	});

	it('tests, runs the pipeline saving its reader results, then commits, in that order in the publish job', () => {
		const steps = [
			'run: npm ci',
			'run: npm run typecheck',
			'run: npm test',
			'run: npm run pipeline -- --save-collect "$RUNNER_TEMP/collect.json" --report "$RUNNER_TEMP/report.json"',
			'.github/scripts/commit-public.sh',
		].map((s) => publish.indexOf(s));
		expect(steps.every((i) => i >= 0)).toBe(true);
		expect([...steps].sort((a, b) => a - b)).toEqual(steps);
		expect(publish).toContain('sha: ${{ steps.commit.outputs.sha }}');
		expect(publish).toMatch(/- id: commit\n/);
	});

	it('type-checks and tests a moved upstream, then replays the saved reader results on a retry, without installing', () => {
		const commitStep = publish.slice(publish.indexOf('- id: commit'));
		const match = commitStep.match(/^\s+PUBLISH_CMD: (.*)$/m);
		expect(match?.[1]).toBe('npm run typecheck && npm test && npm run pipeline -- --from-collect "$RUNNER_TEMP/collect.json" --report "$RUNNER_TEMP/report.json"');
		expect(match?.[1]).not.toContain('npm ci');
	});

	it('builds and deploys exactly the SHA the publish job pushed', () => {
		expect(build).toContain('ref: ${{ needs.publish.outputs.sha }}');
		expect(build).not.toContain('github.sha');
		expect(build.indexOf('run: npm ci')).toBeLessThan(build.indexOf('run: npm run build'));
	});

	it('never leaves a credential on disk after checkout', () => {
		const checkouts = pipeline.match(/uses: actions\/checkout@v\d+\n\s+with:\n(?:\s{10}.*\n)*/g) ?? [];
		expect(checkouts).toHaveLength(3);
		for (const checkout of checkouts) expect(checkout).toContain('persist-credentials: false');
	});

	it('fails the build unless both pages and both data files were built', () => {
		for (const file of ['dist/index.html', 'dist/about/index.html', 'dist/snapshot.json', 'dist/places.json']) {
			expect(build).toContain(file);
		}
	});

	it('grants contents: write to publish only, and Pages and OIDC to deploy only', () => {
		const workflowLevel = pipeline.match(/^permissions:\n((?:  .*\n)*)/m)?.[1] ?? '';
		expect(workflowLevel.trim()).toBe('contents: read');
		expect(publish).toMatch(/^    permissions:\n      contents: write\n    \S/m);
		expect(build).not.toMatch(/permissions:|contents: write|pages: write|id-token: write/);
		expect(deploy).not.toContain('contents: write');
		expect(publish).not.toMatch(/pages: write|id-token: write/);
		expect(deploy).toMatch(/permissions:\n\s+pages: write\n\s+id-token: write/);
		expect(monitor).toMatch(/^    permissions:\n      contents: read\n      issues: write\n    \S/m);
		expect(monitor).not.toMatch(/contents: write|pages: write|id-token: write/);
		expect(publish).not.toContain('issues: write');
	});

	describe('alerts (Story 3.4)', () => {
		type Step = { id?: string; name?: string; if?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
		type Job = { needs?: string | string[]; if?: string; outputs?: Record<string, string>; steps: Step[] };
		const jobs = (parse(pipeline) as { jobs: Record<string, Job> }).jobs;

		it('runs the monitor after publish, build and deploy, always, on main only', () => {
			expect(jobs.monitor!.needs).toEqual(['publish', 'build', 'deploy']);
			expect(jobs.monitor!.if).toBe("always() && github.ref == 'refs/heads/main'");
		});

		it('installs nothing in the monitor job and checks out without credentials', () => {
			expect(monitor).not.toContain('npm ci');
			expect(monitor).not.toContain('cache: npm');
			const steps = jobs.monitor!.steps;
			expect(steps.filter((s) => s.uses?.startsWith('actions/checkout@'))).toEqual([expect.objectContaining({ with: expect.objectContaining({ 'persist-credentials': false }) })]);
			const uses = steps.map((s) => s.uses).filter((u) => u !== undefined).map((u) => u.split('@')[0]);
			expect(uses).toEqual(['actions/checkout', 'actions/setup-node']);
			const alerts = steps.find((s) => s.id === 'alerts')!;
			expect(alerts.run).toBe('node tools/alerts.ts');
			expect(alerts.env).toMatchObject({
				GH_TOKEN: '${{ github.token }}',
				STAGE: '${{ needs.publish.outputs.stage }}',
				REPORT: '${{ needs.publish.outputs.report }}',
				PUBLISH_RESULT: '${{ needs.publish.result }}',
				BUILD_RESULT: '${{ needs.build.result }}',
				DEPLOY_RESULT: '${{ needs.deploy.result }}',
			});
		});

		it('pings the dead-man check only when the alerts step says so, with the secret from env', () => {
			const steps = jobs.monitor!.steps;
			const pings = steps.filter((s) => s.run?.includes('curl'));
			expect(pings).toHaveLength(1);
			const ping = pings[0]!;
			expect(ping.if).toMatch(/steps\.alerts\.outputs\.ping == 'true'$/);
			expect(ping.env).toEqual({ DEADMAN_PING_URL: '${{ secrets.DEADMAN_PING_URL }}' });
			expect(ping.run).toContain('curl -fsS -m 10 --retry 3 "$DEADMAN_PING_URL"');
			expect(ping.run).toContain('::warning::');
			expect(pipeline.match(/secrets\.DEADMAN_PING_URL/g)).toHaveLength(1);
		});

		it('fails the publish job when every fetched centre failed, only after the commit', () => {
			const steps = jobs.publish!.steps;
			const commit = steps.findIndex((s) => s.id === 'commit');
			const allFailed = steps.findIndex((s) => s.id === 'all-failed');
			expect(commit).toBeGreaterThanOrEqual(0);
			expect(allFailed).toBeGreaterThan(commit);
			expect(publish.indexOf('- id: all-failed')).toBeGreaterThan(publish.indexOf('- id: commit'));
			expect(steps[allFailed]!.run).toContain('all_fetched_failed');
		});

		it('names the failed stage and passes the report from a final always() step', () => {
			const steps = jobs.publish!.steps;
			const stage = steps.at(-1)!;
			expect(stage.id).toBe('stage');
			expect(stage.if).toBe('always()');
			for (const id of ['checkout', 'setup-node', 'install', 'typecheck', 'test', 'pipeline', 'commit', 'all-failed']) {
				expect(steps.some((s) => s.id === id)).toBe(true);
				expect(Object.values(stage.env ?? {})).toContain(`\${{ steps.${id}.outcome }}`);
			}
			for (const name of ['setup', 'tests', 'input', 'push', 'every fetched centre failed']) expect(stage.run).toContain(`'${name}'`);
			expect(jobs.publish!.outputs).toMatchObject({ stage: '${{ steps.stage.outputs.stage }}', report: '${{ steps.stage.outputs.report }}' });
		});
	});
});
