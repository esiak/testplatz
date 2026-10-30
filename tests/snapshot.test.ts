import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, serializeSnapshot, writeSnapshot, type SnapshotInput } from '../pipeline/stages/publish.ts';
import { SNAPSHOT_PATH } from '../pipeline/stages/paths.ts';
import type { LocatedOutcome } from '../pipeline/stages/locate.ts';
import { type Centre } from '../shared/directory.ts';
import { FRESHNESS_MS, SNAPSHOT_SCHEMA_VERSION, snapshotSchema, type Snapshot, type SnapshotListing } from '../shared/snapshot.ts';
import { emptyState, type CentreState, type State, type StoredListing } from '../shared/state.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'bgt-snapshot-'));
const RUN_1 = new Date('2026-10-27T07:00:00.000Z');
const RUN_2 = new Date('2026-10-28T07:00:00.000Z');
const EARLIER = '2026-10-26T05:17:00.000Z';

const centre = (id: string, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: 'https://example.de/',
	test_page_url: 'https://example.de/test',
	reader: 'none',
	reader_config: null,
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});
const kufer = (id: string, extra: Partial<Centre> = {}): Centre => centre(id, { reader: 'kuferweb', reader_config: { list_url: `https://${id}.de/kurse` }, ...extra });
const itemkg = (id: string, extra: Partial<Centre> = {}): Centre => centre(id, { reader: 'itemkg', reader_config: { list_url: `https://${id}.de/kurse` }, ...extra });

const DIRECTORY: Centre[] = [centre('zeta'), kufer('alpha', { opted_out: true }), centre('mid', { lat: null, lon: null })];

const stored = (centreId: string, startsAt: string, extra: Partial<StoredListing> = {}): StoredListing => ({
	id: `${centreId}@${startsAt.slice(0, 16)}`,
	centre_id: centreId,
	starts_at: startsAt,
	place: null,
	address: 'Hauptstraße 1, 80331 München',
	status: 'free',
	deadline: null,
	registration_method: 'online',
	source_url: `https://${centreId}.de/k/1`,
	link_ok: true,
	eligibility: null,
	lat: 48.137,
	lon: 11.575,
	location: 'venue',
	first_seen_at: EARLIER,
	removed_at: null,
	baseline: true,
	...extra,
});

const history = (lastResult: 'ok' | 'failed', listings: StoredListing[] = [], lastSuccess: string | null = EARLIER): CentreState => ({
	last_result: lastResult,
	last_checked_at: EARLIER,
	last_success_at: lastSuccess,
	listings,
});

const stateOf = (centres: Record<string, CentreState>): State => ({ ...emptyState(), centres });

const build = (input: Partial<SnapshotInput> = {}): Snapshot =>
	buildSnapshot({ centres: DIRECTORY, state: emptyState(), outcomes: {}, readers: ['kuferweb', 'itemkg'], runAt: RUN_1, ...input });

const published = (listing: StoredListing): SnapshotListing => {
	const { removed_at: _removed, ...rest } = listing;
	return rest as SnapshotListing;
};

/** A valid snapshot with one covered centre `k` holding one listing. */
function withListing(): Snapshot {
	return build({
		centres: [...DIRECTORY, kufer('k')],
		state: stateOf({ k: history('ok', [stored('k', '2026-11-12T10:00:00+01:00')]) }),
	});
}

describe('snapshotSchema', () => {
	it('accepts a built snapshot, with and without listings', () => {
		expect(snapshotSchema.safeParse(build()).success).toBe(true);
		expect(withListing().listings).toHaveLength(1);
		expect(snapshotSchema.safeParse(withListing()).success).toBe(true);
	});

	const rejects: [string, (s: Snapshot) => unknown][] = [
		['another schemaVersion', (s) => ({ ...s, schemaVersion: 1 })],
		['an extra top-level key', (s) => ({ ...s, extra: true })],
		['an extra centre key', (s) => ({ ...s, centres: [{ ...s.centres[0], extra: 1 }, ...s.centres.slice(1)] })],
		['a listing of an unknown centre', (s) => ({ ...s, listings: [{ ...s.listings[0]!, id: 'nope@2026-11-12T10:00', centre_id: 'nope' }] })],
		['a listing of a not_checked centre', (s) => ({ ...s, centres: s.centres.map((c) => (c.centre_id === 'k' ? { ...c, coverage: 'not_checked' } : c)) })],
		['a listing with removed_at', (s) => ({ ...s, listings: [{ ...s.listings[0]!, removed_at: null }] })],
		['a listing without first_seen_at', (s) => ({ ...s, listings: [{ ...s.listings[0]!, first_seen_at: undefined }] })],
		['a listing whose id names another centre', (s) => ({ ...s, listings: [{ ...s.listings[0]!, id: 'zeta@2026-11-12T10:00' }] })],
		['duplicate listing ids', (s) => ({ ...s, listings: [s.listings[0]!, s.listings[0]!] })],
		['covered + opted out', (s) => ({ ...s, centres: s.centres.map((c) => (c.opted_out ? { ...c, coverage: 'covered' } : c)) })],
		['covered + reader none', (s) => ({ ...s, centres: s.centres.map((c) => (c.reader === 'none' ? { ...c, coverage: 'covered' } : c)) })],
		['a duplicate centre_id', (s) => ({ ...s, centres: [s.centres[0], s.centres[0]] })],
		['a non-Z generated_at', (s) => ({ ...s, generated_at: '2026-10-27T09:00:00+02:00' })],
		['a non-Z last_checked_at', (s) => ({ ...s, centres: [{ ...s.centres[0], last_checked_at: '2026-10-27T09:00:00+02:00' }, ...s.centres.slice(1)] })],
		['an unknown coverage code', (s) => ({ ...s, centres: [{ ...s.centres[0], coverage: 'unknown' }, ...s.centres.slice(1)] })],
		['an omitted run field', (s) => ({ ...s, centres: [{ ...s.centres[0], last_success_at: undefined }, ...s.centres.slice(1)] })],
		['a listing without location fields', (s) => ({ ...s, listings: [{ ...s.listings[0]!, lat: undefined, lon: undefined, location: undefined }] })],
		['a listing with only lat', (s) => ({ ...s, listings: [{ ...s.listings[0]!, lon: null }] })],
		['a listing outside the Bavaria box', (s) => ({ ...s, listings: [{ ...s.listings[0]!, lat: 52.52, lon: 13.4 }] })],
		['an unknown location code', (s) => ({ ...s, listings: [{ ...s.listings[0]!, location: 'home' }] })],
		['a system for reader none', (s) => ({ ...s, systems: [{ reader: 'none', centres_covered: 0, centres_ok: 0, centres_failed: 0, last_success_at: null }] })],
	];

	it.each(rejects)('rejects %s', (_name, mutate) => {
		expect(snapshotSchema.safeParse(mutate(withListing())).success).toBe(false);
	});

	it('rejects unsorted listing ids', () => {
		const snapshot = build({
			centres: [...DIRECTORY, kufer('k')],
			state: stateOf({ k: history('ok', [stored('k', '2026-11-12T10:00:00+01:00'), stored('k', '2026-12-01T10:00:00+01:00')]) }),
		});
		expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
		expect(snapshotSchema.safeParse({ ...snapshot, listings: [...snapshot.listings].reverse() }).success).toBe(false);
	});
});

describe('FRESHNESS_MS', () => {
	it('is 36 h (one daily run plus slack)', () => {
		expect(FRESHNESS_MS).toBe(36 * 60 * 60 * 1000);
	});
});

describe('buildSnapshot', () => {
	it('lists every centre once, sorted, with the run fields after the directory fields', () => {
		const snapshot = build();
		expect(snapshot.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
		expect(SNAPSHOT_SCHEMA_VERSION).toBe(3);
		expect(snapshot.generated_at).toBe('2026-10-27T07:00:00Z');
		expect(snapshot.centres.map((c) => c.centre_id)).toEqual(['alpha', 'mid', 'zeta']);
		for (const c of snapshot.centres) {
			expect(Object.keys(c).slice(-4)).toEqual(['coverage', 'last_result', 'last_checked_at', 'last_success_at']);
		}
	});

	it('marks opted-out, reader none and unregistered-reader centres not_checked with null run fields and no listings', () => {
		const listing = stored('opt', '2026-11-12T10:00:00+01:00');
		const snapshot = build({
			centres: [kufer('opt', { opted_out: true }), centre('none'), itemkg('unreg')],
			readers: ['kuferweb'],
			state: stateOf({ opt: history('ok', [listing]), unreg: history('ok', [stored('unreg', '2026-11-12T10:00:00+01:00')]) }),
		});
		for (const c of snapshot.centres) {
			expect(c).toMatchObject({ coverage: 'not_checked', last_result: null, last_checked_at: null, last_success_at: null });
		}
		expect(snapshot.listings).toEqual([]);
		expect(snapshot.systems).toEqual([{ reader: 'kuferweb', centres_covered: 0, centres_ok: 0, centres_failed: 0, last_success_at: null }]);
	});

	it('marks a robots skip not_checked and drops its stored listings; a budget skip stays covered with its listings', () => {
		const robots = stored('robots', '2026-11-12T10:00:00+01:00');
		const budget = stored('budget', '2026-11-12T10:00:00+01:00');
		const outcomes: Record<string, LocatedOutcome> = {
			robots: { kind: 'skipped', reason: 'robots' },
			budget: { kind: 'skipped', reason: 'budget' },
		};
		const snapshot = build({
			centres: [kufer('robots'), kufer('budget')],
			state: stateOf({ robots: history('ok', [robots]), budget: history('ok', [budget]) }),
			outcomes,
		});
		expect(snapshot.centres.find((c) => c.centre_id === 'robots')).toMatchObject({ coverage: 'not_checked', last_result: null, last_success_at: null });
		expect(snapshot.centres.find((c) => c.centre_id === 'budget')).toMatchObject({ coverage: 'covered', last_result: 'ok', last_success_at: EARLIER });
		expect(snapshot.listings).toEqual([published(budget)]);
	});

	it('keeps a covered centre with no state covered with null run fields', () => {
		const snapshot = build({ centres: [kufer('never')] });
		expect(snapshot.centres[0]).toMatchObject({ coverage: 'covered', last_result: null, last_checked_at: null, last_success_at: null });
		expect(snapshot.systems.find((s) => s.reader === 'kuferweb')).toEqual({ reader: 'kuferweb', centres_covered: 1, centres_ok: 0, centres_failed: 0, last_success_at: null });
	});

	it('publishes a failed centre with its old listings and its run fields from state', () => {
		const listing = stored('f', '2026-11-12T10:00:00+01:00');
		const snapshot = build({ centres: [itemkg('f')], state: stateOf({ f: history('failed', [listing]) }), outcomes: { f: { kind: 'failed', reason: 'list-page' } } });
		expect(snapshot.centres[0]).toMatchObject({ coverage: 'covered', last_result: 'failed', last_checked_at: EARLIER, last_success_at: EARLIER });
		expect(snapshot.listings).toEqual([published(listing)]);
	});

	it('drops removed and past listings (starts_at not after runAt), drops removed_at, and sorts by id', () => {
		const future2 = stored('b', '2026-12-01T10:00:00+01:00', { baseline: false, first_seen_at: '2026-10-27T07:00:00.000Z' });
		const future1 = stored('a', '2026-11-12T10:00:00+01:00');
		const removed = stored('a', '2026-11-20T10:00:00+01:00', { removed_at: EARLIER });
		const atRunAt = stored('a', '2026-10-27T08:00:00+01:00');
		const snapshot = build({
			centres: [kufer('b'), kufer('a')],
			state: stateOf({ a: history('ok', [atRunAt, future1, removed]), b: history('ok', [future2]) }),
		});
		expect(snapshot.listings).toEqual([published(future1), published(future2)]);
		expect(Object.keys(snapshot.listings[0]!)).not.toContain('removed_at');
		expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
	});

	it('fills a stored listing without location fields with the centre coordinates and location centre', () => {
		const legacy = { ...stored('a', '2026-11-12T10:00:00+01:00') } as Partial<StoredListing>;
		delete legacy.lat;
		delete legacy.lon;
		delete legacy.location;
		const unlocated = { ...legacy, id: 'm@2026-11-12T10:00', centre_id: 'm' } as StoredListing;
		const placed = stored('a', '2026-11-13T10:00:00+01:00', { lat: 49.4, lon: 11.1, location: 'venue' });
		const snapshot = build({
			centres: [kufer('a', { lat: 48.5, lon: 11.2 }), kufer('m', { lat: null, lon: null })],
			state: stateOf({ a: history('ok', [legacy as StoredListing, placed]), m: history('failed', [unlocated]) }),
		});
		expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
		expect(snapshot.listings.map((l) => [l.id, l.lat, l.lon, l.location])).toEqual([
			['a@2026-11-12T10:00', 48.5, 11.2, 'centre'],
			['a@2026-11-13T10:00', 49.4, 11.1, 'venue'],
			['m@2026-11-12T10:00', null, null, 'centre'],
		]);
	});

	it('sums systems per registered reader, sorted, with the latest last_success_at', () => {
		const snapshot = build({
			centres: [kufer('k1'), kufer('k2'), kufer('k3'), kufer('k4', { opted_out: true }), itemkg('i1')],
			state: stateOf({
				k1: history('ok', [], '2026-10-26T05:17:00.000Z'),
				k2: history('failed', [], '2026-10-25T05:17:00.000Z'),
				k4: history('ok', [], '2026-10-27T05:17:00.000Z'),
				i1: history('failed', [], null),
			}),
		});
		expect(snapshot.systems).toEqual([
			{ reader: 'itemkg', centres_covered: 1, centres_ok: 0, centres_failed: 1, last_success_at: null },
			{ reader: 'kuferweb', centres_covered: 3, centres_ok: 1, centres_failed: 1, last_success_at: '2026-10-26T05:17:00.000Z' },
		]);
	});
});

describe('writeSnapshot', () => {
	it.each<[string, (s: Snapshot) => Snapshot]>([
		['covered + opted out', (s) => ({ ...s, centres: s.centres.map((c) => (c.opted_out ? { ...c, coverage: 'covered' } : c)) })],
		['a listing of a not_checked centre', (s) => ({ ...s, centres: s.centres.map((c) => (c.centre_id === 'k' ? { ...c, coverage: 'not_checked' } : c)) })],
	])('throws and writes nothing for an invalid snapshot (%s)', (_name, mutate) => {
		const dir = tmp();
		const path = join(dir, 'snapshot.json');
		expect(() => writeSnapshot(mutate(withListing()), path)).toThrow(/fails the schema/);
		expect(readdirSync(dir)).toEqual([]);
	});

	it('writes minified JSON with a trailing newline, then leaves an equal snapshot untouched', () => {
		const dir = tmp();
		const path = join(dir, 'snapshot.json');
		expect(writeSnapshot(withListing(), path)).toBe('written');
		const text = readFileSync(path, 'utf8');
		expect(text).toBe(serializeSnapshot(withListing()));
		expect(text.endsWith('}\n')).toBe(true);
		expect(text).not.toContain('\n\t');
		expect(writeSnapshot(build({ centres: [...DIRECTORY, kufer('k')], state: stateOf({ k: history('ok', [stored('k', '2026-11-12T10:00:00+01:00')]) }), runAt: RUN_2 }), path)).toBe('unchanged');
		expect(readFileSync(path, 'utf8')).toBe(text);
		expect(readdirSync(dir)).toEqual(['snapshot.json']);
	});

	it('overwrites a corrupt existing snapshot', () => {
		const dir = tmp();
		const path = join(dir, 'snapshot.json');
		writeFileSync(path, '{corrupt');
		expect(writeSnapshot(build({ runAt: RUN_2 }), path)).toBe('written');
		expect(snapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).generated_at).toBe('2026-10-28T07:00:00Z');
	});
});

describe('committed data/public/snapshot.json', () => {
	// Validity and internal consistency only. It must not compare centre_ids with the directory:
	// `npm test` runs before `npm run pipeline` in pipeline.yml, and the pipeline is what
	// reconciles a changed directory with the committed snapshot.
	const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')));

	it('validates as schemaVersion 3 with centres', () => {
		expect(snapshot.schemaVersion).toBe(3);
		expect(snapshot.centres.length).toBeGreaterThan(0);
	});

	it('has null run fields for every not_checked centre and system counts that match its centres', () => {
		for (const centre of snapshot.centres.filter((c) => c.coverage === 'not_checked')) {
			expect(centre).toMatchObject({ last_result: null, last_checked_at: null, last_success_at: null });
		}
		for (const system of snapshot.systems) {
			const covered = snapshot.centres.filter((c) => c.coverage === 'covered' && c.reader === system.reader);
			expect(system.centres_covered).toBe(covered.length);
			expect(system.centres_ok).toBe(covered.filter((c) => c.last_result === 'ok').length);
			expect(system.centres_failed).toBe(covered.filter((c) => c.last_result === 'failed').length);
		}
	});
});
