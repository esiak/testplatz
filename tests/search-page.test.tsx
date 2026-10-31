// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_SCHEMA_VERSION, type SnapshotCentre, type SnapshotListing } from '../shared/snapshot.ts';
import { App } from '../web/src/app.tsx';
import { PLACES_URL } from '../web/src/data/places.ts';
import { RELOAD_FLAG } from '../web/src/data/reload-once.ts';
import { SNAPSHOT_URL } from '../web/src/data/snapshot.ts';
import de from '../web/src/i18n/de.json' with { type: 'json' };
import en from '../web/src/i18n/en.json' with { type: 'json' };
import { PLACE_ROWS, placeRow, placesOf, smallPlaces } from './fixtures/places.ts';
import { coveredCentre, jsonResponse, snapshotCentre, snapshotListing, snapshotOf } from './fixtures/snapshot.ts';

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
	// No map position, and in none of the searched places: only the hidden notice counts it.
	snapshotCentre('nocoords', {
		name: 'Ohne Koordinaten',
		address: { street: 'Kulmbacher Str. 1', postcode: '96317', city: 'Kronach' },
		lat: null,
		lon: null,
	}),
	snapshotCentre('muc', { name: 'vhs München', lat: 48.1374, lon: 11.5755 }),
];

/** A listing of `centre` held at the centre's own coordinates. */
const listingOf = (centre: SnapshotCentre, startsAt: string, extra: Partial<SnapshotListing> = {}): SnapshotListing =>
	snapshotListing(centre.centre_id, startsAt, { lat: centre.lat, lon: centre.lon, ...extra });

// ---------- harness ----------

let root: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let store: Map<string, string>;
let reload: ReturnType<typeof vi.fn<() => void>>;
let storageThrows: boolean;
/** What the injected clock returns. */
let clockNow: number;
const DEFAULT_NOW = Date.parse('2026-10-29T12:00:00Z');

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
					now: () => clockNow,
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
	clockNow = DEFAULT_NOW;
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
			'1 centre has no map position yet and may be nearby. See which',
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
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=20&sort=soonest&lang=de');
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

describe('result cards', () => {
	// Thursday 29 Oct 2026, 13:00 in Berlin.
	const NOW = DEFAULT_NOW;
	const kufer = coveredCentre('kufer', 'ok', {
		name: 'vhs Nürnberg',
		address: { street: 'Gewerbemuseumsplatz 1', postcode: '90403', city: 'Nürnberg' },
		lat: NBG.lat,
		lon: NBG.lon,
		website: 'https://www.vhs-nuernberg.de/',
		test_page_url: 'https://www.vhs-nuernberg.de/einbuergerungstest',
		last_success_at: '2026-10-29T10:00:00Z',
	});
	const item = coveredCentre('item', 'ok', {
		name: 'Bildungszentrum Fürth',
		address: { street: 'Königstraße 1', postcode: '90762', city: 'Fürth' },
		lat: 49.4771,
		lon: 10.9887,
		website: 'https://www.bz-fuerth.de/',
		test_page_url: 'https://www.bz-fuerth.de/test',
		// 47 h before NOW: Tuesday 14:00 in Berlin.
		last_success_at: '2026-10-27T13:00:00Z',
	});
	const stale = coveredCentre('stale', 'ok', {
		name: 'vhs Erlangen',
		address: { street: 'Friedrichstraße 19', postcode: '91054', city: 'Erlangen' },
		lat: 49.5897,
		lon: 11.0078,
	});
	const akademie = CENTRES.find((centre) => centre.centre_id === 'nbg')!;

	const waitlist = listingOf(kufer, '2026-12-09T10:00:00+01:00', {
		address: 'Gewerbemuseumsplatz 1, 90403 Nürnberg',
		status: 'waitlist',
		deadline: '2026-11-11',
		registration_method: 'online',
		source_url: 'https://www.vhs-nuernberg.de/kurs/123',
		eligibility: 'Nur für Personen mit Hauptwohnsitz in Nürnberg.',
	});
	const deadLink = listingOf(item, '2026-11-20T09:00:00+01:00', {
		address: 'Königstraße 1, 90762 Fürth',
		status: 'free',
		deadline: '2026-10-28',
		source_url: 'https://item.example.de/kurs/9',
		link_ok: false,
	});
	// Started an hour before NOW.
	const pastSameCentre = listingOf(kufer, '2026-10-29T12:00:00+01:00');
	const pastOnly = listingOf(stale, '2026-10-20T10:00:00+02:00');

	async function show(listings = [waitlist, deadLink, pastSameCentre, pastOnly], lang: 'en' | 'de' = 'en'): Promise<HTMLElement[]> {
		return showWith([kufer, item, stale, akademie], listings, lang);
	}

	async function showWith(centres: SnapshotCentre[], listings: SnapshotListing[], lang: 'en' | 'de' = 'en'): Promise<HTMLElement[]> {
		act(() => render(null, root));
		serve(ok(snapshotOf(centres, listings)));
		clockNow = NOW;
		setBrowser('', [lang === 'en' ? 'en-GB' : 'de-DE']);
		mount();
		await settle();
		await search('Nürnberg', 20);
		return cards();
	}

	const facts = (card: HTMLElement) => [...card.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
	const paragraphs = () => [...root.querySelectorAll('.search__results > p')].map((p) => p.textContent);

	it('lists dates by start, hides past ones, then the centres without a date in the outcome order', async () => {
		const shown = await show();
		expect(cardNames()).toEqual(['Fri 20 Nov, 09:00', 'Wed 9 Dec, 10:00', 'Akademie Nürnberg', 'vhs Erlangen']);
		// Akademie has no reader: uncovered. vhs Erlangen was checked and only had past dates: no dates.
		expect(shown[2]!.querySelector('.card__why')).not.toBeNull();
		expect(shown[3]!.querySelector('.card__why')).toBeNull();
		expect(shown[3]!.querySelector('.chip')!.textContent).toBe('No dates listed');
		expect(root.textContent).not.toContain('Thu 29 Oct');
	});

	it('counts the dates and the uncovered cards in the count line and the announcement, with no no-dates notice', async () => {
		await show();
		expect(paragraphs()).toEqual(['2 dates and 1 unchecked centre within 20 km']);
		expect(statusText()).toBe('2 dates and 1 unchecked centre within 20 km');
	});

	it('uses the singular and plural forms, counting only uncovered cards as unchecked', async () => {
		await showWith([kufer, item, akademie, { ...stale, last_result: 'failed' }], [waitlist]);
		expect(statusText()).toBe('1 date and 2 unchecked centres within 20 km');
		// One dated centre, one no-dates centre (stale), one uncovered centre (akademie).
		await showWith([kufer, stale, akademie], [waitlist]);
		expect(cards()).toHaveLength(3);
		expect(statusText()).toBe('1 date and 1 unchecked centre within 20 km');
		await showWith([kufer, item, akademie], [waitlist, deadLink]);
		expect(statusText()).toBe('2 dates and 1 unchecked centre within 20 km');
		await showWith([kufer, akademie], [waitlist]);
		expect(statusText()).toBe('1 date and 1 unchecked centre within 20 km');
		await showWith([kufer, akademie], [waitlist], 'de');
		expect(statusText()).toBe('1 Termin und 1 nicht geprüftes Testzentrum im Umkreis von 20 km');
	});

	it('reads "less than 1 h" for a check under an hour ago, in both languages', async () => {
		const fresh = { ...kufer, last_success_at: '2026-10-29T11:30:00Z' };
		await showWith([fresh], [waitlist]);
		expect(cards()[0]!.querySelector('.card__freshness')!.textContent).toBe('Checked less than 1 h ago');
		await showWith([fresh], [waitlist], 'de');
		expect(cards()[0]!.querySelector('.card__freshness')!.textContent).toBe('Vor weniger als 1 Std. geprüft');
	});

	it('shows "Booked out" and the email and post registration words', async () => {
		const booked = listingOf(kufer, '2026-12-01T18:30:00+01:00', { status: 'booked_out', registration_method: 'email' });
		const byPost = listingOf(kufer, '2026-12-02T18:30:00+01:00', { registration_method: 'post' });
		const [first, second] = await showWith([kufer], [booked, byPost]);
		const chip = first!.querySelector('.chip')!;
		expect(chip.textContent).toBe('Booked out');
		expect(chip.classList.contains('chip--booked')).toBe(true);
		expect(first!.querySelector('h3 a')!.getAttribute('aria-label')).toBe(
			'Tue 1 Dec, 18:30, vhs Nürnberg, Booked out, opens kufer.example.de in a new tab',
		);
		expect(facts(first!)[1]).toEqual(['Status', 'Booked out']);
		expect(facts(first!)[3]).toEqual(['Registration', 'Email']);
		expect(facts(second!)[3]).toEqual(['Registration', 'Post']);
	});

	it('shows a date of a centre without coordinates in the searched place with distance unknown', async () => {
		const unplaced = coveredCentre('unplaced', 'ok', {
			name: 'Bildungswerk Nürnberg',
			address: { street: 'Hauptstraße 1', postcode: '90402', city: 'Nürnberg' },
			lat: null,
			lon: null,
		});
		const [card] = await showWith([unplaced], [listingOf(unplaced, '2026-12-01T18:30:00+01:00')]);
		expect(card!.querySelector('h3 a')!.textContent).toBe('Tue 1 Dec, 18:30');
		expect(facts(card!)[0]).toEqual(['Distance', 'unknown']);
	});

	it('opens the website, or else the dead deep link, with its domain, when the centre has no test page', async () => {
		const noTestPage = { ...item, test_page_url: null };
		let [card] = await showWith([noTestPage], [deadLink]);
		expect(card!.querySelector('h3 a')!.getAttribute('href')).toBe('https://www.bz-fuerth.de/');
		expect(card!.querySelector('.card__destination')!.textContent).toBe('bz-fuerth.de ↗');
		[card] = await showWith([{ ...noTestPage, website: null }], [deadLink]);
		expect(card!.querySelector('h3 a')!.getAttribute('href')).toBe('https://item.example.de/kurs/9');
		expect(card!.querySelector('.card__destination')!.textContent).toBe('item.example.de ↗');
		expect(card!.querySelector('h3 a')!.getAttribute('aria-label')).toBe(
			'Fri 20 Nov, 09:00, Bildungszentrum Fürth, Free seats, opens item.example.de in a new tab',
		);
	});

	it('shows the no-dates notice and reverts the centre when all its dates are past', async () => {
		await show([pastSameCentre, pastOnly]);
		expect(paragraphs()).toEqual([
			'0 dates and 1 unchecked centre within 20 km',
			'No dates found nearby. These centres may still have dates on their own pages.',
		]);
		expect(cardNames()).toEqual(['Akademie Nürnberg', 'vhs Nürnberg', 'Bildungszentrum Fürth', 'vhs Erlangen']);
	});

	it('has every part in order, with the date as a stretched link to the date page', async () => {
		const card = (await show())[1]!;
		expect([...card.children].map((el) => el.className)).toEqual([
			'card__top',
			'card__centre',
			'card__address',
			'card__facts',
			'card__eligibility',
			'card__bottom',
		]);
		const link = card.querySelector<HTMLAnchorElement>('h3 a')!;
		expect(link.textContent).toBe('Wed 9 Dec, 10:00');
		expect(link.getAttribute('href')).toBe('https://www.vhs-nuernberg.de/kurs/123');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.getAttribute('aria-label')).toBe(
			'Wed 9 Dec, 10:00, vhs Nürnberg, Booked out, waitlist open, opens vhs-nuernberg.de in a new tab',
		);
		expect(root.querySelectorAll('a a')).toHaveLength(0);

		const chip = card.querySelector('.chip')!;
		expect(chip.textContent).toBe('Booked out · Waitlist');
		expect(chip.getAttribute('aria-hidden')).toBe('true');
		expect(chip.classList.contains('chip--booked')).toBe(true);

		const centre = card.querySelector('.card__centre')!;
		expect(centre.textContent).toBe('vhs Nürnberg');
		expect(centre.getAttribute('lang')).toBe('de');

		expect(card.querySelector('.card__address-text')!.textContent).toBe('Gewerbemuseumsplatz 1, 90403 Nürnberg');
		const map = card.querySelector('.card__map')!;
		expect(link.contains(map)).toBe(false);
		expect(map.getAttribute('aria-label')).toBe('Map: Gewerbemuseumsplatz 1, 90403 Nürnberg (Google Maps, new tab)');
		expect(map.querySelector('[aria-hidden="true"]')!.textContent).toBe('↗');

		expect(facts(card).map(([label]) => label)).toEqual(['Distance', 'Status', 'Deadline', 'Registration']);
		expect(facts(card)[0]![1]).toBe('0 km');
		expect(facts(card)[2]![1]).toBe('11 Nov');
		expect(facts(card)[3]![1]).toBe('Online');
		const statusCell = card.querySelectorAll('dd')[1]!;
		expect(statusCell.querySelector('[aria-hidden="true"]')!.textContent).toBe('Booked out · Waitlist');
		expect(statusCell.querySelector('.visually-hidden')!.textContent).toBe('Booked out, waitlist open');

		const destination = card.querySelector('.card__destination')!;
		expect(destination.textContent).toBe('vhs-nuernberg.de ↗');
		expect(destination.getAttribute('aria-hidden')).toBe('true');

		const time = card.querySelector('.card__freshness time')!;
		expect(time.textContent).toBe('Checked 2 h ago');
		expect(time.getAttribute('datetime')).toBe('2026-10-29T10:00:00Z');
	});

	it('shows the eligibility text as published, in German, outside the link', async () => {
		const card = (await show())[1]!;
		const line = card.querySelector('.card__eligibility')!;
		expect(line.textContent).toBe('Who may register: Nur für Personen mit Hauptwohnsitz in Nürnberg.');
		const text = line.querySelector('[lang="de"]')!;
		expect(text.textContent).toBe('Nur für Personen mit Hauptwohnsitz in Nürnberg.');
		expect(card.querySelector('h3 a')!.contains(text)).toBe(false);
	});

	it('opens the test page for a dead deep link, with passed deadline, unknowns and the exact freshness time', async () => {
		const card = (await show())[0]!;
		const link = card.querySelector<HTMLAnchorElement>('h3 a')!;
		expect(link.getAttribute('href')).toBe('https://www.bz-fuerth.de/test');
		expect(link.getAttribute('aria-label')).toBe('Fri 20 Nov, 09:00, Bildungszentrum Fürth, Free seats, opens bz-fuerth.de in a new tab');
		expect(card.querySelector('.card__destination')!.textContent).toBe("Opens the centre's test page");
		const chip = card.querySelector('.chip')!;
		expect(chip.textContent).toBe('Free seats');
		expect(chip.classList.contains('chip--free')).toBe(true);
		expect(facts(card)).toEqual([
			['Distance', '7 km'],
			['Status', 'Free seats'],
			['Deadline', 'Passed'],
			['Registration', 'unknown'],
		]);
		expect(card.querySelector('.card__eligibility')!.textContent).toBe('Who may register: not stated, check the provider page');
		const time = card.querySelector('.card__freshness time')!;
		expect(time.textContent).toBe('◷ Checked Tue 14:00');
		expect(time.querySelector('[aria-hidden="true"]')!.textContent).toBe('◷');
	});

	it('shows "Status unknown" and in-person registration, and no freshness line without a successful check', async () => {
		const unknown = listingOf(kufer, '2026-12-01T18:30:00+01:00', { status: 'unknown', registration_method: 'in_person' });
		serve(ok(snapshotOf([{ ...kufer, last_success_at: null, last_result: 'failed' }], [unknown])));
		setBrowser();
		mount();
		await settle();
		await search('Nürnberg', 20);
		const card = cards()[0]!;
		const chip = card.querySelector('.chip')!;
		expect(chip.textContent).toBe('Status unknown');
		expect(chip.classList.contains('chip--unknown')).toBe(true);
		expect(facts(card)[1]).toEqual(['Status', 'Status unknown']);
		expect(facts(card)[3]).toEqual(['Registration', 'In person']);
		expect(card.querySelector('.card__freshness')).toBeNull();
	});

	it('uses the German formats and words', async () => {
		const card = (await show(undefined, 'de'))[1]!;
		expect(card.querySelector('h3 a')!.textContent).toBe('Mi., 9. Dez., 10:00');
		expect(card.querySelector('h3 a')!.getAttribute('aria-label')).toBe(
			'Mi., 9. Dez., 10:00, vhs Nürnberg, Ausgebucht, Warteliste offen, öffnet vhs-nuernberg.de in einem neuen Tab',
		);
		expect(facts(card)[2]).toEqual(['Anmeldeschluss', '11. Nov.']);
		expect(card.querySelector('.card__freshness')!.textContent).toBe('Vor 2 Std. geprüft');
		expect(statusText()).toBe('2 Termine und 1 nicht geprüftes Testzentrum im Umkreis von 20 km');
	});
});

describe('no-dates and not-checked-right-now cards', () => {
	// Thursday 29 Oct 2026, 13:00 in Berlin.
	const NOW = DEFAULT_NOW;
	const checked = coveredCentre('checked', 'ok', {
		name: 'vhs Nürnberg',
		address: { street: 'Gewerbemuseumsplatz 1', postcode: '90403', city: 'Nürnberg' },
		lat: NBG.lat,
		lon: NBG.lon,
		website: 'https://www.vhs-nuernberg.de/',
		test_page_url: 'https://www.vhs-nuernberg.de/einbuergerungstest',
		last_success_at: '2026-10-29T10:00:00Z',
	});
	const failed = coveredCentre('failed', 'failed', {
		name: 'Bildungszentrum Fürth',
		address: { street: 'Königstraße 1', postcode: '90762', city: 'Fürth' },
		lat: 49.4771,
		lon: 10.9887,
		website: 'https://www.bz-fuerth.de/',
		test_page_url: 'https://www.bz-fuerth.de/test',
		// 40 h before NOW: Tuesday 21:00 in Berlin.
		last_success_at: '2026-10-27T20:00:00Z',
	});
	const never = coveredCentre('never', null, {
		name: 'vhs Erlangen',
		address: { street: 'Friedrichstraße 19', postcode: '91054', city: 'Erlangen' },
		lat: 49.5897,
		lon: 11.0078,
	});
	const akademie = CENTRES.find((centre) => centre.centre_id === 'nbg')!;

	async function showWith(centres: SnapshotCentre[], listings: SnapshotListing[] = [], lang: 'en' | 'de' = 'en'): Promise<HTMLElement[]> {
		act(() => render(null, root));
		serve(ok(snapshotOf(centres, listings)));
		clockNow = NOW;
		setBrowser('', [lang === 'en' ? 'en-GB' : 'de-DE']);
		mount();
		await settle();
		await search('Nürnberg', 20);
		return cards();
	}

	const facts = (card: HTMLElement) => [...card.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
	const paragraphs = () => [...root.querySelectorAll('.search__results > p')].map((p) => p.textContent);
	const byName = (name: string) => cards().find((card) => card.querySelector('h3')!.textContent === name)!;

	it('gives a checked centre with nothing listed a no-dates card with every part, linked to its test page', async () => {
		const [card] = await showWith([checked]);
		expect([...card!.children].map((el) => el.className)).toEqual(['card__top', 'card__address', 'card__facts', 'card__bottom']);

		const h3 = card!.querySelector('h3')!;
		expect(h3.className).toBe('card__name');
		expect(h3.getAttribute('lang')).toBe('de');
		const link = h3.querySelector<HTMLAnchorElement>('a.card__link')!;
		expect(link.textContent).toBe('vhs Nürnberg');
		expect(link.getAttribute('href')).toBe('https://www.vhs-nuernberg.de/einbuergerungstest');
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(link.getAttribute('aria-label')).toBe('vhs Nürnberg, no dates listed, opens vhs-nuernberg.de in a new tab');
		expect(root.querySelectorAll('a a')).toHaveLength(0);

		const chip = card!.querySelector('.chip')!;
		expect(chip.textContent).toBe('No dates listed');
		expect(chip.getAttribute('aria-hidden')).toBe('true');
		expect(chip.classList.contains('chip--booked')).toBe(true);

		expect(card!.querySelector('.card__address-text')!.textContent).toBe('Gewerbemuseumsplatz 1, 90403 Nürnberg');
		const map = card!.querySelector('.card__map')!;
		expect(link.contains(map)).toBe(false);
		expect(map.getAttribute('aria-label')).toBe('Map: Gewerbemuseumsplatz 1, 90403 Nürnberg (Google Maps, new tab)');

		expect(facts(card!)).toEqual([
			['Distance', '0 km'],
			['Status', 'No dates listed'],
			['Deadline', 'unknown'],
			['Registration', 'unknown'],
		]);

		const destination = card!.querySelector('.card__destination')!;
		expect(destination.textContent).toBe('vhs-nuernberg.de ↗');
		expect(destination.getAttribute('aria-hidden')).toBe('true');
		const time = card!.querySelector('.card__freshness time')!;
		expect(time.textContent).toBe('Checked 2 h ago');
		expect(time.getAttribute('datetime')).toBe('2026-10-29T10:00:00Z');

		expect(card!.querySelector('.card__why')).toBeNull();
		expect(card!.querySelector('.card__body')).toBeNull();
	});

	it('shows distance unknown on the no-dates card of a centre without coordinates in the searched place', async () => {
		const unplaced = { ...checked, lat: null, lon: null, address: { street: 'Gewerbemuseumsplatz 1', postcode: '90403', city: 'Nürnberg' } };
		const [card] = await showWith([unplaced]);
		expect(card!.querySelector('.chip')!.textContent).toBe('No dates listed');
		expect(facts(card!)[0]).toEqual(['Distance', 'unknown']);
	});

	it('shows the exact freshness time on a no-dates card checked more than 36 h ago', async () => {
		// 40 h before NOW: Tuesday 21:00 in Berlin.
		const [card] = await showWith([{ ...checked, last_success_at: '2026-10-27T20:00:00Z' }]);
		expect(card!.querySelector('.chip')!.textContent).toBe('No dates listed');
		expect(card!.querySelector('.card__freshness time')!.textContent).toBe('◷ Checked Tue 21:00');
	});

	it('gives a checked centre with only past dates a no-dates card', async () => {
		const [card] = await showWith([checked], [listingOf(checked, '2026-10-20T10:00:00+02:00')]);
		expect(card!.querySelector('.chip')!.textContent).toBe('No dates listed');
		expect(card!.querySelector('.card__freshness')).not.toBeNull();
	});

	it('shows "Not checked right now" for a covered centre whose check failed or never ran, counted as unchecked', async () => {
		await showWith([failed, never]);
		for (const name of ['Bildungszentrum Fürth', 'vhs Erlangen']) {
			const card = byName(name);
			expect(card.querySelector('.card__body')!.textContent).toBe("Not checked right now. See the centre's page.");
			expect(card.querySelector('.chip')!.textContent).toBe('Not checked');
			expect(facts(card)[1]).toEqual(['Status', 'Not checked']);
			expect(card.querySelector('.card__why')!.getAttribute('href')).toContain('not-checked');
			expect(card.querySelector('.card__freshness')).toBeNull();
			expect(card.textContent).not.toContain('No dates listed');
			expect(card.querySelector('h3 a')!.getAttribute('aria-label')).toContain(', not checked, ');
		}
		expect(statusText()).toBe('0 dates and 2 unchecked centres within 20 km');
	});

	it('keeps "Not checked automatically" for a centre without coverage', async () => {
		const [card] = await showWith([akademie]);
		expect(card!.querySelector('.card__body')!.textContent).toBe("Not checked automatically. See the centre's page.");
		expect(statusText()).toBe('0 dates and 1 unchecked centre within 20 km');
	});

	it('keeps the result cards of a centre whose last check failed but still has dates, with its exact freshness time', async () => {
		const [card, ...rest] = await showWith([failed], [listingOf(failed, '2026-11-20T09:00:00+01:00')]);
		expect(rest).toEqual([]);
		expect(card!.querySelector('h3 a')!.textContent).toBe('Fri 20 Nov, 09:00');
		expect(card!.querySelector('.card__freshness time')!.textContent).toBe('◷ Checked Tue 21:00');
		expect(card!.textContent).not.toContain('Not checked right now');
		expect(statusText()).toBe('1 date and 0 unchecked centres within 20 km');
	});

	it('counts only uncovered cards and shows the no-dates notice when no date is in range', async () => {
		await showWith([akademie, checked, failed, never]);
		expect(cardNames()).toEqual(['Akademie Nürnberg', 'vhs Nürnberg', 'Bildungszentrum Fürth', 'vhs Erlangen']);
		const expected = '0 dates and 3 unchecked centres within 20 km';
		expect(paragraphs()).toEqual([expected, 'No dates found nearby. These centres may still have dates on their own pages.']);
		expect(statusText()).toBe(expected);
	});

	it('shows the no-dates notice when every card is a no-dates card', async () => {
		await showWith([checked]);
		expect(paragraphs()).toEqual([
			'0 dates and 0 unchecked centres within 20 km',
			'No dates found nearby. These centres may still have dates on their own pages.',
		]);
		expect(statusText()).toBe('0 dates and 0 unchecked centres within 20 km');
	});

	it('shows the name as plain text with no destination line when the centre has no test page and no website', async () => {
		const [card] = await showWith([{ ...checked, test_page_url: null, website: null }]);
		const h3 = card!.querySelector('h3')!;
		expect(h3.textContent).toBe('vhs Nürnberg');
		expect(h3.querySelector('a')).toBeNull();
		expect(card!.querySelector('.card__destination')).toBeNull();
		expect(card!.querySelector('.card__freshness')).not.toBeNull();
	});

	it('opens the website when the centre has no test page', async () => {
		const [card] = await showWith([{ ...checked, test_page_url: null }]);
		expect(card!.querySelector('h3 a')!.getAttribute('href')).toBe('https://www.vhs-nuernberg.de/');
	});

	it('uses the German words', async () => {
		const [card] = await showWith([checked, failed], [], 'de');
		expect(card!.querySelector('h3 a')!.getAttribute('aria-label')).toBe(
			'vhs Nürnberg, keine Termine angegeben, öffnet vhs-nuernberg.de in einem neuen Tab',
		);
		expect(card!.querySelector('.chip')!.textContent).toBe('Keine Termine angegeben');
		expect(card!.querySelector('.card__freshness')!.textContent).toBe('Vor 2 Std. geprüft');
		expect(byName('Bildungszentrum Fürth').querySelector('.card__body')!.textContent).toBe(
			'Derzeit nicht geprüft. Bitte sehen Sie auf der Seite des Testzentrums nach.',
		);
	});
});

describe('sort by soonest or nearest', () => {
	// About 111 km per degree of latitude: offsets give the distances in the names.
	const at = (km: number) => ({ lat: NBG.lat + km / 111.2, lon: NBG.lon });
	const d30 = coveredCentre('d30', 'ok', { name: 'Dreißig', ...at(30) });
	const d10 = coveredCentre('d10', 'ok', { name: 'Zehn', ...at(10) });
	const u5 = coveredCentre('u5', 'ok', { name: 'Fünf', ...at(5) });
	const unloc = snapshotCentre('unloc', {
		name: 'Ohne Ort',
		address: { street: 'Hauptstraße 1', postcode: '90403', city: 'Nürnberg' },
		lat: null,
		lon: null,
	});
	const early = listingOf(d30, '2026-11-20T09:00:00+01:00');
	const late = listingOf(d10, '2026-12-09T10:00:00+01:00');
	const EARLY = 'Fri 20 Nov, 09:00';
	const LATE = 'Wed 9 Dec, 10:00';
	const ALL = [d30, d10, u5, unloc];

	async function showWith(centres: SnapshotCentre[], listings: SnapshotListing[], hash = '', lang: 'en' | 'de' = 'en'): Promise<void> {
		act(() => render(null, root));
		serve(ok(snapshotOf(centres, listings)));
		setBrowser(hash, [lang === 'en' ? 'en-GB' : 'de-DE']);
		mount();
		await settle();
		if (!hash) await search('Nürnberg', 40);
	}

	const radio = (value: 'soonest' | 'nearest') => root.querySelector<HTMLInputElement>(`input[type="radio"][name="sort"][value="${value}"]`)!;
	const checked = () => [...root.querySelectorAll<HTMLInputElement>('input[name="sort"]')].filter((r) => r.checked).map((r) => r.value);
	const headings = () => [...root.querySelectorAll('.search__results h2')].map((h) => h.textContent);
	/** The results box's children in order: tag plus class. */
	const layout = () => [...root.querySelector('.search__results')!.children].map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
	const notices = () => [...root.querySelectorAll('.search__results > p.notice-line')].map((p) => p.textContent);

	function choose(value: 'soonest' | 'nearest'): void {
		act(() => {
			radio(value).focus();
			radio(value).click();
		});
	}

	it('shows a "Sort by" group with Soonest checked, dated cards first, then "No dates to show" and the rest by distance', async () => {
		await showWith(ALL, [early, late], '#q=N%C3%BCrnberg&r=40&lang=en');
		const group = root.querySelector('fieldset.sort-control')!;
		expect(group.querySelector('legend')!.textContent).toBe('Sort by');
		expect([...group.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['Soonest', 'Nearest']);
		expect(radio('soonest').checked).toBe(true);
		expect(radio('nearest').checked).toBe(false);
		expect(cardNames()).toEqual([EARLY, LATE, 'Fünf', 'Ohne Ort']);
		expect(headings()).toEqual(['No dates to show']);
		expect(layout()).toEqual(['p.results-count', 'div.results-controls', 'ul.results', 'h2.results-heading', 'ul.results']);
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=40&sort=soonest&lang=en');
	});

	it('soonest with only undated cards: the heading, then the cards, and the no-dates notice', async () => {
		await showWith([u5, unloc], []);
		expect(cardNames()).toEqual(['Fünf', 'Ohne Ort']);
		expect(layout()).toEqual(['p.results-count', 'div.results-controls', 'p.notice-line', 'h2.results-heading', 'ul.results']);
		expect(notices()).toEqual([en['results.notice_no_dates']]);
	});

	it('soonest with only dated cards has no heading', async () => {
		await showWith([d30, d10], [early, late]);
		expect(cardNames()).toEqual([EARLY, LATE]);
		expect(headings()).toEqual([]);
		expect(root.querySelectorAll('ul.results')).toHaveLength(1);
	});

	it('Nearest merges every card by distance, unknown last, without re-running the search or re-reading the clock', async () => {
		await showWith(ALL, [early, late]);
		const countLine = root.querySelector('.results-count')!.textContent;
		// A re-read clock would hide both dates.
		clockNow = Date.parse('2027-06-01T00:00:00Z');
		choose('nearest');
		expect(cardNames()).toEqual(['Fünf', LATE, EARLY, 'Ohne Ort']);
		expect(headings()).toEqual([]);
		expect(root.querySelectorAll('ul.results')).toHaveLength(1);
		expect(checked()).toEqual(['nearest']);
		expect(document.activeElement).toBe(radio('nearest'));
		expect(statusText()).toBe('Sorted by nearest');
		expect(root.querySelector('.results-count')!.textContent).toBe(countLine);
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=40&sort=nearest&lang=en');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('back to Soonest restores the order and the heading', async () => {
		await showWith(ALL, [early, late]);
		choose('nearest');
		choose('soonest');
		expect(cardNames()).toEqual([EARLY, LATE, 'Fünf', 'Ohne Ort']);
		expect(headings()).toEqual(['No dates to show']);
		expect(statusText()).toBe('Sorted by soonest');
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=40&sort=soonest&lang=en');
	});

	it('Nearest puts dated cards before an undated card at the same distance, by start', async () => {
		const here = coveredCentre('here', 'ok', { name: 'Hier', ...at(12) });
		const there = coveredCentre('there', 'ok', { name: 'Dort', ...at(12) });
		await showWith(
			[here, there],
			[listingOf(there, '2026-12-09T10:00:00+01:00'), listingOf(there, '2026-11-20T09:00:00+01:00')],
		);
		choose('nearest');
		expect(cardNames()).toEqual([EARLY, LATE, 'Hier']);
	});

	it('follows a hashchange that changes only the sort, without a rerun or fetch', async () => {
		await showWith(ALL, [early, late]);
		expect(checked()).toEqual(['soonest']);
		navigateHash('#q=N%C3%BCrnberg&r=40&sort=nearest&lang=en');
		await settle();
		expect(checked()).toEqual(['nearest']);
		expect(cardNames()).toEqual(['Fünf', LATE, EARLY, 'Ohne Ort']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		navigateHash('#q=N%C3%BCrnberg&r=40&lang=en');
		await settle();
		expect(checked()).toEqual(['soonest']);
		expect(cardNames()).toEqual([EARLY, LATE, 'Fünf', 'Ohne Ort']);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('shows no "Sort by" group for no centres in range or a field error', async () => {
		await showWith(ALL, [early, late]);
		expect(root.querySelector('fieldset.sort-control')).not.toBeNull();
		await search('München', 10);
		expect(root.querySelector('.no-centres')).not.toBeNull();
		expect(root.querySelector('fieldset.sort-control')).toBeNull();
		await search('Nurnbreg');
		expect(alerts()).toHaveLength(1);
		expect(root.querySelector('fieldset.sort-control')).toBeNull();
	});

	it('a shared link with sort=nearest opens with Nearest checked', async () => {
		await showWith(ALL, [early, late], '#q=N%C3%BCrnberg&r=40&sort=nearest&lang=de', 'de');
		expect(checked()).toEqual(['nearest']);
		expect(root.querySelector('legend')!.textContent).toBe('Sortieren nach');
		expect(cardNames()[0]).toBe('Fünf');
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=40&sort=nearest&lang=de');
	});

	for (const hash of ['#q=N%C3%BCrnberg&r=40&sort=foo&lang=en', '#q=N%C3%BCrnberg&r=40&lang=en']) {
		it(`reads ${hash} as Soonest`, async () => {
			await showWith(ALL, [early, late], hash);
			expect(checked()).toEqual(['soonest']);
			expect(location.hash).toBe('#q=N%C3%BCrnberg&r=40&sort=soonest&lang=en');
		});
	}

	it('keeps Nearest for a new search and a radius change', async () => {
		await showWith([...ALL, ...CENTRES], [early, late]);
		choose('nearest');
		await search('München');
		expect(checked()).toEqual(['nearest']);
		expect(location.hash).toBe('#q=M%C3%BCnchen&r=40&sort=nearest&lang=en');
		await search('Nürnberg', 20);
		expect(checked()).toEqual(['nearest']);
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=20&sort=nearest&lang=en');
	});

	it('keeps Nearest on a language switch', async () => {
		await showWith(ALL, [early, late]);
		choose('nearest');
		act(() => root.querySelector<HTMLAnchorElement>('nav a[hreflang="de"]')!.click());
		await settle();
		expect(checked()).toEqual(['nearest']);
		expect(cardNames()[0]).toBe('Fünf');
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=40&sort=nearest&lang=de');
		expect(statusText()).toBe(de['results.sorted_nearest']);
	});

	it('the "Did you mean" links carry the current sort', async () => {
		await showWith(ALL, [early, late]);
		choose('nearest');
		await search('Nurnbreg');
		const link = root.querySelector<HTMLAnchorElement>('.field-message__suggestion')!;
		expect(link.getAttribute('href')).toBe('#q=N%C3%BCrnberg&r=40&sort=nearest&lang=en');
	});

	describe('booked-out notice', () => {
		const booked = { ...early, status: 'booked_out' as const };
		const waiting = { ...late, status: 'waitlist' as const };

		it('shows when every dated card is booked out or waitlist, in either sort', async () => {
			await showWith(ALL, [booked, waiting]);
			expect(notices()).toEqual([en['results.notice_all_booked']]);
			expect(en['results.notice_all_booked']).toBe('All checked dates are booked out. Other centres may still have seats.');
			choose('nearest');
			expect(notices()).toEqual([en['results.notice_all_booked']]);
		});

		for (const status of ['free', 'unknown'] as const) {
			it(`does not show with one ${status} date`, async () => {
				await showWith(ALL, [booked, { ...late, status }]);
				expect(notices()).toEqual([]);
			});
		}

		it('does not show without dated cards', async () => {
			await showWith([u5, unloc], []);
			expect(notices()).toEqual([en['results.notice_no_dates']]);
		});
	});

	describe('hide booked-out dates', () => {
		const toggle = () => root.querySelector<HTMLInputElement>('.results-controls input[type="checkbox"]')!;
		const hiddenLine = () => root.querySelector('.hide-booked__line');
		const countLine = () => root.querySelector('.results-count')!.textContent;
		const booked1 = { ...early, status: 'booked_out' as const };
		const booked2 = listingOf(d10, '2026-11-25T09:00:00+01:00', { status: 'booked_out' });
		const waiting = { ...late, status: 'waitlist' as const };
		const free = listingOf(d30, '2026-12-01T10:00:00+01:00', { status: 'free' });
		const MIXED = [booked1, booked2, waiting, free];

		/** Ticks or unticks the checkbox the way a click or Space does: focus, then toggle. */
		function tick(): void {
			act(() => {
				toggle().focus();
				toggle().click();
			});
		}

		function clickButton(text: string): void {
			act(() => {
				const button = buttonByText(text)!;
				button.focus();
				button.click();
			});
		}

		it('sits unticked after Soonest | Nearest in one results-controls row', async () => {
			await showWith(ALL, MIXED);
			const row = root.querySelector('.results-controls')!;
			expect([...row.children].map((el) => el.className)).toEqual(['sort-control', 'hide-booked']);
			expect(toggle().checked).toBe(false);
			expect(toggle().closest('label')!.textContent).toBe('Hide booked-out');
			expect(hiddenLine()).toBeNull();
		});

		it('hides only booked-out dates, keeps the count line, and announces the number hidden', async () => {
			await showWith(ALL, MIXED);
			const before = cardNames();
			const counted = countLine();
			expect(before).toEqual([EARLY, 'Wed 25 Nov, 09:00', 'Tue 1 Dec, 10:00', LATE, 'Fünf', 'Ohne Ort']);
			tick();
			expect(toggle().checked).toBe(true);
			expect(document.activeElement).toBe(toggle());
			expect(cardNames()).toEqual(['Tue 1 Dec, 10:00', LATE, 'Fünf', 'Ohne Ort']);
			expect(hiddenLine()!.textContent).toBe('2 booked-out dates hidden · Show');
			// Outside the row: the line appearing never moves the checkbox or the sort control.
			expect(hiddenLine()!.closest('.results-controls')).toBeNull();
			expect(statusText()).toBe('2 booked-out dates hidden');
			expect(countLine()).toBe(counted);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(location.hash).toBe('#q=N%C3%BCrnberg&r=40&sort=soonest&lang=en');
		});

		it('"Show" unticks, brings every card back and moves focus to the checkbox', async () => {
			await showWith(ALL, MIXED);
			const before = cardNames();
			tick();
			const show = buttonByText('Show')!;
			const describedBy = show.getAttribute('aria-describedby')!;
			expect(document.getElementById(describedBy)!.textContent).toBe('2 booked-out dates hidden');
			clickButton('Show');
			expect(toggle().checked).toBe(false);
			expect(document.activeElement).toBe(toggle());
			expect(cardNames()).toEqual(before);
			expect(hiddenLine()).toBeNull();
			expect(statusText()).toBe('2 booked-out dates shown');
		});

		it('unticking the checkbox itself announces the dates shown and keeps focus', async () => {
			await showWith(ALL, MIXED);
			tick();
			tick();
			expect(toggle().checked).toBe(false);
			expect(document.activeElement).toBe(toggle());
			expect(cardNames()).toHaveLength(6);
			expect(statusText()).toBe('2 booked-out dates shown');
		});

		it('everything hidden: "Show them" replaces the all-booked notice and undated cards stay', async () => {
			const all = [
				booked1,
				booked2,
				{ ...late, status: 'booked_out' as const },
				listingOf(d30, '2026-12-01T10:00:00+01:00', { status: 'booked_out' }),
			];
			await showWith(ALL, all);
			expect(notices()).toEqual([en['results.notice_all_booked']]);
			tick();
			expect(notices()).toEqual(['All 4 dates here are booked out and hidden. Show them']);
			expect(cardNames()).toEqual(['Fünf', 'Ohne Ort']);
			// "Show them" is the one way back: no second "Show".
			expect(hiddenLine()).toBeNull();
			expect(buttonByText('Show')).toBeUndefined();
			const describedBy = buttonByText('Show them')!.getAttribute('aria-describedby')!;
			expect(document.getElementById(describedBy)!.textContent).toBe('All 4 dates here are booked out and hidden.');
			clickButton('Show them');
			expect(toggle().checked).toBe(false);
			expect(document.activeElement).toBe(toggle());
			expect(cardNames()).toHaveLength(6);
			expect(notices()).toEqual([en['results.notice_all_booked']]);
			expect(statusText()).toBe('4 booked-out dates shown');
		});

		it('booked-out and waitlist only: the waitlist date stays and the all-booked notice keeps showing', async () => {
			await showWith(ALL, [booked1, waiting]);
			tick();
			expect(notices()).toEqual([en['results.notice_all_booked']]);
			expect(cardNames()).toHaveLength(3);
			expect(hiddenLine()!.textContent).toBe('1 booked-out date hidden · Show');
			expect(statusText()).toBe('1 booked-out date hidden');
		});

		it('nothing to hide: no card hidden, no hidden line, and "0 booked-out dates hidden"', async () => {
			await showWith(ALL, [early, late]);
			const before = cardNames();
			tick();
			expect(cardNames()).toEqual(before);
			expect(hiddenLine()).toBeNull();
			expect(statusText()).toBe('0 booked-out dates hidden');
		});

		it('Nearest keeps the hidden cards hidden in the single list', async () => {
			await showWith(ALL, MIXED);
			tick();
			const kept = cardNames();
			choose('nearest');
			expect(root.querySelectorAll('ul.results')).toHaveLength(1);
			expect(cardNames()).toHaveLength(4);
			expect([...cardNames()].sort()).toEqual([...kept].sort());
		});

		it('stays ticked for a new search, which is filtered and counted afresh', async () => {
			await showWith(ALL, MIXED);
			tick();
			await search('Nürnberg', 20);
			expect(toggle().checked).toBe(true);
			// d30 is 30 km away: only d10's booked-out and waitlist dates are left.
			expect(hiddenLine()!.textContent).toBe('1 booked-out date hidden · Show');
			expect(cardNames()).toEqual([LATE, 'Fünf', 'Ohne Ort']);
			expect(statusText()).toBe(`${countLine()}. 1 booked-out date hidden`);
			expect(location.hash).toBe('#q=N%C3%BCrnberg&r=20&sort=soonest&lang=en');
		});

		it('keeps focus on the checkbox when clicked without focusing it first', async () => {
			await showWith(ALL, MIXED);
			act(() => toggle().click());
			expect(toggle().checked).toBe(true);
			expect(document.activeElement).toBe(toggle());
		});

		it('announces one booked-out date shown in the singular', async () => {
			await showWith(ALL, [booked1, waiting]);
			tick();
			tick();
			expect(statusText()).toBe('1 booked-out date shown');
		});

		it('everything hidden with a single date: the singular notice', async () => {
			await showWith(ALL, [booked1]);
			tick();
			expect(notices()).toEqual(['1 date here is booked out and hidden. Show them']);
			expect(hiddenLine()).toBeNull();
		});

		it('reads the singular forms in German', async () => {
			await showWith(ALL, [booked1, free], '#q=N%C3%BCrnberg&r=40&lang=de', 'de');
			tick();
			expect(hiddenLine()!.textContent).toBe('1 ausgebuchter Termin ausgeblendet · Anzeigen');
			await showWith(ALL, [booked1], '#q=N%C3%BCrnberg&r=40&lang=de', 'de');
			tick();
			expect(notices()).toEqual(['1 Termin hier ist ausgebucht und ausgeblendet. Anzeigen']);
		});

		it('reads in German', async () => {
			await showWith(ALL, MIXED, '#q=N%C3%BCrnberg&r=40&lang=de', 'de');
			expect(toggle().closest('label')!.textContent).toBe('Ausgebuchte ausblenden');
			tick();
			expect(hiddenLine()!.textContent).toBe('2 ausgebuchte Termine ausgeblendet · Anzeigen');
			expect(statusText()).toBe('2 ausgebuchte Termine ausgeblendet');
		});
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
		expect(links[0]!.getAttribute('href')).toBe('#q=N%C3%BCrnberg&r=20&sort=soonest&lang=en');
		expect(location.hash).toBe('#q=Nurnbreg&r=20&sort=soonest&lang=en');

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
		expect(location.hash).toBe('#q=Kiel&r=40&sort=soonest&lang=de');
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
		expect(location.hash).toBe('#q=Augsburg&r=20&sort=soonest&lang=en');
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

describe('search by test location', () => {
	// About 12.6 km apart: more than the 10 km radius.
	const HERRSCHING = placeRow('09188127', 'Herrsching a.Ammersee', { postcodes: ['82211'], lat: 47.9993, lon: 11.1716 });
	const STARNBERG = placeRow('09188139', 'Starnberg', { postcodes: ['82319'], lat: 47.9973, lon: 11.3398 });
	const starnberg = coveredCentre('starnberg', 'ok', {
		name: 'vhs Starnberg',
		address: { street: 'Hauptstraße 1', postcode: '82319', city: 'Starnberg' },
		lat: STARNBERG.lat,
		lon: STARNBERG.lon,
		last_success_at: '2026-10-29T10:00:00Z',
	});
	const inHerrsching = listingOf(starnberg, '2026-12-09T10:00:00+01:00', {
		address: 'Schulstraße 2, 82211 Herrsching a.Ammersee',
		lat: HERRSCHING.lat,
		lon: HERRSCHING.lon,
	});
	const facts = (card: HTMLElement) => [...card.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);

	async function showWith(centres: SnapshotCentre[], listings: SnapshotListing[], place: string): Promise<void> {
		serve(ok(snapshotOf(centres, listings)), ok(placesOf([HERRSCHING, STARNBERG])));
		setBrowser();
		mount();
		await settle();
		await search(place, 10);
	}

	it('shows a date held in town by a centre based elsewhere, with the distance to the test address and no other card for it', async () => {
		await showWith([starnberg], [inHerrsching], 'Herrsching a.Ammersee');
		expect(cards()).toHaveLength(1);
		expect(cardNames()).toEqual(['Wed 9 Dec, 10:00']);
		expect(facts(cards()[0]!)[0]).toEqual(['Distance', '0 km']);
		expect(cards()[0]!.querySelector('.card__address-text')!.textContent).toBe('Schulstraße 2, 82211 Herrsching a.Ammersee');
		expect(root.querySelector('.results-count')!.textContent).toBe('1 date and 0 unchecked centres within 10 km');
	});

	it('shows no centres in the centre\'s own town when its only date is held far away', async () => {
		await showWith([starnberg], [inHerrsching], 'Starnberg');
		expect(cards()).toEqual([]);
		expect(root.querySelector('.search__results')!.textContent).toContain('No test centres within 10 km.');
		expect(statusText()).toBe('No test centres within 10 km.');
	});

	it('counts only the selected cards in the count line', async () => {
		const uncovered = snapshotCentre('herrsching', { name: 'Bildungswerk Herrsching', lat: HERRSCHING.lat, lon: HERRSCHING.lon });
		const second = listingOf(starnberg, '2026-12-10T10:00:00+01:00', { lat: HERRSCHING.lat + 0.01, lon: HERRSCHING.lon });
		const inStarnberg = listingOf(starnberg, '2026-12-11T10:00:00+01:00');
		await showWith([starnberg, uncovered], [inHerrsching, second, inStarnberg], 'Herrsching a.Ammersee');
		expect(cardNames()).toEqual(['Wed 9 Dec, 10:00', 'Thu 10 Dec, 10:00', 'Bildungswerk Herrsching']);
		expect(root.querySelector('.results-count')!.textContent).toBe('2 dates and 1 unchecked centre within 10 km');
	});
});

describe('centres without a map position', () => {
	const unlocated = (id: string, name: string, postcode: string, city: string) =>
		snapshotCentre(id, { name, address: { street: 'Hauptstraße 1', postcode, city }, lat: null, lon: null });
	const mvhs = unlocated('mvhs', 'Münchner VHS', '81667', 'München');
	const brk = unlocated('brk', 'Bayerisches Rotes Kreuz', '80331', 'Somewhere');
	const kronach = unlocated('kronach', 'VHS Kreis Kronach', '96317', 'Kronach');
	const located = snapshotCentre('muc', { name: 'vhs München', lat: 48.1374, lon: 11.5755 });
	const notice = () => root.querySelector<HTMLElement>('.search__results .notice-line:has(a)');

	it('shows a centre of the searched place after the distanced cards, with distance unknown, counted as unchecked', async () => {
		serve(ok(snapshotOf([mvhs, kronach, located, brk])));
		setBrowser();
		mount();
		await settle();
		await search('München', 20);
		expect(cardNames()).toEqual(['vhs München', 'Bayerisches Rotes Kreuz', 'Münchner VHS']);
		const distance = (card: HTMLElement) => card.querySelector('dd')!.textContent;
		expect(cards().map(distance)).toEqual(['0 km', 'unknown', 'unknown']);
		expect(statusText()).toBe('0 dates and 3 unchecked centres within 20 km');
		// Their cards keep the uncovered-card shape: stretched link, map link, Why?.
		const last = cards()[2]!;
		expect(last.querySelector('h3 a')!.getAttribute('href')).toBe('https://mvhs.example.de/test');
		expect(last.querySelector('.card__map')).not.toBeNull();
		expect(last.querySelector('.card__why')!.getAttribute('href')).toBe('/about/#not-checked=&lang=en');
		expect(notice()!.textContent).toBe('1 centre has no map position yet and may be nearby. See which');
	});

	it('shows results, not "no centres", when only such centres match, and no notice when none are hidden', async () => {
		serve(ok(snapshotOf([mvhs])));
		setBrowser('', ['de-DE']);
		mount();
		await settle();
		await search('München', 10);
		expect(cardNames()).toEqual(['Münchner VHS']);
		expect(cards()[0]!.querySelector('dd')!.textContent).toBe(de['card.fact.distance_unknown']);
		expect(root.querySelector('.search__results')!.textContent).not.toContain('Keine Testzentren');
		expect(statusText()).toBe('0 Termine und 1 nicht geprüftes Testzentrum im Umkreis von 10 km');
		expect(notice()).toBeNull();
	});

	it('counts the hidden ones in a notice that links to About #no-location, in the current language', async () => {
		serve(ok(snapshotOf([kronach, unlocated('roth', 'VHS Roth', '91161', 'Hilpoltstein'), snapshotCentre('aug', { lat: 48.37, lon: 10.9 })])));
		setBrowser('', ['de-DE']);
		mount();
		await settle();
		await search('Augsburg', 40);
		expect(cardNames()).toHaveLength(1);
		const line = notice()!;
		expect(line.textContent).toBe(`2 Testzentren haben noch keine Kartenposition und könnten in der Nähe sein. ${de['results.unlocated_link']}`);
		const link = line.querySelector('a')!;
		expect(link.getAttribute('href')).toBe('/about/#no-location=&lang=de');
		expect(link.hasAttribute('target')).toBe(false);
		// The notice follows the no-dates notice.
		const paragraphs = [...root.querySelectorAll('.search__results > p')];
		expect(paragraphs.indexOf(line)).toBe(paragraphs.length - 1);
	});

	it('adds the notice to "no centres in range", after the next-radius button', async () => {
		serve(ok(snapshotOf([kronach])));
		setBrowser();
		mount();
		await settle();
		await search('Augsburg', 10);
		const box = root.querySelector('.no-centres')!;
		expect(box.textContent).toBe('No test centres within 10 km.Search 20 km1 centre has no map position yet and may be nearby. See which');
		expect(box.lastElementChild!.querySelector('a')!.getAttribute('href')).toBe('/about/#no-location=&lang=en');
		expect(statusText()).toBe('No test centres within 10 km.');
	});
});

describe('Bavarian names with a qualifier and places outside Bavaria', () => {
	it('searches Lindau (Bodensee) for "Lindau" and "88131 Lindau"', async () => {
		serve(ok(snapshotOf([snapshotCentre('lindau', { name: 'vhs Lindau', lat: 47.55, lon: 9.69 })])));
		setBrowser();
		mount();
		await settle();
		for (const input of ['Lindau', '88131 Lindau']) {
			await search(input, 10);
			expect(alerts(), input).toEqual([]);
			expect(cardNames(), input).toEqual(['vhs Lindau']);
			expect(field().value, input).toBe(input);
		}
	});

	it('asks to pick one for "Neuburg"', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Neuburg');
		expect(alerts()[0]!.textContent).toBe(en['error.several_places']);
	});

	it('shows Bavaria only for "Essen" and keeps the text, instead of searching Essenbach', async () => {
		setBrowser();
		mount();
		await settle();
		await search('Essen');
		expect(alerts()[0]!.textContent).toBe(en['error.outside_bavaria']);
		expect(field().value).toBe('Essen');
		expect(location.hash).toBe('#q=Essen&r=40&sort=soonest&lang=en');
		expect(cards()).toEqual([]);
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
		expect(location.hash).toBe('#q=Augsburg&r=20&sort=soonest&lang=en');
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
			expect(location.hash).toBe('#q=Augsburg&r=40&sort=soonest&lang=en');
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
		expect(location.hash).toBe('#q=N%C3%BCrnberg&r=20&sort=soonest&lang=de');
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
	// The same failures for places.json: a schema error keeps the current schemaVersion.
	const placesFailure = (name: string, failing: Responder): Responder =>
		name === 'a schema error' ? ok({ ...smallPlaces(), places: 'nope' }) : failing;

	for (const [name, failing] of failures) {
		for (const file of ['snapshot', 'places'] as const) {
			it(`shows the load error for ${name} in ${file}.json, and Try again recovers`, async () => {
				let calls = 0;
				const good = file === 'snapshot' ? ok(snapshotOf(CENTRES)) : ok(smallPlaces());
				const bad = file === 'snapshot' ? failing : placesFailure(name, failing);
				const flaky: Responder = () => (calls++ === 0 ? bad() : good());
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
	const newerSnapshot = ok({ ...snapshotOf(CENTRES), schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 });
	// A places.json of the old schema version 1, as a stale cache would serve it.
	const newerPlaces = ok({ ...placesOf([NBG]), schemaVersion: 1 });

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

describe('place suggestions', () => {
	const listbox = () => root.querySelector<HTMLUListElement>('ul[role="listbox"]')!;
	const options = () => [...root.querySelectorAll<HTMLLIElement>('ul[role="listbox"] > li[role="option"]')];
	const optionNames = () => options().map((o) => o.querySelector('.place-suggestions__name')!.textContent);
	const optionMeta = () => options().map((o) => o.querySelector('.place-suggestions__meta')?.textContent ?? null);
	const expanded = () => field().getAttribute('aria-expanded');
	const activeOption = () => {
		const id = field().getAttribute('aria-activedescendant');
		return id === null ? null : document.getElementById(id);
	};

	function press(key: string): KeyboardEvent {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		act(() => {
			field().dispatchEvent(event);
		});
		return event;
	}

	async function ready(hash = ''): Promise<void> {
		setBrowser(hash);
		mount();
		await settle();
	}

	it('is an ARIA 1.2 combobox controlling a listbox labelled by the field label', async () => {
		await ready();
		expect(field().getAttribute('role')).toBe('combobox');
		expect(field().getAttribute('aria-autocomplete')).toBe('list');
		expect(expanded()).toBe('false');
		expect(field().getAttribute('aria-controls')).toBe(listbox().id);
		const label = root.querySelector(`label[for="${field().id}"]`)!;
		expect(listbox().getAttribute('aria-labelledby')).toBe(label.id);
		expect(listbox().hidden).toBe(true);
		expect(field().hasAttribute('aria-activedescendant')).toBe(false);
	});

	it('opens after 2 characters with matches for spelling variants, and announces the count', async () => {
		await ready();
		type('N');
		expect(expanded()).toBe('false');
		expect(options()).toEqual([]);
		for (const text of ['nu', 'Nue', 'NÜRN']) {
			type(text);
			expect(expanded(), text).toBe('true');
			expect(listbox().hidden).toBe(false);
			expect(optionNames()).toEqual(['Nürnberg']);
		}
		expect(statusText()).toBe('1 suggestion');
		expect(status()).toHaveLength(1);
		type('Ober');
		expect(options()).toHaveLength(6);
		expect(statusText()).toBe('6 suggestions');
		for (const option of options()) expect(option.getAttribute('aria-selected')).toBe('false');
	});

	it('announces only when the rows change, and nothing on close', async () => {
		await ready();
		type('Ka');
		const first = status()[0]!.firstElementChild;
		expect(statusText()).toBe('3 suggestions');
		type('Kas');
		expect(status()[0]!.firstElementChild).toBe(first);
		type('Kast');
		press('Escape');
		expect(status()[0]!.firstElementChild).toBe(first);
		type('Ob');
		expect(status()[0]!.firstElementChild).not.toBe(first);
		expect(statusText()).toBe('6 suggestions');
	});

	it('closes for one character, text without matches and blur', async () => {
		await ready();
		type('Ob');
		expect(expanded()).toBe('true');
		type('O');
		expect(expanded()).toBe('false');
		type('Atlantis');
		expect(expanded()).toBe('false');
		type('Ob');
		expect(expanded()).toBe('true');
		act(() => field().blur());
		expect(expanded()).toBe('false');
		act(() => field().focus());
		expect(expanded()).toBe('false');
		type('Obe');
		expect(expanded()).toBe('true');
	});

	it('shows postcode rows with the matched postcode as meta', async () => {
		await ready();
		type('8923');
		expect(optionNames()).toEqual(['Neu-Ulm']);
		expect(optionMeta()).toEqual(['89231']);
	});

	it('shows same-name towns with postcode and district, and only them get a meta line', async () => {
		await ready();
		type('Kastl');
		expect(optionNames()).toEqual(['Kastl', 'Kastl', 'Kastl']);
		expect(optionMeta()).toEqual(['84556 · Landkreis Altötting', '92280 · Landkreis Amberg-Sulzbach', '95506 · Landkreis Tirschenreuth']);
		type('Augs');
		expect(optionMeta()).toEqual([null]);
	});

	it('collapses same-name rows sharing a postcode, and Enter searches it', async () => {
		await ready();
		type('Chiemsee');
		expect(optionNames()).toEqual(['Chiemsee']);
		submit();
		await settle();
		expect(alerts()).toEqual([]);
		expect(location.hash).toBe('#q=Chiemsee&r=40&sort=soonest&lang=en');
	});

	it('moves the highlight with ↓ and ↑, wrapping, via aria-activedescendant', async () => {
		await ready();
		type('Ober');
		expect(activeOption()).toBeNull();
		expect(press('ArrowDown').defaultPrevented).toBe(true);
		expect(activeOption()).toBe(options()[0]);
		expect(options()[0]!.getAttribute('aria-selected')).toBe('true');
		press('ArrowDown');
		expect(activeOption()).toBe(options()[1]);
		expect(options()[0]!.getAttribute('aria-selected')).toBe('false');
		for (let i = 0; i < 4; i++) press('ArrowDown');
		expect(activeOption()).toBe(options()[5]);
		press('ArrowDown');
		expect(activeOption()).toBe(options()[0]);
		press('ArrowUp');
		expect(activeOption()).toBe(options()[5]);
		press('ArrowUp');
		expect(activeOption()).toBe(options()[4]);
		// A change of rows clears the highlight.
		type('Oberau');
		expect(activeOption()).toBeNull();
		press('ArrowUp');
		expect(activeOption()).toBe(options()[options().length - 1]);
	});

	it('closes on Escape and keeps the text; ↓ reopens with the first row highlighted', async () => {
		await ready();
		type('Ober');
		press('ArrowDown');
		expect(press('Escape').defaultPrevented).toBe(true);
		expect(expanded()).toBe('false');
		expect(field().value).toBe('Ober');
		expect(field().hasAttribute('aria-activedescendant')).toBe(false);
		expect(options()).toEqual([]);
		press('ArrowDown');
		expect(expanded()).toBe('true');
		expect(activeOption()).toBe(options()[0]);
	});

	it('picks the highlighted row with Enter: searches it, closes the list and writes the pick text to the fragment', async () => {
		await ready();
		chooseRadius(100);
		type('Kastl');
		const replace = vi.spyOn(history, 'replaceState');
		const push = vi.spyOn(history, 'pushState');
		press('ArrowDown');
		press('ArrowDown');
		expect(press('Enter').defaultPrevented).toBe(true);
		await settle();
		expect(field().value).toBe('92280 Kastl');
		expect(expanded()).toBe('false');
		expect(location.hash).toBe('#q=92280+Kastl&r=100&sort=soonest&lang=en');
		expect(replace).toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(field());
		expect([...cardNames()].sort()).toEqual(['Akademie Nürnberg', 'bfz Fürth', 'vhs Erlangen']);
	});

	it('picks a row on click without blurring the field', async () => {
		await ready();
		chooseRadius(100);
		type('Kastl');
		const option = options()[0]!;
		const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
		act(() => {
			option.dispatchEvent(down);
		});
		expect(down.defaultPrevented).toBe(true);
		const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
		act(() => {
			option.dispatchEvent(mouseDown);
		});
		expect(mouseDown.defaultPrevented).toBe(true);
		act(() => option.click());
		await settle();
		expect(field().value).toBe('84556 Kastl');
		expect(document.activeElement).toBe(field());
		expect(expanded()).toBe('false');
		expect(location.hash).toBe('#q=84556+Kastl&r=100&sort=soonest&lang=en');
		expect(cardNames()).toEqual(['vhs München']);
	});

	it('submits normally on Enter without a highlighted row: one match runs as before', async () => {
		await ready();
		type('Nürnberg');
		expect(press('Enter').defaultPrevented).toBe(false);
		submit();
		await settle();
		expect(expanded()).toBe('false');
		expect(cardNames()).toHaveLength(3);
		expect(statusText()).toBe('0 dates and 3 unchecked centres within 40 km');
		expect(field().hasAttribute('aria-invalid')).toBe(false);
	});

	it('searches the one suggestion on Enter, writing its pick text to the field and fragment', async () => {
		await ready();
		chooseRadius(100);
		type('Augs');
		expect(optionNames()).toEqual(['Augsburg']);
		const replace = vi.spyOn(history, 'replaceState');
		const push = vi.spyOn(history, 'pushState');
		submit();
		await settle();
		expect(alerts()).toEqual([]);
		expect(field().value).toBe('Augsburg');
		expect(location.hash).toBe('#q=Augsburg&r=100&sort=soonest&lang=en');
		// Once for the typed text, once for the pick text; a rerun of "Augsburg" would add a third.
		expect(replace.mock.calls.map((call) => String(call[2]))).toEqual([
			'/testplatz/#q=Augs&r=100&sort=soonest&lang=en',
			'/testplatz/#q=Augsburg&r=100&sort=soonest&lang=en',
		]);
		expect(push).not.toHaveBeenCalled();
		expect(expanded()).toBe('false');
		expect(document.activeElement).toBe(field());
		expect(cardNames()).toEqual(['vhs München']);
	});

	for (const text of ['Ober', 'Neu']) {
		it(`asks to pick one when several suggestions match "${text}" on Enter`, async () => {
			await ready();
			await search('Nürnberg');
			await search(text);
			expect(alerts()[0]!.textContent).toBe(en['error.several_places']);
			expect(field().hasAttribute('aria-invalid')).toBe(false);
			expect(field().value).toBe(text);
			expect(cards()).toEqual([]);
			expect(expanded()).toBe('true');
			expect(options().length).toBeGreaterThan(1);
			expect(location.hash).toBe(`#q=${text}&r=40&sort=soonest&lang=en`);
		});
	}

	it('searches an exact name even when other towns start with it', async () => {
		await ready();
		type('Au');
		expect(optionNames()).toEqual(['Au', 'Augsburg']);
		submit();
		await settle();
		expect(alerts()).toEqual([]);
		expect(field().value).toBe('Au');
		expect(location.hash).toBe('#q=Au&r=40&sort=soonest&lang=en');
		expect(expanded()).toBe('false');
	});

	it('searches the one suggestion for a partial name in a link, rewriting the field and fragment', async () => {
		setBrowser('#q=Augs&r=100&lang=en');
		const replace = vi.spyOn(history, 'replaceState');
		mount();
		await settle();
		const announcement = status()[0]!.firstElementChild;
		await settle();
		expect(status()[0]!.firstElementChild).toBe(announcement);
		// The rewrite to "Augsburg" does not run the search a second time.
		expect(replace.mock.calls.filter((call) => String(call[2]).includes('q=Augsburg'))).toHaveLength(1);
		expect(alerts()).toEqual([]);
		expect(field().value).toBe('Augsburg');
		expect(location.hash).toBe('#q=Augsburg&r=100&sort=soonest&lang=en');
		expect(cardNames()).toEqual(['vhs München']);
		expect(expanded()).toBe('false');
	});

	it('searches an exact postcode on Enter', async () => {
		await ready();
		await search('89231');
		expect(alerts()).toEqual([]);
		expect(location.hash).toBe('#q=89231&r=40&sort=soonest&lang=en');
		expect(expanded()).toBe('false');
	});

	it('asks to pick one for an ambiguous name, keeping the list open without aria-invalid', async () => {
		await ready();
		await search('Nürnberg');
		expect(cards()).toHaveLength(3);
		await search('Kastl');
		const [alert] = alerts();
		expect(alert!.textContent).toBe(en['error.several_places']);
		expect(field().getAttribute('aria-describedby')).toBe(alert!.id);
		expect(field().hasAttribute('aria-invalid')).toBe(false);
		expect(field().value).toBe('Kastl');
		expect(cards()).toEqual([]);
		expect(root.querySelector('.search__results')!.textContent).toBe('');
		expect(root.querySelectorAll('.field-message__suggestion')).toHaveLength(0);
		expect(expanded()).toBe('true');
		expect(optionNames()).toEqual(['Kastl', 'Kastl', 'Kastl']);
		expect(statusText()).toBe('3 suggestions');

		chooseRadius(100);
		act(() => options()[1]!.click());
		await settle();
		expect(alerts()).toEqual([]);
		expect(field().value).toBe('92280 Kastl');
		expect(location.hash).toBe('#q=92280+Kastl&r=100&sort=soonest&lang=en');
		expect(cardNames()).toHaveLength(3);
	});

	it('asks again for a repeated ambiguous submit, re-announcing the suggestions', async () => {
		await ready();
		await search('Kastl');
		const first = status()[0]!.firstElementChild;
		submit();
		await settle();
		expect(expanded()).toBe('true');
		expect(status()[0]!.firstElementChild).not.toBe(first);
		expect(statusText()).toBe('3 suggestions');
	});

	it('reproduces a qualified pick text from a link', async () => {
		await ready('#q=92280+Kastl&r=100&lang=en');
		expect(field().value).toBe('92280 Kastl');
		expect(alerts()).toEqual([]);
		expect([...cardNames()].sort()).toEqual(['Akademie Nürnberg', 'bfz Fürth', 'vhs Erlangen']);
		expect(expanded()).toBe('false');
	});

	it('asks to pick one for an ambiguous link, with the list open', async () => {
		await ready('#q=Kastl&lang=en');
		expect(document.activeElement).toBe(field());
		expect(alerts()[0]!.textContent).toBe(en['error.several_places']);
		expect(expanded()).toBe('true');
		expect(options()).toHaveLength(3);
	});

	it('does not pop the list open after a fragment fill', async () => {
		await ready('#q=Augsburg&lang=en');
		expect(field().value).toBe('Augsburg');
		expect(expanded()).toBe('false');
		navigateHash('#q=F%C3%BCrth&lang=en');
		await settle();
		expect(field().value).toBe('Fürth');
		expect(expanded()).toBe('false');
	});

	it('closes after "Search N km"', async () => {
		await ready();
		await search('Augsburg', 10);
		type('Augsburg');
		expect(expanded()).toBe('true');
		act(() => buttonByText('Search 20 km')!.click());
		await settle();
		expect(expanded()).toBe('false');
	});

	it('shows no list before the data is ready, and opens on typing once it is', async () => {
		let resolvePlaces: (response: Response) => void = () => {};
		serve(ok(snapshotOf(CENTRES)), () => new Promise((resolve) => (resolvePlaces = resolve)));
		setBrowser();
		mount();
		await settle();
		type('Ober');
		press('ArrowDown');
		expect(expanded()).toBe('false');
		expect(options()).toEqual([]);
		expect(statusText()).toBe('');
		await act(async () => {
			resolvePlaces(jsonResponse(smallPlaces()));
		});
		await settle();
		expect(expanded()).toBe('false');
		type('Obe');
		expect(expanded()).toBe('true');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('keeps the rows on a language switch and shows the catalogue text in the new language', async () => {
		await ready('#lang=de');
		type('Kastl');
		expect(statusText()).toBe('3 Vorschläge');
		const before = optionMeta();
		act(() => root.querySelector<HTMLAnchorElement>('nav a[hreflang="en"]')!.click());
		expect(expanded()).toBe('true');
		expect(optionMeta()).toEqual(before);
		expect(statusText()).toBe('3 suggestions');
	});

	it('shows the several message in German', async () => {
		await ready('#lang=de');
		await search('Kastl');
		expect(alerts()[0]!.textContent).toBe(de['error.several_places']);
		expect(de['error.several_places']).toBe('Mehrere Orte passen. Wählen Sie bitte einen aus.');
	});

	it('does not put place keys or coordinates in the fragment', async () => {
		await ready();
		type('Kastl');
		press('ArrowDown');
		press('Enter');
		await settle();
		expect(location.hash).not.toMatch(/09171121|48\.2|12\.7|lat|lon/);
	});
});
