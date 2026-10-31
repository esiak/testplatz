import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Places } from '../../../shared/places.ts';
import type { Snapshot } from '../../../shared/snapshot.ts';
import { SchemaVersionError } from '../data/load-json.ts';
import { loadPlaces } from '../data/places.ts';
import { clearReloadFlag, defaultReloadServices, reloadOnce, type ReloadServices } from '../data/reload-once.ts';
import { loadSnapshot } from '../data/snapshot.ts';
import { NO_LOCATION_ID } from '../fragment.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { ResultCard } from './result-card.tsx';
import { NoDatesCard } from './no-dates-card.tsx';
import { HiddenBookedLine, HideBookedOut } from './hide-booked-out.tsx';
import { allBookedOut, bookedOutCount, hideBookedOut, sortedCards, undatedKind, type Results, type SortedCard } from './results.ts';
import { SearchBar } from './search-bar.tsx';
import {
	DEFAULT_RADIUS,
	nextRadius,
	parseSearchFragment,
	parseSort,
	runSearch,
	searchFragment,
	type Outcome,
	type Radius,
	type Search,
	type Sort,
} from './search.ts';
import { SortControl } from './sort-control.tsx';
import { aboutSectionUrl, UncoveredCard } from './uncovered-card.tsx';

/** What the page talks to; tests inject their own. */
export interface SearchServices extends ReloadServices {
	/** Used for the two data requests; defaults to the global `fetch` at call time. */
	fetch?: typeof fetch;
	/** The clock, read once per search; defaults to `Date.now`. */
	now?: () => number;
}

/** A results outcome's cards, computed once against the `now` taken when the search ran. */
type Shown = Results & { now: number };

type DataState = { kind: 'loading' } | { kind: 'ready'; snapshot: Snapshot; places: Places } | { kind: 'failed' };

/** What the live region says. Stored as a description so a language switch re-renders it. */
type Announcement =
	| { kind: 'loading' }
	/** `hiddenCount`: booked-out dates the ticked toggle hides in these results (0 when unticked). */
	| { kind: 'outcome'; outcome: Outcome; shown: Shown | null; hiddenCount: number }
	| { kind: 'suggestions'; count: number }
	| { kind: 'sorted'; sort: Sort }
	| { kind: 'hidden'; hidden: boolean; count: number };

const SKELETON_COUNT = 3;

function sameSearch(a: Search | null, b: Search): boolean {
	return a !== null && a.q === b.q && a.r === b.r;
}

const COUNT_KEYS = {
	date: { centre: 'results.count_date_one_one', centres: 'results.count_date_one' },
	dates: { centre: 'results.count_one', centres: 'results.count' },
} as const;

/** "N dates and M unchecked centres within R km": dated cards shown, and uncovered cards shown (no-dates cards count in neither). */
function CountLine({ outcome, shown }: { outcome: Extract<Outcome, { kind: 'results' }>; shown: Shown }) {
	const { t } = useI18n();
	const dates = shown.dated.length;
	const unchecked = shown.undated.filter((item) => undatedKind(item.centre) !== 'no_dates').length;
	const key = COUNT_KEYS[dates === 1 ? 'date' : 'dates'][unchecked === 1 ? 'centre' : 'centres'];
	return <>{t(key, { dates, unchecked, radius: outcome.search.r })}</>;
}

/** "N centres have no map position yet and may be nearby. See which" — absent when none are hidden. */
function HiddenUnlocatedNotice({ count }: { count: number }) {
	const { lang, t } = useI18n();
	if (count === 0) return null;
	return (
		<p class="notice-line">
			{t(count === 1 ? 'results.unlocated_notice_one' : 'results.unlocated_notice', { count })}{' '}
			<a class="notice-line__link" href={aboutSectionUrl(lang, NO_LOCATION_ID)}>
				{t('results.unlocated_link')}
			</a>
		</p>
	);
}

function AnnouncementText({ announcement }: { announcement: Announcement | null }) {
	const { t } = useI18n();
	if (!announcement) return null;
	if (announcement.kind === 'loading') return <>{t('search.loading')}</>;
	if (announcement.kind === 'suggestions') {
		const { count } = announcement;
		return <>{t(count === 1 ? 'search.suggestions_count_one' : 'search.suggestions_count', { count })}</>;
	}
	if (announcement.kind === 'sorted') return <>{t(announcement.sort === 'soonest' ? 'results.sorted_soonest' : 'results.sorted_nearest')}</>;
	if (announcement.kind === 'hidden') {
		const { hidden, count } = announcement;
		const key = hidden ? (count === 1 ? 'results.hidden_count_one' : 'results.hidden_count') : count === 1 ? 'results.shown_count_one' : 'results.shown_count';
		return <>{t(key, { count })}</>;
	}
	const { outcome, shown, hiddenCount } = announcement;
	if (outcome.kind === 'results' && shown) {
		return (
			<>
				<CountLine outcome={outcome} shown={shown} />
				{hiddenCount > 0 ? `. ${t(hiddenCount === 1 ? 'results.hidden_count_one' : 'results.hidden_count', { count: hiddenCount })}` : null}
			</>
		);
	}
	if (outcome.kind === 'no_centres') return <>{t('results.none_in_radius', { radius: outcome.search.r })}</>;
	return null;
}

/** One card of any kind, in its list item. */
function CardItem({ card, now }: { card: SortedCard; now: number }) {
	if (card.kind === 'dated') {
		return (
			<li class="results__item">
				<ResultCard result={card.result} now={now} />
			</li>
		);
	}
	const kind = undatedKind(card.item.centre);
	return (
		<li class="results__item">
			{kind === 'no_dates' ? (
				<NoDatesCard item={card.item} now={now} />
			) : (
				<UncoveredCard item={card.item} rightNow={kind === 'not_checked_right_now'} />
			)}
		</li>
	);
}

const cardKey = (card: SortedCard): string => (card.kind === 'dated' ? `d:${card.result.listing.id}` : `u:${card.item.centre.centre_id}`);

function CardList({ cards, now }: { cards: SortedCard[]; now: number }) {
	return (
		<ul class="results">
			{cards.map((card) => (
				<CardItem key={cardKey(card)} card={card} now={now} />
			))}
		</ul>
	);
}

/** Soonest: dates, then (when there are any) "No dates to show" and the other cards. Nearest: one list. */
function SortedResults({ shown, sort }: { shown: Shown; sort: Sort }) {
	const { t } = useI18n();
	const sorted = sortedCards(shown, sort);
	if (sorted.sort === 'nearest') return <CardList cards={sorted.cards} now={shown.now} />;
	return (
		<>
			{sorted.dated.length > 0 ? <CardList cards={sorted.dated} now={shown.now} /> : null}
			{sorted.undated.length > 0 ? (
				<>
					<h2 class="results-heading">{t('results.no_dates_heading')}</h2>
					<CardList cards={sorted.undated} now={shown.now} />
				</>
			) : null}
		</>
	);
}

function Skeletons() {
	return (
		<ul class="results" aria-busy="true">
			{Array.from({ length: SKELETON_COUNT }, (_, index) => (
				<li key={index} class="skeleton">
					<span class="skeleton__bar" />
					<span class="skeleton__bar" />
					<span class="skeleton__bar" />
				</li>
			))}
		</ul>
	);
}

export function SearchPage({ services }: { services?: Partial<SearchServices> }) {
	const { lang, hash, t, replaceHash } = useI18n();
	const fetchImpl = services?.fetch;
	const storage = services?.storage ?? defaultReloadServices.storage;
	const reload = services?.reload ?? defaultReloadServices.reload;
	const clock = services?.now ?? Date.now;

	const [text, setText] = useState('');
	const [radius, setRadius] = useState<Radius>(DEFAULT_RADIUS);
	const [sort, setSort] = useState<Sort>(() => parseSort(hash));
	const [data, setData] = useState<DataState>({ kind: 'loading' });
	const [attempt, setAttempt] = useState(0);
	const [pending, setPending] = useState<Search | null>(null);
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	const [shown, setShown] = useState<Shown | null>(null);
	/** Counts shown outcomes, so a repeated field error remounts (and re-announces) its alert. */
	const [outcomeId, setOutcomeId] = useState(0);
	const [announcement, setAnnouncement] = useState<{ value: Announcement; id: number } | null>(null);
	/** The suggestions list starts dismissed: only typing (or a several-places outcome) opens it. */
	const [listDismissed, setListDismissed] = useState(true);
	const [listOpenId, setListOpenId] = useState(0);
	/** Page state, not in the fragment: stays as set across new searches until unticked or reload. */
	const [hideBooked, setHideBooked] = useState(false);

	const fieldRef = useRef<HTMLInputElement>(null);
	const hideBookedInput = useRef<HTMLInputElement>(null);
	/** The toggle as of the last render, read by `show` so a new search's announcement says what it hides. */
	const hideBookedOn = useRef(hideBooked);
	hideBookedOn.current = hideBooked;
	const lastSearch = useRef<Search | null>(null);
	const dataRef = useRef(data);
	dataRef.current = data;
	const langRef = useRef(lang);
	langRef.current = lang;
	/** The sort every fragment write carries; set from the fragment and by the sort control. */
	const sortRef = useRef(sort);
	const announceId = useRef(0);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;

	const announce = useCallback((value: Announcement) => {
		announceId.current += 1;
		setAnnouncement({ value, id: announceId.current });
	}, []);

	const show = useCallback(
		(search: Search, ready: Extract<DataState, { kind: 'ready' }>) => {
			const now = clock();
			const result = runSearch(search, ready.places.places, ready.snapshot.centres, ready.snapshot.listings, now, ready.places.others);
			// A single suggestion was searched: the field and the fragment take its pick text.
			if ((result.kind === 'results' || result.kind === 'no_centres') && result.search.q !== search.q) {
				lastSearch.current = result.search;
				setText(result.search.q);
				replaceHash(searchFragment(result.search.q, result.search.r, sortRef.current, langRef.current));
			}
			const resultShown: Shown | null = result.kind === 'results' ? { dated: result.dated, undated: result.undated, now } : null;
			setOutcome(result);
			setShown(resultShown);
			setOutcomeId((n) => n + 1);
			// A name several towns share keeps the list open so the user can pick one.
			if (result.kind === 'field_error' && result.code === 'several_places') {
				setListDismissed(false);
				setListOpenId((n) => n + 1);
			}
			if (result.kind === 'field_error') setAnnouncement(null);
			else {
				const hiddenCount = hideBookedOn.current && resultShown ? bookedOutCount(resultShown.dated) : 0;
				announce({ kind: 'outcome', outcome: result, shown: resultShown, hiddenCount });
			}
		},
		// The services are fixed for the page's lifetime.
		[announce, replaceHash],
	);

	/** Writes the fragment, then runs the search now or once the data has arrived. */
	const requestSearch = useCallback(
		(search: Search, options: { fill: boolean; focus: boolean }) => {
			lastSearch.current = search;
			setListDismissed(true);
			if (options.fill) setText(search.q);
			setRadius(search.r);
			replaceHash(searchFragment(search.q, search.r, sortRef.current, langRef.current));
			const current = dataRef.current;
			if (current.kind === 'ready') {
				setPending(null);
				show(search, current);
			} else {
				const alreadyWaiting = pendingRef.current !== null;
				setPending(search);
				setOutcome(null);
				// "Loading dates…" is announced once per wait, not on every submit while waiting.
				if (current.kind === 'loading' && !alreadyWaiting) announce({ kind: 'loading' });
			}
			if (options.focus) fieldRef.current?.focus();
		},
		[replaceHash, show, announce],
	);

	// Load both files once, in parallel; only "Try again" loads them again.
	useEffect(() => {
		let active = true;
		setData({ kind: 'loading' });
		Promise.allSettled([loadSnapshot(fetchImpl), loadPlaces(fetchImpl)]).then(([snapshot, places]) => {
			if (!active) return;
			if (snapshot.status === 'fulfilled' && places.status === 'fulfilled') {
				clearReloadFlag(storage);
				setData({ kind: 'ready', snapshot: snapshot.value, places: places.value });
				return;
			}
			const versionMismatch = [snapshot, places].some((r) => r.status === 'rejected' && r.reason instanceof SchemaVersionError);
			// Reloading picks up the app build that matches the data; the page stays in loading meanwhile.
			if (versionMismatch && reloadOnce({ storage, reload })) return;
			setData({ kind: 'failed' });
		});
		return () => {
			active = false;
		};
		// The services are fixed for the page's lifetime; only a retry loads again.
	}, [attempt]);

	// A search that waited for data runs as soon as it arrives.
	useEffect(() => {
		if (data.kind !== 'ready' || !pending) return;
		setPending(null);
		show(pending, data);
	}, [data, pending, show]);

	// On mount and on every fragment change: take its sort, and run its search when it differs from the last one.
	useEffect(() => {
		const fromFragment = parseSort(hash);
		sortRef.current = fromFragment;
		setSort(fromFragment);
		const { q, r } = parseSearchFragment(hash);
		if (!q) return;
		const search = { q, r };
		if (sameSearch(lastSearch.current, search)) return;
		requestSearch(search, { fill: true, focus: lastSearch.current !== null });
	}, [hash, requestSearch]);

	useEffect(() => {
		fieldRef.current?.focus();
	}, []);

	const submit = () => {
		const q = text.trim();
		if (!q) return;
		requestSearch({ q, r: radius }, { fill: false, focus: true });
	};

	const onText = (value: string) => {
		setText(value);
		// Typing before the data is ready opens nothing; the next keystroke after it does.
		setListDismissed(dataRef.current.kind !== 'ready');
	};

	const pick = (pickText: string) => requestSearch({ q: pickText, r: radius }, { fill: true, focus: true });

	/** Re-orders the cards already shown: no new search, clock read or fetch. */
	const chooseSort = (next: Sort) => {
		sortRef.current = next;
		setSort(next);
		const search = outcome?.kind === 'results' ? outcome.search : lastSearch.current;
		if (search) replaceHash(searchFragment(search.q, search.r, next, langRef.current));
		announce({ kind: 'sorted', sort: next });
	};

	/** Hides or shows the booked-out dates already shown: no new search, clock read or fetch. Focus ends on the checkbox. */
	const chooseHideBooked = (next: boolean) => {
		setHideBooked(next);
		announce({ kind: 'hidden', hidden: next, count: shown ? bookedOutCount(shown.dated) : 0 });
		hideBookedInput.current?.focus();
	};

	const announceSuggestions = useCallback((count: number) => announce({ kind: 'suggestions', count }), [announce]);

	const retry = () => {
		setAttempt((n) => n + 1);
		setData({ kind: 'loading' });
		if (pending) announce({ kind: 'loading' });
		fieldRef.current?.focus();
	};

	const fieldError = outcome?.kind === 'field_error' ? { code: outcome.code, suggestions: outcome.suggestions, id: outcomeId } : null;

	let body = null;
	if (pending && data.kind === 'loading') {
		body = <Skeletons />;
	} else if (pending && data.kind === 'failed') {
		body = (
			<div class="load-failure">
				<p class="load-failure__text" role="alert">
					{t('search.load_error')}
				</p>
				<button type="button" class="button-secondary" onClick={retry}>
					{t('search.retry')}
				</button>
			</div>
		);
	} else if (outcome?.kind === 'no_centres') {
		const next = nextRadius(outcome.search.r);
		body = (
			<div class="no-centres">
				<p>{t('results.none_in_radius', { radius: outcome.search.r })}</p>
				{next !== null ? (
					<button
						type="button"
						class="button-secondary"
						onClick={() => requestSearch({ q: outcome.search.q, r: next }, { fill: true, focus: true })}
					>
						{t('search.next_radius', { radius: next })}
					</button>
				) : null}
				<HiddenUnlocatedNotice count={outcome.hiddenUnlocated} />
			</div>
		);
	} else if (outcome?.kind === 'results' && shown) {
		const hiddenCount = hideBooked ? bookedOutCount(shown.dated) : 0;
		const visible: Shown = hideBooked ? { ...shown, dated: hideBookedOut(shown.dated) } : shown;
		// Every date is hidden by the toggle: this notice replaces the all-booked one (same state, said once).
		const allHidden = shown.dated.length > 0 && visible.dated.length === 0;
		body = (
			<>
				<p class="results-count">
					<CountLine outcome={outcome} shown={shown} />
				</p>
				<div class="results-controls">
					<SortControl sort={sort} onSort={chooseSort} />
					<HideBookedOut checked={hideBooked} checkboxRef={hideBookedInput} onChange={chooseHideBooked} />
				</div>
				{/* Everything hidden: the notice's "Show them" is the one way back, so this line stays out. */}
				<HiddenBookedLine count={allHidden ? 0 : hiddenCount} onShow={() => chooseHideBooked(false)} />
				{shown.dated.length === 0 ? <p class="notice-line">{t('results.notice_no_dates')}</p> : null}
				{allHidden ? (
					<p class="notice-line">
						<span id="all-hidden-notice">
							{t(hiddenCount === 1 ? 'results.notice_all_hidden_one' : 'results.notice_all_hidden', { count: hiddenCount })}
						</span>{' '}
						<button
							type="button"
							class="link-button notice-line__link"
							aria-describedby="all-hidden-notice"
							onClick={() => chooseHideBooked(false)}
						>
							{t('results.show_them')}
						</button>
					</p>
				) : allBookedOut(shown.dated) ? (
					<p class="notice-line">{t('results.notice_all_booked')}</p>
				) : null}
				<HiddenUnlocatedNotice count={outcome.hiddenUnlocated} />
				<SortedResults shown={visible} sort={sort} />
			</>
		);
	}

	return (
		<div class="search">
			<h1>{t('search.heading')}</h1>
			<SearchBar
				text={text}
				radius={radius}
				sort={sort}
				error={fieldError}
				fieldRef={fieldRef}
				places={data.kind === 'ready' ? data.places.places : null}
				dismissed={listDismissed}
				openId={listOpenId}
				onText={onText}
				onRadius={setRadius}
				onSubmit={submit}
				onDismiss={() => setListDismissed(true)}
				onReopen={() => setListDismissed(false)}
				onPick={pick}
				onSuggestions={announceSuggestions}
			/>
			<p class="visually-hidden" role="status">
				{announcement ? (
					<span key={announcement.id}>
						<AnnouncementText announcement={announcement.value} />
					</span>
				) : null}
			</p>
			<div class="search__results">{body}</div>
		</div>
	);
}
