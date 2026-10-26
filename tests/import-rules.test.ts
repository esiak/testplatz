import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Import rules from the architecture spine (§Invariants & Rules): "Arrows are the only allowed
 * imports." The arrow graph is enforced as an allowlist:
 *   web → shared
 *   pipeline/stages → shared, pipeline/readers, pipeline/fetch
 *   pipeline/readers → shared
 *   pipeline/fetch → shared
 *   tools → pipeline/fetch, shared
 *   shared → (nothing)
 * Imports within the same layer are allowed. `pipeline/config.ts` is a pipeline-root module that
 * stages, fetch and tools may import; it may itself import shared and the root package.json.
 * No project code may import the `typescript` package.
 */

export interface SourceFile {
	/** Repo-relative POSIX path, e.g. `pipeline/readers/kuferweb/index.ts`. */
	path: string;
	source: string;
}

export interface Violation {
	file: string;
	specifier: string;
	rule: string;
}

type Layer =
	| 'web'
	| 'shared'
	| 'tools'
	| 'pipeline/fetch'
	| 'pipeline/readers'
	| 'pipeline/stages'
	| 'pipeline/config.ts'
	| 'package.json';

type SourceLayer = Exclude<Layer, 'package.json'>;

/** Layers each layer may import besides itself: the spine's arrows. */
const ALLOWED: Record<SourceLayer, readonly Layer[]> = {
	web: ['shared'],
	shared: [],
	'pipeline/readers': ['shared'],
	'pipeline/fetch': ['shared', 'pipeline/config.ts'],
	'pipeline/stages': ['shared', 'pipeline/readers', 'pipeline/fetch', 'pipeline/config.ts'],
	tools: ['pipeline/fetch', 'shared', 'pipeline/config.ts'],
	'pipeline/config.ts': ['shared', 'package.json'],
};

const SCANNED_DIRS = ['shared', 'pipeline', 'web', 'tools'];
const SOURCE_FILE = /\.[mc]?[jt]sx?$/;
const PROJECT_TOP_DIRS = new Set(['shared', 'pipeline', 'web', 'tools', 'data', 'tests']);

const SPECIFIER_PATTERNS = [
	// import x from '…' / import { a } from '…' / import type … from '…' / import '…'
	/\bimport\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
	// export … from '…'
	/\bexport\s+(?:type\s+)?[\w$*{}\s,]*?\s*from\s+['"]([^'"]+)['"]/g,
	// import('…')
	/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('//'))
		.join('\n');
}

export function extractSpecifiers(source: string): string[] {
	const code = stripComments(source);
	const found = new Set<string>();
	for (const pattern of SPECIFIER_PATTERNS) {
		for (const match of code.matchAll(pattern)) found.add(match[1]!);
	}
	return [...found];
}

type Resolved = { kind: 'project'; path: string } | { kind: 'package'; name: string };

/** Resolves a specifier to a repo-relative project path, or to a package name. */
export function resolveSpecifier(fromFile: string, specifier: string): Resolved {
	if (specifier.startsWith('.')) {
		return { kind: 'project', path: posix.normalize(posix.join(posix.dirname(fromFile), specifier)) };
	}
	if (specifier.startsWith('/')) {
		return { kind: 'project', path: posix.normalize(specifier.slice(1)) };
	}
	const parts = specifier.split('/');
	if (PROJECT_TOP_DIRS.has(parts[0]!)) {
		return { kind: 'project', path: posix.normalize(specifier) };
	}
	const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
	return { kind: 'package', name };
}

const isUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

/** The spine layer a repo-relative path belongs to, or null when it is in none. */
export function layerOf(path: string): Layer | null {
	if (path === 'package.json') return 'package.json';
	if (path === 'pipeline/config' || /^pipeline\/config\.[mc]?[jt]sx?$/.test(path)) return 'pipeline/config.ts';
	for (const layer of ['pipeline/fetch', 'pipeline/readers', 'pipeline/stages', 'web', 'shared', 'tools'] as const) {
		if (isUnder(path, layer)) return layer;
	}
	return null;
}

/** The rule a forbidden import breaks, worded as the spine's named rule where one applies. */
function ruleFor(from: Layer | null, to: Layer | null, toPath: string): string {
	if (from === 'pipeline/readers' && (to === 'pipeline/fetch' || to === 'pipeline/stages')) {
		return 'pipeline/readers must not import pipeline/fetch or pipeline/stages';
	}
	if (from === 'web' && (isUnder(toPath, 'pipeline') || isUnder(toPath, 'tools'))) {
		return 'web must not import pipeline or tools';
	}
	if (from === null || from === 'package.json') {
		return 'file is outside every spine layer, so it may not import project code';
	}
	const allowed = ALLOWED[from].join(', ') || 'nothing outside its own layer';
	return `${from} may only import ${allowed} (arrows are the only allowed imports)`;
}

const isAllowed = (from: Layer | null, to: Layer | null): boolean =>
	from !== null && from !== 'package.json' && to !== null && (to === from || ALLOWED[from].includes(to));

export function checkImports(files: SourceFile[]): Violation[] {
	const violations: Violation[] = [];
	for (const file of files) {
		const from = layerOf(file.path);
		for (const specifier of extractSpecifiers(file.source)) {
			const target = resolveSpecifier(file.path, specifier);
			const flag = (rule: string) => violations.push({ file: file.path, specifier, rule });

			if (target.kind === 'package') {
				if (target.name === 'typescript') flag('no project code may import "typescript"');
				continue;
			}
			const to = layerOf(target.path);
			if (!isAllowed(from, to)) flag(ruleFor(from, to, target.path));
		}
	}
	return violations;
}

const formatViolations = (violations: Violation[]): string =>
	violations.map((v) => `${v.file}: imports '${v.specifier}' (${v.rule})`).join('\n');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function collectProjectFiles(): SourceFile[] {
	const files: SourceFile[] = [];
	for (const dir of SCANNED_DIRS) {
		let entries: string[];
		try {
			entries = readdirSync(posix.join(repoRoot, dir), { recursive: true, encoding: 'utf8' });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const rel = posix.join(dir, entry.split('\\').join('/'));
			if (!SOURCE_FILE.test(rel) || rel.split('/').includes('node_modules')) continue;
			files.push({ path: rel, source: readFileSync(posix.join(repoRoot, rel), 'utf8') });
		}
	}
	return files;
}

describe('import rules checker', () => {
	it('accepts every arrow in the spine graph and same-layer imports', () => {
		const files: SourceFile[] = [
			{ path: 'web/src/app.tsx', source: "import { x } from '../../shared/codes.ts';\nimport { h } from 'preact';\nimport './other.ts';" },
			{
				path: 'pipeline/stages/publish.ts',
				source:
					"import { get } from '../fetch/index.ts';\nimport r from '../readers/kuferweb/index.ts';\nimport { s } from '../../shared/schemas.ts';\nimport { USER_AGENT } from '../config.ts';\nimport { m } from './merge.ts';",
			},
			{ path: 'pipeline/readers/kuferweb/index.ts', source: "import { load } from 'cheerio';\nimport { s } from '../../../shared/schemas.ts';\nimport { p } from '../shared-parse.ts';" },
			{ path: 'pipeline/fetch/index.ts', source: "import { USER_AGENT } from '../config.ts';\nimport { s } from '../../shared/x.ts';" },
			{ path: 'pipeline/config.ts', source: "import pkg from '../package.json' with { type: 'json' };" },
			{ path: 'tools/geocode.ts', source: "import { get } from '../pipeline/fetch/index.ts';\nimport { h } from '../shared/haversine.ts';\nimport { USER_AGENT } from '../pipeline/config.ts';" },
			{ path: 'shared/schemas.ts', source: "import { z } from 'zod';\nimport { c } from './codes.ts';" },
		];
		expect(checkImports(files)).toEqual([]);
	});

	it('flags a reader importing fetch and names the file, import and rule', () => {
		const violations = checkImports([
			{ path: 'pipeline/readers/x/index.ts', source: "import { get } from '../../fetch/client.ts';" },
		]);
		expect(violations).toHaveLength(1);
		expect(formatViolations(violations)).toBe(
			"pipeline/readers/x/index.ts: imports '../../fetch/client.ts' (pipeline/readers must not import pipeline/fetch or pipeline/stages)",
		);
	});

	it('flags a reader importing stages or pipeline/config, including via export-from and dynamic import', () => {
		const violations = checkImports([
			{
				path: 'pipeline/readers/x/index.ts',
				source:
					"export { merge } from '../../stages/merge.ts';\nconst m = await import('../../stages/publish.ts');\nimport { USER_AGENT } from '../../config.ts';",
			},
		]);
		expect(violations.map((v) => v.specifier)).toEqual(['../../config.ts', '../../stages/merge.ts', '../../stages/publish.ts']);
	});

	it('flags any web file importing pipeline or tools', () => {
		const violations = checkImports([
			{ path: 'web/src/app.tsx', source: "import { USER_AGENT } from '../../pipeline/config.ts';" },
			{ path: 'web/src/deep/x.ts', source: "import type { T } from '../../../tools/geocode.ts';" },
			{ path: 'web/src/y.ts', source: "import { z } from 'pipeline/stages/publish.ts';" },
			{ path: 'web/scripts/z.mjs', source: "import { g } from '/tools/geocode.ts';" },
		]);
		expect(violations.map((v) => v.file)).toEqual(['web/src/app.tsx', 'web/src/deep/x.ts', 'web/src/y.ts', 'web/scripts/z.mjs']);
		expect(violations.every((v) => v.rule === 'web must not import pipeline or tools')).toBe(true);
	});

	it('flags shared importing pipeline', () => {
		const violations = checkImports([{ path: 'shared/codes.ts', source: "import { USER_AGENT } from '../pipeline/config.ts';" }]);
		expect(violations).toHaveLength(1);
		expect(violations[0]!.rule).toContain('shared may only import nothing outside its own layer');
	});

	it('flags tools importing pipeline/stages', () => {
		const violations = checkImports([{ path: 'tools/x.ts', source: "import { publish } from '../pipeline/stages/publish.ts';" }]);
		expect(violations).toHaveLength(1);
		expect(violations[0]!.rule).toContain('tools may only import pipeline/fetch, shared');
	});

	it('flags imports of files outside every layer', () => {
		const violations = checkImports([
			{ path: 'pipeline/fetch/x.ts', source: "import d from '../../data/directory/centres.json';" },
			{ path: 'pipeline/other.ts', source: "import { s } from '../shared/x.ts';" },
		]);
		expect(violations.map((v) => v.file)).toEqual(['pipeline/fetch/x.ts', 'pipeline/other.ts']);
	});

	it('flags any import of the typescript package', () => {
		const violations = checkImports([
			{ path: 'tools/x.ts', source: "import ts from 'typescript';" },
			{ path: 'shared/y.ts', source: "import * as ts from 'typescript/lib/typescript.js';" },
			{ path: 'pipeline/stages/z.ts', source: "const ts = await import('typescript');" },
			{ path: 'web/src/w.tsx', source: "export type { Node } from 'typescript';" },
		]);
		expect(violations).toHaveLength(4);
		expect(violations.every((v) => v.rule === 'no project code may import "typescript"')).toBe(true);
	});

	it('ignores commented-out imports and lookalike packages', () => {
		const violations = checkImports([
			{
				path: 'pipeline/readers/x/index.ts',
				source: "// import { get } from '../../fetch/client.ts';\n/* import ts from 'typescript'; */\nimport x from 'typescript-eslint-free';",
			},
		]);
		expect(violations).toEqual([]);
	});
});

describe('import rules in this repository', () => {
	it('scans the project sources', () => {
		const paths = collectProjectFiles().map((f) => f.path);
		expect(paths).toContain('web/src/app.tsx');
		expect(paths).toContain('pipeline/config.ts');
	});

	it('has no import-rule violations', () => {
		const violations = checkImports(collectProjectFiles());
		expect(violations, formatViolations(violations)).toEqual([]);
	});
});
