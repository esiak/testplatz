import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VISIT_WINDOW_MS } from '../pipeline/config.ts';
import { readVisitLog } from '../pipeline/fetch/visits.ts';
import { mergeRun, readState, serializeState, writeMergeResult, type MergeResult } from '../pipeline/stages/merge.ts';
import { normaliseOutcome, type NormalisedOutcome } from '../pipeline/stages/normalise.ts';
import type { Centre } from '../shared/directory.ts';
import { listingSchema, type RawListing } from '../shared/listing.ts';
import { emptyState, STATE_VERSION, stateSchema, type State } from '../shared/state.ts';
import type { Visit } from '../shared/visits.ts';

const HOUR = 60 * 60 * 1000;
const RUN_1 = new Date('2026-10-28T05:17:00.000Z');
const RUN_2 = new Date('2026-10-28T11:17:00.000Z');
const RUN_3 = new Date('2026-10-28T17:17:00.000Z');

const centre = (id: string): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: 'https://example.de/',
	test_page_url: 'https://example.de/test',
	reader: 'kuferweb',
	reader_config: null,
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
});

const raw = (date: string, extra: Partial<RawListing> = {}): RawListing => ({
	date,
	time: '10:00',
	place: null,
	address: null,
	status: 'free',
	deadline: null,
	registration_method: 'online',
	eligibility: null,
	source_url: `https://example.de/k/${date}`,
	...extra,
});

/** Normalised `ok` outcome for centre `id` with these raw listings (detail pages all 2xx). */
const ok = (id: string, listings: RawListing[]): NormalisedOutcome =>
	normaliseOutcome(centre(id), { kind: 'ok', listings }, listings.map((l) => ({ url: l.source_url, role: 'detail', status: 200, finalUrl: l.source_url })));
const failed: NormalisedOutcome = { kind: 'failed', reason: 'list-page' };
const skipped: NormalisedOutcome = { kind: 'skipped', reason: 'budget' };

const merge = (state: State, outcomes: Record<string, NormalisedOutcome>, runAt: Date, log: Visit[] = [], visits: Visit[] = []): MergeResult =>
	mergeRun({ state, log, outcomes, visits, runAt });

const listingsOf = (state: State, id: string) => state.centres[id]!.listings;
const byListingId = (state: State, centreId: string, listingId: string) => listingsOf(state, centreId).find((l) => l.id === listingId);

describe('mergeRun outcomes', () => {
	it('first ok run: sets the run fields, listings are baseline with first_seen_at = runAt', () => {
		const { state } = merge(emptyState(), { a: ok('a', [raw('2026-11-12'), raw('2026-12-01')]) }, RUN_1);
		expect(state.stateVersion).toBe(STATE_VERSION);
		expect(state.centres.a).toMatchObject({ last_result: 'ok', last_checked_at: RUN_1.toISOString(), last_success_at: RUN_1.toISOString() });
		expect(listingsOf(state, 'a').map((l) => [l.id, l.first_seen_at, l.removed_at, l.baseline])).toEqual([
			['a@2026-11-12T10:00', RUN_1.toISOString(), null, true],
			['a@2026-12-01T10:00', RUN_1.toISOString(), null, true],
		]);
		expect(stateSchema.safeParse(state).success).toBe(true);
	});

	it('later ok run: a new id is not baseline; a kept id keeps first_seen_at and baseline and takes the new fields', () => {
		const first = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1).state;
		const { state } = merge(first, { a: ok('a', [raw('2026-11-12', { status: 'booked_out' }), raw('2026-12-01')]) }, RUN_2);
		expect(byListingId(state, 'a', 'a@2026-11-12T10:00')).toMatchObject({ status: 'booked_out', first_seen_at: RUN_1.toISOString(), baseline: true, removed_at: null });
		expect(byListingId(state, 'a', 'a@2026-12-01T10:00')).toMatchObject({ first_seen_at: RUN_2.toISOString(), baseline: false });
	});

	it('a centre whose earlier runs all failed gets baseline on its first ok run', () => {
		const first = merge(emptyState(), { a: failed }, RUN_1).state;
		expect(first.centres.a).toEqual({ last_result: 'failed', last_checked_at: RUN_1.toISOString(), last_success_at: null, listings: [] });
		const { state } = merge(first, { a: ok('a', [raw('2026-11-12')]) }, RUN_2);
		expect(listingsOf(state, 'a')[0]!.baseline).toBe(true);
	});

	it('disappears then returns: tombstoned, then removed_at null with original first_seen_at and baseline', () => {
		const one = merge(emptyState(), { a: ok('a', [raw('2026-11-12'), raw('2026-12-01')]) }, RUN_1).state;
		const two = merge(one, { a: ok('a', [raw('2026-12-01')]) }, RUN_2).state;
		expect(byListingId(two, 'a', 'a@2026-11-12T10:00')).toMatchObject({ removed_at: RUN_2.toISOString(), first_seen_at: RUN_1.toISOString(), baseline: true });
		const three = merge(two, { a: ok('a', [raw('2026-11-12'), raw('2026-12-01')]) }, RUN_3).state;
		expect(byListingId(three, 'a', 'a@2026-11-12T10:00')).toMatchObject({ removed_at: null, first_seen_at: RUN_1.toISOString(), baseline: true });
	});

	it('an already-tombstoned listing keeps its original removed_at', () => {
		const one = merge(emptyState(), { a: ok('a', [raw('2026-11-12'), raw('2026-12-01')]) }, RUN_1).state;
		const two = merge(one, { a: ok('a', [raw('2026-12-01')]) }, RUN_2).state;
		const three = merge(two, { a: ok('a', [raw('2026-12-01')]) }, RUN_3).state;
		expect(byListingId(three, 'a', 'a@2026-11-12T10:00')!.removed_at).toBe(RUN_2.toISOString());
	});

	it('an ok run with zero listings tombstones every stored listing', () => {
		const one = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1).state;
		const two = merge(one, { a: ok('a', []) }, RUN_2).state;
		expect(listingsOf(two, 'a').map((l) => l.removed_at)).toEqual([RUN_2.toISOString()]);
	});

	it('failed run: listings identical, last_success_at unchanged, last_checked_at and last_result set', () => {
		const one = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1).state;
		const two = merge(one, { a: failed }, RUN_2).state;
		expect(two.centres.a).toEqual({ ...one.centres.a, last_result: 'failed', last_checked_at: RUN_2.toISOString() });
		expect(listingsOf(two, 'a')).toEqual(listingsOf(one, 'a'));
	});

	it('skipped: the centre state is byte-identical; an unseen skipped centre gets no entry', () => {
		const one = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1).state;
		const two = merge(one, { a: skipped, b: skipped }, RUN_2).state;
		expect(JSON.stringify(two.centres.a)).toBe(JSON.stringify(one.centres.a));
		expect(serializeState(two)).toBe(serializeState(one));
		expect(two.centres.b).toBeUndefined();
	});

	it('leaves centres without an outcome untouched and never deletes a centre entry', () => {
		const one = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]), b: ok('b', [raw('2026-10-28', { time: '08:00' })]) }, RUN_1).state;
		const two = merge(one, { c: failed }, RUN_3).state;
		expect(two.centres.a).toEqual(one.centres.a);
		// b's only listing is now past and pruned, but b stays
		expect(two.centres.b).toEqual({ ...one.centres.b, listings: [] });
		expect(Object.keys(two.centres)).toEqual(['a', 'b', 'c']);
	});

	it('drops every listing with starts_at at or before runAt, whatever the outcome', () => {
		// RUN_2 is 11:17Z = 12:17 Berlin (+01:00)
		const listings = [raw('2026-10-28', { time: '12:17' }), raw('2026-10-28', { time: '12:18' }), raw('2026-10-27')];
		const one = merge(emptyState(), { a: ok('a', listings), b: ok('b', listings), c: ok('c', listings) }, RUN_1).state;
		const two = merge(one, { a: ok('a', listings), b: failed, c: skipped }, RUN_2).state;
		for (const id of ['a', 'b', 'c']) expect(listingsOf(two, id).map((l) => l.id)).toEqual([`${id}@2026-10-28T12:18`]);
	});

	it('keeps centre keys and listings sorted', () => {
		const { state } = merge(emptyState(), { zz: ok('zz', [raw('2026-12-01'), raw('2026-11-12')]), aa: failed }, RUN_1);
		expect(Object.keys(state.centres)).toEqual(['aa', 'zz']);
		expect(listingsOf(state, 'zz').map((l) => l.id)).toEqual(['zz@2026-11-12T10:00', 'zz@2026-12-01T10:00']);
	});

	it('same-minute ids end to end: stable across runs, a returning #2 keeps its history', () => {
		const sessions = [raw('2026-11-12', { place: 'B', source_url: 'https://example.de/k/b' }), raw('2026-11-12', { place: 'A', source_url: 'https://example.de/k/a' })];
		const one = merge(emptyState(), { a: ok('a', sessions) }, RUN_1).state;
		expect(listingsOf(one, 'a').map((l) => [l.id, l.place])).toEqual([
			['a@2026-11-12T10:00', 'A'],
			['a@2026-11-12T10:00#2', 'B'],
		]);
		const two = merge(one, { a: ok('a', [sessions[0]!]) }, RUN_2).state;
		// Only B is left, so it takes the unsuffixed id; #2 is tombstoned.
		expect(listingsOf(two, 'a').map((l) => [l.id, l.place, l.removed_at])).toEqual([
			['a@2026-11-12T10:00', 'B', null],
			['a@2026-11-12T10:00#2', 'B', RUN_2.toISOString()],
		]);
		const three = merge(two, { a: ok('a', [...sessions].reverse()) }, RUN_3).state;
		expect(listingsOf(three, 'a').map((l) => [l.id, l.place, l.removed_at, l.first_seen_at])).toEqual([
			['a@2026-11-12T10:00', 'A', null, RUN_1.toISOString()],
			['a@2026-11-12T10:00#2', 'B', null, RUN_1.toISOString()],
		]);
	});
});

describe('mergeRun visit log', () => {
	it('appends this run, drops entries at or older than 24 h, sorted by at then host', () => {
		const ago = (ms: number) => new Date(RUN_2.getTime() - ms).toISOString();
		const log: Visit[] = [
			{ host: 'b.de', at: ago(HOUR) },
			{ host: 'a.de', at: ago(VISIT_WINDOW_MS) },
			{ host: 'a.de', at: ago(VISIT_WINDOW_MS - 1) },
			{ host: 'a.de', at: ago(HOUR) },
		];
		const visits: Visit[] = [
			{ host: 'z.de', at: RUN_2.toISOString() },
			{ host: 'c.de', at: RUN_2.toISOString() },
		];
		expect(merge(emptyState(), {}, RUN_2, log, visits).log).toEqual([
			{ host: 'a.de', at: ago(VISIT_WINDOW_MS - 1) },
			{ host: 'a.de', at: ago(HOUR) },
			{ host: 'b.de', at: ago(HOUR) },
			{ host: 'c.de', at: RUN_2.toISOString() },
			{ host: 'z.de', at: RUN_2.toISOString() },
		]);
	});

	it('drops exact duplicate (host, at) entries, so merging the same run twice charges no host twice', () => {
		const visits: Visit[] = [{ host: 'a.de', at: RUN_2.toISOString() }];
		const once = merge(emptyState(), {}, RUN_2, [], visits).log;
		expect(merge(emptyState(), {}, RUN_2, once, visits).log).toEqual(once);
		expect(merge(emptyState(), {}, RUN_2, [...visits, ...visits], []).log).toEqual(visits);
	});
});

describe('listing and state cross-field checks', () => {
	const listing = () => (ok('a', [raw('2026-11-12')]) as Extract<NormalisedOutcome, { kind: 'ok' }>).listings[0]!;
	const stateWith = (key: string, listings: unknown[]) => {
		const { state } = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1);
		return { ...state, centres: { [key]: { ...state.centres.a!, listings } } };
	};

	it('accepts the unbroken listing and state', () => {
		expect(listingSchema.safeParse(listing()).success).toBe(true);
		expect(stateSchema.safeParse(merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1).state).success).toBe(true);
	});

	it('rejects an id whose minute differs from starts_at', () => {
		expect(listingSchema.safeParse({ ...listing(), id: 'a@2026-11-12T10:01' }).success).toBe(false);
	});

	it('rejects an id whose prefix differs from centre_id', () => {
		expect(listingSchema.safeParse({ ...listing(), id: 'b@2026-11-12T10:00' }).success).toBe(false);
	});

	it('rejects a self-consistent listing of centre b stored under key a', () => {
		const stored = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1).state.centres.a!.listings[0]!;
		const other = { ...stored, id: 'b@2026-11-12T10:00', centre_id: 'b' };
		expect(listingSchema.safeParse({ ...listing(), id: other.id, centre_id: other.centre_id }).success).toBe(true);
		expect(stateSchema.safeParse(stateWith('a', [other])).success).toBe(false);
	});
});

describe('readState and writeMergeResult', () => {
	let dir: string;
	let paths: { statePath: string; visitLogPath: string };
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'merge-'));
		paths = { statePath: join(dir, 'state', 'state.json'), visitLogPath: join(dir, 'state', 'visits.json') };
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('reads a missing state file as the empty state', () => {
		expect(readState(paths.statePath)).toEqual(emptyState());
	});

	it('round-trips two consecutive runs through the files', () => {
		const one = merge(emptyState(), { b: ok('b', [raw('2026-11-12')]), a: failed }, RUN_1, [], [{ host: 'example.de', at: RUN_1.toISOString() }]);
		writeMergeResult(one, paths);
		expect(readState(paths.statePath)).toEqual(one.state);
		const two = mergeRun({
			state: readState(paths.statePath),
			log: readVisitLog(paths.visitLogPath),
			outcomes: { a: ok('a', [raw('2026-12-01')]), b: ok('b', [raw('2026-12-01')]) },
			visits: [{ host: 'example.de', at: RUN_2.toISOString() }],
			runAt: RUN_2,
		});
		writeMergeResult(two, paths);
		const state = readState(paths.statePath);
		expect(state).toEqual(two.state);
		expect(stateSchema.parse(state).stateVersion).toBe(1);
		expect(readVisitLog(paths.visitLogPath)).toEqual(two.log);
		expect(two.log).toHaveLength(2);
		const text = readFileSync(paths.statePath, 'utf8');
		expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, '\t')}\n`);
		expect(Object.keys(JSON.parse(text).centres)).toEqual(['a', 'b']);
		expect(readdirSync(join(dir, 'state')).sort()).toEqual(['state.json', 'visits.json']);
	});

	it('writes identical bytes for an identical result', () => {
		const one = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1);
		writeMergeResult(one, paths);
		const first = readFileSync(paths.statePath, 'utf8');
		writeMergeResult({ state: readState(paths.statePath), log: readVisitLog(paths.visitLogPath) }, paths);
		expect(readFileSync(paths.statePath, 'utf8')).toBe(first);
	});

	it.each<[string, string, RegExp]>([
		['invalid JSON', '{ nope', /not valid JSON/],
		['another stateVersion', JSON.stringify({ stateVersion: 2, centres: {} }), /stateVersion 2, expected 1/],
		['no stateVersion', JSON.stringify({ centres: {} }), /stateVersion undefined/],
		['a schema failure', JSON.stringify({ stateVersion: 1, centres: { a: { last_result: 'ok' } } }), /invalid at centres\.a/],
		[
			'a listing with an extra unknown field',
			JSON.stringify(
				(() => {
					const { state } = merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1);
					return { ...state, centres: { a: { ...state.centres.a!, listings: [{ ...state.centres.a!.listings[0]!, instructor: 'X' }] } } };
				})(),
			),
			/invalid at centres\.a\.listings\.0/,
		],
	])('throws naming the path for %s', (_case, text, message) => {
		writeFileSync(join(dir, 'bad.json'), text);
		expect(() => readState(join(dir, 'bad.json'))).toThrow(message);
		expect(() => readState(join(dir, 'bad.json'))).toThrow(join(dir, 'bad.json'));
	});

	it('throws naming the path when the state file cannot be read', () => {
		expect(() => readState(dir)).toThrow(`cannot read state file ${dir}`);
	});

	const good = (): MergeResult => merge(emptyState(), { a: ok('a', [raw('2026-11-12')]) }, RUN_1, [], [{ host: 'example.de', at: RUN_1.toISOString() }]);
	const badListing = (): MergeResult => {
		const result = good();
		const listing = result.state.centres.a!.listings[0]!;
		return { ...result, state: { ...result.state, centres: { a: { ...result.state.centres.a!, listings: [{ ...listing, centre_id: 'b' }] } } } };
	};

	it.each<[string, () => MergeResult]>([
		['a listing under the wrong centre key', badListing],
		['unsorted listings', () => {
			const result = merge(emptyState(), { a: ok('a', [raw('2026-11-12'), raw('2026-12-01')]) }, RUN_1);
			result.state.centres.a!.listings.reverse();
			return result;
		}],
		['an invalid visit log', () => ({ ...good(), log: [{ host: '', at: 'yesterday' }] })],
	])('writes nothing for %s', (_case, make) => {
		expect(() => writeMergeResult(make(), paths)).toThrow(/fails the schema, nothing written/);
		expect(existsSync(join(dir, 'state'))).toBe(false);
	});

	it('leaves existing files untouched when the new result is invalid', () => {
		writeMergeResult(good(), paths);
		const before = [readFileSync(paths.statePath, 'utf8'), readFileSync(paths.visitLogPath, 'utf8')];
		expect(() => writeMergeResult({ ...good(), log: [{ host: '', at: 'x' }] }, paths)).toThrow();
		expect([readFileSync(paths.statePath, 'utf8'), readFileSync(paths.visitLogPath, 'utf8')]).toEqual(before);
		expect(readdirSync(join(dir, 'state')).sort()).toEqual(['state.json', 'visits.json']);
	});
});
