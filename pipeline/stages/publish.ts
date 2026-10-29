/**
 * Publish stage: turns the centre directory, merge's state and this run's outcomes into
 * `data/public/snapshot.json` (AD-1, AD-8, AD-9).
 *
 * The snapshot is validated before it is written, and written atomically (temp file + rename).
 * When the existing file is valid and equal apart from `generated_at`, it is left untouched, so an
 * unchanged run produces no data commit. Publish never writes `data/directory/` or merge's files.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { sortDirectory, type Centre, type Reader as ReaderSystem } from '../../shared/directory.ts';
import { SNAPSHOT_SCHEMA_VERSION, snapshotSchema, type Coverage, type Snapshot, type SnapshotListing, type SnapshotSystem } from '../../shared/snapshot.ts';
import type { State } from '../../shared/state.ts';
import type { NormalisedOutcome } from './normalise.ts';

/** UTC ISO 8601 with `Z`, whole seconds. */
const isoSeconds = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface SnapshotInput {
	/** The directory as read at run start. */
	centres: readonly Centre[];
	/** Merge's state after this run. */
	state: State;
	/** This run's normalised outcome per `centre_id`; a centre without one has none this run. */
	outcomes: Readonly<Record<string, NormalisedOutcome>>;
	/** The reader systems registered for this run. */
	readers: readonly Exclude<ReaderSystem, 'none'>[];
	runAt: Date;
}

/**
 * A centre's coverage: `not_checked` when it is opted out, has reader `none` or a reader that is
 * not registered, or robots.txt kept this run out; otherwise `covered` (a budget skip or a centre
 * with no state yet stays covered).
 */
export function coverageOf(centre: Centre, readers: ReadonlySet<string>, outcome: NormalisedOutcome | undefined): Coverage {
	if (centre.opted_out || centre.reader === 'none' || !readers.has(centre.reader)) return 'not_checked';
	if (outcome?.kind === 'skipped' && outcome.reason === 'robots') return 'not_checked';
	return 'covered';
}

/**
 * The snapshot for this run. Every directory centre appears once, sorted by `centre_id`, with run
 * fields from state when `covered` (null when it has no state yet) and null when `not_checked`.
 * `systems[]` has one entry per registered reader. `listings[]` holds the stored listings of
 * covered centres that are not removed and start after `runAt`, without `removed_at`, by id.
 */
export function buildSnapshot({ centres, state, outcomes, readers, runAt }: SnapshotInput): Snapshot {
	const registered = new Set<string>(readers);
	const now = runAt.getTime();
	const snapshotCentres: Snapshot['centres'] = [];
	const listings: SnapshotListing[] = [];
	const systems = new Map<string, SnapshotSystem>(
		[...registered].sort(compare).map((reader) => [
			reader,
			{ reader: reader as SnapshotSystem['reader'], centres_covered: 0, centres_ok: 0, centres_failed: 0, last_success_at: null },
		]),
	);

	for (const centre of sortDirectory(centres)) {
		const coverage = coverageOf(centre, registered, outcomes[centre.centre_id]);
		const history = coverage === 'covered' ? state.centres[centre.centre_id] : undefined;
		snapshotCentres.push({
			...centre,
			coverage,
			last_result: history?.last_result ?? null,
			last_checked_at: history?.last_checked_at ?? null,
			last_success_at: history?.last_success_at ?? null,
		});
		if (coverage !== 'covered') continue;

		const system = systems.get(centre.reader)!;
		system.centres_covered += 1;
		if (history?.last_result === 'ok') system.centres_ok += 1;
		if (history?.last_result === 'failed') system.centres_failed += 1;
		const success = history?.last_success_at ?? null;
		if (success !== null && (system.last_success_at === null || Date.parse(success) > Date.parse(system.last_success_at))) {
			system.last_success_at = success;
		}
		for (const { removed_at, ...listing } of history?.listings ?? []) {
			if (removed_at === null && Date.parse(listing.starts_at) > now) listings.push(listing);
		}
	}

	return {
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		generated_at: isoSeconds(runAt),
		systems: [...systems.values()],
		centres: snapshotCentres,
		listings: listings.sort((a, b) => compare(a.id, b.id)),
	};
}

/** The file text: minified JSON with a trailing newline. */
export const serializeSnapshot = (snapshot: Snapshot): string => `${JSON.stringify(snapshot)}\n`;

/** Comparable form of a snapshot, ignoring `generated_at`. */
const contentKey = (snapshot: Snapshot): string => JSON.stringify({ ...snapshot, generated_at: '' });

/** The existing snapshot at `path` when it is readable, valid JSON and schema-valid; otherwise null. */
function readExisting(path: string): Snapshot | null {
	if (!existsSync(path)) return null;
	try {
		const result = snapshotSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

/**
 * Validates `snapshot` and writes it atomically to `path`, unless the existing file is valid and
 * equal apart from `generated_at`. Throws (writing nothing) when the snapshot fails the schema.
 */
export function writeSnapshot(snapshot: Snapshot, path: string): 'written' | 'unchanged' {
	const result = snapshotSchema.safeParse(snapshot);
	if (!result.success) throw new Error(`snapshot fails the schema:\n${result.error.message}`);
	const existing = readExisting(path);
	if (existing !== null && contentKey(existing) === contentKey(result.data)) return 'unchanged';

	const dir = dirname(path);
	mkdirSync(dir, { recursive: true });
	const temp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
	try {
		writeFileSync(temp, serializeSnapshot(result.data));
		renameSync(temp, path);
	} catch (caught) {
		rmSync(temp, { force: true });
		throw caught;
	}
	return 'written';
}
