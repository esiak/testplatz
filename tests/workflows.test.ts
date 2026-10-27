import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

	it.each(['push', 'pull_request'])('skips %s events that only touch bot-owned data', (trigger) => {
		expect(pathsIgnore(ci, trigger).sort()).toEqual(['data/public/**', 'data/state/**']);
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

	it('tests, runs the pipeline, then commits, in that order in the publish job', () => {
		const steps = [
			'run: npm ci',
			'run: npm run typecheck',
			'run: npm test',
			'run: npm run pipeline',
			'.github/scripts/commit-public.sh',
		].map((s) => publish.indexOf(s));
		expect(steps.every((i) => i >= 0)).toBe(true);
		expect([...steps].sort((a, b) => a - b)).toEqual(steps);
		expect(publish).toContain('sha: ${{ steps.commit.outputs.sha }}');
		expect(publish).toMatch(/- id: commit\n/);
	});

	it('type-checks and tests a moved upstream before re-publishing it on a retry, without installing', () => {
		const commitStep = publish.slice(publish.indexOf('- id: commit'));
		const match = commitStep.match(/^\s+PUBLISH_CMD: (.*)$/m);
		expect(match?.[1]).toBe('npm run typecheck && npm test && npm run pipeline');
		expect(match?.[1]).not.toContain('npm ci');
	});

	it('builds and deploys exactly the SHA the publish job pushed', () => {
		expect(build).toContain('ref: ${{ needs.publish.outputs.sha }}');
		expect(build).not.toContain('github.sha');
		expect(build.indexOf('run: npm ci')).toBeLessThan(build.indexOf('run: npm run build'));
	});

	it('never leaves a credential on disk after checkout', () => {
		const checkouts = pipeline.match(/uses: actions\/checkout@v\d+\n\s+with:\n(?:\s{10}.*\n)*/g) ?? [];
		expect(checkouts).toHaveLength(2);
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
	});
});
