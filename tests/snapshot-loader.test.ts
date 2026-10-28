import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { snapshotSchema } from '../shared/snapshot.ts';
import { loadSnapshot, SNAPSHOT_URL, uncheckedCentres } from '../web/src/data/snapshot.ts';
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
		await expect(loadSnapshot(fetchReturning(jsonResponse({ ...snapshotOf([]), schemaVersion: 2 })))).rejects.toThrow('invalid');
		await expect(loadSnapshot(fetchReturning(jsonResponse({ centres: [] })))).rejects.toThrow('invalid');
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
