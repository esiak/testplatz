import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSnapshot, runPublish, serializeSnapshot, writeSnapshot } from '../pipeline/stages/publish.ts';
import { SNAPSHOT_PATH } from '../pipeline/stages/paths.ts';
import { type Centre } from '../shared/directory.ts';
import { snapshotSchema, type Snapshot } from '../shared/snapshot.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'bgt-snapshot-'));
const RUN_1 = new Date('2026-10-27T07:00:00.000Z');
const RUN_2 = new Date('2026-10-28T07:00:00.000Z');

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

const DIRECTORY: Centre[] = [
	centre('zeta'),
	centre('alpha', { reader: 'kuferweb', reader_config: { list_url: 'https://example.de/kurse' }, opted_out: true }),
	centre('mid', { lat: null, lon: null, verified_at: null }),
];

/** A temp directory holding `centres.json` (raw text or entries) and the snapshot path. */
function setup(directory: Centre[] | string = DIRECTORY): { dir: string; directoryPath: string; snapshotPath: string } {
	const dir = tmp();
	const directoryPath = join(dir, 'centres.json');
	writeFileSync(directoryPath, typeof directory === 'string' ? directory : JSON.stringify(directory));
	return { dir, directoryPath, snapshotPath: join(dir, 'public', 'snapshot.json') };
}

function publish(paths: { directoryPath: string; snapshotPath: string }, runAt = RUN_1) {
	const logs: string[] = [];
	const errors: string[] = [];
	const code = runPublish({
		...paths,
		now: () => runAt,
		log: (line) => logs.push(line),
		error: (line) => errors.push(line),
	});
	return { code, logs, errors };
}

const valid = (): Snapshot => buildSnapshot(DIRECTORY, RUN_1);

describe('snapshotSchema', () => {
	it('accepts a built snapshot', () => {
		expect(snapshotSchema.safeParse(valid()).success).toBe(true);
	});

	it('accepts a covered centre with a reader that is not opted out, and a system entry', () => {
		const snapshot = valid();
		snapshot.centres[1] = { ...snapshot.centres[1]!, reader: 'itemkg', reader_config: { list_url: 'https://x.de/' }, coverage: 'covered', last_result: 'ok', last_checked_at: '2026-10-27T07:00:00Z', last_success_at: '2026-10-27T07:00:00Z' };
		snapshot.systems = [{ reader: 'itemkg', centres_covered: 1, centres_ok: 1, centres_failed: 0, last_success_at: '2026-10-27T07:00:00Z' }];
		expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
	});

	const rejects: [string, (s: Snapshot) => unknown][] = [
		['another schemaVersion', (s) => ({ ...s, schemaVersion: 2 })],
		['an extra top-level key', (s) => ({ ...s, extra: true })],
		['an extra centre key', (s) => ({ ...s, centres: [{ ...s.centres[0], extra: 1 }] })],
		['a listing', (s) => ({ ...s, listings: [{ centre_id: 'alpha' }] })],
		['covered + opted out', (s) => ({ ...s, centres: [{ ...s.centres[0], coverage: 'covered' }] })],
		['covered + reader none', (s) => ({ ...s, centres: [{ ...s.centres[1], coverage: 'covered' }] })],
		['a duplicate centre_id', (s) => ({ ...s, centres: [s.centres[0], s.centres[0]] })],
		['a non-Z generated_at', (s) => ({ ...s, generated_at: '2026-10-27T09:00:00+02:00' })],
		['a non-Z last_checked_at', (s) => ({ ...s, centres: [{ ...s.centres[0], last_checked_at: '2026-10-27T09:00:00+02:00' }] })],
		['an unknown coverage code', (s) => ({ ...s, centres: [{ ...s.centres[0], coverage: 'unknown' }] })],
		['an unknown last_result code', (s) => ({ ...s, centres: [{ ...s.centres[0], last_result: 'unknown' }] })],
		['an omitted run field', (s) => ({ ...s, centres: [{ ...s.centres[0], last_success_at: undefined }] })],
		['a half coordinate pair', (s) => ({ ...s, centres: [{ ...s.centres[0], lat: null }] })],
		['coordinates outside Bavaria', (s) => ({ ...s, centres: [{ ...s.centres[0], lat: 52.5, lon: 13.4 }] })],
		['reader_config with reader none', (s) => ({ ...s, centres: [{ ...s.centres[1], reader_config: { list_url: 'https://x.de/' } }] })],
		['a system for reader none', (s) => ({ ...s, systems: [{ reader: 'none', centres_covered: 0, centres_ok: 0, centres_failed: 0, last_success_at: null }] })],
	];

	it.each(rejects)('rejects %s', (_name, mutate) => {
		expect(snapshotSchema.safeParse(mutate(valid())).success).toBe(false);
	});
});

describe('buildSnapshot', () => {
	it('lists every centre once, sorted, not_checked with null run fields, after the directory fields', () => {
		const snapshot = buildSnapshot(DIRECTORY, RUN_1);
		expect(snapshot.schemaVersion).toBe(1);
		expect(snapshot.generated_at).toBe('2026-10-27T07:00:00Z');
		expect(snapshot.systems).toEqual([]);
		expect(snapshot.listings).toEqual([]);
		expect(snapshot.centres.map((c) => c.centre_id)).toEqual(['alpha', 'mid', 'zeta']);
		for (const c of snapshot.centres) {
			expect(c).toMatchObject({ coverage: 'not_checked', last_result: null, last_checked_at: null, last_success_at: null });
			expect(Object.keys(c).slice(-4)).toEqual(['coverage', 'last_result', 'last_checked_at', 'last_success_at']);
		}
	});
});

describe('runPublish', () => {
	it('publishes a valid minified snapshot with a trailing newline (normal run)', () => {
		const paths = setup();
		const { code, errors } = publish(paths);
		expect(code).toBe(0);
		expect(errors).toEqual([]);
		const text = readFileSync(paths.snapshotPath, 'utf8');
		expect(text).toBe(serializeSnapshot(buildSnapshot(DIRECTORY, RUN_1)));
		expect(text.endsWith('}\n')).toBe(true);
		expect(text).not.toContain('\n\t');
		const snapshot = snapshotSchema.parse(JSON.parse(text));
		expect(snapshot.centres).toHaveLength(3);
	});

	it('publishes an opted-out centre once as not_checked', () => {
		const paths = setup();
		const { code, errors } = publish(paths);
		expect(code).toBe(0);
		expect(errors).toEqual([]);
		const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(paths.snapshotPath, 'utf8')));
		const optedOut = snapshot.centres.filter((c) => c.centre_id === 'alpha');
		expect(optedOut).toHaveLength(1);
		expect(optedOut[0]).toMatchObject({ opted_out: true, reader: 'kuferweb', coverage: 'not_checked' });
	});

	it('publishes an ungeocoded centre with null coordinates', () => {
		const paths = setup();
		const { code, errors } = publish(paths);
		expect(code).toBe(0);
		expect(errors).toEqual([]);
		const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(paths.snapshotPath, 'utf8')));
		expect(snapshot.centres.find((c) => c.centre_id === 'mid')).toMatchObject({ lat: null, lon: null });
	});

	it('leaves the file byte-identical on an unchanged rerun', () => {
		const paths = setup();
		publish(paths, RUN_1);
		const before = readFileSync(paths.snapshotPath, 'utf8');
		const { code, logs } = publish(paths, RUN_2);
		expect(code).toBe(0);
		expect(readFileSync(paths.snapshotPath, 'utf8')).toBe(before);
		expect(logs.join('\n')).toContain('unchanged');
	});

	it('rewrites the file with a new generated_at when the directory changed', () => {
		const paths = setup();
		publish(paths, RUN_1);
		writeFileSync(paths.directoryPath, JSON.stringify([...DIRECTORY.slice(1), centre('zeta', { name: 'Renamed' })]));
		expect(publish(paths, RUN_2).code).toBe(0);
		const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(paths.snapshotPath, 'utf8')));
		expect(snapshot.generated_at).toBe('2026-10-28T07:00:00Z');
		expect(snapshot.centres.find((c) => c.centre_id === 'zeta')?.name).toBe('Renamed');
	});

	it.each([
		['not JSON', '{nope', 'cannot read the directory'],
		['a schema error', JSON.stringify([centre('alpha', { lat: 52.5, lon: 13.4 })]), 'fails the schema'],
		['a duplicate id', JSON.stringify([centre('alpha'), centre('alpha')]), 'duplicate centre_id'],
	])('writes nothing and exits 1 for an invalid directory (%s)', (_name, text, message) => {
		const paths = setup(text);
		const { code, errors } = publish(paths);
		expect(code).toBe(1);
		expect(errors.join('\n')).toContain(message);
		expect(existsSync(paths.snapshotPath)).toBe(false);
	});

	it('leaves an existing snapshot untouched when the directory is invalid', () => {
		const paths = setup();
		publish(paths);
		const before = readFileSync(paths.snapshotPath, 'utf8');
		writeFileSync(paths.directoryPath, '[{"centre_id":"x"}]');
		expect(publish(paths, RUN_2).code).toBe(1);
		expect(readFileSync(paths.snapshotPath, 'utf8')).toBe(before);
	});

	it('exits 1 when the directory file is missing', () => {
		const dir = tmp();
		const { code, errors } = publish({ directoryPath: join(dir, 'missing.json'), snapshotPath: join(dir, 's.json') });
		expect(code).toBe(1);
		expect(errors).toHaveLength(1);
	});

	it('overwrites a corrupt existing snapshot', () => {
		const paths = setup();
		publish(paths);
		writeFileSync(paths.snapshotPath, '{corrupt');
		expect(publish(paths, RUN_2).code).toBe(0);
		const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(paths.snapshotPath, 'utf8')));
		expect(snapshot.generated_at).toBe('2026-10-28T07:00:00Z');
	});
});

describe('writeSnapshot', () => {
	it.each<[string, (s: Snapshot) => Snapshot]>([
		['covered + opted out', (s) => ({ ...s, centres: s.centres.map((c) => (c.opted_out ? { ...c, coverage: 'covered' } : c)) })],
		['a listing', (s) => ({ ...s, listings: [{ centre_id: 'alpha' }] })],
	])('throws and writes nothing for an invalid snapshot (%s)', (_name, mutate) => {
		const dir = tmp();
		const path = join(dir, 'snapshot.json');
		expect(() => writeSnapshot(mutate(valid()), path)).toThrow(/fails the schema/);
		expect(readdirSync(dir)).toEqual([]);
	});

	it('leaves no temp file behind after an atomic write', () => {
		const dir = tmp();
		const path = join(dir, 'snapshot.json');
		expect(writeSnapshot(valid(), path)).toBe('written');
		expect(writeSnapshot(buildSnapshot(DIRECTORY, RUN_2), path)).toBe('unchanged');
		expect(readdirSync(dir)).toEqual(['snapshot.json']);
	});
});

describe('committed data/public/snapshot.json', () => {
	// Validity and the Epic 1 shape only. It must not compare centre_ids with the directory:
	// `npm test` runs before `npm run pipeline` in pipeline.yml, and the pipeline is what
	// reconciles a changed directory with the committed snapshot.
	it('is valid and holds only not_checked centres with null run fields', () => {
		const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')));
		expect(snapshot.centres.length).toBeGreaterThan(0);
		for (const centre of snapshot.centres) {
			expect(centre).toMatchObject({ coverage: 'not_checked', last_result: null, last_checked_at: null, last_success_at: null });
		}
		expect(snapshot.systems).toEqual([]);
		expect(snapshot.listings).toEqual([]);
	});
});
