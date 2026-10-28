import type { ComponentChildren } from 'preact';
import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'preact/hooks';
import { parseFragment, withLang } from '../fragment.ts';
import deJson from './de.json';
import enJson from './en.json';

export const LANGS = ['de', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export type MessageKey = keyof typeof enJson;
export type Catalogue = Record<MessageKey, string>;
export type Catalogues = Record<Lang, Catalogue>;
export type Params = Record<string, string | number>;

// Typed as Catalogue so a key missing from de.json also fails the typecheck.
const de: Catalogue = deJson;
const en: Catalogue = enJson;
export const CATALOGUES: Catalogues = { de, en };

export function isLang(value: unknown): value is Lang {
	return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** The fragment's `lang` (case-insensitive), or null when it is missing or invalid. */
function fragmentLang(fragment: string): Lang | null {
	const value = parseFragment(fragment).get('lang')?.toLowerCase();
	return isLang(value) ? value : null;
}

/** A valid `lang` in the fragment wins; else the first browser language (`en*` → en, else de). */
export function detectLanguage(fragment: string, navigatorLanguages: readonly string[]): Lang {
	const fromFragment = fragmentLang(fragment);
	if (fromFragment) return fromFragment;
	return navigatorLanguages[0]?.toLowerCase().startsWith('en') ? 'en' : 'de';
}

/** Looks up a message and fills `{name}` placeholders; unknown placeholders are left as they are. */
export function translate(catalogue: Catalogue, key: MessageKey, params?: Params): string {
	const message = catalogue[key];
	if (!params) return message;
	return message.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export interface I18nValue {
	lang: Lang;
	/** The current URL fragment, kept in sync on every hashchange and language switch. */
	hash: string;
	t: (key: MessageKey, params?: Params) => string;
	/** Switches the language and rewrites only `lang` in the fragment, without a history entry. */
	setLang: (lang: Lang) => void;
	/** Replaces the whole fragment without a history entry (no `hashchange`) and keeps `hash` in sync. */
	replaceHash: (hash: string) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

function browserLanguages(): readonly string[] {
	if (navigator.languages?.length) return navigator.languages;
	return navigator.language ? [navigator.language] : [];
}

export interface I18nProviderProps {
	/** The message used as `document.title`. */
	titleKey: MessageKey;
	/** Overrides the bundled catalogues (tests inject sentinels). */
	catalogues?: Catalogues;
	children?: ComponentChildren;
}

export function I18nProvider({ titleKey, catalogues = CATALOGUES, children }: I18nProviderProps) {
	const [lang, setLangState] = useState<Lang>(() => detectLanguage(location.hash, browserLanguages()));

	const [hash, setHash] = useState(() => location.hash);

	const replaceHash = useCallback((nextHash: string) => {
		history.replaceState(history.state, '', `${location.pathname}${location.search}${nextHash}`);
		setHash(nextHash);
	}, []);

	const setLang = useCallback(
		(next: Lang) => {
			replaceHash(withLang(location.hash, next));
			setLangState(next);
		},
		[replaceHash],
	);

	useEffect(() => {
		const onHashChange = () => {
			setHash(location.hash);
			const fromFragment = fragmentLang(location.hash);
			if (fromFragment) setLangState(fromFragment);
		};
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	}, []);

	const value = useMemo<I18nValue>(() => {
		const catalogue = catalogues[lang];
		return { lang, hash, setLang, replaceHash, t: (key, params) => translate(catalogue, key, params) };
	}, [lang, hash, catalogues, setLang, replaceHash]);

	// Layout effect: <html lang> and the title are right before the first paint.
	useLayoutEffect(() => {
		document.documentElement.lang = lang;
		document.title = translate(catalogues[lang], titleKey);
	}, [lang, titleKey, catalogues]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
	const value = useContext(I18nContext);
	if (!value) throw new Error('useI18n must be used inside I18nProvider');
	return value;
}
