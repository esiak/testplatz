import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_SCHEMA_VERSION, snapshotSchema } from '../shared/snapshot.ts';
import { SchemaVersionError } from '../web/src/data/load-json.ts';
import { loadPlaces, PLACES_URL } from '../web/src/data/places.ts';
import { clearReloadFlag, RELOAD_FLAG, reloadOnce } from '../web/src/data/reload-once.ts';
import { loadSnapshot, SNAPSHOT_URL, uncheckedCentres } from '../web/src/data/snapshot.ts';
import { placesOf, smallPlaces } from './fixtures/places.ts';
import { coveredCentre, jsonResponse, snapshotCentre, snapshotOf } from './fixtures/snapshot.ts';

const fetchReturning = (response: Response | Promise<Response>) => vi.fn<typeof fetch>(() => Promise.resolve(response));

describe('loadSnapshot', () => {
	it('fetches the same-origin snapshot and returns it parsed', async () => {
		const snapshot = snapshotOf([snapshotCentre('a')]);
		const fetchImpl = fetchReturning(jsonResponse(snapshot));
		await expect(loadSnapshot(fetchImpl)).resolves.toEqual(snapshot);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledWith(SNAPSHOT_URL);
		expect(SNAPSHOT_URL).toMatch(/^\/(?:[\w-]+\/)*snapshot\.json$/);
	});

	it('rejects a network error', async () => {
		await expect(loadSnapshot(vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline'))))).rejects.toThrow('offline');
	});

	it('rejects a non-2xx response', async () => {
		await expect(loadSnapshot(fetchReturning(jsonResponse(snapshotOf([]), 500)))).rejects.toThrow('HTTP 500');
		await expect(loadSnapshot(fetchReturning(jsonResponse(snapshotOf([]), 404)))).rejects.toThrow('HTTP 404');
	});

	it('rejects invalid JSON', async () => {
		await expect(loadSnapshot(fetchReturning(jsonResponse('{not json')))).rejects.toThrow();
	});

	it('rejects a wrong schemaVersion or shape', async () => {
		await expect(loadSnapshot(fetchReturning(jsonResponse({ ...snapshotOf([]), schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 })))).rejects.toThrow('invalid');
		await expect(loadSnapshot(fetchReturning(jsonResponse({ centres: [] })))).rejects.toThrow('invalid');
	});
});

describe('schemaVersion mismatch', () => {
	it('throws a SchemaVersionError only for a different schemaVersion', async () => {
		const newer = loadSnapshot(fetchReturning(jsonResponse({ ...snapshotOf([]), schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 })));
		await expect(newer).rejects.toBeInstanceOf(SchemaVersionError);
		const shape = loadSnapshot(fetchReturning(jsonResponse({ ...snapshotOf([]), centres: 'nope' })));
		await expect(shape).rejects.not.toBeInstanceOf(SchemaVersionError);
		const missing = loadSnapshot(fetchReturning(jsonResponse({ centres: [] })));
		await expect(missing).rejects.not.toBeInstanceOf(SchemaVersionError);
		await expect(loadSnapshot(fetchReturning(jsonResponse([])))).rejects.not.toBeInstanceOf(SchemaVersionError);
	});
});

describe('loadPlaces', () => {
	it('fetches the same-origin place table and returns it parsed', async () => {
		const places = smallPlaces();
		const fetchImpl = fetchReturning(jsonResponse(places));
		await expect(loadPlaces(fetchImpl)).resolves.toEqual(places);
		expect(fetchImpl).toHaveBeenCalledWith(PLACES_URL);
		expect(PLACES_URL).toMatch(/^\/(?:[\w-]+\/)*places\.json$/);
	});

	it('rejects network errors, non-2xx, bad JSON and schema errors with a plain error', async () => {
		for (const fetchImpl of [
			vi.fn<typeof fetch>(() => Promise.reject(new TypeError('offline'))),
			fetchReturning(jsonResponse(smallPlaces(), 500)),
			fetchReturning(jsonResponse('{not json')),
			fetchReturning(jsonResponse({ ...smallPlaces(), places: [] })),
		]) {
			const result = loadPlaces(fetchImpl);
			await expect(result).rejects.toThrow();
			await expect(result).rejects.not.toBeInstanceOf(SchemaVersionError);
		}
	});

	it('rejects a different schemaVersion with a SchemaVersionError', async () => {
		await expect(loadPlaces(fetchReturning(jsonResponse({ ...placesOf([]), schemaVersion: 1 })))).rejects.toBeInstanceOf(SchemaVersionError);
	});
});

describe('reloadOnce', () => {
	const memoryStorage = (initial: Record<string, string> = {}) => {
		const map = new Map(Object.entries(initial));
		const storage = {
			getItem: (key: string) => map.get(key) ?? null,
			setItem: (key: string, value: string) => void map.set(key, value),
			removeItem: (key: string) => void map.delete(key),
		} as Storage;
		return { map, storage: () => storage };
	};

	it('reloads and sets the flag the first time', () => {
		const { map, storage } = memoryStorage();
		const reload = vi.fn();
		expect(reloadOnce({ storage, reload })).toBe(true);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(map.get(RELOAD_FLAG)).toBe('1');
	});

	it('does not reload when the flag is set or storage throws', () => {
		const reload = vi.fn();
		expect(reloadOnce({ storage: memoryStorage({ [RELOAD_FLAG]: '1' }).storage, reload })).toBe(false);
		const throwing = () => {
			throw new Error('blocked');
		};
		expect(reloadOnce({ storage: throwing, reload })).toBe(false);
		expect(reload).not.toHaveBeenCalled();
	});

	it('clears the flag, and tolerates storage that throws', () => {
		const { map, storage } = memoryStorage({ [RELOAD_FLAG]: '1' });
		clearReloadFlag(storage);
		expect(map.has(RELOAD_FLAG)).toBe(false);
		expect(() =>
			clearReloadFlag(() => {
				throw new Error('blocked');
			}),
		).not.toThrow();
	});
});

describe('uncheckedCentres', () => {
	it('keeps not_checked centres and covered centres whose last check is not ok', () => {
		const snapshot = snapshotOf([
			coveredCentre('ok', 'ok'),
			coveredCentre('failed', 'failed'),
			coveredCentre('never', null),
			snapshotCentre('none'),
			snapshotCentre('opted', { opted_out: true }),
		]);
		expect(uncheckedCentres(snapshot).map((c) => c.centre_id).sort()).toEqual(['failed', 'never', 'none', 'opted']);
	});

	it('sorts by name with German collation', () => {
		const snapshot = snapshotOf([
			snapshotCentre('z', { name: 'Zentrum' }),
			snapshotCentre('oe', { name: 'Ötztal Akademie' }),
			snapshotCentre('a', { name: 'akademie' }),
			snapshotCentre('o', { name: 'Ostbayern' }),
		]);
		expect(uncheckedCentres(snapshot).map((c) => c.name)).toEqual(['akademie', 'Ostbayern', 'Ötztal Akademie', 'Zentrum']);
	});

	it('returns an empty list when every centre is covered and ok', () => {
		expect(uncheckedCentres(snapshotOf([coveredCentre('a', 'ok')]))).toEqual([]);
	});

	it('applies the rule to the committed snapshot and returns the matches sorted', () => {
		const path = fileURLToPath(new URL('../data/public/snapshot.json', import.meta.url));
		const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
		const unchecked = uncheckedCentres(snapshot);
		for (const centre of unchecked) {
			expect(centre.coverage === 'not_checked' || centre.last_result !== 'ok').toBe(true);
		}
		const left = snapshot.centres.filter((c) => !unchecked.includes(c));
		for (const centre of left) {
			expect(centre.coverage).not.toBe('not_checked');
			expect(centre.last_result).toBe('ok');
		}
		const names = unchecked.map((c) => c.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
	});
});
