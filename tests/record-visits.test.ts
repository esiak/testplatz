import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VISIT_WINDOW_MS } from '../pipeline/config.ts';
import { recordVisits } from '../pipeline/stages/record-visits.ts';
import type { Visit } from '../shared/visits.ts';

const NOW = new Date('2026-10-29T05:17:00.000Z');
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const text = (value: unknown) => `${JSON.stringify(value, null, '\t')}\n`;

/** A temp tree with data/state/visits.json (and a state.json that must stay untouched) and a run's visits file. */
function setup(log: Visit[] | string | null, visits: unknown) {
	const dir = mkdtempSync(join(tmpdir(), 'bgt-record-visits-'));
	mkdirSync(join(dir, 'state'));
	const visitLogPath = join(dir, 'state', 'visits.json');
	const statePath = join(dir, 'state', 'state.json');
	const visitsPath = join(dir, 'run-visits.json');
	if (log !== null) writeFileSync(visitLogPath, typeof log === 'string' ? log : text(log));
	writeFileSync(statePath, '{"untouched":true}\n');
	writeFileSync(visitsPath, typeof visits === 'string' ? visits : JSON.stringify(visits));
	return { dir, visitLogPath, statePath, visitsPath };
}

function record(paths: ReturnType<typeof setup>) {
	const logs: string[] = [];
	const errors: string[] = [];
	const code = recordVisits(paths.visitsPath, { visitLogPath: paths.visitLogPath, now: () => NOW, log: (l) => logs.push(l), error: (l) => errors.push(l) });
	return { code, logs, errors };
}

const readLog = (path: string): Visit[] => JSON.parse(readFileSync(path, 'utf8')) as Visit[];

describe('recordVisits (Story 3.11)', () => {
	it('appends the run\'s visits, sorted by at then host, tab-indented like merge writes it', () => {
		const paths = setup([{ host: 'a.de', at: ago(2 * HOUR) }], [
			{ host: 'z.de', at: ago(HOUR) },
			{ host: 'b.de', at: ago(HOUR) },
		]);
		const { code } = record(paths);
		expect(code).toBe(0);
		const expected = [
			{ host: 'a.de', at: ago(2 * HOUR) },
			{ host: 'b.de', at: ago(HOUR) },
			{ host: 'z.de', at: ago(HOUR) },
		];
		expect(readFileSync(paths.visitLogPath, 'utf8')).toBe(text(expected));
	});

	it('keeps a visit already on the log once, and writes nothing when every visit is there', () => {
		const log = [
			{ host: 'old.de', at: ago(VISIT_WINDOW_MS + HOUR) },
			{ host: 'a.de', at: ago(HOUR) },
		];
		const paths = setup(log, [{ host: 'a.de', at: ago(HOUR) }]);
		const before = readFileSync(paths.visitLogPath, 'utf8');
		const { code, logs } = record(paths);
		expect(code).toBe(0);
		expect(logs.join('\n')).toContain('unchanged');
		// Not even the stale entry is pruned: nothing new, nothing written.
		expect(readFileSync(paths.visitLogPath, 'utf8')).toBe(before);

		const second = setup(log, [{ host: 'a.de', at: ago(HOUR) }, { host: 'b.de', at: ago(HOUR) }]);
		expect(record(second).code).toBe(0);
		expect(readLog(second.visitLogPath)).toEqual([
			{ host: 'a.de', at: ago(HOUR) },
			{ host: 'b.de', at: ago(HOUR) },
		]);
	});

	it('drops visits older than the window before now, like merge', () => {
		const paths = setup([], [
			{ host: 'old.de', at: ago(VISIT_WINDOW_MS) },
			{ host: 'new.de', at: ago(VISIT_WINDOW_MS - 1) },
		]);
		expect(record(paths).code).toBe(0);
		expect(readLog(paths.visitLogPath)).toEqual([{ host: 'new.de', at: ago(VISIT_WINDOW_MS - 1) }]);
	});

	it('creates the log when it is missing, and touches no other file', () => {
		const paths = setup(null, [{ host: 'a.de', at: ago(HOUR) }]);
		expect(record(paths).code).toBe(0);
		expect(readLog(paths.visitLogPath)).toEqual([{ host: 'a.de', at: ago(HOUR) }]);
		expect(readFileSync(paths.statePath, 'utf8')).toBe('{"untouched":true}\n');
		expect(readdirSync(join(paths.dir, 'state')).sort()).toEqual(['state.json', 'visits.json']);
	});

	it.each<[string, unknown]>([
		['not JSON', '{nope'],
		['not an array', { host: 'a.de' }],
		['a bad visit', [{ host: '', at: 'yesterday' }]],
	])('rejects a visits file that is %s, naming it, without writing', (_name, visits) => {
		const paths = setup([{ host: 'a.de', at: ago(HOUR) }], visits);
		const before = readFileSync(paths.visitLogPath, 'utf8');
		const { code, errors } = record(paths);
		expect(code).toBe(1);
		expect(errors.join('\n')).toContain(paths.visitsPath);
		expect(errors.join('\n')).toContain('nothing written');
		expect(readFileSync(paths.visitLogPath, 'utf8')).toBe(before);
	});

	it('rejects an invalid visit log without writing', () => {
		const paths = setup('[{"host":1}]\n', [{ host: 'a.de', at: ago(HOUR) }]);
		const { code, errors } = record(paths);
		expect(code).toBe(1);
		expect(errors.join('\n')).toContain(paths.visitLogPath);
		expect(readFileSync(paths.visitLogPath, 'utf8')).toBe('[{"host":1}]\n');
	});
});

describe('node pipeline/stages/record-visits.ts (CLI)', () => {
	const CLI = fileURLToPath(new URL('../pipeline/stages/record-visits.ts', import.meta.url));

	it.each([[[]], [['a.json', 'b.json']], [['--bogus']]])('exits 1 with usage for %j', (args) => {
		const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('usage: node pipeline/stages/record-visits.ts <visits-file>');
	});

	it('exits 1 naming a missing visits file', () => {
		const missing = join(mkdtempSync(join(tmpdir(), 'bgt-record-visits-cli-')), 'nope.json');
		const result = spawnSync(process.execPath, [CLI, missing], { encoding: 'utf8' });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(missing);
	});
});
