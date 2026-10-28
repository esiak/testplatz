import { SNAPSHOT_SCHEMA_VERSION, type Snapshot, type SnapshotCentre } from '../../shared/snapshot.ts';

/** A valid snapshot centre; `extra` overrides any field. */
export function snapshotCentre(id: string, extra: Partial<SnapshotCentre> = {}): SnapshotCentre {
	return {
		centre_id: id,
		name: `Centre ${id}`,
		address: { street: 'Hauptstraße 1', postcode: '80331', city: 'München' },
		lat: 48.137,
		lon: 11.575,
		website: `https://${id}.example.de/`,
		test_page_url: `https://${id}.example.de/test`,
		reader: 'none',
		reader_config: null,
		opted_out: false,
		source: 'rtpartner',
		verified_at: null,
		coverage: 'not_checked',
		last_result: null,
		last_checked_at: null,
		last_success_at: null,
		...extra,
	};
}

/** A covered centre (KuferWeb) with the given last result. */
export function coveredCentre(id: string, lastResult: SnapshotCentre['last_result'], extra: Partial<SnapshotCentre> = {}): SnapshotCentre {
	return snapshotCentre(id, {
		reader: 'kuferweb',
		reader_config: { list_url: `https://${id}.example.de/kurse` },
		coverage: 'covered',
		last_result: lastResult,
		last_checked_at: lastResult ? '2026-10-28T06:00:00Z' : null,
		last_success_at: lastResult === 'ok' ? '2026-10-28T06:00:00Z' : null,
		...extra,
	});
}

export function snapshotOf(centres: SnapshotCentre[]): Snapshot {
	return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, generated_at: '2026-10-28T06:00:00Z', systems: [], centres, listings: [] };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
