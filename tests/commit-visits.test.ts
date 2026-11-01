import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../.github/scripts/commit-visits.sh', import.meta.url));
const RECORD_VISITS = fileURLToPath(new URL('../pipeline/stages/record-visits.ts', import.meta.url));
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const HOUR = 60 * 60 * 1000;
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * HOUR).toISOString();
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

/** Runs git in `cwd` with a test identity, isolated from the user's global config. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', env: GIT_ENV }).trim();
}

const logText = (visits: unknown[]) => `${JSON.stringify(visits, null, '\t')}\n`;

/** A bare "remote" with one commit on main (visit log, state, snapshot, README), and a clone of it. */
function setup(visits: unknown[] = [{ host: 'a.de', at: at(10) }]) {
	const root = mkdtempSync(join(tmpdir(), 'bgt-commit-visits-'));
	const remote = join(root, 'remote.git');
	const seed = join(root, 'seed');
	const work = join(root, 'work');
	git(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
	git(root, 'init', '--quiet', '--initial-branch=main', seed);
	mkdirSync(join(seed, 'data', 'state'), { recursive: true });
	mkdirSync(join(seed, 'data', 'public'), { recursive: true });
	writeFileSync(join(seed, 'data', 'state', 'visits.json'), logText(visits));
	writeFileSync(join(seed, 'data', 'state', 'state.json'), '{"s":1}\n');
	writeFileSync(join(seed, 'data', 'public', 'snapshot.json'), '{"v":1}\n');
	writeFileSync(join(seed, 'README'), 'readme\n');
	git(seed, 'add', '.');
	git(seed, 'commit', '--quiet', '-m', 'seed');
	git(seed, 'push', '--quiet', remote, 'HEAD:refs/heads/main');
	git(root, 'clone', '--quiet', remote, work);
	return { root, remote, work };
}

/** The run's visits file, as `run.ts --save-visits` writes it. */
function runVisits(root: string, visits: unknown[]): string {
	const path = join(root, 'run-visits.json');
	writeFileSync(path, `${JSON.stringify(visits)}\n`);
	return path;
}

/** The real record step, writing the work tree's data/state/visits.json (not this repository's). */
const realRecord = (visitsFile: string, marker?: string): string =>
	`${marker === undefined ? '' : `echo run >> '${marker}' && `}node -e "import('${RECORD_VISITS}').then((m) => { process.exitCode = m.recordVisits('${visitsFile}', { visitLogPath: 'data/state/visits.json' }); })"`;

function run(work: string, recordCmd: string, extraEnv: Record<string, string> = {}) {
	const result = spawnSync('bash', [SCRIPT], { cwd: work, encoding: 'utf8', env: { ...GIT_ENV, RECORD_CMD: recordCmd, ...extraEnv } });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const remoteHead = (remote: string): string => git(remote, 'rev-parse', 'refs/heads/main');
const commitCount = (remote: string): number => Number(git(remote, 'rev-list', '--count', 'refs/heads/main'));
const remoteLog = (remote: string): unknown => JSON.parse(git(remote, 'show', 'main:data/state/visits.json'));

/** Another clone pushes a commit writing `files` (path → content) to main. */
function pushUpstream(root: string, remote: string, files: Record<string, string>, name = 'other'): string {
	const other = join(root, name);
	if (!existsSync(other)) git(root, 'clone', '--quiet', remote, other);
	else git(other, 'pull', '--quiet', '--ff-only');
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(other, path, '..'), { recursive: true });
		writeFileSync(join(other, path), content);
	}
	git(other, 'add', '-A');
	git(other, 'commit', '--quiet', '-m', 'upstream');
	git(other, 'push', '--quiet', 'origin', 'HEAD:main');
	return remoteHead(remote);
}

describe('commit-visits.sh (Story 3.11)', () => {
	it('commits only data/state/visits.json with the run\'s visits, as the bot, and drops the rest of the failed run', () => {
		const { root, remote, work } = setup();
		// What a failed run leaves behind: changed data and code, and a local commit never pushed.
		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":"failed run"}\n');
		git(work, 'commit', '--quiet', '-am', 'local, never pushed');
		writeFileSync(join(work, 'data', 'state', 'state.json'), '{"s":"failed run"}\n');
		writeFileSync(join(work, 'README'), 'local edit\n');
		const before = remoteHead(remote);
		const visits = [{ host: 'b.de', at: at(1) }];
		const result = run(work, realRecord(runVisits(root, visits)));
		expect(result.status, result.stderr).toBe(0);
		expect(commitCount(remote)).toBe(2);
		expect(git(remote, 'rev-parse', 'main^')).toBe(before);
		expect(git(remote, 'show', '--name-only', '--format=', 'main')).toBe('data/state/visits.json');
		expect(git(remote, 'log', '-1', '--format=%an <%ae>|%s', 'main')).toBe(`github-actions[bot] <${BOT_EMAIL}>|data: record visits from a failed run`);
		expect(remoteLog(remote)).toEqual([{ host: 'a.de', at: at(10) }, ...visits].map((v) => expect.objectContaining({ host: v.host })));
		expect(git(remote, 'show', 'main:data/public/snapshot.json')).toBe('{"v":1}');
		expect(git(remote, 'show', 'main:data/state/state.json')).toBe('{"s":1}');
	});

	it('records on the newest main, keeping visits another run pushed meanwhile', () => {
		const { root, remote, work } = setup();
		const other = [{ host: 'a.de', at: at(10) }, { host: 'c.de', at: at(2) }];
		const upstream = pushUpstream(root, remote, { 'data/state/visits.json': logText(other), 'data/state/state.json': '{"s":2}\n' });
		const result = run(work, realRecord(runVisits(root, [{ host: 'b.de', at: at(1) }])));
		expect(result.status, result.stderr).toBe(0);
		expect(git(remote, 'rev-parse', 'main^')).toBe(upstream);
		expect((remoteLog(remote) as { host: string }[]).map((v) => v.host)).toEqual(['a.de', 'c.de', 'b.de']);
		expect(git(remote, 'show', 'main:data/state/state.json')).toBe('{"s":2}');
	});

	it('makes no commit when main already holds the run\'s visits', () => {
		const visits = [{ host: 'a.de', at: at(10) }];
		const { root, remote, work } = setup(visits);
		const before = remoteHead(remote);
		const result = run(work, realRecord(runVisits(root, visits)));
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('nothing to commit');
		expect(remoteHead(remote)).toBe(before);
	});

	it('retries after a rejected push: fetches, resets and records again on the moved upstream', () => {
		const { root, remote, work } = setup();
		const other = join(root, 'other');
		git(root, 'clone', '--quiet', remote, other);
		// The first push is rejected; meanwhile another run pushes its visits.
		const hook = join(remote, 'hooks', 'pre-receive');
		const once = join(root, 'rejected-once');
		writeFileSync(hook, `#!/bin/sh\nif [ ! -f '${once}' ]; then touch '${once}'; echo rejected >&2; exit 1; fi\nexit 0\n`);
		chmodSync(hook, 0o755);
		const records = join(root, 'records');
		const result = run(work, realRecord(runVisits(root, [{ host: 'b.de', at: at(1) }]), records));
		expect(result.status, result.stderr).toBe(0);
		expect(readFileSync(records, 'utf8').trim().split('\n')).toHaveLength(2);
		expect(result.stderr).toContain('push rejected');
		expect(commitCount(remote)).toBe(2);
		expect(git(remote, 'show', '--name-only', '--format=', 'main')).toBe('data/state/visits.json');
	});

	it('fails after 3 rejected pushes', () => {
		const { root, remote, work } = setup();
		const attempts = join(root, 'attempts');
		const hook = join(remote, 'hooks', 'pre-receive');
		writeFileSync(hook, `#!/bin/sh\necho push >> '${attempts}'\necho rejected >&2\nexit 1\n`);
		chmodSync(hook, 0o755);
		const result = run(work, realRecord(runVisits(root, [{ host: 'b.de', at: at(1) }])));
		expect(result.status).not.toBe(0);
		expect(readFileSync(attempts, 'utf8').trim().split('\n')).toHaveLength(3);
		expect(result.stderr).toContain('rejected 3 times');
		expect(commitCount(remote)).toBe(1);
	});

	it('fails without pushing when the record command fails (an invalid visits file)', () => {
		const { root, remote, work } = setup();
		const before = remoteHead(remote);
		const result = run(work, realRecord(runVisits(root, [{ host: '' }])));
		expect(result.status).not.toBe(0);
		expect(remoteHead(remote)).toBe(before);
	});

	it('requires RECORD_CMD', () => {
		const { work } = setup();
		const result = spawnSync('bash', [SCRIPT], { cwd: work, encoding: 'utf8', env: GIT_ENV });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain('RECORD_CMD');
	});

	it('passes the auth header to fetch and push only, with hooks disabled on every git call, and keeps it from the record command', () => {
		const { root, work } = setup();
		const bin = join(root, 'bin');
		const log = join(root, 'git-calls');
		mkdirSync(bin);
		const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
		writeFileSync(join(bin, 'git'), `#!/bin/sh\n(IFS='\t'; printf '%s\\n' "$*") >> '${log}'\nexec '${realGit}' "$@"\n`);
		chmodSync(join(bin, 'git'), 0o755);
		const header = 'AUTHORIZATION: basic dGVzdA==';
		const envFile = join(root, 'record-env');
		const result = run(work, `env > '${envFile}' && printf '[]\\n' > data/state/visits.json`, { GIT_AUTH_HEADER: header, PATH: `${bin}:${process.env.PATH ?? ''}` });
		expect(result.status, result.stderr).toBe(0);
		expect(readFileSync(envFile, 'utf8')).not.toMatch(/GIT_AUTH_HEADER|dGVzdA==/);

		const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => {
			const args = line.split('\t');
			const config: string[] = [];
			while (args[0] === '-c') config.push(args.splice(0, 2)[1]!);
			return { command: args[0], config };
		});
		const byCommand = (name: string) => calls.filter((c) => c.command === name);
		expect(byCommand('fetch')).toHaveLength(1);
		expect(byCommand('push')).toHaveLength(1);
		for (const name of ['reset', 'add', 'commit']) expect(byCommand(name).length).toBeGreaterThan(0);
		for (const call of calls) {
			expect(call.config).toContain('core.hooksPath=/dev/null');
			const hasHeader = call.config.includes(`http.https://github.com/.extraheader=${header}`);
			expect(hasHeader, `${call.command} ${hasHeader ? 'got' : 'lacks'} the header`).toBe(call.command === 'push' || call.command === 'fetch');
		}
	});
});
