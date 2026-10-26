import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

/**
 * Every DESIGN.md frontmatter token must exist in web/src/styles/tokens.css under the naming rules
 * documented at the top of that file, and no other web file may hold literal colours, px font
 * sizes, fixed heights, removed outlines or inline styles.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string): string => readFileSync(posix.join(repoRoot, rel), 'utf8');

const DESIGN_MD = '_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/DESIGN.md';
const TOKENS_CSS = 'web/src/styles/tokens.css';
const BASE_CSS = 'web/src/styles/base.css';

// ---------- DESIGN.md ----------

type Tree = { [key: string]: unknown };

interface Design {
	colors: Record<string, string>;
	typography: Record<string, Record<string, string | number>>;
	rounded: Record<string, string>;
	spacing: Record<string, string>;
	components: Record<string, Tree>;
}

function loadDesign(): Design {
	const match = /^---\n([\s\S]*?)\n---/.exec(read(DESIGN_MD));
	if (!match) throw new Error('DESIGN.md has no frontmatter');
	return parseYaml(match[1]!) as Design;
}

const REF = /^\{([\w.-]+)\}$/;
const TYPO_PROPS = { fontFamily: 'family', fontSize: 'size', fontWeight: 'weight', lineHeight: 'line-height' } as const;

/** The CSS custom property a `{group.key[.prop]}` reference names. */
function propertyForRef(ref: string): string {
	const [group, key, prop] = ref.split('.');
	switch (group) {
		case 'colors':
			return `--color-${key}`;
		case 'rounded':
			return `--radius-${key}`;
		case 'spacing':
			return `--space-${key}`;
		case 'typography':
			if (!prop) return `--font-${key}`;
			return `--font-${key}-${TYPO_PROPS[prop as keyof typeof TYPO_PROPS]}`;
		default:
			throw new Error(`Unknown reference group in {${ref}}`);
	}
}

/** Resolves a DESIGN value to its final string; `dark` picks `X-dark` colours where they exist. */
function resolveDesign(design: Design, value: unknown, dark: boolean): string {
	const text = String(value);
	const ref = REF.exec(text)?.[1];
	if (!ref) return text;
	const [group, key, prop] = ref.split('.') as [keyof Design, string, string | undefined];
	if (group === 'colors') {
		const darkValue = design.colors[`${key}-dark`];
		return dark && darkValue !== undefined ? darkValue : resolveDesign(design, design.colors[key], dark);
	}
	if (group === 'typography' && !prop) return typographyShorthand(design, key, dark);
	const groupTree = design[group] as Record<string, unknown>;
	const target = prop ? (groupTree[key] as Tree)[prop] : groupTree[key];
	if (target === undefined) throw new Error(`Unresolved reference {${ref}}`);
	return resolveDesign(design, target, dark);
}

function typographyShorthand(design: Design, name: string, dark: boolean): string {
	const style = design.typography[name]!;
	const r = (v: unknown) => resolveDesign(design, v, dark);
	return `${r(style.fontWeight)} ${r(style.fontSize)}/${r(style.lineHeight)} ${r(style.fontFamily)}`;
}

interface Expectation {
	property: string;
	/** Raw value the property must hold in tokens.css, when the naming rules fix it. */
	raw?: string;
	light: string;
	dark: string;
}

function expectations(design: Design): Expectation[] {
	const out: Expectation[] = [];
	const add = (property: string, value: unknown, raw?: string) =>
		out.push({ property, raw, light: resolveDesign(design, value, false), dark: resolveDesign(design, value, true) });

	for (const [key, value] of Object.entries(design.colors)) {
		if (key.endsWith('-dark')) continue;
		const darkValue = design.colors[`${key}-dark`];
		out.push({ property: `--color-${key}`, light: value, dark: darkValue ?? value });
	}
	for (const [name, style] of Object.entries(design.typography)) {
		for (const [prop, suffix] of Object.entries(TYPO_PROPS)) add(`--font-${name}-${suffix}`, style[prop]);
		out.push({ property: `--font-${name}`, light: typographyShorthand(design, name, false), dark: typographyShorthand(design, name, true) });
	}
	for (const [key, value] of Object.entries(design.rounded)) add(`--radius-${key}`, value);
	for (const [key, value] of Object.entries(design.spacing)) add(`--space-${key}`, value);

	const addComponent = (property: string, value: unknown) => {
		const ref = REF.exec(String(value))?.[1];
		add(property, value, ref ? `var(${propertyForRef(ref)})` : String(value));
	};
	for (const [component, props] of Object.entries(design.components)) {
		for (const [prop, value] of Object.entries(props)) {
			if (prop === 'variants') {
				for (const [variant, variantProps] of Object.entries(value as Record<string, Tree>)) {
					for (const [vprop, vvalue] of Object.entries(variantProps)) addComponent(`--${component}-${variant}-${vprop}`, vvalue);
				}
			} else {
				addComponent(`--${component}-${prop}`, value);
			}
		}
	}
	return out;
}

// ---------- CSS parsing ----------

const stripCssComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function parseDeclarations(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of block.split(';')) {
		const colon = part.indexOf(':');
		if (colon < 0) continue;
		const name = part.slice(0, colon).trim();
		if (name) out[name] = part.slice(colon + 1).trim();
	}
	return out;
}

const DARK_BLOCK = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/;

function parseTokens(css: string): { light: Record<string, string>; dark: Record<string, string> } {
	const code = stripCssComments(css);
	const darkMatch = DARK_BLOCK.exec(code);
	if (!darkMatch) throw new Error('tokens.css has no @media (prefers-color-scheme: dark) { :root { … } } block');
	const rest = code.replace(DARK_BLOCK, '');
	const light: Record<string, string> = {};
	for (const match of rest.matchAll(/:root\s*\{([^}]*)\}/g)) Object.assign(light, parseDeclarations(match[1]!));
	return { light, dark: parseDeclarations(darkMatch[1]!) };
}

function resolveVars(value: string, props: Record<string, string>, seen: string[] = []): string {
	return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name: string) => {
		if (seen.includes(name)) throw new Error(`Cyclic var() chain: ${[...seen, name].join(' → ')}`);
		const next = props[name];
		if (next === undefined) throw new Error(`var(${name}) is not defined in tokens.css`);
		return resolveVars(next, props, [...seen, name]);
	});
}

/** Collapses whitespace (also around `/` and `,`) and lower-cases hex colours. */
const normalise = (value: string): string =>
	value
		.replace(/\s+/g, ' ')
		.replace(/\s*([/,])\s*/g, '$1')
		.replace(/#[0-9a-f]+\b/gi, (hex) => hex.toLowerCase())
		.trim();

// ---------- token tests ----------

describe('design tokens', () => {
	const design = loadDesign();
	const tokens = parseTokens(read(TOKENS_CSS));
	const darkProps = { ...tokens.light, ...tokens.dark };

	it('declares color-scheme: light dark', () => {
		expect(tokens.light['color-scheme']).toBe('light dark');
	});

	it('only overrides colour tokens in the dark block', () => {
		const unexpected = Object.keys(tokens.dark).filter((name) => !name.startsWith('--color-'));
		expect(unexpected).toEqual([]);
	});

	for (const exp of expectations(design)) {
		it(`${exp.property} matches DESIGN.md`, () => {
			const raw = tokens.light[exp.property];
			expect(raw, `${exp.property} is missing from tokens.css`).toBeDefined();
			if (exp.raw !== undefined) expect(normalise(raw!), `${exp.property} raw value`).toBe(normalise(exp.raw));
			expect(normalise(resolveVars(raw!, tokens.light)), `${exp.property} (light)`).toBe(normalise(exp.light));
			const darkRaw = darkProps[exp.property]!;
			expect(normalise(resolveVars(darkRaw, darkProps)), `${exp.property} (dark)`).toBe(normalise(exp.dark));
		});
	}

	it('has a global :focus-visible ring built from the focus-ring tokens', () => {
		const code = stripCssComments(read(BASE_CSS));
		const rules = [...code.matchAll(/([^{}]+)\{([^}]*)\}/g)]
			.filter((m) => m[1]!.split(',').some((s) => s.trim() === ':focus-visible'))
			.map((m) => parseDeclarations(m[2]!));
		expect(rules.length, 'base.css needs a `:focus-visible { … }` rule').toBeGreaterThan(0);
		const decls = Object.assign({}, ...rules) as Record<string, string>;
		expect(normalise(decls.outline ?? '')).toBe('var(--focus-ring-width) solid var(--focus-ring-color)');
		expect(normalise(decls['outline-offset'] ?? '')).toBe('var(--focus-ring-offset)');
	});
});

// ---------- literal-value scan ----------

const NAMED_COLOURS = [
	'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'brown', 'gray', 'grey',
	'silver', 'gold', 'navy', 'teal', 'maroon', 'olive', 'lime', 'aqua', 'fuchsia', 'cyan', 'magenta',
	'indigo', 'violet', 'crimson', 'coral', 'salmon', 'tomato', 'beige', 'ivory', 'khaki', 'lavender',
	'turquoise', 'tan', 'darkgray', 'darkgrey', 'lightgray', 'lightgrey', 'whitesmoke', 'gainsboro',
];
const NAMED_COLOUR = new RegExp(`(?<![\\w-])(?:${NAMED_COLOURS.join('|')})(?![\\w-])`, 'i');

export interface ScanFinding {
	file: string;
	problem: string;
	text: string;
}

/** CSS declarations from a stylesheet, or from `<style>` blocks of an HTML file. */
function cssDeclarations(css: string): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	for (const match of stripCssComments(css).matchAll(/\{([^{}]*)\}/g)) {
		for (const [name, value] of Object.entries(parseDeclarations(match[1]!))) out.push([name.toLowerCase(), value]);
	}
	return out;
}

export function scanFile(file: string, source: string): ScanFinding[] {
	const findings: ScanFinding[] = [];
	const flag = (problem: string, text: string) => findings.push({ file, problem, text: text.trim() });

	for (const match of source.matchAll(/(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi)) flag('hex colour', match[0]);
	for (const match of source.matchAll(/(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/gi)) flag('colour function', match[0]);
	for (const match of source.matchAll(/(?<![\w-])height\s*:[^;\n]*/gi)) flag('height declaration (use min-height)', match[0]);
	for (const match of source.matchAll(/outline(?:-style|-width)?\s*:\s*(?:none|0)(?![\w.])/gi)) flag('removed focus outline', match[0]);
	if (file.endsWith('.tsx')) for (const match of source.matchAll(/\bstyle\s*=/g)) flag('inline style', match[0]);

	const css = file.endsWith('.css')
		? source
		: file.endsWith('.html')
			? [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')
			: '';
	for (const [name, value] of cssDeclarations(css)) {
		if (name.startsWith('--')) continue;
		if (NAMED_COLOUR.test(value)) flag('named colour', `${name}: ${value}`);
		if (/\d(?:\.\d+)?px\b/i.test(value)) flag('px size', `${name}: ${value}`);
	}
	return findings;
}

function webFiles(): string[] {
	return readdirSync(posix.join(repoRoot, 'web'), { recursive: true, encoding: 'utf8' })
		.map((entry) => posix.join('web', entry.split('\\').join('/')))
		.filter((rel) => /\.(css|ts|tsx|html)$/.test(rel) && rel !== TOKENS_CSS && !rel.split('/').includes('node_modules'));
}

describe('literal-value scanner', () => {
	it('flags each forbidden pattern', () => {
		const css =
			'.a { color: #fff; background: rgb(0 0 0); border-color: red; font-size: 14px; height: 2rem; outline: none; padding: 8px; }';
		expect(scanFile('x.css', css).map((f) => f.problem)).toEqual([
			'hex colour',
			'colour function',
			'height declaration (use min-height)',
			'removed focus outline',
			'named colour',
			'px size',
			'px size',
		]);
		expect(scanFile('x.html', '<style>.b { margin: 0.5px }</style>').map((f) => f.problem)).toEqual(['px size']);
		expect(scanFile('x.tsx', 'const a = <p style={{ color: "red" }} />;').map((f) => f.problem)).toEqual(['inline style']);
		expect(scanFile('x.html', '<style>a { outline: 0 }</style>').map((f) => f.problem)).toEqual(['removed focus outline']);
	});

	it('accepts tokens, min-height, line-height and fragment links', () => {
		const css = '.a { color: var(--color-action); min-height: var(--space-target-min); line-height: 1.5; border: thin solid currentColor; }';
		expect(scanFile('x.css', css)).toEqual([]);
		expect(scanFile('x.tsx', 'const a = <a href="about/#lang=de" />;')).toEqual([]);
	});
});

describe('web sources use tokens only', () => {
	const files = webFiles();

	it('scans the web sources', () => {
		expect(files).toContain(BASE_CSS);
		expect(files).toContain('web/src/app.tsx');
	});

	it('hold no literal colours, px sizes, fixed heights, removed outlines or inline styles', () => {
		const findings = files.flatMap((file) => scanFile(file, read(file)));
		expect(findings, findings.map((f) => `${f.file}: ${f.problem}: ${f.text}`).join('\n')).toEqual([]);
	});
});
