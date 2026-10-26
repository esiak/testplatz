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
});

describe('pipeline.yml', () => {
	const pipeline = read('pipeline.yml');
	const build = job(pipeline, 'build');
	const deploy = job(pipeline, 'deploy');

	it('deploys from main or dispatch in one non-cancelling concurrency group', () => {
		expect(pipeline).toMatch(/^  push:\n    branches: \[main\]\n/m);
		expect(pipeline).toContain('workflow_dispatch:');
		expect(pipeline).toMatch(/concurrency:\n\s+group: pipeline\n\s+cancel-in-progress: false/);
		expect(build).toContain('ref: ${{ github.sha }}');
		expect(deploy).toMatch(/uses: actions\/deploy-pages@v\d+/);
	});

	it('runs type-check and tests before the build in the build job', () => {
		const steps = ['run: npm ci', 'run: npm run typecheck', 'run: npm test', 'run: npm run build'].map((s) =>
			build.indexOf(s),
		);
		expect(steps.every((i) => i >= 0)).toBe(true);
		expect([...steps].sort((a, b) => a - b)).toEqual(steps);
	});

	it('fails the build unless both pages were built', () => {
		expect(build).toContain('dist/index.html');
		expect(build).toContain('dist/about/index.html');
	});

	it('grants Pages and OIDC permissions to the deploy job only', () => {
		const workflowLevel = pipeline.match(/^permissions:\n((?:  .*\n)*)/m)?.[1] ?? '';
		expect(workflowLevel.trim()).toBe('contents: read');
		expect(build).not.toMatch(/pages: write|id-token: write/);
		expect(deploy).toMatch(/permissions:\n\s+pages: write\n\s+id-token: write/);
	});
});
