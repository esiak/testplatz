import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../.github/scripts/commit-public.sh', import.meta.url));
const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';

/** Runs git in `cwd` with a test identity, isolated from the user's global config. */
function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
	}).trim();
}

/** A bare "remote" with one commit on main (data/public/snapshot.json, data/state/state.json, README), and a clone of it. */
function setup(): { root: string; remote: string; work: string } {
	const root = mkdtempSync(join(tmpdir(), 'bgt-commit-public-'));
	const remote = join(root, 'remote.git');
	const seed = join(root, 'seed');
	const work = join(root, 'work');
	git(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote);
	git(root, 'init', '--quiet', '--initial-branch=main', seed);
	mkdirSync(join(seed, 'data', 'public'), { recursive: true });
	writeFileSync(join(seed, 'data', 'public', 'snapshot.json'), '{"v":1}\n');
	mkdirSync(join(seed, 'data', 'state'), { recursive: true });
	writeFileSync(join(seed, 'data', 'state', 'state.json'), '{"s":1}\n');
	writeFileSync(join(seed, 'README'), 'readme\n');
	git(seed, 'add', '.');
	git(seed, 'commit', '--quiet', '-m', 'seed');
	git(seed, 'push', '--quiet', remote, 'HEAD:refs/heads/main');
	git(root, 'clone', '--quiet', remote, work);
	return { root, remote, work };
}

function run(work: string, publishCmd: string, extraEnv: Record<string, string> = {}) {
	const output = join(work, '..', 'github-output');
	writeFileSync(output, '');
	const result = spawnSync('bash', [SCRIPT], {
		cwd: work,
		encoding: 'utf8',
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_CONFIG_NOSYSTEM: '1',
			PUBLISH_CMD: publishCmd,
			GITHUB_OUTPUT: output,
			...extraEnv,
		},
	});
	const sha = readFileSync(output, 'utf8').match(/^sha=([0-9a-f]{40})$/m)?.[1] ?? null;
	return { status: result.status, stdout: result.stdout, stderr: result.stderr, sha };
}

const remoteHead = (remote: string): string => git(remote, 'rev-parse', 'refs/heads/main');

/** Another clone pushes a commit writing `files` (path → content) to main; returns the new upstream SHA. */
function pushUpstream(root: string, remote: string, files: Record<string, string>, name = 'other'): string {
	const other = join(root, name);
	git(root, 'clone', '--quiet', remote, other);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(other, path, '..'), { recursive: true });
		writeFileSync(join(other, path), content);
	}
	git(other, 'add', '-A');
	git(other, 'commit', '--quiet', '-m', 'upstream');
	git(other, 'push', '--quiet', 'origin', 'HEAD:main');
	return remoteHead(remote);
}
const commitCount = (remote: string): number => Number(git(remote, 'rev-list', '--count', 'refs/heads/main'));

describe('commit-public.sh', () => {
	it('makes no commit when data/public/ is unchanged, and outputs HEAD', () => {
		const { remote, work } = setup();
		const before = remoteHead(remote);
		const result = run(work, 'true');
		expect(result.status).toBe(0);
		expect(commitCount(remote)).toBe(1);
		expect(result.sha).toBe(before);
		expect(remoteHead(remote)).toBe(before);
	});

	it('commits data/state/ and data/public/ together, once, with the bot identity and pushes it', () => {
		const { remote, work } = setup();
		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		writeFileSync(join(work, 'data', 'public', 'places.json'), '{}\n');
		writeFileSync(join(work, 'data', 'state', 'state.json'), '{"s":2}\n');
		writeFileSync(join(work, 'data', 'state', 'visits.json'), '[]\n');
		writeFileSync(join(work, 'README'), 'local edit, never committed\n');
		const result = run(work, 'true');
		expect(result.status).toBe(0);
		expect(commitCount(remote)).toBe(2);
		expect(result.sha).toBe(remoteHead(remote));
		const files = git(remote, 'show', '--name-only', '--format=', 'main').split('\n').sort();
		expect(files).toEqual(['data/public/places.json', 'data/public/snapshot.json', 'data/state/state.json', 'data/state/visits.json']);
		expect(git(remote, 'log', '-1', '--format=%an <%ae>|%s', 'main')).toBe(`github-actions[bot] <${BOT_EMAIL}>|data: publish snapshot`);
		expect(git(work, 'status', '--porcelain')).toBe('M README');
	});

	it('resets to a moved upstream, publishes again and pushes on top of it', () => {
		const { root, remote, work } = setup();
		// Someone else pushes to main after the work clone was made.
		const other = join(root, 'other');
		git(root, 'clone', '--quiet', remote, other);
		writeFileSync(join(other, 'README'), 'upstream change\n');
		git(other, 'commit', '--quiet', '-am', 'upstream');
		git(other, 'push', '--quiet', 'origin', 'HEAD:main');
		const upstream = remoteHead(remote);

		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		const envFile = join(root, 'publish-env');
		const publish = `env > '${envFile}' && printf '{"v":3}\\n' > data/public/snapshot.json`;
		const result = run(work, publish, { GIT_AUTH_HEADER: 'AUTHORIZATION: basic dGVzdA==' });
		expect(result.status).toBe(0);
		expect(commitCount(remote)).toBe(3);
		expect(git(remote, 'rev-parse', 'main^')).toBe(upstream);
		expect(result.sha).toBe(remoteHead(remote));
		expect(git(remote, 'show', 'main:data/public/snapshot.json')).toBe('{"v":3}');
		expect(git(remote, 'show', 'main:README')).toBe('upstream change');
		// The publish command's environment does not contain the credential.
		expect(readFileSync(envFile, 'utf8')).not.toMatch(/GIT_AUTH_HEADER|dGVzdA==/);
	});

	it('rebases onto an upstream that changed only data/state/ and data/public/, without re-publishing', () => {
		const { root, remote, work } = setup();
		const upstream = pushUpstream(root, remote, { 'data/state/visits.json': '[1]\n', 'data/public/places.json': '{}\n' });
		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		writeFileSync(join(work, 'data', 'state', 'state.json'), '{"s":2}\n');
		const publishes = join(root, 'publishes');
		const result = run(work, `echo run >> '${publishes}'`);
		expect(result.status).toBe(0);
		expect(existsSync(publishes)).toBe(false);
		expect(commitCount(remote)).toBe(3);
		expect(git(remote, 'rev-parse', 'main^')).toBe(upstream);
		expect(result.sha).toBe(remoteHead(remote));
		expect(git(remote, 'show', 'main:data/public/snapshot.json')).toBe('{"v":2}');
		expect(git(remote, 'show', 'main:data/state/state.json')).toBe('{"s":2}');
		expect(git(remote, 'show', 'main:data/state/visits.json')).toBe('[1]');
		expect(git(remote, 'log', '-1', '--format=%an <%ae>', 'main')).toBe(`github-actions[bot] <${BOT_EMAIL}>`);
		expect(result.stderr).toContain('rebasing');
	});

	it('aborts a conflicting rebase onto a data-only upstream, then resets and re-publishes', () => {
		const { root, remote, work } = setup();
		const upstream = pushUpstream(root, remote, { 'data/state/state.json': '{"s":"upstream"}\n' });
		writeFileSync(join(work, 'data', 'state', 'state.json'), '{"s":"local"}\n');
		const publishes = join(root, 'publishes');
		const result = run(work, `echo run >> '${publishes}' && printf '{"s":"replayed"}\\n' > data/state/state.json && printf '{"v":3}\\n' > data/public/snapshot.json`);
		expect(result.status).toBe(0);
		expect(readFileSync(publishes, 'utf8').trim().split('\n')).toHaveLength(1);
		expect(result.stderr).toContain('rebase conflicted');
		expect(commitCount(remote)).toBe(3);
		expect(git(remote, 'rev-parse', 'main^')).toBe(upstream);
		expect(git(remote, 'show', 'main:data/state/state.json')).toBe('{"s":"replayed"}');
		expect(git(remote, 'show', 'main:data/public/snapshot.json')).toBe('{"v":3}');
		expect(git(work, 'status', '--porcelain')).toBe('');
	});

	it('resets and re-publishes when the upstream changed anything outside the data folders (e.g. the directory)', () => {
		const { root, remote, work } = setup();
		const upstream = pushUpstream(root, remote, { 'data/directory/centres.json': '[]\n', 'data/state/state.json': '{"s":"upstream"}\n' });
		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		const publishes = join(root, 'publishes');
		const result = run(work, `echo run >> '${publishes}' && printf '{"v":3}\\n' > data/public/snapshot.json`);
		expect(result.status).toBe(0);
		expect(readFileSync(publishes, 'utf8').trim().split('\n')).toHaveLength(1);
		expect(result.stderr).not.toContain('rebasing');
		expect(git(remote, 'rev-parse', 'main^')).toBe(upstream);
		expect(git(remote, 'show', 'main:data/public/snapshot.json')).toBe('{"v":3}');
		expect(git(remote, 'show', 'main:data/state/state.json')).toBe('{"s":"upstream"}');
		expect(git(remote, 'show', 'main:data/directory/centres.json')).toBe('[]');
	});

	it('fails without pushing or outputting a sha when the re-publish after a reset fails', () => {
		const { root, remote, work } = setup();
		const other = join(root, 'other');
		git(root, 'clone', '--quiet', remote, other);
		writeFileSync(join(other, 'README'), 'upstream change\n');
		git(other, 'commit', '--quiet', '-am', 'upstream');
		git(other, 'push', '--quiet', 'origin', 'HEAD:main');
		const upstream = remoteHead(remote);

		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		const result = run(work, 'exit 1');
		expect(result.status).not.toBe(0);
		expect(result.sha).toBeNull();
		expect(remoteHead(remote)).toBe(upstream);
	});

	it('makes no commit after a reset when the re-published data is unchanged', () => {
		const { root, remote, work } = setup();
		const other = join(root, 'other');
		git(root, 'clone', '--quiet', remote, other);
		writeFileSync(join(other, 'README'), 'upstream change\n');
		git(other, 'commit', '--quiet', '-am', 'upstream');
		git(other, 'push', '--quiet', 'origin', 'HEAD:main');
		const upstream = remoteHead(remote);
		// The work clone is behind and has no data change: the push is rejected, then a no-op.
		const result = run(work, 'true');
		expect(result.status).toBe(0);
		expect(remoteHead(remote)).toBe(upstream);
		expect(result.sha).toBe(upstream);
	});

	it('passes the auth header to fetch and push only, with hooks disabled on every git call', () => {
		const { root, remote, work } = setup();
		const other = join(root, 'other');
		git(root, 'clone', '--quiet', remote, other);
		writeFileSync(join(other, 'README'), 'upstream change\n');
		git(other, 'commit', '--quiet', '-am', 'upstream');
		git(other, 'push', '--quiet', 'origin', 'HEAD:main');

		// A logging `git` first on PATH records every call's arguments, one tab-separated line each.
		const bin = join(root, 'bin');
		const log = join(root, 'git-calls');
		mkdirSync(bin);
		const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
		writeFileSync(join(bin, 'git'), `#!/bin/sh\n(IFS='\t'; printf '%s\\n' "$*") >> '${log}'\nexec '${realGit}' "$@"\n`);
		chmodSync(join(bin, 'git'), 0o755);

		const header = 'AUTHORIZATION: basic dGVzdA==';
		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		const result = run(work, `printf '{"v":3}\\n' > data/public/snapshot.json`, {
			GIT_AUTH_HEADER: header,
			PATH: `${bin}:${process.env.PATH ?? ''}`,
		});
		expect(result.status).toBe(0);

		const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => {
			const args = line.split('\t');
			const config: string[] = [];
			while (args[0] === '-c') config.push(args.splice(0, 2)[1]);
			return { command: args[0], config };
		});
		const byCommand = (name: string) => calls.filter((c) => c.command === name);
		expect(byCommand('push')).toHaveLength(2);
		expect(byCommand('fetch')).toHaveLength(1);
		for (const name of ['add', 'commit', 'reset']) expect(byCommand(name).length).toBeGreaterThan(0);
		for (const call of calls) {
			expect(call.config).toContain('core.hooksPath=/dev/null');
			const hasHeader = call.config.includes(`http.https://github.com/.extraheader=${header}`);
			expect(hasHeader, `${call.command} ${hasHeader ? 'got' : 'lacks'} the header`).toBe(call.command === 'push' || call.command === 'fetch');
			if (!hasHeader) expect(call.config.join(' ')).not.toContain('extraheader');
		}
	});

	it('fails after 3 rejected pushes and outputs no sha', () => {
		const { root, remote, work } = setup();
		const attempts = join(root, 'attempts');
		const hook = join(remote, 'hooks', 'pre-receive');
		writeFileSync(hook, `#!/bin/sh\necho push >> '${attempts}'\necho rejected >&2\nexit 1\n`);
		chmodSync(hook, 0o755);
		const publishes = join(root, 'publishes');
		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		const result = run(work, `echo run >> '${publishes}' && printf '{"v":2}\\n' > data/public/snapshot.json`);
		expect(result.status).not.toBe(0);
		expect(result.sha).toBeNull();
		expect(readFileSync(attempts, 'utf8').trim().split('\n')).toHaveLength(3);
		// The upstream never moved (no commit outside the data folders), so each retry is a no-op rebase.
		expect(existsSync(publishes)).toBe(false);
		expect(commitCount(remote)).toBe(1);
		expect(result.stderr).toContain('rejected 3 times');
	});

	it('fails after 3 rejected pushes while the upstream keeps moving outside data/, re-publishing on each retry', () => {
		const { root, remote, work } = setup();
		const other = join(root, 'other');
		git(root, 'clone', '--quiet', remote, other);
		const publishes = join(root, 'publishes');
		// Each publish first moves the upstream again outside data/, then regenerates the data.
		const moveUpstream = `cp '${publishes}' '${other}/README' && git -C '${other}' -c user.name=T -c user.email=t@example.com commit --quiet -am upstream && git -C '${other}' push --quiet origin HEAD:main`;
		writeFileSync(join(other, 'README'), 'upstream change\n');
		git(other, 'commit', '--quiet', '-am', 'upstream');
		git(other, 'push', '--quiet', 'origin', 'HEAD:main');

		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		const result = run(work, `echo run >> '${publishes}' && ${moveUpstream} && printf '{"v":3}\\n' > data/public/snapshot.json`);
		expect(result.status).not.toBe(0);
		expect(result.sha).toBeNull();
		// Every push is rejected because the upstream moved again during the re-publish.
		expect(result.stderr.match(/! \[rejected\]/g)).toHaveLength(3);
		expect(readFileSync(publishes, 'utf8').trim().split('\n')).toHaveLength(2);
		expect(result.stderr.match(/resetting to origin\/main and publishing again/g)).toHaveLength(2);
		expect(result.stderr).not.toContain('rebasing');
		expect(result.stderr).toContain('rejected 3 times');
		expect(git(remote, 'log', '-1', '--format=%s', 'main')).toBe('upstream');
	});

	it('resets and re-publishes when a merge commit\'s own resolution changes a file outside data/', () => {
		const { root, remote, work } = setup();
		const other = join(root, 'other');
		git(root, 'clone', '--quiet', remote, other);
		// Both parents change only data/; the merge commit itself edits README.
		git(other, 'switch', '--quiet', '-c', 'side');
		writeFileSync(join(other, 'data', 'state', 'state.json'), '{"s":"side"}\n');
		git(other, 'commit', '--quiet', '-am', 'side data');
		git(other, 'switch', '--quiet', 'main');
		writeFileSync(join(other, 'data', 'public', 'places.json'), '{}\n');
		git(other, 'add', '-A');
		git(other, 'commit', '--quiet', '-m', 'main data');
		git(other, 'merge', '--quiet', '--no-ff', '--no-commit', 'side');
		writeFileSync(join(other, 'README'), 'changed in the merge\n');
		git(other, 'add', '-A');
		git(other, 'commit', '--quiet', '-m', 'merge');
		git(other, 'push', '--quiet', 'origin', 'HEAD:main');
		const upstream = remoteHead(remote);

		writeFileSync(join(work, 'data', 'public', 'snapshot.json'), '{"v":2}\n');
		const publishes = join(root, 'publishes');
		const result = run(work, `echo run >> '${publishes}' && printf '{"v":3}\\n' > data/public/snapshot.json`);
		expect(result.status).toBe(0);
		expect(result.stderr).not.toContain('rebasing');
		expect(readFileSync(publishes, 'utf8').trim().split('\n')).toHaveLength(1);
		expect(git(remote, 'rev-parse', 'main^')).toBe(upstream);
		expect(git(remote, 'show', 'main:README')).toBe('changed in the merge');
		expect(git(remote, 'show', 'main:data/public/snapshot.json')).toBe('{"v":3}');
	});

	it('is executable', () => {
		expect(existsSync(SCRIPT)).toBe(true);
		expect(git(fileURLToPath(new URL('..', import.meta.url)), 'ls-files', '-s', '.github/scripts/commit-public.sh')).toMatch(/^100755 /);
	});
});
