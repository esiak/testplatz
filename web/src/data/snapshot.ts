import { snapshotSchema, type Snapshot, type SnapshotCentre } from '../../../shared/snapshot.ts';

/** Same-origin URL of the published snapshot. */
export const SNAPSHOT_URL = `${import.meta.env.BASE_URL}snapshot.json`;

/**
 * Fetches and validates `snapshot.json`. Throws on a network error, a non-2xx response,
 * invalid JSON, or a schema (including `schemaVersion`) mismatch.
 */
export async function loadSnapshot(fetchImpl: typeof fetch = fetch): Promise<Snapshot> {
	const response = await fetchImpl(SNAPSHOT_URL);
	if (!response.ok) throw new Error(`snapshot.json: HTTP ${response.status}`);
	const json: unknown = await response.json();
	const parsed = snapshotSchema.safeParse(json);
	if (!parsed.success) throw new Error(`snapshot.json: invalid (${parsed.error.issues.length} issues)`);
	return parsed.data;
}

/** Centres not checked automatically, or whose last check did not succeed, sorted by name (German collation). */
export function uncheckedCentres(snapshot: Snapshot): SnapshotCentre[] {
	return snapshot.centres
		.filter((centre) => centre.coverage === 'not_checked' || centre.last_result !== 'ok')
		.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
