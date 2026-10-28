import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withLang } from '../web/src/fragment.ts';
import de from '../web/src/i18n/de.json' with { type: 'json' };
import en from '../web/src/i18n/en.json' with { type: 'json' };
import { CATALOGUES, detectLanguage, translate } from '../web/src/i18n/i18n.tsx';

const EXPERIENCE_MD = fileURLToPath(
	new URL('../_bmad-output/planning-artifacts/ux-designs/ux-bgtsearch-2026-10-25/EXPERIENCE.md', import.meta.url),
);

const catalogues: Record<string, Record<string, string>> = { de, en };
const placeholders = (value: string): string[] => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();

/** Quoted strings in the Do column of the EXPERIENCE.md Voice and Tone table. */
function voiceAndToneDoStrings(): string[] {
	const md = readFileSync(EXPERIENCE_MD, 'utf8');
	const section = /^## Voice and Tone\n([\s\S]*?)(?=^## )/m.exec(md)?.[1];
	if (!section) throw new Error('EXPERIENCE.md has no "## Voice and Tone" section');
	const rows = section.split('\n').filter((line) => line.startsWith('|'));
	// Skip the header row and the |---| separator.
	const doCells = rows.slice(2).map((row) => row.split('|')[1] ?? '');
	return doCells.flatMap((cell) => [...cell.matchAll(/"([^"]+)"/g)].map((m) => m[1]!));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const asPattern = (value: string): RegExp =>
	new RegExp(`^${value.split(/\{\w+\}/).map(escapeRegExp).join('.+')}$`);

describe('translation catalogues', () => {
	it('have the same keys in de.json and en.json', () => {
		const onlyIn = (a: string, b: string) => Object.keys(catalogues[a]!).filter((k) => !(k in catalogues[b]!));
		expect(onlyIn('en', 'de'), 'keys missing from de.json').toEqual([]);
		expect(onlyIn('de', 'en'), 'keys missing from en.json').toEqual([]);
	});

	it('use the same placeholders per key', () => {
		const mismatched = Object.keys(en)
			.filter((key) => key in de)
			.filter((key) => placeholders(catalogues.en![key]!).join() !== placeholders(catalogues.de![key]!).join());
		expect(mismatched, 'keys whose placeholders differ').toEqual([]);
	});

	it('contain no exclamation marks', () => {
		const offending = Object.entries(catalogues).flatMap(([lang, cat]) =>
			Object.entries(cat)
				.filter(([, value]) => value.includes('!'))
				.map(([key]) => `${lang}:${key}`),
		);
		expect(offending).toEqual([]);
	});

	it('cover every Do-column string from EXPERIENCE.md Voice and Tone', () => {
		const strings = voiceAndToneDoStrings();
		expect(strings.length).toBeGreaterThan(5);
		const patterns = Object.values(en).map(asPattern);
		const missing = strings.filter((text) => !patterns.some((p) => p.test(text)));
		expect(missing, 'Do-column strings with no matching en.json value').toEqual([]);
	});

	it('use autonyms for language names and codes in both files', () => {
		for (const key of ['lang.de.code', 'lang.de.name', 'lang.en.code', 'lang.en.name'] as const) {
			expect(de[key]).toBe(en[key]);
		}
	});

	it('translate fills placeholders', () => {
		expect(translate(CATALOGUES.en, 'results.none_in_radius', { radius: 20 })).toBe('No test centres within 20 km.');
		expect(translate(CATALOGUES.en, 'search.next_radius', { radius: 40 })).toBe('Search 40 km');
		expect(translate(CATALOGUES.en, 'freshness.relative', { hours: 2 })).toBe('Checked 2 h ago');
		expect(translate(CATALOGUES.de, 'search.heading')).toBe(de['search.heading']);
	});
});

describe('detectLanguage', () => {
	it('uses English for an English first browser language', () => {
		expect(detectLanguage('', ['en-GB', 'de'])).toBe('en');
		expect(detectLanguage('', ['EN'])).toBe('en');
	});

	it('uses German for any other browser language, or none', () => {
		expect(detectLanguage('', ['fr-FR'])).toBe('de');
		expect(detectLanguage('', ['de-DE', 'en'])).toBe('de');
		expect(detectLanguage('', [])).toBe('de');
	});

	it('prefers a valid lang in the fragment', () => {
		expect(detectLanguage('#q=F%C3%BCrth&r=20&lang=en', ['de-DE'])).toBe('en');
		expect(detectLanguage('#lang=de', ['en-US'])).toBe('de');
	});

	it('reads the fragment lang case-insensitively', () => {
		expect(detectLanguage('#lang=EN', ['de-DE'])).toBe('en');
		expect(detectLanguage('#q=Ulm&lang=De', ['en-GB'])).toBe('de');
	});

	it('ignores an invalid lang in the fragment', () => {
		expect(detectLanguage('#lang=xx', ['en-GB'])).toBe('en');
		expect(detectLanguage('#lang=xx', ['fr'])).toBe('de');
	});
});

describe('withLang', () => {
	it('replaces only lang and keeps every other parameter in order', () => {
		expect(withLang('#q=F%C3%BCrth&r=20&lang=de', 'en')).toBe('#q=F%C3%BCrth&r=20&lang=en');
		expect(withLang('#lang=de&q=Augsburg&sort=nearest&x=1', 'en')).toBe('#lang=en&q=Augsburg&sort=nearest&x=1');
	});

	it('adds lang to an empty or lang-less fragment', () => {
		expect(withLang('', 'en')).toBe('#lang=en');
		expect(withLang('#', 'en')).toBe('#lang=en');
		expect(withLang('#q=Fürth&r=20', 'de')).toBe('#q=F%C3%BCrth&r=20&lang=de');
	});
});
