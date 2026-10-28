// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotCentre } from '../shared/snapshot.ts';
import { App } from '../web/src/app.tsx';
import { PLACES_URL } from '../web/src/data/places.ts';
import { RELOAD_FLAG } from '../web/src/data/reload-once.ts';
import { SNAPSHOT_URL } from '../web/src/data/snapshot.ts';
import de from '../web/src/i18n/de.json' with { type: 'json' };
import en from '../web/src/i18n/en.json' with { type: 'json' };
import { PLACE_ROWS, placesOf, smallPlaces } from './fixtures/places.ts';
import { jsonResponse, snapshotCentre, snapshotOf } from './fixtures/snapshot.ts';

// ---------- fixtures ----------

const NBG = PLACE_ROWS.nuernberg;

const CENTRES: SnapshotCentre[] = [
	snapshotCentre('erlangen', {
		name: 'vhs Erlangen',
		address: { street: 'Friedrichstraße 19', postcode: '91054', city: 'Erlangen' },
		lat: 49.5897,
		lon: 11.0078,
		website: 'https://www.vhs-erlangen.de/',
		test_page_url: null,
	}),
	snapshotCentre('fuerth', {
		name: 'bfz Fürth',
		address: { street: 'Königstraße 1', postcode: '90762', city: 'Fürth' },
		lat: 49.4771,
		lon: 10.9887,
		website: null,
		test_page_url: null,
	}),
	snapshotCentre('nbg', {
		name: 'Akademie Nürnberg',
		address: { street: 'Bahnhofsplatz 6', postcode: '90443', city: 'Nürnberg' },
		lat: NBG.lat,
		lon: NBG.lon,
		website: 'https://www.akademie.example.de/',
		test_page_url: 'https://kurse.akademie.example.de/test',
	}),
	snapshotCentre('nocoords', { name: 'Ohne Koordinaten', lat: null, lon: null }),
	snapshotCentre('muc', { name: 'vhs München', lat: 48.1374, lon: 11.5755 }),
];

// ---------- harness ----------

let root: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let store: Map<string, string>;
let reload: ReturnType<typeof vi.fn<() => void>>;
let storageThrows: boolean;

type Responder = () => Promise<Response>;
const ok = (body: unknown): Responder => () => Promise.resolve(jsonResponse(body));

function serve(snapshot: Responder = ok(snapshotOf(CENTRES)), places: Responder = ok(smallPlaces())): void {
	fetchMock = vi.fn<typeof fetch>((input) => {
		const url = String(input);
		if (url === SNAPSHOT_URL) return snapshot();
		if (url === PLACES_URL) return places();
		return Promise.reject(new Error(`unexpected request ${url}`));
	});
	vi.stubGlobal('fetch', fetchMock);
}

const fakeStorage = (): Storage =>
	({
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
	}) as Storage;

function setBrowser(hash = '', languages = ['en-GB']): void {
	vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
	history.replaceState(null, '', `/testplatz/${hash}`);
}

function mount(): void {
	act(() => {
		render(
			<App
				services={{
					storage: () => {
						if (storageThrows) throw new Error('blocked');
						return fakeStorage();
					},
					reload,
				}}
			/>,
			root,
		);
	});
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

const field = () => root.querySelector<HTMLInputElement>('input#search-place')!;
const select = () => root.querySelector<HTMLSelectElement>('select')!;
const form = () => root.querySelector<HTMLFormElement>('form[role="search"]')!;
const status = () => root.querySelectorAll('[role="status"]');
const statusText = () => status()[0]!.textContent ?? '';
const alerts = () => [...root.querySelectorAll('[role="alert"]')];
const cards = () => [...root.querySelectorAll<HTMLElement>('ul.results > li > article')];
const cardNames = () => cards().map((card) => card.querySelector('h3')!.textContent);
const buttonByText = (text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);

function type(text: string): void {
	act(() => {
		field().value = text;
		field().dispatchEvent(new Event('input', { bubbles: true }));
	});
}

function chooseRadius(km: number): void {
	act(() => {
		select().value = String(km);
		select().dispatchEvent(new Event('change', { bubbles: true }));
	});
}

function submit(): void {
	act(() => {
		form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	});
}

async function search(text: string, km?: number): Promise<void> {
	type(text);
	if (km !== undefined) chooseRadius(km);
	submit();
	await settle();
}

function navigateHash(hash: string): void {
	act(() => {
		history.pushState(null, '', `/testplatz/${hash}`);
		window.dispatchEvent(new HashChangeEvent('hashchange'));
	});
}

beforeEach(() => {
	root = document.createElement('div');
	document.body.append(root);
	store = new Map();
	reload = vi.fn<() => void>();
	storageThrows = false;
	serve();
});

afterEach(() => {
	act(() => render(null, root));
	root.remove();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// ---------- tests ----------

describe('search page at load', () => {
	it('has the heading, a labelled field and radius select, and a search button', () => {
		setBrowser();
		mount();
		expect(root.querySelector('main h1')!.textContent).toBe(en['search.heading']);
		const label = root.querySelector<HTMLLabelElement>(`label[for="${field().id}"]`)!;
		expect(label.textContent).toBe('Town or postcode');
		expect(root.querySelector(`label[for="${select().id}"]`)!.textContent).toBe('Radius');
		expect([...select().options].map((o) => [o.value, o.textContent])).toEqual([
			['10', '10 km'],
			['20', '20 km'],
			['40', '40 km'],
			['60', '60 km'],
			['100', '100 km'],
		]);
		expect(select().value).toBe('40');
		const button = form().querySelector('button')!;
		expect(button.getAttribute('type')).toBe('submit');
		expect(button.textContent).toBe('Search');
	});

	it('focuses the field and has one empty status region', () => {
		setBrowser();
		mount();
		expect(document.activeElement).toBe(field());
		expect(status()).toHaveLength(1);
		expect(statusText()).toBe('');
	});

	it('requests only the two same-origin data files, in parallel', () => {
		serve(
			() => new Promise(() => {}),
			() => new Promise(() => {}),
		);
		setBrowser();
		mount();
		expect(fetchMock.mock.calls.map((call) => String(call[0])).sort()).toEqual([PLACES_URL, SNAPSHOT_URL].sort());
		expect(SNAPSHOT_URL).toBe('/snapshot.json');
		expect(PLACES_URL).toBe('/places.json');
	});

	it('shows no load error before a search', async () => {
		serve(() => Promise.reject(new TypeError('offline')));
		setBrowser();
		mount();
		await settle();
		expect(alerts()).toEqual([]);
		expect(buttonByText('Try again')).toBeUndefined();
	});
});

describe('a search with results', () => {
	it('lists every centre with coordinates in range, nearest first, with count line and notice', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg', 20);
		expect(cardNames()).toEqual(['Akademie Nürnberg', 'bfz Fürth', 'vhs Erlangen']);
		const results = root.querySelector('.search__results')!;
		const paragraphs = [...results.querySelectorAll(':scope > p')].map((p) => p.textContent);
		expect(paragraphs).toEqual([
			'0 dates and 3 unchecked centres within 20 km',
			'No dates found nearby. These centres may still have dates on their own pages.',
		]);
		expect(statusText()).toBe('0 dates and 3 unchecked centres within 20 km');
	});

	it('writes the search to the fragment without a history entry and keeps focus in the field', async () => {
		setBrowser('', ['de-DE']);
		mount();
		await settle();
		const length = history.length;
		const replace = vi.spyOn(history, 'replaceState');
		await search('  Nürnberg ', 20);
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=20&lang=de');
		expect(location.search).toBe('');
		expect(replace).toHaveBeenCalled();
		expect(history.length).toBe(length);
		expect(document.activeElement).toBe(field());
		expect(field().value).toBe('  Nürnberg ');
	});

	it('gives the same results for spelling variants and the postcode', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg');
		const expected = cardNames();
		expect(expected).toHaveLength(3);
		let announcement = status()[0]!.firstElementChild;
		for (const variant of ['nuernberg', 'NÜRNBERG', '90443']) {
			await search(variant);
			expect(cardNames(), variant).toEqual(expected);
			// The same count line is announced again: the status region gets a new element.
			const next = status()[0]!.firstElementChild;
			expect(next, variant).not.toBeNull();
			expect(next, variant).not.toBe(announcement);
			expect(next!.textContent).toBe(statusText());
			announcement = next;
		}
	});

	it('uses the singular count line for one centre', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg', 10);
		expect(cardNames()).toEqual(['Akademie Nürnberg', 'bfz Fürth']);
		await search('München', 10);
		expect(cardNames()).toEqual(['vhs München']);
		expect(statusText()).toBe('0 dates and 1 unchecked centre within 10 km');
	});

	it('does not search when only the radius changes, or for blank input', async () => {
		setBrowser();
		mount();
		await settle();
		chooseRadius(100);
		expect(cards()).toEqual([]);
		await search('   ');
		expect(cards()).toEqual([]);
		expect(location.hash).toBe('');
		expect(statusText()).toBe('');
	});

	it('never refetches or refreshes while the page is open', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg', 20);
		vi.useFakeTimers();
		act(() => {
			vi.advanceTimersByTime(60 * 60 * 1000);
		});
		vi.useRealTimers();
		await search('Augsburg', 100);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('uncovered card', () => {
	async function nurembergCards(lang: 'en' | 'de' = 'en'): Promise<HTMLElement[]> {
		setBrowser('', [lang === 'en' ? 'en-GB' : 'de-DE']);
		mount();
		await settle();
		await search('Nürnberg', 20);
		return cards();
	}

	it('is one stretched link to the test page with a full link name', async () => {
		const [card] = await nurembergCards();
		const h3 = card!.querySelector('h3')!;
		expect(h3.getAttribute('lang')).toBe('de');
		const link = h3.querySelector('a')!;
		expect(link.getAttribute('href')).toBe('https://kurse.akademie.example.de/test');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.getAttribute('aria-label')).toBe('Akademie Nürnberg, not checked, opens kurse.akademie.example.de in a new tab');
		expect(root.querySelectorAll('a a')).toHaveLength(0);
		// Map and Why? are siblings of the link, never inside it.
		expect(link.contains(card!.querySelector('.card__map'))).toBe(false);
		expect(link.contains(card!.querySelector('.card__why'))).toBe(false);
	});

	it('falls back to the website and strips www from the domain', async () => {
		const erlangen = (await nurembergCards())[2]!;
		const link = erlangen.querySelector('h3 a')!;
		expect(link.getAttribute('href')).toBe('https://www.vhs-erlangen.de/');
		expect(link.getAttribute('aria-label')).toBe('vhs Erlangen, not checked, opens vhs-erlangen.de in a new tab');
		const destination = erlangen.querySelector('.card__destination')!;
		expect(destination.textContent).toBe('vhs-erlangen.de ↗');
		expect(destination.getAttribute('aria-hidden')).toBe('true');
	});

	it('shows the chip, address with Map, body line and key facts in order', async () => {
		const [card] = await nurembergCards();
		const chip = card!.querySelector('.chip')!;
		expect(chip.textContent).toBe('Not checked');
		expect(chip.getAttribute('aria-hidden')).toBe('true');

		expect(card!.querySelector('.card__address-text')!.textContent).toBe('Bahnhofsplatz 6, 90443 Nürnberg');
		const map = card!.querySelector<HTMLAnchorElement>('.card__map')!;
		expect(map.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Bahnhofsplatz%206%2C%2090443%20N%C3%BCrnberg');
		expect(map.getAttribute('target')).toBe('_blank');
		expect(map.getAttribute('rel')).toBe('noopener noreferrer');
		expect(map.getAttribute('aria-label')).toBe('Map: Bahnhofsplatz 6, 90443 Nürnberg (Google Maps, new tab)');
		expect(map.textContent).toBe('Map↗');

		expect(card!.querySelector('.card__body')!.textContent).toBe("Not checked automatically. See the centre's page.");

		const dl = card!.querySelector('dl')!;
		const facts = [...dl.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
		expect(facts).toEqual([
			['Distance', '0 km'],
			['Status', 'Not checked'],
			['Deadline', 'see website'],
			['Registration', 'see website'],
		]);

		const order = [...card!.children].map((el) => el.className);
		expect(order).toEqual(['card__top', 'card__address', 'card__body', 'card__facts', 'card__bottom']);
		expect(card!.textContent).not.toMatch(/Checked \d/);
	});

	it('shows the distance in whole km', async () => {
		const names = await nurembergCards();
		const distance = (card: HTMLElement) => card.querySelector('dd')!.textContent;
		expect(names.map(distance)).toEqual(['0 km', '7 km', '16 km']);
	});

	it('links Why? to About #not-checked in the same tab, in the current language', async () => {
		const [card] = await nurembergCards('de');
		const why = card!.querySelector<HTMLAnchorElement>('.card__why')!;
		expect(why.textContent).toBe(de['card.why']);
		expect(why.getAttribute('href')).toBe('/about/#not-checked=&lang=de');
		expect(why.hasAttribute('target')).toBe(false);
		expect(why.getAttribute('aria-label')).toBe('Warum wird Akademie Nürnberg nicht geprüft?');
	});

	it('has no link and no destination when the centre has no URL', async () => {
		const fuerth = (await nurembergCards())[1]!;
		expect(fuerth.querySelector('h3')!.textContent).toBe('bfz Fürth');
		expect(fuerth.querySelector('h3 a')).toBeNull();
		expect(fuerth.querySelector('.card__destination')).toBeNull();
		expect(fuerth.querySelector('.card__map')).not.toBeNull();
		expect(fuerth.querySelector('.card__why')).not.toBeNull();
	});
});

describe('field errors', () => {
	it('shows Bavaria only for a place elsewhere, keeps the input and links the message', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg');
		expect(cards()).toHaveLength(3);
		for (const input of ['Kiel', '24103']) {
			await search(input);
			const [alert] = alerts();
			expect(alert!.textContent).toBe(en['error.outside_bavaria']);
			expect(alert!.tagName).toBe('P');
			expect(field().getAttribute('aria-invalid')).toBe('true');
			expect(field().getAttribute('aria-describedby')).toBe(alert!.id);
			expect(field().value).toBe(input);
			expect(cards()).toEqual([]);
			expect(root.querySelector('.search__results')!.textContent).toBe('');
		}
	});

	it('shows place-not-found with Bavarian suggestions that run the search', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nurnbreg', 20);
		const [alert] = alerts();
		expect(alert!.textContent).toBe(en['error.place_not_found']);
		const links = [...root.querySelectorAll<HTMLAnchorElement>('.field-message__suggestion')];
		expect(links.map((a) => a.textContent)).toEqual(['Did you mean Nürnberg?']);
		expect(links[0]!.getAttribute('href')).toBe('#q=N%C3%BCrnberg&r=20&lang=en');
		expect(location.hash).toBe('#q=Nurnbreg&r=20&lang=en');

		navigateHash(links[0]!.getAttribute('href')!);
		await settle();
		expect(field().value).toBe('Nürnberg');
		expect(alerts()).toEqual([]);
		expect(field().hasAttribute('aria-invalid')).toBe(false);
		expect(field().hasAttribute('aria-describedby')).toBe(false);
		expect(cardNames()).toEqual(['Akademie Nürnberg', 'bfz Fürth', 'vhs Erlangen']);
	});

	it('remounts the alert for a repeated error, and clears the status region', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg');
		expect(statusText()).not.toBe('');
		await search('Kiel');
		const first = alerts()[0]!;
		expect(statusText()).toBe('');
		await search('24103');
		const second = alerts()[0]!;
		expect(second.textContent).toBe(first.textContent);
		expect(second).not.toBe(first);
		expect(first.isConnected).toBe(false);
		expect(field().getAttribute('aria-describedby')).toBe(second.id);
	});

	it('gives no suggestions for unknown digits', async () => {
		setBrowser();
		mount();
		await settle();
		await search('12');
		expect(alerts()[0]!.textContent).toBe(en['error.place_not_found']);
		expect(root.querySelectorAll('.field-message__suggestion')).toHaveLength(0);
	});

	it('re-renders the message in the new language', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Kiel');
		act(() => root.querySelector<HTMLAnchorElement>('nav a[hreflang="de"]')!.click());
		expect(alerts()[0]!.textContent).toBe(de['error.outside_bavaria']);
		expect(location.hash).toBe('#q=Kiel&r=40&lang=de');
	});
});

describe('no centres in range', () => {
	it('offers the next radius, which reruns the search and keeps focus in the field', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Augsburg', 10);
		expect(root.querySelector('.search__results')!.textContent).toContain('No test centres within 10 km.');
		expect(statusText()).toBe('No test centres within 10 km.');
		const next = buttonByText('Search 20 km')!;
		expect(next.className).toContain('button-secondary');
		type('edited text');
		act(() => next.click());
		await settle();
		expect(field().value).toBe('Augsburg');
		expect(select().value).toBe('20');
		expect(location.hash).toBe('#q=Augsburg&r=20&lang=en');
		expect(document.activeElement).toBe(field());
		expect(root.querySelector('.search__results')!.textContent).toContain('No test centres within 20 km.');
	});

	it('offers no button at 100 km', async () => {
		serve(ok(snapshotOf([snapshotCentre('hof', { lat: 50.31, lon: 11.91 })])));
		setBrowser();
		mount();
		await settle();
		await search('München', 100);
		expect(root.querySelector('.search__results')!.textContent).toBe('No test centres within 100 km.');
		expect(root.querySelector('.search__results button')).toBeNull();
	});
});

describe('shared links and the fragment', () => {
	it('runs the search of a shared link', async () => {
		setBrowser('#q=Augsburg&r=20&lang=en', ['de-DE']);
		serve(ok(snapshotOf([snapshotCentre('aug', { name: 'vhs Augsburg', lat: 48.37, lon: 10.9 })])));
		mount();
		await settle();
		expect(document.documentElement.lang).toBe('en');
		expect(field().value).toBe('Augsburg');
		expect(select().value).toBe('20');
		expect(cardNames()).toEqual(['vhs Augsburg']);
		expect(location.hash).toBe('#q=Augsburg&r=20&lang=en');
	});

	for (const [r, hash] of [
		['r=35', '#q=Augsburg&r=35&lang=en'],
		['r=30', '#q=Augsburg&r=30&lang=en'],
		['r=abc', '#q=Augsburg&r=abc&lang=en'],
		['no r', '#q=Augsburg&lang=en'],
	] as const) {
		it(`snaps ${r} to 40 and rewrites the fragment`, async () => {
			setBrowser(hash);
			mount();
			await settle();
			expect(select().value).toBe('40');
			expect(location.hash).toBe('#q=Augsburg&r=40&lang=en');
		});
	}

	it('shows place-not-found for an unknown place in a link, with the text filled in', async () => {
		setBrowser('#q=Atlantis&lang=en');
		mount();
		await settle();
		expect(field().value).toBe('Atlantis');
		expect(alerts()[0]!.textContent).toBe(en['error.place_not_found']);
	});

	it('reruns on a hashchange with a new q or r, but not on a lang-only change', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg', 20);
		const announcement = status()[0]!.firstElementChild;
		expect(announcement).not.toBeNull();

		act(() => {
			history.replaceState(null, '', '/testplatz/#q=N%C3%BCrnberg&r=20&lang=de');
			window.dispatchEvent(new HashChangeEvent('hashchange'));
		});
		await settle();
		expect(status()[0]!.firstElementChild).toBe(announcement);
		expect(cardNames()).toHaveLength(3);

		navigateHash('#q=N%C3%BCrnberg&r=10&lang=de');
		await settle();
		expect(select().value).toBe('10');
		expect(cardNames()).toHaveLength(2);

		navigateHash('#q=M%C3%BCnchen&r=10&lang=de');
		await settle();
		expect(field().value).toBe('München');
		expect(cardNames()).toEqual(['vhs München']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('keeps the results on a language switch, without a rerun', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg', 20);
		const before = cards();
		const announcement = status()[0]!.firstElementChild;
		act(() => root.querySelector<HTMLAnchorElement>('nav a[hreflang="de"]')!.click());
		expect(cards()).toEqual(before);
		expect(status()[0]!.firstElementChild).toBe(announcement);
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=20&lang=de');
		expect(before[0]!.querySelector('.card__body')!.textContent).toBe(de['card.not_checked_automatically']);
		expect(root.querySelector('.search__results > p')!.textContent).toBe('0 Termine und 3 nicht geprüfte Testzentren im Umkreis von 20 km');
		expect(before[0]!.querySelector('.card__why')!.getAttribute('href')).toBe('/about/#not-checked=&lang=de');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('loading', () => {
	it('shows 3 static skeletons, announces loading once, and runs the search on arrival', async () => {
		let resolveSnapshot: (response: Response) => void = () => {};
		serve(() => new Promise((resolve) => (resolveSnapshot = resolve)));
		setBrowser();
		mount();
		await settle();
		type('Nürnberg');
		submit();
		const busy = root.querySelector('[aria-busy="true"]')!;
		expect(busy).not.toBeNull();
		expect(busy.querySelectorAll('li.skeleton')).toHaveLength(3);
		for (const skeleton of busy.querySelectorAll('li')) expect(skeleton.querySelectorAll('.skeleton__bar')).toHaveLength(3);
		expect(statusText()).toBe('Loading dates…');
		expect(document.activeElement).toBe(field());
		// A second submit while still waiting does not announce loading again.
		const loading = status()[0]!.firstElementChild;
		type('Fürth');
		submit();
		expect(status()[0]!.firstElementChild).toBe(loading);
		type('Nürnberg');
		submit();

		await act(async () => {
			resolveSnapshot(jsonResponse(snapshotOf(CENTRES)));
		});
		await settle();
		expect(root.querySelector('[aria-busy="true"]')).toBeNull();
		expect(cardNames()).toHaveLength(3);
		expect(statusText()).toBe('0 dates and 3 unchecked centres within 40 km');
	});
});

describe('load failure', () => {
	const failures: Array<[string, Responder]> = [
		['a network error', () => Promise.reject(new TypeError('offline'))],
		['HTTP 500', () => Promise.resolve(jsonResponse(snapshotOf(CENTRES), 500))],
		['bad JSON', () => Promise.resolve(jsonResponse('{not json'))],
		['a schema error', ok({ ...snapshotOf(CENTRES), centres: 'nope' })],
	];

	for (const [name, failing] of failures) {
		for (const file of ['snapshot', 'places'] as const) {
			it(`shows the load error for ${name} in ${file}.json, and Try again recovers`, async () => {
				let calls = 0;
				const good = file === 'snapshot' ? ok(snapshotOf(CENTRES)) : ok(smallPlaces());
				const flaky: Responder = () => (calls++ === 0 ? failing() : good());
				if (file === 'snapshot') serve(flaky);
				else serve(undefined, flaky);
				setBrowser();
				mount();
				await settle();
				await search('Nürnberg');
				const [alert] = alerts();
				expect(alert!.textContent).toBe(en['search.load_error']);
				expect(alert!.className).toContain('load-failure__text');
				const retry = buttonByText('Try again')!;
				expect(retry.className).toContain('button-secondary');

				act(() => retry.click());
				await settle();
				expect(fetchMock).toHaveBeenCalledTimes(4);
				expect(alerts()).toEqual([]);
				expect(cardNames()).toHaveLength(3);
				expect(document.activeElement).toBe(field());
			});
		}
	}
});

describe('schemaVersion mismatch', () => {
	const newerSnapshot = ok({ ...snapshotOf(CENTRES), schemaVersion: 2 });
	const newerPlaces = ok({ ...placesOf([NBG]), schemaVersion: 2 });

	it('reloads once and sets the flag', async () => {
		serve(newerSnapshot);
		setBrowser();
		mount();
		await settle();
		expect(reload).toHaveBeenCalledTimes(1);
		expect(store.get(RELOAD_FLAG)).toBe('1');
		await search('Nürnberg');
		expect(alerts()).toEqual([]);
		expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
	});

	it('reloads for a places.json mismatch too', async () => {
		serve(undefined, newerPlaces);
		setBrowser();
		mount();
		await settle();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('shows the load error when the flag is already set', async () => {
		store.set(RELOAD_FLAG, '1');
		serve(newerSnapshot);
		setBrowser();
		mount();
		await settle();
		expect(reload).not.toHaveBeenCalled();
		await search('Nürnberg');
		expect(alerts()[0]!.textContent).toBe(en['search.load_error']);
	});

	it('shows the load error when sessionStorage throws', async () => {
		storageThrows = true;
		serve(newerSnapshot);
		setBrowser();
		mount();
		await settle();
		expect(reload).not.toHaveBeenCalled();
		await search('Nürnberg');
		expect(alerts()[0]!.textContent).toBe(en['search.load_error']);
	});

	it('clears the flag after a successful load', async () => {
		store.set(RELOAD_FLAG, '1');
		setBrowser();
		mount();
		await settle();
		expect(store.has(RELOAD_FLAG)).toBe(false);
	});
});
