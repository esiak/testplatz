/**
 * Publish stage: turns the centre directory into `data/public/snapshot.json` (AD-1, AD-9).
 *
 * The snapshot is validated before it is written, and written atomically (temp file + rename).
 * When the existing file is valid and equal apart from `generated_at`, it is left untouched, so an
 * unchanged directory produces no data commit. Publish never writes `data/directory/`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { directorySchema, sortDirectory, type Centre } from '../../shared/directory.ts';
import { SNAPSHOT_SCHEMA_VERSION, snapshotSchema, type Snapshot } from '../../shared/snapshot.ts';
import { DIRECTORY_PATH, SNAPSHOT_PATH } from './paths.ts';

/** UTC ISO 8601 with `Z`, whole seconds. */
const isoSeconds = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The snapshot for a directory at `runAt`. Every centre appears once, sorted by `centre_id`.
 * No readers exist yet, so every centre is `not_checked` with null run fields.
 */
export function buildSnapshot(centres: readonly Centre[], runAt: Date): Snapshot {
	return {
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		generated_at: isoSeconds(runAt),
		systems: [],
		centres: sortDirectory(centres).map((centre) => ({
			...centre,
			coverage: 'not_checked',
			last_result: null,
			last_checked_at: null,
			last_success_at: null,
		})),
		listings: [],
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

export interface PublishOptions {
	directoryPath?: string;
	snapshotPath?: string;
	now?: () => Date;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

/** Reads and validates the directory, then publishes the snapshot. Returns the exit code. */
export function runPublish(options: PublishOptions = {}): number {
	const {
		directoryPath = DIRECTORY_PATH,
		snapshotPath = SNAPSHOT_PATH,
		now = () => new Date(),
		log = console.log,
		error = console.error,
	} = options;

	let data: unknown;
	try {
		data = JSON.parse(readFileSync(directoryPath, 'utf8'));
	} catch (caught) {
		error(`cannot read the directory ${directoryPath}, nothing written: ${(caught as Error).message}`);
		return 1;
	}
	const directory = directorySchema.safeParse(data);
	if (!directory.success) {
		error(`the directory ${directoryPath} fails the schema, nothing written:\n${directory.error.message}`);
		return 1;
	}

	try {
		const snapshot = buildSnapshot(directory.data, now());
		const outcome = writeSnapshot(snapshot, snapshotPath);
		log(
			outcome === 'written'
				? `${snapshot.centres.length} centres published to ${snapshotPath}`
				: `${snapshot.centres.length} centres; ${snapshotPath} unchanged, left as it is`,
		);
		return 0;
	} catch (caught) {
		error(`cannot publish the snapshot, nothing written: ${(caught as Error).message}`);
		return 1;
	}
}
