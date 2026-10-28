import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Places } from '../../../shared/places.ts';
import type { Snapshot } from '../../../shared/snapshot.ts';
import { SchemaVersionError } from '../data/load-json.ts';
import { loadPlaces } from '../data/places.ts';
import { clearReloadFlag, defaultReloadServices, reloadOnce, type ReloadServices } from '../data/reload-once.ts';
import { loadSnapshot } from '../data/snapshot.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { SearchBar } from './search-bar.tsx';
import { DEFAULT_RADIUS, nextRadius, parseSearchFragment, runSearch, searchFragment, type Outcome, type Radius, type Search } from './search.ts';
import { UncoveredCard } from './uncovered-card.tsx';

/** What the page talks to; tests inject their own. */
export interface SearchServices extends ReloadServices {
	/** Used for the two data requests; defaults to the global `fetch` at call time. */
	fetch?: typeof fetch;
}

type DataState = { kind: 'loading' } | { kind: 'ready'; snapshot: Snapshot; places: Places } | { kind: 'failed' };

/** What the live region says. Stored as a description so a language switch re-renders it. */
type Announcement = { kind: 'loading' } | { kind: 'outcome'; outcome: Outcome } | { kind: 'suggestions'; count: number };

const SKELETON_COUNT = 3;

function sameSearch(a: Search | null, b: Search): boolean {
	return a !== null && a.q === b.q && a.r === b.r;
}

function CountLine({ outcome }: { outcome: Extract<Outcome, { kind: 'results' }> }) {
	const { t } = useI18n();
	const unchecked = outcome.items.length;
	return <>{t(unchecked === 1 ? 'results.count_one' : 'results.count', { dates: 0, unchecked, radius: outcome.search.r })}</>;
}

function AnnouncementText({ announcement }: { announcement: Announcement | null }) {
	const { t } = useI18n();
	if (!announcement) return null;
	if (announcement.kind === 'loading') return <>{t('search.loading')}</>;
	if (announcement.kind === 'suggestions') {
		const { count } = announcement;
		return <>{t(count === 1 ? 'search.suggestions_count_one' : 'search.suggestions_count', { count })}</>;
	}
	const { outcome } = announcement;
	if (outcome.kind === 'results') return <CountLine outcome={outcome} />;
	if (outcome.kind === 'no_centres') return <>{t('results.none_in_radius', { radius: outcome.search.r })}</>;
	return null;
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

	const [text, setText] = useState('');
	const [radius, setRadius] = useState<Radius>(DEFAULT_RADIUS);
	const [data, setData] = useState<DataState>({ kind: 'loading' });
	const [attempt, setAttempt] = useState(0);
	const [pending, setPending] = useState<Search | null>(null);
	const [outcome, setOutcome] = useState<Outcome | null>(null);
	/** Counts shown outcomes, so a repeated field error remounts (and re-announces) its alert. */
	const [outcomeId, setOutcomeId] = useState(0);
	const [announcement, setAnnouncement] = useState<{ value: Announcement; id: number } | null>(null);
	/** The suggestions list starts dismissed: only typing (or a several-places outcome) opens it. */
	const [listDismissed, setListDismissed] = useState(true);
	const [listOpenId, setListOpenId] = useState(0);

	const fieldRef = useRef<HTMLInputElement>(null);
	const lastSearch = useRef<Search | null>(null);
	const dataRef = useRef(data);
	dataRef.current = data;
	const langRef = useRef(lang);
	langRef.current = lang;
	const announceId = useRef(0);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;

	const announce = useCallback((value: Announcement) => {
		announceId.current += 1;
		setAnnouncement({ value, id: announceId.current });
	}, []);

	const show = useCallback(
		(search: Search, ready: Extract<DataState, { kind: 'ready' }>) => {
			const result = runSearch(search, ready.places.places, ready.snapshot.centres);
			// A single suggestion was searched: the field and the fragment take its pick text.
			if ((result.kind === 'results' || result.kind === 'no_centres') && result.search.q !== search.q) {
				lastSearch.current = result.search;
				setText(result.search.q);
				replaceHash(searchFragment(result.search.q, result.search.r, langRef.current));
			}
			setOutcome(result);
			setOutcomeId((n) => n + 1);
			// A name several towns share keeps the list open so the user can pick one.
			if (result.kind === 'field_error' && result.code === 'several_places') {
				setListDismissed(false);
				setListOpenId((n) => n + 1);
			}
			if (result.kind === 'field_error') setAnnouncement(null);
			else announce({ kind: 'outcome', outcome: result });
		},
		[announce, replaceHash],
	);

	/** Writes the fragment, then runs the search now or once the data has arrived. */
	const requestSearch = useCallback(
		(search: Search, options: { fill: boolean; focus: boolean }) => {
			lastSearch.current = search;
			setListDismissed(true);
			if (options.fill) setText(search.q);
			setRadius(search.r);
			replaceHash(searchFragment(search.q, search.r, langRef.current));
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

	// On mount and on every fragment change: run the fragment's search when it differs from the last one.
	useEffect(() => {
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
			</div>
		);
	} else if (outcome?.kind === 'results') {
		body = (
			<>
				<p class="results-count">
					<CountLine outcome={outcome} />
				</p>
				<p class="notice-line">{t('results.notice_no_dates')}</p>
				<ul class="results">
					{outcome.items.map((item) => (
						<li key={item.centre.centre_id} class="results__item">
							<UncoveredCard item={item} />
						</li>
					))}
				</ul>
			</>
		);
	}

	return (
		<div class="search">
			<h1>{t('search.heading')}</h1>
			<SearchBar
				text={text}
				radius={radius}
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
