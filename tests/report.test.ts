import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYSTEM_DOWN_MS } from '../pipeline/config.ts';
import type { LocatedOutcome } from '../pipeline/stages/locate.ts';
import { buildRunReport, failedReport, writeReport, type RunReportInput } from '../pipeline/stages/report.ts';
import { buildCoverage } from '../shared/coverage.ts';
import type { Centre } from '../shared/directory.ts';
import type { SnapshotSystem } from '../shared/snapshot.ts';
import { STATE_VERSION, type State, type StoredListing } from '../shared/state.ts';

const RUN_AT = new Date('2026-10-29T05:17:00.000Z');
const HOUR = 60 * 60 * 1000;
const hoursBefore = (h: number): string => new Date(RUN_AT.getTime() - h * HOUR).toISOString();

const centre = (id: string, reader: Centre['reader'] = 'kuferweb'): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
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

const stored = (centreId: string, startsAt: string, extra: Partial<StoredListing> = {}): StoredListing => ({
	id: `${centreId}@${startsAt.slice(0, 16)}`,
	centre_id: centreId,
	starts_at: startsAt,
	time_known: true,
	place: null,
	address: 'Hauptstraße 1, 80331 München',
	status: 'free',
	deadline: null,
	registration_method: 'online',
	source_url: `https://${centreId}.example.de/k/1`,
	link_ok: true,
	eligibility: null,
	first_seen_at: hoursBefore(48),
	removed_at: null,
	baseline: true,
	...extra,
});

const system = (reader: SnapshotSystem['reader'], extra: Partial<SnapshotSystem> = {}): SnapshotSystem => ({
	reader,
	centres_covered: 3,
	centres_ok: 3,
	centres_failed: 0,
	last_success_at: RUN_AT.toISOString(),
	...extra,
});

const priorState = (listings: Record<string, StoredListing[]>): State => ({
	stateVersion: STATE_VERSION,
	centres: Object.fromEntries(
		Object.entries(listings).map(([id, list]) => [id, { last_result: 'ok' as const, last_checked_at: hoursBefore(24), last_success_at: hoursBefore(24), last_skip_reason: null, last_skip_at: null, last_robots_skip_at: null, listings: list }]),
	),
});

const input = (extra: Partial<RunReportInput> = {}): RunReportInput => ({
	runAt: RUN_AT,
	tally: { ok: 2, failed: 0, skipped: 0 },
	systems: [system('itemkg'), system('kuferweb')],
	directory: [centre('a'), centre('b', 'itemkg')],
	priorState: priorState({}),
	outcomes: {},
	coverage: buildCoverage([], {}),
	...extra,
});

const ok = (count = 0): LocatedOutcome => ({ kind: 'ok', listings: Array.from({ length: count }, () => ({}) as never), carriedFrom: {} });

describe('buildRunReport: every fetched centre failed', () => {
	it('is set with ≥ 1 failed and 0 ok, skipped not counting as fetched', () => {
		expect(buildRunReport(input({ tally: { ok: 0, failed: 3, skipped: 1 } })).all_fetched_failed).toBe(true);
	});

	it('is not set when only skipped centres ran, or when one centre was ok', () => {
		expect(buildRunReport(input({ tally: { ok: 0, failed: 0, skipped: 4 } })).all_fetched_failed).toBe(false);
		expect(buildRunReport(input({ tally: { ok: 1, failed: 3, skipped: 0 } })).all_fetched_failed).toBe(false);
	});

	it('reports stage null and the run time', () => {
		const report = buildRunReport(input());
		expect(report.stage).toBeNull();
		expect(report.runAt).toBe(RUN_AT.toISOString());
	});
});

describe('buildRunReport: system down', () => {
	const down = (extra: Partial<SnapshotSystem>) => buildRunReport(input({ systems: [system('itemkg', extra)] })).systems[0]!.problem_down;

	it('is down after more than 24 h without a centre ok', () => {
		expect(SYSTEM_DOWN_MS).toBe(24 * HOUR);
		expect(down({ centres_ok: 0, last_success_at: hoursBefore(30) })).toEqual({ since: hoursBefore(30) });
	});

	it('is not down within 24 h, or while a centre is ok', () => {
		expect(down({ centres_ok: 0, last_success_at: hoursBefore(10) })).toBeNull();
		expect(down({ centres_ok: 0, last_success_at: hoursBefore(24) })).toBeNull();
		expect(down({ centres_ok: 1, last_success_at: hoursBefore(30) })).toBeNull();
	});

	it('is down at once when it never succeeded', () => {
		expect(down({ centres_ok: 0, last_success_at: null })).toEqual({ since: null });
	});

	it('is not down when it covers no centre', () => {
		expect(down({ centres_covered: 0, centres_ok: 0, last_success_at: null })).toBeNull();
	});

	it('lists every system, with no problems when healthy', () => {
		expect(buildRunReport(input()).systems).toEqual([
			{ reader: 'itemkg', problem_down: null, disappeared: [] },
			{ reader: 'kuferweb', problem_down: null, disappeared: [] },
		]);
	});
});

describe('buildRunReport: dates disappeared', () => {
	const disappeared = (prior: StoredListing[], outcome: LocatedOutcome = ok()) =>
		buildRunReport(input({ priorState: priorState({ a: prior }), outcomes: { a: outcome, b: ok(1) } })).systems.find((s) => s.reader === 'kuferweb')!
			.disappeared;

	it('names a centre ok with 0 listings whose prior state held an upcoming live listing', () => {
		expect(disappeared([stored('a', '2026-10-20T10:00:00+01:00'), stored('a', '2026-11-20T10:00:00+01:00')])).toEqual([{ centre_id: 'a', name: 'Centre a' }]);
	});

	it('counts a listing starting exactly at runAt', () => {
		expect(disappeared([stored('a', RUN_AT.toISOString())])).toHaveLength(1);
	});

	it('ignores prior dates that are all in the past', () => {
		expect(disappeared([stored('a', '2026-10-20T10:00:00+01:00'), stored('a', '2026-10-29T06:00:00+01:00')])).toEqual([]);
	});

	it('ignores tombstoned prior dates', () => {
		expect(disappeared([stored('a', '2026-11-20T10:00:00+01:00', { removed_at: hoursBefore(24) })])).toEqual([]);
	});

	it('ignores a centre that still has listings, failed, or had no prior state', () => {
		const prior = [stored('a', '2026-11-20T10:00:00+01:00')];
		expect(disappeared(prior, ok(1))).toEqual([]);
		expect(disappeared(prior, { kind: 'failed', reason: 'list-page' } as LocatedOutcome)).toEqual([]);
		expect(disappeared([])).toEqual([]);
	});

	it('counts an untimed prior listing of the run\'s Berlin date, not one of the previous day (Story 3.10)', () => {
		const untimed = (date: string) => stored('a', `${date}T00:00:00+01:00`, { id: `a@${date}`, time_known: false });
		expect(disappeared([untimed('2026-10-29')])).toEqual([{ centre_id: 'a', name: 'Centre a' }]);
		expect(disappeared([untimed('2026-10-28')])).toEqual([]);
	});

	it('files the centre under its own reader system only', () => {
		const report = buildRunReport(input({ priorState: priorState({ a: [stored('a', '2026-11-20T10:00:00+01:00')] }), outcomes: { a: ok() } }));
		expect(report.systems.find((s) => s.reader === 'itemkg')!.disappeared).toEqual([]);
	});
});

describe('failedReport and writeReport', () => {
	it('reports the stage with no systems', () => {
		expect(failedReport('input')).toEqual({ stage: 'input', runAt: null, all_fetched_failed: false, systems: [], coverage: null });
		expect(failedReport('fetch', RUN_AT).runAt).toBe(RUN_AT.toISOString());
	});

	it('carries the run coverage (Story 4.1)', () => {
		const directory = [centre('a'), centre('b', 'itemkg')];
		const outcomes = { a: ok(2), b: { kind: 'failed', reason: 'structure-missing' } as LocatedOutcome };
		const coverage = buildCoverage(directory, outcomes);
		expect(buildRunReport(input({ directory, outcomes, coverage })).coverage).toEqual(coverage);
		expect(coverage.coverage).toEqual({ percent: 50, numerator: 1, denominator: 2 });
	});

	it('writes one line of JSON', () => {
		const path = join(mkdtempSync(join(tmpdir(), 'bgt-report-')), 'report.json');
		const report = buildRunReport(input());
		writeReport(path, report);
		const text = readFileSync(path, 'utf8');
		expect(text.trimEnd().split('\n')).toHaveLength(1);
		expect(JSON.parse(text)).toEqual(report);
	});
});
