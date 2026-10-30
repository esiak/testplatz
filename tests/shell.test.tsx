// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutPage } from '../web/src/about-page.tsx';
import { App } from '../web/src/app.tsx';
import en from '../web/src/i18n/en.json' with { type: 'json' };
import de from '../web/src/i18n/de.json' with { type: 'json' };
import type { Catalogue, Catalogues } from '../web/src/i18n/i18n.tsx';
import { PLACES_URL } from '../web/src/data/places.ts';
import { SNAPSHOT_URL } from '../web/src/data/snapshot.ts';
import { smallPlaces } from './fixtures/places.ts';
import { coveredCentre, jsonResponse, snapshotCentre, snapshotOf } from './fixtures/snapshot.ts';

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

/** Never settles: the About page stays in its loading state. */
const pendingFetch = () => new Promise<Response>(() => {});

function stubFetch(impl: (input: RequestInfo | URL) => Promise<Response>): void {
	vi.stubGlobal('fetch', vi.fn<typeof fetch>(impl));
}

/** Serves the search page's two data files; `fail` makes both requests fail. */
function stubSearchData(centres: ReturnType<typeof snapshotCentre>[], fail = false): void {
	stubFetch((input) => {
		if (fail) return Promise.reject(new TypeError('offline'));
		const url = String(input);
		if (url === SNAPSHOT_URL) return Promise.resolve(jsonResponse(snapshotOf(centres)));
		if (url === PLACES_URL) return Promise.resolve(jsonResponse(smallPlaces()));
		return Promise.reject(new Error(`unexpected request ${url}`));
	});
}

/** Types into the search field and submits the form. */
function searchFor(text: string, km?: number): void {
	const field = root.querySelector<HTMLInputElement>('form[role="search"] input')!;
	const select = root.querySelector<HTMLSelectElement>('form[role="search"] select')!;
	act(() => {
		field.value = text;
		field.dispatchEvent(new Event('input', { bubbles: true }));
		if (km !== undefined) {
			select.value = String(km);
			select.dispatchEvent(new Event('change', { bubbles: true }));
		}
	});
	act(() => {
		root.querySelector('form[role="search"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	});
}

/** Lets pending fetches and their state updates finish. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

/**
 * Text nodes and label attributes that are left once sentinels are removed. `allowed` lists data
 * text (centre names) that may appear as a whole text node.
 */
function leftoverText(allowed: readonly string[] = []): string[] {
	const leftovers: string[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const rest = (node.textContent ?? '').replace(SENTINEL, '').trim();
		if (rest && !allowed.includes(rest)) leftovers.push(`text: ${rest}`);
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
	stubFetch(pendingFetch);
});

afterEach(() => {
	act(() => render(null, root));
	root.remove();
	document.title = '';
	document.documentElement.removeAttribute('lang');
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
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

	it('the About page loading state renders only catalogue text', () => {
		setBrowser(['de-DE'], '', '/testplatz/about/');
		mount('about', SENTINELS);
		expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
		expect(leftoverText()).toEqual([]);
	});

	it('the About page loaded state renders only catalogue text and centre names', async () => {
		const centres = [
			snapshotCentre('a', { name: 'Alpha Sprachschule' }),
			snapshotCentre('b', { name: 'Bravo Akademie', test_page_url: null, website: null }),
			coveredCentre('c', 'failed', { name: 'Charlie vhs' }),
		];
		stubFetch(() => Promise.resolve(jsonResponse(snapshotOf(centres))));
		setBrowser(['de-DE'], '', '/testplatz/about/');
		mount('about', SENTINELS);
		await settle();
		expect(root.querySelectorAll('.about__centre-list > li')).toHaveLength(3);
		expect(leftoverText(centres.map((c) => c.name))).toEqual([]);
	});

	it('the About page lists centres without a map position with only catalogue text and centre names', async () => {
		const centres = [snapshotCentre('a', { name: 'Alpha Sprachschule', lat: null, lon: null }), snapshotCentre('b', { name: 'Bravo Akademie' })];
		stubFetch(() => Promise.resolve(jsonResponse(snapshotOf(centres))));
		setBrowser(['de-DE'], '', '/testplatz/about/');
		mount('about', SENTINELS);
		await settle();
		expect(root.querySelectorAll('#no-location .about__centre-list > li')).toHaveLength(1);
		expect(root.textContent).toContain('[[about.no_location.count_one]]');
		expect(leftoverText(centres.map((c) => c.name))).toEqual([]);
	});

	it('the About page empty state renders only catalogue text', async () => {
		stubFetch(() => Promise.resolve(jsonResponse(snapshotOf([coveredCentre('a', 'ok')]))));
		setBrowser(['de-DE'], '', '/testplatz/about/');
		mount('about', SENTINELS);
		await settle();
		expect(root.textContent).toContain('[[about.not_checked.none]]');
		expect(root.textContent).toContain('[[about.no_location.none]]');
		expect(leftoverText()).toEqual([]);
	});

	it('the About page error state renders only catalogue text', async () => {
		stubFetch(() => Promise.reject(new TypeError('offline')));
		setBrowser(['de-DE'], '', '/testplatz/about/');
		mount('about', SENTINELS);
		await settle();
		expect(root.querySelector('[role="alert"]')).not.toBeNull();
		expect(root.querySelector('button')).not.toBeNull();
		expect(leftoverText()).toEqual([]);
	});

	describe('search page states', () => {
		const centres = [
			snapshotCentre('a', {
				name: 'Alpha Sprachschule',
				address: { street: 'Bahnhofsplatz 6', postcode: '90443', city: 'Nürnberg' },
				lat: 49.4539,
				lon: 11.0773,
			}),
			snapshotCentre('b', {
				name: 'Bravo Akademie',
				address: { street: 'Königstraße 1', postcode: '90762', city: 'Fürth' },
				lat: 49.4771,
				lon: 10.9887,
				test_page_url: null,
				website: null,
			}),
			snapshotCentre('c', { name: 'Charlie vhs', lat: 49.59, lon: 11.0, test_page_url: null }),
		];
		const dataText = [...centres.map((c) => c.name), ...centres.map((c) => `${c.address.street}, ${c.address.postcode} ${c.address.city}`)];

		async function searchPage(text: string, km?: number, fail = false): Promise<void> {
			stubSearchData(centres, fail);
			setBrowser(['de-DE']);
			mount('search', SENTINELS);
			await settle();
			searchFor(text, km);
			await settle();
		}

		it('loading', () => {
			setBrowser(['de-DE']);
			mount('search', SENTINELS);
			searchFor('Nürnberg');
			expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
			expect(root.querySelector('[role="status"]')!.textContent).toBe('[[search.loading]]');
			expect(leftoverText()).toEqual([]);
		});

		it('results', async () => {
			await searchPage('Nürnberg', 20);
			expect(root.querySelectorAll('ul.results > li > article')).toHaveLength(3);
			expect(root.querySelector('.card__destination')).not.toBeNull();
			expect(leftoverText(dataText)).toEqual([]);
		});

		it('place not found, with suggestions', async () => {
			await searchPage('Nurnbreg');
			expect(root.querySelector('[role="alert"]')).not.toBeNull();
			expect(root.querySelectorAll('.field-message__suggestion').length).toBeGreaterThan(0);
			expect(leftoverText()).toEqual([]);
		});

		it('suggestions list open, for names and postcodes', async () => {
			stubSearchData(centres);
			setBrowser(['de-DE']);
			mount('search', SENTINELS);
			await settle();
			const field = root.querySelector<HTMLInputElement>('form[role="search"] input')!;
			for (const [text, rows] of [
				['Kastl', 3],
				['Ober', 6],
				['8923', 1],
			] as const) {
				act(() => {
					field.focus();
					field.value = text;
					field.dispatchEvent(new Event('input', { bubbles: true }));
				});
				expect(root.querySelectorAll('[role="listbox"] > [role="option"]'), text).toHaveLength(rows);
				expect(root.querySelector('[role="status"]')!.textContent).toMatch(/^\[\[search\.suggestions_count(_one)?\]\]$/);
				// Place names and postcodes are data text.
				const names = [...root.querySelectorAll('.place-suggestions__name')].map((n) => n.textContent ?? '');
				expect(leftoverText([...names, '89231'])).toEqual([]);
			}
		});

		it('several places match', async () => {
			await searchPage('Kastl');
			expect(root.querySelector('[role="alert"]')!.textContent).toBe('[[error.several_places]]');
			expect(root.querySelectorAll('[role="listbox"] > [role="option"]')).toHaveLength(3);
			expect(leftoverText(['Kastl'])).toEqual([]);
		});

		it('outside Bavaria', async () => {
			await searchPage('Kiel');
			expect(root.querySelector('[role="alert"]')!.textContent).toBe('[[error.outside_bavaria]]');
			expect(leftoverText()).toEqual([]);
		});

		it('no centres in range', async () => {
			await searchPage('Augsburg', 10);
			expect(root.querySelector('.no-centres button')).not.toBeNull();
			expect(leftoverText()).toEqual([]);
		});

		describe('with centres that have no map position', () => {
			const inPlace = snapshotCentre('d', {
				name: 'Delta vhs',
				address: { street: 'Hauptmarkt 1', postcode: '90403', city: 'Nürnberg' },
				lat: null,
				lon: null,
			});
			const elsewhere = snapshotCentre('e', {
				name: 'Echo vhs',
				address: { street: 'Kulmbacher Str. 1', postcode: '96317', city: 'Kronach' },
				lat: null,
				lon: null,
			});
			const withUnlocated = [...centres, inPlace, elsewhere];
			const unlocatedText = [...dataText, inPlace.name, `${inPlace.address.street}, ${inPlace.address.postcode} ${inPlace.address.city}`];

			async function search(text: string, km: number): Promise<void> {
				stubSearchData(withUnlocated);
				setBrowser(['de-DE']);
				mount('search', SENTINELS);
				await settle();
				searchFor(text, km);
				await settle();
			}

			it('results with an unlocated card and the hidden notice', async () => {
				await search('Nürnberg', 20);
				expect(root.querySelectorAll('ul.results > li > article')).toHaveLength(4);
				expect(root.textContent).toContain('[[card.fact.distance_unknown]]');
				expect(root.textContent).toContain('[[results.unlocated_notice_one]]');
				expect(root.textContent).toContain('[[results.unlocated_link]]');
				expect(leftoverText(unlocatedText)).toEqual([]);
			});

			it('no centres in range, with the hidden notice', async () => {
				await search('Augsburg', 10);
				expect(root.querySelector('.no-centres button')).not.toBeNull();
				expect(root.textContent).toContain('[[results.unlocated_notice]]');
				expect(leftoverText()).toEqual([]);
			});
		});

		it('load failure', async () => {
			await searchPage('Nürnberg', 40, true);
			expect(root.querySelector('.load-failure [role="alert"]')).not.toBeNull();
			expect(root.querySelector('.load-failure button')).not.toBeNull();
			expect(leftoverText()).toEqual([]);
		});
	});

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
		setBrowser(['de-DE'], '#q=F%C3%BCrth&r=20&sort=soonest&lang=en');
		mount('search');
		expect(document.documentElement.lang).toBe('en');
		expect(h1Text()).toBe(en['search.heading']);
		expect(location.hash).toBe('#q=F%C3%BCrth&r=20&sort=soonest&lang=en');
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
		setBrowser(['de-DE'], '#q=F%C3%BCrth&r=20&sort=soonest&lang=de');
		mount('search');
		const historyLength = history.length;
		const enLink = langLink('en');
		expect(enLink.getAttribute('href')).toBe('#q=F%C3%BCrth&r=20&sort=soonest&lang=en');

		enLink.focus();
		act(() => enLink.click());

		expect(h1Text()).toBe(en['search.heading']);
		expect(document.documentElement.lang).toBe('en');
		expect(document.title).toBe(en['search.title']);
		expect(location.hash).toBe('#q=F%C3%BCrth&r=20&sort=soonest&lang=en');
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
		setBrowser(['de-DE'], '#q=Ulm&r=20&sort=soonest&lang=de');
		mount('search');
		expect(langLink('en').getAttribute('href')).toBe('#q=Ulm&r=20&sort=soonest&lang=en');
		act(() => {
			history.replaceState(null, '', '/testplatz/#q=Augsburg&r=20&sort=soonest&lang=de');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		});
		expect(langLink('en').getAttribute('href')).toBe('#q=Augsburg&r=20&sort=soonest&lang=en');
		expect(langLink('de').getAttribute('href')).toBe('#q=Augsburg&r=20&sort=soonest&lang=de');
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
