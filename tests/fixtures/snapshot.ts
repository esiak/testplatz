import { SNAPSHOT_SCHEMA_VERSION, type Snapshot, type SnapshotCentre, type SnapshotListing } from '../../shared/snapshot.ts';

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

/** A valid snapshot listing of `centreId` at `startsAt` (`YYYY-MM-DDTHH:mm:00+0X:00`); `extra` overrides any field. */
export function snapshotListing(centreId: string, startsAt: string, extra: Partial<SnapshotListing> = {}): SnapshotListing {
	return {
		id: `${centreId}@${startsAt.slice(0, 16)}`,
		centre_id: centreId,
		starts_at: startsAt,
		place: null,
		address: 'Hauptstraße 1, 80331 München',
		status: 'free',
		deadline: null,
		registration_method: null,
		source_url: `https://${centreId}.example.de/kurse/${startsAt.slice(0, 10)}`,
		link_ok: true,
		eligibility: null,
		lat: 48.137,
		lon: 11.575,
		location: 'venue',
		first_seen_at: '2026-10-28T06:00:00Z',
		baseline: true,
		...extra,
	};
}

/** Listings are sorted by id, as published. */
export function snapshotOf(centres: SnapshotCentre[], listings: SnapshotListing[] = []): Snapshot {
	const sorted = [...listings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return { schemaVersion: SNAPSHOT_SCHEMA_VERSION, generated_at: '2026-10-28T06:00:00Z', systems: [], centres, listings: sorted };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
