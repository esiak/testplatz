import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * "Only merge writes `data/state/`" (AD-6): a source file that names the state files
 * (`STATE_PATH`, `VISIT_LOG_PATH` or a `data/state` path) and also calls an fs write function must
 * be `pipeline/stages/merge.ts`.
 */

const SCANNED_DIRS = ['pipeline', 'tools', 'shared', 'web'];
const SOURCE_FILE = /\.[mc]?[jt]sx?$/;
const STATE_REFERENCE = /\bSTATE_PATH\b|\bVISIT_LOG_PATH\b|data\/state/;
const FS_WRITE = /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|renameSync|rename|rmSync|rm|unlinkSync|unlink|mkdirSync|mkdir|copyFileSync|copyFile|cpSync|createWriteStream|truncateSync|truncate)\s*\(/;
const ALLOWED_WRITER = 'pipeline/stages/merge.ts';

const stripComments = (source: string): string =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('//'))
		.join('\n');

/** Files that reference the state files and call an fs write function. */
export function stateWriters(files: { path: string; source: string }[]): string[] {
	return files
		.filter(({ source }) => {
			const code = stripComments(source);
			return STATE_REFERENCE.test(code) && FS_WRITE.test(code);
		})
		.map(({ path }) => path)
		.sort();
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function projectFiles(): { path: string; source: string }[] {
	const files: { path: string; source: string }[] = [];
	for (const dir of SCANNED_DIRS) {
		for (const entry of readdirSync(posix.join(repoRoot, dir), { recursive: true, encoding: 'utf8' })) {
			const rel = posix.join(dir, entry.split('\\').join('/'));
			if (!SOURCE_FILE.test(rel) || rel.split('/').includes('node_modules') || rel.split('/').includes('fixtures')) continue;
			files.push({ path: rel, source: readFileSync(posix.join(repoRoot, rel), 'utf8') });
		}
	}
	return files;
}

describe('state writers checker', () => {
	it('flags a file naming a state path with a write call, and ignores reads and comments', () => {
		expect(
			stateWriters([
				{ path: 'tools/x.ts', source: "import { VISIT_LOG_PATH } from '../pipeline/fetch/visits.ts';\nwriteFileSync(VISIT_LOG_PATH, '[]');" },
				{ path: 'pipeline/stages/y.ts', source: "const p = 'data/state/state.json';\nrenameSync(t, p);" },
				{ path: 'pipeline/fetch/visits.ts', source: "const p = 'data/state/visits.json';\nreadFileSync(p, 'utf8');" },
				{ path: 'pipeline/stages/z.ts', source: "// writeFileSync(STATE_PATH, '')\nconsole.log(STATE_PATH);" },
				{ path: 'pipeline/stages/publish.ts', source: "writeFileSync(SNAPSHOT_PATH, '');" },
			]),
		).toEqual(['pipeline/stages/y.ts', 'tools/x.ts']);
	});
});

describe('state writers in this repository', () => {
	it('only pipeline/stages/merge.ts writes data/state/', () => {
		expect(stateWriters(projectFiles())).toEqual([ALLOWED_WRITER]);
	});
});
