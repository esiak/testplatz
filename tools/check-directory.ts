/**
 * Validates data/directory/centres.json against the directory schema and its canonical form (CI step).
 *
 *   node tools/check-directory.ts [path]
 *
 * Prints `<n> centres OK`, or one line per issue (entry index, field, centre_id) and exits 1.
 */
import { readFileSync } from 'node:fs';
import { directorySchema, serializeDirectory, sortDirectory } from '../shared/directory.ts';
import { CENTRES_PATH } from './paths.ts';

type Issue = NonNullable<ReturnType<typeof directorySchema.safeParse>['error']>['issues'][number];

export interface CheckResult {
	ok: boolean;
	lines: string[];
}

function describeIssue(issue: Issue, data: unknown): string {
	const [index, ...rest] = issue.path;
	if (typeof index !== 'number') return `${issue.path.join('.') || 'file'}: ${issue.message}`;
	const entry = Array.isArray(data) ? (data[index] as { centre_id?: unknown } | undefined) : undefined;
	const id = typeof entry?.centre_id === 'string' ? entry.centre_id : '?';
	const keys = issue.code === 'unrecognized_keys' ? issue.keys : [];
	const field = rest.length > 0 ? rest.join('.') : keys.length > 0 ? keys.join(', ') : '(entry)';
	return `entry ${index} (${id}) ${field}: ${issue.message}`;
}

/** Checks the directory file text: valid JSON, schema-valid, canonical form. */
export function checkDirectoryText(text: string): CheckResult {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		return { ok: false, lines: [`not valid JSON: ${(error as Error).message}`] };
	}
	const result = directorySchema.safeParse(data);
	if (!result.success) return { ok: false, lines: result.error.issues.map((issue) => describeIssue(issue, data)) };
	const ids = result.data.map((c) => c.centre_id);
	const sorted = sortDirectory(result.data).map((c) => c.centre_id);
	const misplaced = ids.findIndex((id, i) => id !== sorted[i]);
	if (misplaced >= 0) {
		return { ok: false, lines: [`entry ${misplaced} (${ids[misplaced]}) centre_id: entries must be sorted by centre_id`] };
	}
	if (text !== serializeDirectory(result.data)) {
		return {
			ok: false,
			lines: ['file: not in canonical form (JSON with tab indentation and one trailing newline); rewrite it with serializeDirectory'],
		};
	}
	return { ok: true, lines: [`${result.data.length} centres OK`] };
}

if (import.meta.main) {
	const path = process.argv[2] ?? CENTRES_PATH;
	let text: string | null = null;
	try {
		text = readFileSync(path, 'utf8');
	} catch (caught) {
		console.error(`cannot read ${path}: ${(caught as Error).message}`);
	}
	const result: CheckResult = text === null ? { ok: false, lines: [] } : checkDirectoryText(text);
	for (const line of result.lines) (result.ok ? console.log : console.error)(line);
	process.exitCode = result.ok ? 0 : 1;
}
