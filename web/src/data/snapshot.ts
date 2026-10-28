import { SNAPSHOT_SCHEMA_VERSION, snapshotSchema, type Snapshot, type SnapshotCentre } from '../../../shared/snapshot.ts';
import { loadJson } from './load-json.ts';

/** Same-origin URL of the published snapshot. */
export const SNAPSHOT_URL = `${import.meta.env.BASE_URL}snapshot.json`;

/**
 * Fetches and validates `snapshot.json`. Throws on a network error, a non-2xx response,
 * invalid JSON, or a schema mismatch; a `schemaVersion` mismatch throws a `SchemaVersionError`.
 */
export function loadSnapshot(fetchImpl: typeof fetch = fetch): Promise<Snapshot> {
	return loadJson(SNAPSHOT_URL, 'snapshot.json', snapshotSchema, SNAPSHOT_SCHEMA_VERSION, fetchImpl);
}

/** Centres not checked automatically, or whose last check did not succeed, sorted by name (German collation). */
export function uncheckedCentres(snapshot: Snapshot): SnapshotCentre[] {
	return snapshot.centres
		.filter((centre) => centre.coverage === 'not_checked' || centre.last_result !== 'ok')
		.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
