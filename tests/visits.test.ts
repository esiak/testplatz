import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VISIT_LIMIT_PER_HOST, VISIT_WINDOW_MS } from '../pipeline/config.ts';
import { overBudget, readVisitLog, VISIT_LOG_PATH } from '../pipeline/fetch/visits.ts';
import { visitLogSchema, visitSchema, visitsInWindow, type Visit } from '../shared/visits.ts';

const RUN_AT = new Date('2026-10-28T05:17:00.000Z');
const ago = (ms: number) => new Date(RUN_AT.getTime() - ms).toISOString();
const HOUR = 60 * 60 * 1000;

describe('visit schema', () => {
	it('accepts a host with a UTC ISO datetime', () => {
		expect(visitSchema.safeParse({ host: 'a.de', at: '2026-10-28T05:17:00.000Z' }).success).toBe(true);
		expect(visitLogSchema.safeParse([]).success).toBe(true);
	});

	it.each<[string, unknown]>([
		['an empty host', { host: '', at: '2026-10-28T05:17:00Z' }],
		['a missing at', { host: 'a.de' }],
		['an offset datetime', { host: 'a.de', at: '2026-10-28T06:17:00+01:00' }],
		['a date only', { host: 'a.de', at: '2026-10-28' }],
		['an extra key', { host: 'a.de', at: '2026-10-28T05:17:00Z', url: 'https://a.de/' }],
		['a non-string host', { host: 1, at: '2026-10-28T05:17:00Z' }],
	])('rejects %s', (_case, value) => {
		expect(visitSchema.safeParse(value).success).toBe(false);
	});

	it('rejects a log that is not an array', () => {
		expect(visitLogSchema.safeParse({ host: 'a.de', at: '2026-10-28T05:17:00Z' }).success).toBe(false);
	});
});

describe('visitsInWindow and overBudget', () => {
	it('counts only this host, newer than the window start; exactly 24 h old does not count', () => {
		const log: Visit[] = [
			{ host: 'a.de', at: ago(VISIT_WINDOW_MS) },
			{ host: 'a.de', at: ago(VISIT_WINDOW_MS - 1) },
			{ host: 'a.de', at: ago(HOUR) },
			{ host: 'b.de', at: ago(HOUR) },
			{ host: 'a.de', at: ago(-HOUR) },
		];
		expect(visitsInWindow(log, 'a.de', RUN_AT, VISIT_WINDOW_MS)).toBe(3);
		expect(visitsInWindow(log, 'b.de', RUN_AT, VISIT_WINDOW_MS)).toBe(1);
		expect(visitsInWindow(log, 'c.de', RUN_AT, VISIT_WINDOW_MS)).toBe(0);
	});

	it('is over budget at the limit within 24 h, not with old visits', () => {
		const recent = Array.from({ length: VISIT_LIMIT_PER_HOST }, (_, i): Visit => ({ host: 'a.de', at: ago((i + 1) * HOUR) }));
		const old = Array.from({ length: VISIT_LIMIT_PER_HOST }, (_, i): Visit => ({ host: 'a.de', at: ago(VISIT_WINDOW_MS + i * HOUR) }));
		expect(overBudget(recent, 'a.de', RUN_AT)).toBe(true);
		expect(overBudget(recent.slice(1), 'a.de', RUN_AT)).toBe(false);
		expect(overBudget(old, 'a.de', RUN_AT)).toBe(false);
		expect(overBudget(recent, 'b.de', RUN_AT)).toBe(false);
	});
});

describe('readVisitLog', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'visits-'));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('points at data/state/visits.json', () => {
		expect(VISIT_LOG_PATH.split(/[\\/]/).slice(-3)).toEqual(['data', 'state', 'visits.json']);
	});

	it('reads a missing file as an empty log', () => {
		expect(readVisitLog(join(dir, 'visits.json'))).toEqual([]);
	});

	it('reads a valid log', () => {
		const path = join(dir, 'visits.json');
		const log = [{ host: 'a.de', at: '2026-10-28T05:17:00.000Z' }];
		writeFileSync(path, JSON.stringify(log));
		expect(readVisitLog(path)).toEqual(log);
	});

	it('throws naming the path for malformed JSON', () => {
		const path = join(dir, 'visits.json');
		writeFileSync(path, '[{"host":');
		expect(() => readVisitLog(path)).toThrow(path);
		expect(() => readVisitLog(path)).toThrow(/not valid JSON/);
	});

	it.each([['empty', ''], ['whitespace-only', ' \n\t ']])('throws naming the path for an %s file', (_case, content) => {
		const path = join(dir, 'visits.json');
		writeFileSync(path, content);
		expect(() => readVisitLog(path)).toThrow(path);
	});

	it('throws naming the path for a bad entry', () => {
		const path = join(dir, 'visits.json');
		writeFileSync(path, JSON.stringify([{ host: 'a.de', at: '2026-10-28T05:17:00Z' }, { host: '', at: 'yesterday' }]));
		expect(() => readVisitLog(path)).toThrow(path);
		expect(() => readVisitLog(path)).toThrow(/invalid at 1\./);
	});

	it('throws naming the path when the path is a directory (EISDIR)', () => {
		const path = join(dir, 'visits.json');
		mkdirSync(path);
		expect(() => readVisitLog(path)).toThrow(`cannot read visit log ${path}`);
	});
});
