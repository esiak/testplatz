// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshotSchema, type SnapshotCentre } from '../shared/snapshot.ts';
import { AboutPage, OPT_OUT_URL } from '../web/src/about-page.tsx';
import { SNAPSHOT_URL, uncheckedCentres, unlocatedCentres } from '../web/src/data/snapshot.ts';
import epicSnapshot from '../data/public/snapshot.json' with { type: 'json' };
import de from '../web/src/i18n/de.json' with { type: 'json' };
import en from '../web/src/i18n/en.json' with { type: 'json' };
import { coveredCentre, jsonResponse, snapshotCentre, snapshotOf } from './fixtures/snapshot.ts';

const catalogues = { de, en } as const;
type Lang = keyof typeof catalogues;

let root: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function setBrowser(languages: string[], hash = ''): void {
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
	history.replaceState(null, '', `/testplatz/about/${hash}`);
}

function stubFetch(...responses: Array<() => Promise<Response>>): void {
	let call = 0;
	fetchMock = vi.fn<typeof fetch>(() => {
		const next = responses[Math.min(call, responses.length - 1)]!;
		call += 1;
		return next();
	});
	vi.stubGlobal('fetch', fetchMock);
}

const respond = (centres: SnapshotCentre[]) => () => Promise.resolve(jsonResponse(snapshotOf(centres)));

function mount(): void {
	act(() => {
		render(<AboutPage />, root);
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

const section = (id = 'not-checked') => root.querySelector<HTMLElement>(`#${id}`)!;
const noLocation = () => section('no-location');
const noLocationItems = () => [...noLocation().querySelectorAll<HTMLLIElement>('.about__centre-list > li')];
const centreList = () => section().querySelector('.about__centre-list');
const centreItems = () => [...section().querySelectorAll<HTMLLIElement>('.about__centre-list > li')];
const sectionText = () => section().textContent ?? '';

beforeEach(() => {
	root = document.createElement('div');
	document.body.append(root);
});

afterEach(() => {
	act(() => render(null, root));
	root.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('About page structure', () => {
	for (const [lang, browser] of [
		['de', 'de-DE'],
		['en', 'en-GB'],
	] as const) {
		it(`has one h1 and the six h2 sections in order (${lang})`, () => {
			const t = catalogues[lang as Lang];
			stubFetch(respond([]));
			setBrowser([browser]);
			mount();
			const h1s = [...root.querySelectorAll('h1')];
			expect(h1s.map((h) => h.textContent)).toEqual([t['about.heading']]);
			expect([...root.querySelectorAll('main h2')].map((h) => h.textContent)).toEqual([
				t['about.how.heading'],
				t['about.not_checked.heading'],
				t['about.no_location.heading'],
				t['about.sources.heading'],
				t['about.attribution.heading'],
				t['about.opt_out.heading'],
			]);
			expect(section().tagName).toBe('SECTION');
			expect(section().querySelector('h2')!.textContent).toBe(t['about.not_checked.heading']);
			const reasons = [...section().querySelectorAll('ul:not(.about__centre-list) > li')].map((li) => li.textContent);
			expect(reasons).toEqual([
				t['about.not_checked.reason_system'],
				t['about.not_checked.reason_opted_out'],
				t['about.not_checked.reason_failed'],
			]);
			expect(root.textContent).toContain(t['about.how.body']);
			expect(root.textContent).toContain(t['about.sources.directory']);
			expect(root.textContent).toContain(t['about.sources.websites']);
			expect(root.textContent).toContain(t['about.opt_out.body']);
		});
	}

	it('uses the specified English copy', () => {
		expect(en['about.how.body']).toBe("We read the centres' websites several times a day. Always check the centre's page before you register.");
		expect(en['about.attribution.osm']).toBe('Place data © OpenStreetMap contributors (ODbL)');
		expect(en['about.attribution.nominatim']).toBe('Centre locations found with Nominatim');
		expect(en['about.opt_out.link']).toBe('Ask to be removed');
		expect(en['about.sources.directory']).toContain('rtpartner.de');
		expect(en['about.sources.directory']).toContain('BAMF');
	});
});

describe('external links', () => {
	const linkByHref = (href: string) => root.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;

	function expectExternal(link: HTMLAnchorElement, label: string, lang: Lang): void {
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		const arrow = link.querySelector('[aria-hidden="true"]')!;
		expect(arrow.textContent).toBe('↗');
		expect(link.getAttribute('aria-label')).toBe(catalogues[lang]['link.new_tab'].replace('{label}', label));
		expect(link.textContent!.replace('↗', '').trim()).toBe(label);
	}

	it('marks attribution and opt-out links as new-tab links (en)', async () => {
		stubFetch(respond([snapshotCentre('a', { name: 'vhs Günzburg' })]));
		setBrowser(['en-GB']);
		mount();
		expectExternal(linkByHref('https://www.openstreetmap.org/copyright'), en['about.attribution.osm'], 'en');
		expectExternal(linkByHref('https://nominatim.org/'), en['about.attribution.nominatim'], 'en');
		const optOut = linkByHref('https://github.com/esiak/testplatz/issues/new?template=opt-out-request.yml');
		expect(optOut.getAttribute('href')).toBe(OPT_OUT_URL);
		expectExternal(optOut, 'Ask to be removed', 'en');
		expect(optOut.getAttribute('aria-label')).toBe('Ask to be removed (opens in a new tab)');

		await settle();
		const centreLink = centreItems()[0]!.querySelector('a')!;
		expectExternal(centreLink, 'vhs Günzburg', 'en');
		expect(centreLink.getAttribute('aria-label')).toBe('vhs Günzburg (opens in a new tab)');
	});

	it('uses the German new-tab label', async () => {
		stubFetch(respond([snapshotCentre('a', { name: 'vhs Günzburg' })]));
		setBrowser(['de-DE']);
		mount();
		expectExternal(linkByHref(OPT_OUT_URL), de['about.opt_out.link'], 'de');
		await settle();
		expect(centreItems()[0]!.querySelector('a')!.getAttribute('aria-label')).toBe('vhs Günzburg (öffnet in einem neuen Tab)');
	});
});

describe('not-checked list', () => {
	it('shows a busy loading state until the snapshot arrives, with the other sections rendered', () => {
		stubFetch(() => new Promise<Response>(() => {}));
		setBrowser(['en-GB']);
		mount();
		const busy = section().querySelector('[aria-busy="true"]')!;
		expect(busy.textContent).toBe('Loading centres…');
		expect(root.querySelectorAll('main h2')).toHaveLength(6);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(SNAPSHOT_URL);
	});

	it('lists the unchecked centres of the committed snapshot, sorted by name, linked where a URL exists', async () => {
		const committed = snapshotSchema.parse(epicSnapshot);
		const expected = uncheckedCentres(committed);
		const expectedLinked = expected.filter((c) => (c.test_page_url ?? c.website) !== null);
		stubFetch(() => Promise.resolve(jsonResponse(epicSnapshot)));
		setBrowser(['en-GB']);
		mount();
		await settle();
		expect(section().querySelector('[aria-busy]')).toBeNull();
		const items = centreItems();
		if (expected.length === 0) {
			expect(sectionText()).toContain(en['about.not_checked.none']);
			expect(centreList()).toBeNull();
			return;
		}
		expect(sectionText()).toContain(en['about.not_checked.count'].replace('{count}', String(expected.length)));
		expect(items).toHaveLength(expected.length);
		const names = items.map((li) => li.querySelector('[lang="de"]')!.textContent!);
		expect(names).toEqual(expected.map((c) => c.name));
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
		const linked = items.filter((li) => li.querySelector('a'));
		expect(linked).toHaveLength(expectedLinked.length);
		expect(items.filter((li) => !li.querySelector('a'))).toHaveLength(expected.length - expectedLinked.length);
		expect(linked.map((li) => li.querySelector('a')!.getAttribute('href'))).toEqual(
			expectedLinked.map((c) => c.test_page_url ?? c.website),
		);
	});

	it('links to test_page_url, falls back to website, and shows a plain name without either', async () => {
		stubFetch(
			respond([
				snapshotCentre('c', { name: 'Charlie', test_page_url: null, website: null }),
				snapshotCentre('b', { name: 'Bravo', test_page_url: null, website: 'https://bravo.example.de/' }),
				snapshotCentre('a', { name: 'Alpha', test_page_url: 'https://alpha.example.de/test', website: 'https://alpha.example.de/' }),
			]),
		);
		setBrowser(['en-GB']);
		mount();
		await settle();
		const [alpha, bravo, charlie] = centreItems();
		expect(alpha!.querySelector('a')!.getAttribute('href')).toBe('https://alpha.example.de/test');
		expect(bravo!.querySelector('a')!.getAttribute('href')).toBe('https://bravo.example.de/');
		expect(charlie!.querySelector('a')).toBeNull();
		for (const [item, name] of [
			[alpha, 'Alpha'],
			[bravo, 'Bravo'],
			[charlie, 'Charlie'],
		] as const) {
			const named = item!.querySelector('[lang="de"]')!;
			expect(named.textContent).toBe(name);
		}
		expect(charlie!.textContent).toBe('Charlie');
	});

	it('leaves out covered centres whose last check is ok, keeps failed and never-run ones', async () => {
		stubFetch(
			respond([
				coveredCentre('ok', 'ok', { name: 'Covered OK' }),
				coveredCentre('failed', 'failed', { name: 'Covered failed' }),
				coveredCentre('never', null, { name: 'Covered never' }),
			]),
		);
		setBrowser(['en-GB']);
		mount();
		await settle();
		expect(centreItems().map((li) => li.textContent!.replace('↗', '').trim())).toEqual(['Covered failed', 'Covered never']);
		expect(sectionText()).toContain('2 centres are not checked automatically.');
	});

	it('says every centre is checked when none match, with no list', async () => {
		stubFetch(respond([coveredCentre('ok', 'ok')]));
		setBrowser(['en-GB']);
		mount();
		await settle();
		expect(sectionText()).toContain('Every centre is checked automatically right now.');
		expect(centreList()).toBeNull();
		expect(sectionText()).not.toContain('centres are not checked automatically.');
	});

	const failures: Array<[string, () => Promise<Response>]> = [
		['a network error', () => Promise.reject(new TypeError('offline'))],
		['HTTP 500', () => Promise.resolve(jsonResponse(snapshotOf([]), 500))],
		['invalid JSON', () => Promise.resolve(jsonResponse('{oops'))],
		['schemaVersion 2', () => Promise.resolve(jsonResponse({ ...snapshotOf([]), schemaVersion: 2 }))],
	];

	for (const [name, failure] of failures) {
		it(`shows an alert and Try again on ${name}, keeping the other sections`, async () => {
			stubFetch(failure);
			setBrowser(['en-GB']);
			mount();
			await settle();
			const alert = section().querySelector('[role="alert"]')!;
			expect(alert.textContent).toBe("We couldn't load the list of centres.");
			const button = section().querySelector('button')!;
			expect(button.textContent).toBe('Try again');
			expect(button.getAttribute('type')).toBe('button');
			expect(root.querySelectorAll('main h2')).toHaveLength(6);
			expect(centreList()).toBeNull();
		});
	}

	it('re-fetches on Try again and replaces the alert with the list', async () => {
		stubFetch(() => Promise.resolve(jsonResponse(snapshotOf([]), 500)), respond([snapshotCentre('a', { name: 'Alpha' })]));
		setBrowser(['en-GB']);
		mount();
		await settle();
		act(() => section().querySelector('button')!.click());
		expect(section().querySelector('[aria-busy="true"]')).not.toBeNull();
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(section().querySelector('[role="alert"]')).toBeNull();
		expect(section().querySelector('button')).toBeNull();
		expect(centreItems()).toHaveLength(1);
		expect(sectionText()).toContain('1 centres are not checked automatically.');
	});
});

describe('no-location list', () => {
	const unlocated = (id: string, name: string) => snapshotCentre(id, { name, lat: null, lon: null });

	it('has the heading and intro, after #not-checked', () => {
		stubFetch(respond([]));
		setBrowser(['de-DE']);
		mount();
		expect(noLocation().tagName).toBe('SECTION');
		expect(noLocation().querySelector('h2')!.textContent).toBe(de['about.no_location.heading']);
		expect(noLocation().textContent).toContain(de['about.no_location.intro']);
		expect(section().nextElementSibling).toBe(noLocation());
	});

	it('lists every centre without coordinates, whatever its coverage, sorted by name, from one shared snapshot load', async () => {
		stubFetch(
			respond([
				unlocated('z', 'Zeta'),
				coveredCentre('ok', 'ok', { name: 'Covered OK', lat: null, lon: null }),
				snapshotCentre('placed', { name: 'Placed' }),
				snapshotCentre('a', { name: 'Alpha', lat: null, lon: null, test_page_url: null, website: null }),
			]),
		);
		setBrowser(['en-GB']);
		mount();
		expect(noLocation().querySelector('[aria-busy="true"]')!.textContent).toBe('Loading centres…');
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(noLocationItems().map((li) => li.textContent!.replace('↗', '').trim())).toEqual(['Alpha', 'Covered OK', 'Zeta']);
		expect(noLocationItems()[0]!.querySelector('a')).toBeNull();
		expect(noLocationItems()[2]!.querySelector('a')!.getAttribute('href')).toBe('https://z.example.de/test');
		expect(noLocation().textContent).toContain('3 centres have no map position yet.');
		// The covered, ok centre is not in the not-checked list, but is in this one.
		expect(centreItems().map((li) => li.textContent!.replace('↗', '').trim())).toEqual(['Alpha', 'Placed', 'Zeta']);
	});

	it('lists the centres without coordinates of the committed snapshot', async () => {
		const expected = unlocatedCentres(snapshotSchema.parse(epicSnapshot));
		stubFetch(() => Promise.resolve(jsonResponse(epicSnapshot)));
		setBrowser(['de-DE']);
		mount();
		await settle();
		expect(noLocationItems().map((li) => li.querySelector('[lang="de"]')!.textContent)).toEqual(expected.map((c) => c.name));
	});

	it('says every centre has a map position when none lack one', async () => {
		stubFetch(respond([snapshotCentre('a')]));
		setBrowser(['en-GB']);
		mount();
		await settle();
		expect(noLocation().textContent).toContain(en['about.no_location.none']);
		expect(noLocation().querySelector('.about__centre-list')).toBeNull();
	});

	it('shows the load failure with one alert for the page, and Try again in either list reloads both', async () => {
		stubFetch(() => Promise.reject(new TypeError('offline')), respond([unlocated('a', 'Alpha')]));
		setBrowser(['en-GB']);
		mount();
		await settle();
		expect(root.querySelectorAll('[role="alert"]')).toHaveLength(1);
		expect(noLocation().textContent).toContain("We couldn't load the list of centres.");
		act(() => noLocation().querySelector('button')!.click());
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(noLocationItems()).toHaveLength(1);
		expect(centreItems()).toHaveLength(1);
	});
});

describe('fragment targeting', () => {
	let scrolled: HTMLElement[];

	beforeEach(() => {
		scrolled = [];
		vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
			scrolled.push(this as HTMLElement);
		});
	});

	it('scrolls to #no-location again once the lists above it have loaded, and keeps listening for hashchange', async () => {
		stubFetch(respond([snapshotCentre('a', { name: 'Alpha', lat: null, lon: null })]));
		setBrowser(['en-GB'], '#no-location');
		mount();
		expect(scrolled).toEqual([noLocation()]);
		scrolled = [];
		await settle();
		// The list above has grown; the section is scrolled into view again.
		expect(noLocation().querySelector('.about__centre-list')).not.toBeNull();
		expect(scrolled.length).toBeGreaterThan(0);
		expect(scrolled.every((el) => el === noLocation())).toBe(true);
		scrolled = [];
		location.hash = '#not-checked';
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		expect(scrolled).toEqual([section()]);
	});

	it('scrolls the section into view for #not-checked', () => {
		stubFetch(respond([]));
		setBrowser(['en-GB'], '#not-checked');
		mount();
		expect(scrolled).toEqual([section()]);
		expect(document.documentElement.lang).toBe('en');
	});

	it('scrolls for #not-checked=&lang=en and keeps the fragment language', () => {
		stubFetch(respond([]));
		setBrowser(['de-DE'], '#not-checked=&lang=en');
		mount();
		expect(scrolled).toEqual([section()]);
		expect(document.documentElement.lang).toBe('en');
		expect(root.querySelector('h1')!.textContent).toBe(en['about.heading']);
	});

	it('scrolls to the no-location section for #no-location and #no-location=&lang=de', () => {
		stubFetch(respond([]));
		setBrowser(['en-GB'], '#no-location');
		mount();
		expect(scrolled).toEqual([noLocation()]);
		act(() => render(null, root));
		scrolled = [];
		setBrowser(['en-GB'], '#no-location=&lang=de');
		mount();
		expect(scrolled).toEqual([noLocation()]);
		expect(document.documentElement.lang).toBe('de');
		expect(noLocation().querySelector('h2')!.textContent).toBe(de['about.no_location.heading']);
	});

	it('does not scroll without the key, and scrolls on a later hashchange', () => {
		stubFetch(respond([]));
		setBrowser(['de-DE'], '#lang=de');
		mount();
		expect(scrolled).toEqual([]);
		act(() => {
			history.replaceState(null, '', '/testplatz/about/#not-checked');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		});
		expect(scrolled).toEqual([section()]);
	});

	it('keeps the language switch working on a deep link', () => {
		stubFetch(respond([]));
		setBrowser(['de-DE'], '#not-checked');
		mount();
		const enLink = root.querySelector<HTMLAnchorElement>('nav a[hreflang="en"]')!;
		expect(enLink.getAttribute('href')).toBe('#not-checked=&lang=en');
		act(() => enLink.click());
		expect(location.hash).toBe('#not-checked=&lang=en');
		expect(root.querySelector('h1')!.textContent).toBe(en['about.heading']);
	});
});
