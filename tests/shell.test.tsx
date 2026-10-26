// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutPage } from '../web/src/about-page.tsx';
import { App } from '../web/src/app.tsx';
import en from '../web/src/i18n/en.json' with { type: 'json' };
import de from '../web/src/i18n/de.json' with { type: 'json' };
import type { Catalogue, Catalogues } from '../web/src/i18n/i18n.tsx';

/**
 * Renders each page and checks the shell. Later stories add their surfaces and states to the
 * sentinel section so "no hard-coded UI text" keeps covering everything the site renders.
 */

const sentinel = Object.fromEntries(Object.keys(en).map((key) => [key, `[[${key}]]`])) as Catalogue;
const SENTINELS: Catalogues = { de: sentinel, en: sentinel };
const SENTINEL = /\[\[[\w.-]+\]\]/g;
const LABEL_ATTRIBUTES = ['aria-label', 'title', 'alt', 'placeholder'];

const pages = { search: App, about: AboutPage } as const;
type PageName = keyof typeof pages;

let root: HTMLElement;

function setBrowser(languages: string[], hash = '', path = '/testplatz/'): void {
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
	history.replaceState(null, '', `${path}${hash}`);
}

function mount(page: PageName, catalogues?: Catalogues): void {
	const Page = pages[page];
	act(() => {
		render(<Page catalogues={catalogues} />, root);
	});
}

const langLink = (code: 'de' | 'en'): HTMLAnchorElement => root.querySelector<HTMLAnchorElement>(`nav a[hreflang="${code}"]`)!;
const h1Text = (): string => root.querySelector('h1')!.textContent ?? '';

/** Text nodes and label attributes that are left once sentinels are removed. */
function leftoverText(): string[] {
	const leftovers: string[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const rest = (node.textContent ?? '').replace(SENTINEL, '').trim();
		if (rest) leftovers.push(`text: ${rest}`);
	}
	for (const el of root.querySelectorAll('*')) {
		for (const attr of LABEL_ATTRIBUTES) {
			const value = el.getAttribute(attr);
			if (value === null) continue;
			const rest = value.replace(SENTINEL, '').trim();
			if (rest || !value) leftovers.push(`${attr}: ${value}`);
		}
	}
	const title = document.title.replace(SENTINEL, '').trim();
	if (title || !document.title) leftovers.push(`document.title: ${document.title}`);
	return leftovers;
}

beforeEach(() => {
	root = document.createElement('div');
	document.body.append(root);
});

afterEach(() => {
	act(() => render(null, root));
	root.remove();
	document.title = '';
	document.documentElement.removeAttribute('lang');
	vi.restoreAllMocks();
});

describe('no hard-coded UI text', () => {
	for (const page of Object.keys(pages) as PageName[]) {
		it(`the ${page} page renders only catalogue text`, () => {
			setBrowser(['de-DE']);
			mount(page, SENTINELS);
			expect(root.querySelector('main h1')).not.toBeNull();
			expect(leftoverText()).toEqual([]);
		});
	}

	it('the check catches a literal string', () => {
		setBrowser(['de-DE']);
		mount('search', SENTINELS);
		root.querySelector('h1')!.append(' literal');
		expect(leftoverText()).toEqual(['text: literal']);
	});
});

describe('initial language', () => {
	it('is English for an English browser, with no fragment', () => {
		setBrowser(['en-GB', 'de']);
		mount('search');
		expect(document.documentElement.lang).toBe('en');
		expect(h1Text()).toBe('Find Einbürgerungstest dates near you in Bavaria.');
		expect(document.title).toBe(en['search.title']);
	});

	it('is German for any other browser language', () => {
		setBrowser(['fr-FR']);
		mount('search');
		expect(document.documentElement.lang).toBe('de');
		expect(h1Text()).toBe(de['search.heading']);
		expect(document.title).toBe(de['search.title']);
	});

	it('follows a shared link and leaves its fragment unchanged', () => {
		setBrowser(['de-DE'], '#q=F%C3%BCrth&r=20&lang=en');
		mount('search');
		expect(document.documentElement.lang).toBe('en');
		expect(h1Text()).toBe(en['search.heading']);
		expect(location.hash).toBe('#q=F%C3%BCrth&r=20&lang=en');
	});

	it('ignores a bad lang and does not rewrite the fragment', () => {
		setBrowser(['en-US'], '#lang=xx');
		mount('search');
		expect(document.documentElement.lang).toBe('en');
		expect(location.hash).toBe('#lang=xx');
	});

	it('titles the About page in the active language', () => {
		setBrowser(['de-DE'], '', '/testplatz/about/');
		mount('about');
		expect(document.title).toBe(de['about.title']);
		expect(h1Text()).toBe(de['about.heading']);
	});
});

describe('language switch', () => {
	it('names the nav and both links, and marks the active one', () => {
		setBrowser(['de-DE']);
		mount('search');
		const nav = root.querySelector('header nav')!;
		expect(nav.getAttribute('aria-label')).toBe(de['lang.nav_label']);
		const [deLink, enLink] = [langLink('de'), langLink('en')];
		expect(deLink.textContent).toBe('DE');
		expect(enLink.textContent).toBe('EN');
		expect(deLink.getAttribute('aria-label')).toBe('Deutsch');
		expect(enLink.getAttribute('aria-label')).toBe('English');
		expect(deLink.getAttribute('lang')).toBe('de');
		expect(enLink.getAttribute('lang')).toBe('en');
		expect(deLink.getAttribute('aria-current')).toBe('true');
		expect(enLink.hasAttribute('aria-current')).toBe(false);
		expect(enLink.getAttribute('href')).toBe('#lang=en');
	});

	it('switches DE→EN without reload, keeps the other parameters and keeps focus', () => {
		setBrowser(['de-DE'], '#q=F%C3%BCrth&r=20&lang=de');
		mount('search');
		const historyLength = history.length;
		const enLink = langLink('en');
		expect(enLink.getAttribute('href')).toBe('#q=F%C3%BCrth&r=20&lang=en');

		enLink.focus();
		act(() => enLink.click());

		expect(h1Text()).toBe(en['search.heading']);
		expect(document.documentElement.lang).toBe('en');
		expect(document.title).toBe(en['search.title']);
		expect(location.hash).toBe('#q=F%C3%BCrth&r=20&lang=en');
		expect(location.pathname).toBe('/testplatz/');
		expect(history.length).toBe(historyLength);
		expect(langLink('en')).toBe(enLink);
		expect(document.activeElement).toBe(enLink);
		expect(enLink.getAttribute('aria-current')).toBe('true');
		expect(enLink.getAttribute('lang')).toBe('en');
		expect(langLink('de').hasAttribute('aria-current')).toBe(false);
	});

	it('writes #lang=en into an empty fragment and keeps the query string', () => {
		setBrowser(['de-DE'], '', '/testplatz/?keep=1');
		mount('search');
		act(() => langLink('en').click());
		expect(location.hash).toBe('#lang=en');
		expect(location.search).toBe('?keep=1');
	});

	it('follows a manual fragment edit and ignores an invalid lang', () => {
		setBrowser(['en-GB'], '#lang=en');
		mount('search');
		act(() => {
			history.replaceState(null, '', '/testplatz/#lang=de');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		});
		expect(h1Text()).toBe(de['search.heading']);
		expect(document.documentElement.lang).toBe('de');

		act(() => {
			history.replaceState(null, '', '/testplatz/#lang=xx');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		});
		expect(h1Text()).toBe(de['search.heading']);
	});
});

describe('language switch links', () => {
	it('follow a hashchange that changes only q', () => {
		setBrowser(['de-DE'], '#q=Ulm&r=20&lang=de');
		mount('search');
		expect(langLink('en').getAttribute('href')).toBe('#q=Ulm&r=20&lang=en');
		act(() => {
			history.replaceState(null, '', '/testplatz/#q=Augsburg&r=20&lang=de');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		});
		expect(langLink('en').getAttribute('href')).toBe('#q=Augsburg&r=20&lang=en');
		expect(langLink('de').getAttribute('href')).toBe('#q=Augsburg&r=20&lang=de');
	});

	it('leave modified and middle clicks to the browser', () => {
		setBrowser(['de-DE'], '#lang=de');
		mount('search');
		const enLink = langLink('en');
		// Records whether the app prevented the click, then stops happy-dom from navigating.
		let preventedByApp: boolean | null = null;
		const record = (event: Event) => {
			preventedByApp = event.defaultPrevented;
			event.preventDefault();
		};
		window.addEventListener('click', record);
		try {
			const clicks: MouseEventInit[] = [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }];
			for (const init of clicks) {
				act(() => {
					enLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
				});
				expect(preventedByApp, JSON.stringify(init)).toBe(false);
				expect(document.documentElement.lang).toBe('de');
				expect(location.hash).toBe('#lang=de');
			}
			act(() => {
				enLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
			});
			expect(preventedByApp).toBe(true);
			expect(document.documentElement.lang).toBe('en');
		} finally {
			window.removeEventListener('click', record);
		}
	});
});

describe('footer', () => {
	const footerLinks = () => [...root.querySelectorAll<HTMLAnchorElement>('footer a')];

	it('links to About and shows the attribution on the search page', () => {
		setBrowser(['en-GB']);
		mount('search');
		const links = footerLinks();
		expect(links.map((a) => a.textContent)).toEqual([en['footer.about']]);
		expect(links[0]!.getAttribute('href')).toBe('about/#lang=en');
		expect(links[0]!.hasAttribute('aria-current')).toBe(false);
		expect(root.querySelector('footer')!.textContent).toContain('Place data © OpenStreetMap contributors (ODbL)');
	});

	it('marks the About link as the current page on About', () => {
		setBrowser(['de-DE'], '', '/testplatz/about/');
		mount('about');
		const [about] = footerLinks();
		expect(about!.getAttribute('href')).toBe('./#lang=de');
		expect(about!.getAttribute('aria-current')).toBe('page');
		expect(root.querySelector('footer')!.textContent).toContain('Ortsdaten © OpenStreetMap-Mitwirkende (ODbL)');
	});

	it('has no Impressum or Privacy link', () => {
		for (const page of Object.keys(pages) as PageName[]) {
			setBrowser(['de-DE']);
			mount(page);
			const text = root.querySelector('footer')!.textContent!.toLowerCase();
			for (const word of ['impressum', 'privacy', 'datenschutz']) expect(text).not.toContain(word);
			expect(footerLinks()).toHaveLength(1);
			act(() => render(null, root));
		}
	});
});
