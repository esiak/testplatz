import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FetchImpl } from '../pipeline/fetch/index.ts';
import { parseCliArgs, runPipeline, type RunOptions } from '../pipeline/stages/run.ts';
import type { Centre } from '../shared/directory.ts';
import { snapshotSchema, type Snapshot } from '../shared/snapshot.ts';
import { stateSchema, STATE_VERSION, type CentreState, type State, type StoredListing } from '../shared/state.ts';
import type { Visit } from '../shared/visits.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const KUFERWEB_FIXTURES = join(REPO, 'pipeline/readers/kuferweb/fixtures');
const ITEMKG_FIXTURES = join(REPO, 'pipeline/readers/itemkg/fixtures');

const RUN_AT = new Date('2026-10-29T05:17:00.000Z');
const EARLIER = '2026-10-28T05:17:00.000Z';
const HOUR = 60 * 60 * 1000;

const MOOSBURG_LIST = 'https://www.vhs-moosburg.de/programm/sprachen/kategorie/Einbuergerungstest/50';
const MOOSBURG_DETAIL = 'https://www.vhs-moosburg.de/programm/sprachen/kurs/Einbuergerungstest/';
const EBERSBERG_LIST = 'https://www.vhs-ebersberger-land.de/p/sprachen/deutsch/einbuergerungstests-649-CAT-KAT215';
const EBERSBERG_DETAIL = 'https://www.vhs-ebersberger-land.de/p/sprachen/deutsch/einbuergerungstests/einbuergerungstest-649-C-262-30994';

const centre = (id: string, extra: Partial<Centre> = {}): Centre => ({
	centre_id: id,
	name: `Centre ${id}`,
	address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
	lat: 48.137,
	lon: 11.575,
	website: `https://${id}.example.de/`,
	test_page_url: `https://${id}.example.de/test`,
	reader: 'kuferweb',
	reader_config: { list_url: `https://${id}.example.de/kurse` },
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

/** One centre per row of the story's I/O matrix. */
const DIRECTORY: Centre[] = [
	centre('moosburg', { reader_config: { list_url: MOOSBURG_LIST } }),
	centre('ebersberg', { reader: 'itemkg', reader_config: { list_url: EBERSBERG_LIST } }),
	centre('failed-centre', { reader: 'itemkg' }),
	centre('opted-out', { opted_out: true }),
	centre('none-centre', { reader: 'none', reader_config: null }),
	centre('robots-centre'),
	centre('budget-centre', { reader_config: { list_url: 'https://budget.example.de/kurse' } }),
	centre('never-run', { reader_config: { list_url: 'https://budget.example.de/kurse?b' } }),
];

const stored = (centreId: string, startsAt: string, extra: Partial<StoredListing> = {}): StoredListing => ({
	id: `${centreId}@${startsAt.slice(0, 16)}`,
	centre_id: centreId,
	starts_at: startsAt,
	place: null,
	address: 'Hauptstraße 1, 80331 München',
	status: 'free',
	deadline: null,
	registration_method: 'online',
	source_url: `https://${centreId}.example.de/k/1`,
	link_ok: true,
	eligibility: null,
	first_seen_at: EARLIER,
	removed_at: null,
	baseline: true,
	...extra,
});

const okHistory = (listings: StoredListing[]): CentreState => ({ last_result: 'ok', last_checked_at: EARLIER, last_success_at: EARLIER, listings });

const STATE: State = {
	stateVersion: STATE_VERSION,
	centres: {
		'budget-centre': okHistory([
			stored('budget-centre', '2026-10-28T10:00:00+01:00'),
			stored('budget-centre', '2026-11-20T10:00:00+01:00'),
			stored('budget-centre', '2026-11-27T10:00:00+01:00', { removed_at: EARLIER }),
		]),
		'failed-centre': okHistory([stored('failed-centre', '2026-11-12T10:00:00+01:00')]),
		'robots-centre': okHistory([stored('robots-centre', '2026-11-12T10:00:00+01:00')]),
	},
};

/** budget.example.de has used its 4 visits in the last 24 h. */
const VISIT_LOG: Visit[] = [1, 2, 3, 4].map((h) => ({ host: 'budget.example.de', at: new Date(RUN_AT.getTime() - h * HOUR).toISOString() }));

const fixture = (dir: string, file: string) => () =>
	new Response(readFileSync(join(dir, file)), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const ROUTES: Record<string, () => Response> = {
	'https://robots-centre.example.de/robots.txt': () => new Response('User-agent: *\nDisallow: /\n', { status: 200, headers: { 'content-type': 'text/plain' } }),
	'https://failed-centre.example.de/kurse': () => new Response('down', { status: 500 }),
	[MOOSBURG_LIST]: fixture(KUFERWEB_FIXTURES, 'moosburg/list.html'),
	[`${MOOSBURG_DETAIL}262.3071`]: fixture(KUFERWEB_FIXTURES, 'moosburg/262.3071.html'),
	[`${MOOSBURG_DETAIL}262.3072`]: fixture(KUFERWEB_FIXTURES, 'moosburg/262.3072.html'),
	[EBERSBERG_LIST]: fixture(ITEMKG_FIXTURES, 'ebersberg/list.html'),
	[EBERSBERG_DETAIL]: fixture(ITEMKG_FIXTURES, 'ebersberg/262-30994.html'),
};

/** A fake network over the routes (unknown URLs, robots.txt included, get 404). Records every URL. */
function fakeNetwork(routes: Record<string, () => Response> = ROUTES) {
	const calls: string[] = [];
	const fetchImpl: FetchImpl = async (url) => {
		calls.push(url);
		return routes[url]?.() ?? new Response('not found', { status: 404 });
	};
	return { calls, fetchImpl };
}

interface Paths {
	dir: string;
	directoryPath: string;
	statePath: string;
	visitLogPath: string;
	snapshotPath: string;
}

/** A temp tree with the directory, state and visit log (raw text or values; `null` = no file). */
function setup(files: { directory?: Centre[] | string; state?: State | string | null; log?: Visit[] | string | null } = {}): Paths {
	const dir = mkdtempSync(join(tmpdir(), 'bgt-run-'));
	const paths = {
		dir,
		directoryPath: join(dir, 'directory', 'centres.json'),
		statePath: join(dir, 'state', 'state.json'),
		visitLogPath: join(dir, 'state', 'visits.json'),
		snapshotPath: join(dir, 'public', 'snapshot.json'),
	};
	mkdirSync(join(dir, 'directory'));
	mkdirSync(join(dir, 'state'));
	const text = (value: unknown) => (typeof value === 'string' ? value : `${JSON.stringify(value, null, '\t')}\n`);
	writeFileSync(paths.directoryPath, text(files.directory ?? DIRECTORY));
	const state = files.state === undefined ? STATE : files.state;
	if (state !== null) writeFileSync(paths.statePath, text(state));
	const log = files.log === undefined ? VISIT_LOG : files.log;
	if (log !== null) writeFileSync(paths.visitLogPath, text(log));
	return paths;
}

/** Every file under the temp tree, path → content. */
function tree(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort()) {
		try {
			out[entry] = readFileSync(join(dir, entry), 'utf8');
		} catch {
			// a directory
		}
	}
	return out;
}

async function pipeline(paths: Paths, extra: Partial<RunOptions> = {}, net = fakeNetwork()) {
	const logs: string[] = [];
	const errors: string[] = [];
	const code = await runPipeline({
		directoryPath: paths.directoryPath,
		statePath: paths.statePath,
		visitLogPath: paths.visitLogPath,
		snapshotPath: paths.snapshotPath,
		now: () => RUN_AT,
		clock: () => 0,
		clientOptions: { fetchImpl: net.fetchImpl, delayMs: 0, timeoutMs: 1000, sleep: async () => {} },
		log: (line) => logs.push(line),
		error: (line) => errors.push(line),
		...extra,
	});
	return { code, logs, errors, calls: net.calls };
}

const readSnapshot = (paths: Paths): Snapshot => snapshotSchema.parse(JSON.parse(readFileSync(paths.snapshotPath, 'utf8')));
const readStateFile = (paths: Paths): State => stateSchema.parse(JSON.parse(readFileSync(paths.statePath, 'utf8')));
const centreOf = (snapshot: Snapshot, id: string) => snapshot.centres.find((c) => c.centre_id === id)!;
const listingIds = (snapshot: Snapshot, id: string) => snapshot.listings.filter((l) => l.centre_id === id).map((l) => l.id);

describe('runPipeline: one collection run end to end', () => {
	it('collects, merges and publishes snapshot v2 for every row of the matrix', async () => {
		const paths = setup();
		const { code, errors, calls } = await pipeline(paths);
		expect(errors).toEqual([]);
		expect(code).toBe(0);
		const snapshot = readSnapshot(paths);
		const state = readStateFile(paths);
		const at = RUN_AT.toISOString();

		expect(snapshot.schemaVersion).toBe(2);
		expect(snapshot.generated_at).toBe('2026-10-29T05:17:00Z');
		expect(snapshot.centres.map((c) => c.centre_id)).toEqual(DIRECTORY.map((c) => c.centre_id).sort());

		// Ok: covered, run fields from state, its listings.
		expect(centreOf(snapshot, 'moosburg')).toMatchObject({ coverage: 'covered', last_result: 'ok', last_checked_at: at, last_success_at: at });
		expect(listingIds(snapshot, 'moosburg')).toHaveLength(2);
		expect(listingIds(snapshot, 'ebersberg')).toEqual(['ebersberg@2026-12-15T14:30']);
		expect(snapshot.listings.find((l) => l.centre_id === 'ebersberg')).toMatchObject({ first_seen_at: at, baseline: true, link_ok: true, registration_method: 'email' });

		// Failed after success: covered, failed, the old listing still published.
		expect(centreOf(snapshot, 'failed-centre')).toMatchObject({ coverage: 'covered', last_result: 'failed', last_checked_at: at, last_success_at: EARLIER });
		expect(listingIds(snapshot, 'failed-centre')).toEqual(['failed-centre@2026-11-12T10:00']);
		expect(state.centres['failed-centre']!.listings).toHaveLength(1);

		// Opted out / reader none: not checked, no run fields, no listings, no request.
		for (const id of ['opted-out', 'none-centre']) {
			expect(centreOf(snapshot, id)).toMatchObject({ coverage: 'not_checked', last_result: null, last_checked_at: null, last_success_at: null });
			expect(calls.some((url) => url.includes(`${id}.example.de`))).toBe(false);
		}

		// Robots skip: not checked, its stored listings excluded (state keeps them).
		expect(centreOf(snapshot, 'robots-centre')).toMatchObject({ coverage: 'not_checked', last_result: null, last_success_at: null });
		expect(listingIds(snapshot, 'robots-centre')).toEqual([]);
		expect(state.centres['robots-centre']).toEqual(STATE.centres['robots-centre']);

		// Budget skip: covered, run fields untouched, only the upcoming listing that is not removed published.
		expect(centreOf(snapshot, 'budget-centre')).toMatchObject({ coverage: 'covered', last_result: 'ok', last_checked_at: EARLIER, last_success_at: EARLIER });
		expect(listingIds(snapshot, 'budget-centre')).toEqual(['budget-centre@2026-11-20T10:00']);
		expect(calls.some((url) => url.includes('budget.example.de'))).toBe(false);

		// Never run: covered with null run fields and no listings.
		expect(centreOf(snapshot, 'never-run')).toMatchObject({ coverage: 'covered', last_result: null, last_checked_at: null, last_success_at: null });
		expect(state.centres['never-run']).toBeUndefined();

		expect(snapshot.systems).toEqual([
			{ reader: 'itemkg', centres_covered: 2, centres_ok: 1, centres_failed: 1, last_success_at: at },
			{ reader: 'kuferweb', centres_covered: 3, centres_ok: 2, centres_failed: 0, last_success_at: at },
		]);
		expect(snapshot.listings.map((l) => l.id)).toEqual([...snapshot.listings.map((l) => l.id)].sort());

		// Visits: this run's hosts appended, the over-budget host not charged again.
		const log = JSON.parse(readFileSync(paths.visitLogPath, 'utf8')) as Visit[];
		const thisRun = log.filter((visit) => visit.at === at).map((visit) => visit.host);
		expect(thisRun).toEqual(expect.arrayContaining(['www.vhs-moosburg.de', 'www.vhs-ebersberger-land.de', 'failed-centre.example.de']));
		expect(thisRun).not.toContain('budget.example.de');
	});

	it('logs one line per centre sorted by centre_id, then a summary, with no page content or URLs', async () => {
		const { logs } = await pipeline(setup());
		const ids = DIRECTORY.map((c) => c.centre_id).sort();
		expect(logs).toHaveLength(ids.length + 1);
		expect(logs.slice(0, ids.length).map((line) => line.split(' ')[0])).toEqual(ids);
		expect(logs).toEqual(
			expect.arrayContaining([
				'moosburg kuferweb ok 2 0ms',
				'ebersberg itemkg ok 1 0ms',
				'failed-centre itemkg failed:list-page 0 0ms',
				'opted-out kuferweb skipped:opted-out 0 0ms',
				'none-centre none skipped:no-reader 0 0ms',
				'robots-centre kuferweb skipped:robots 0 0ms',
				'budget-centre kuferweb skipped:budget 0 0ms',
				'never-run kuferweb skipped:budget 0 0ms',
			]),
		);
		expect(logs.at(-1)).toBe('run 2026-10-29T05:17:00.000Z: 8 centres, 2 ok, 1 failed, 5 skipped; state written; 5 listings, snapshot written');
		for (const line of logs) expect(line).not.toMatch(/https?:|<|example\.de|vhs-/);
	});

	it('logs real per-centre durations from the injected clock', async () => {
		let now = 0;
		const { logs } = await pipeline(setup(), { clock: () => (now += 5) });
		expect(logs.find((line) => line.startsWith('moosburg '))).toMatch(/^moosburg kuferweb ok 2 [1-9]\d*ms$/);
	});

	it('leaves the state and the snapshot unchanged on a rerun with nothing new', async () => {
		const empty: Centre[] = [centre('none-centre', { reader: 'none', reader_config: null })];
		const paths = setup({ directory: empty, state: null, log: null });
		const first = await pipeline(paths);
		expect(first.code).toBe(0);
		expect(existsSync(paths.statePath)).toBe(false);
		expect(existsSync(paths.visitLogPath)).toBe(false);
		const before = tree(paths.dir);
		const second = await pipeline(paths, { now: () => new Date(RUN_AT.getTime() + HOUR) });
		expect(second.code).toBe(0);
		expect(second.logs.at(-1)).toContain('state unchanged; 0 listings, snapshot unchanged');
		expect(tree(paths.dir)).toEqual(before);
	});
});

describe('runPipeline: save and replay', () => {
	it('replays a saved run to the same state, visit log and snapshot, with no fetch', async () => {
		const original = setup();
		const replayFile = join(original.dir, 'tmp', 'collect.json');
		expect((await pipeline(original, { saveCollect: replayFile })).code).toBe(0);

		const saved = JSON.parse(readFileSync(replayFile, 'utf8'));
		expect(Object.keys(saved)).toEqual(['runAt', 'outcomes', 'visits', 'pages']);
		expect(saved.runAt).toBe(RUN_AT.toISOString());
		expect(Object.keys(saved.pages)).toEqual([...Object.keys(saved.pages)].sort());
		expect(readFileSync(replayFile, 'utf8')).not.toContain('<html');

		const replayed = setup();
		const net = fakeNetwork({});
		const { code, logs, errors } = await pipeline(replayed, { fromCollect: replayFile, now: () => new Date('2030-01-01T00:00:00Z') }, net);
		expect(errors).toEqual([]);
		expect(code).toBe(0);
		expect(net.calls).toEqual([]);
		for (const file of ['statePath', 'visitLogPath', 'snapshotPath'] as const) {
			expect(readFileSync(replayed[file], 'utf8')).toBe(readFileSync(original[file], 'utf8'));
		}
		expect(logs).toContain('moosburg kuferweb ok 2 -');
		expect(logs.at(-1)).toMatch(/^run 2026-10-29T05:17:00\.000Z \(replay\): /);
	});

	it('replays on top of a newer state and directory, dropping outcomes of centres no longer listed', async () => {
		const original = setup();
		const replayFile = join(original.dir, 'collect.json');
		await pipeline(original, { saveCollect: replayFile });
		const newer = setup({ directory: DIRECTORY.filter((c) => c.centre_id !== 'ebersberg') });
		const { code } = await pipeline(newer, { fromCollect: replayFile }, fakeNetwork({}));
		expect(code).toBe(0);
		const snapshot = readSnapshot(newer);
		expect(snapshot.centres.some((c) => c.centre_id === 'ebersberg')).toBe(false);
		expect(listingIds(snapshot, 'moosburg')).toHaveLength(2);
		expect(readStateFile(newer).centres.ebersberg).toBeUndefined();
	});

	it('replays with a centre added to the directory since the run: no outcome, logged as -, covered with null run fields', async () => {
		const original = setup();
		const replayFile = join(original.dir, 'collect.json');
		await pipeline(original, { saveCollect: replayFile });
		const newer = setup({ directory: [...DIRECTORY, centre('added')] });
		const net = fakeNetwork({});
		const { code, logs, errors } = await pipeline(newer, { fromCollect: replayFile }, net);
		expect(errors).toEqual([]);
		expect(code).toBe(0);
		expect(net.calls).toEqual([]);
		expect(logs).toContain('added kuferweb - 0 -');
		expect(logs.at(-1)).toMatch(/: 9 centres, 2 ok, 1 failed, 5 skipped;/);
		expect(centreOf(readSnapshot(newer), 'added')).toMatchObject({ coverage: 'covered', last_result: null, last_checked_at: null, last_success_at: null });
		expect(listingIds(readSnapshot(newer), 'added')).toEqual([]);
		expect(readStateFile(newer).centres.added).toBeUndefined();
	});

	it.runIf(process.getuid?.() !== 0)('exits 1 when the replay file cannot be saved, naming it, with the state, visit log and snapshot unchanged', async () => {
		const paths = setup();
		const locked = join(paths.dir, 'locked');
		mkdirSync(locked);
		chmodSync(locked, 0o555);
		const replayFile = join(locked, 'collect.json');
		const before = tree(paths.dir);
		try {
			const { code, errors } = await pipeline(paths, { saveCollect: replayFile });
			expect(code).toBe(1);
			expect(errors.join('\n')).toContain(replayFile);
			expect(tree(paths.dir)).toEqual(before);
			expect(existsSync(paths.snapshotPath)).toBe(false);
		} finally {
			chmodSync(locked, 0o755);
		}
	});

	it.each([
		['not JSON', '{nope'],
		['a wrong shape', JSON.stringify({ runAt: RUN_AT.toISOString(), outcomes: {}, visits: [] })],
		['an unknown skip reason', JSON.stringify({ runAt: RUN_AT.toISOString(), outcomes: { moosburg: { kind: 'skipped', reason: 'tired' } }, visits: [], pages: {} })],
		['an invalid raw listing', JSON.stringify({ runAt: RUN_AT.toISOString(), outcomes: { moosburg: { kind: 'ok', listings: [{ date: 'x' }] } }, visits: [], pages: {} })],
		['an extra key', JSON.stringify({ runAt: RUN_AT.toISOString(), outcomes: {}, visits: [], pages: {}, html: '' })],
	])('exits 1 for a replay file with %s, naming it and writing nothing', async (_name, text) => {
		const paths = setup();
		const replayFile = join(paths.dir, 'bad.json');
		writeFileSync(replayFile, text);
		const before = tree(paths.dir);
		const net = fakeNetwork({});
		const { code, errors } = await pipeline(paths, { fromCollect: replayFile }, net);
		expect(code).toBe(1);
		expect(errors.join('\n')).toContain(replayFile);
		expect(net.calls).toEqual([]);
		expect(tree(paths.dir)).toEqual(before);
	});

	it('exits 1 for a missing replay file', async () => {
		const paths = setup();
		const { code } = await pipeline(paths, { fromCollect: join(paths.dir, 'missing.json') }, fakeNetwork({}));
		expect(code).toBe(1);
		expect(existsSync(paths.snapshotPath)).toBe(false);
	});

	it('refuses --save-collect together with --from-collect', async () => {
		const paths = setup();
		const { code } = await pipeline(paths, { saveCollect: join(paths.dir, 'a.json'), fromCollect: join(paths.dir, 'b.json') });
		expect(code).toBe(1);
		expect(existsSync(paths.snapshotPath)).toBe(false);
	});
});

describe('runPipeline: bad inputs write nothing', () => {
	it.each<[string, Parameters<typeof setup>[0], string]>([
		['a directory that is not JSON', { directory: '{nope' }, 'cannot read the directory'],
		['a directory failing the schema', { directory: JSON.stringify([centre('a', { lat: 52.5, lon: 13.4 })]) }, 'fails the schema'],
		['a duplicate centre id', { directory: JSON.stringify([centre('a'), centre('a')]) }, 'duplicate centre_id'],
		['a state file that is not JSON', { state: '{nope' }, 'not valid JSON'],
		['a state file with another stateVersion', { state: JSON.stringify({ stateVersion: 99, centres: {} }) }, 'stateVersion 99'],
		['a bad visit log', { log: JSON.stringify([{ host: '' }]) }, 'visit log'],
	])('exits 1 for %s, with no fetch and no file written', async (_name, files, message) => {
		const paths = setup(files);
		const before = tree(paths.dir);
		const { code, errors, calls } = await pipeline(paths);
		expect(code).toBe(1);
		expect(errors.join('\n')).toContain(message);
		expect(errors.join('\n')).toContain('nothing written');
		expect(calls).toEqual([]);
		expect(tree(paths.dir)).toEqual(before);
	});

	it.runIf(process.getuid?.() !== 0)('stops before publishing when the state cannot be written, leaving no temp file (visit log first)', async () => {
		const paths = setup({ state: null });
		const stateDir = join(paths.dir, 'locked');
		mkdirSync(stateDir);
		chmodSync(stateDir, 0o555);
		try {
			const { code, errors } = await pipeline({ ...paths, statePath: join(stateDir, 'state.json') });
			expect(code).toBe(1);
			expect(errors.join('\n')).toContain('cannot write the state');
			expect(readdirSync(stateDir)).toEqual([]);
			expect(existsSync(paths.snapshotPath)).toBe(false);
			// The visit log was written before the state, so the budget never under-counts.
			const log = JSON.parse(readFileSync(paths.visitLogPath, 'utf8')) as Visit[];
			expect(log.some((visit) => visit.at === RUN_AT.toISOString())).toBe(true);
		} finally {
			chmodSync(stateDir, 0o755);
		}
	});
});

describe('runPipeline: an invalid snapshot', () => {
	afterEach(() => {
		vi.doUnmock('../pipeline/stages/publish.ts');
		vi.resetModules();
	});

	it('exits 1 and leaves the last good snapshot untouched', async () => {
		const paths = setup();
		expect((await pipeline(paths)).code).toBe(0);
		const good = readFileSync(paths.snapshotPath, 'utf8');

		vi.resetModules();
		vi.doMock('../pipeline/stages/publish.ts', async (importOriginal) => {
			const original = await importOriginal<typeof import('../pipeline/stages/publish.ts')>();
			// A listing of a not_checked centre: the schema's cross-check refuses it.
			return {
				...original,
				buildSnapshot: (input: Parameters<typeof original.buildSnapshot>[0]) => {
					const snapshot = original.buildSnapshot(input);
					const id = snapshot.listings[0]!.centre_id;
					return { ...snapshot, centres: snapshot.centres.map((c) => (c.centre_id === id ? { ...c, coverage: 'not_checked' as const } : c)) };
				},
			};
		});
		const { runPipeline: mocked } = await import('../pipeline/stages/run.ts');
		const errors: string[] = [];
		const net = fakeNetwork();
		const code = await mocked({
			directoryPath: paths.directoryPath,
			statePath: paths.statePath,
			visitLogPath: paths.visitLogPath,
			snapshotPath: paths.snapshotPath,
			now: () => new Date(RUN_AT.getTime() + 6 * HOUR),
			clientOptions: { fetchImpl: net.fetchImpl, delayMs: 0, timeoutMs: 1000, sleep: async () => {} },
			log: () => {},
			error: (line) => errors.push(line),
		});
		expect(code).toBe(1);
		expect(errors.join('\n')).toContain('cannot publish the snapshot');
		expect(readFileSync(paths.snapshotPath, 'utf8')).toBe(good);
		expect(readdirSync(join(paths.dir, 'public'))).toEqual(['snapshot.json']);
	});
});

describe('npm run pipeline (CLI)', () => {
	const RUN = join(REPO, 'pipeline/stages/run.ts');

	it('parses --save-collect and --from-collect, and refuses unknown arguments', () => {
		expect(parseCliArgs([])).toEqual({ saveCollect: undefined, fromCollect: undefined });
		expect(parseCliArgs(['--save-collect', 'a.json'])).toEqual({ saveCollect: 'a.json', fromCollect: undefined });
		expect(parseCliArgs(['--from-collect=b.json'])).toEqual({ saveCollect: undefined, fromCollect: 'b.json' });
		expect(() => parseCliArgs(['--bogus'])).toThrow();
		expect(() => parseCliArgs(['--from-collect'])).toThrow();
		expect(() => parseCliArgs(['stray'])).toThrow();
	});

	it.each([
		['an unknown flag', ['--bogus']],
		['an invalid replay file', ['--from-collect', 'BAD']],
	])('exits 1 for %s, leaving the committed data as it is', (_name, args) => {
		const dir = mkdtempSync(join(tmpdir(), 'bgt-run-cli-'));
		const bad = join(dir, 'bad.json');
		writeFileSync(bad, '{"runAt":"nope"}');
		const dataDirs = ['data/state', 'data/public'].map((d) => join(REPO, d));
		const before = dataDirs.map(tree);
		const result = spawnSync(process.execPath, [RUN, ...args.map((a) => (a === 'BAD' ? bad : a))], { cwd: REPO, encoding: 'utf8' });
		expect(result.status).toBe(1);
		expect(dataDirs.map(tree)).toEqual(before);
	});
});
