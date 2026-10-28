import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Snapshot, SnapshotCentre } from '../../shared/snapshot.ts';
import { loadSnapshot, uncheckedCentres, unlocatedCentres } from './data/snapshot.ts';
import { NO_LOCATION_ID, NOT_CHECKED_ID, parseFragment } from './fragment.ts';
import { I18nProvider, useI18n, type Catalogues } from './i18n/i18n.tsx';
import { PageShell } from './shell/page-shell.tsx';

/** The issue form centres use to ask to be removed (`.github/ISSUE_TEMPLATE/opt-out-request.yml`). */
export const OPT_OUT_URL = 'https://github.com/esiak/testplatz/issues/new?template=opt-out-request.yml';
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const NOMINATIM_URL = 'https://nominatim.org/';

export { NO_LOCATION_ID, NOT_CHECKED_ID };

/** A link that opens in a new tab: visible `↗` (hidden from screen readers) and a "new tab" name. */
function ExternalLink({ href, label, children }: { href: string; label: string; children?: ComponentChildren }) {
	const { t } = useI18n();
	return (
		<a class="about__link" href={href} target="_blank" rel="noopener noreferrer" aria-label={t('link.new_tab', { label })}>
			<span>{children ?? label}</span> <span aria-hidden="true">{t('link.external_mark')}</span>
		</a>
	);
}

type SnapshotState = { kind: 'loading' } | { kind: 'loaded'; snapshot: Snapshot } | { kind: 'failed' };

/** Loads the snapshot once for every list on the page; `retry` loads it again. */
function useSnapshot(): { state: SnapshotState; retry: () => void } {
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<SnapshotState>({ kind: 'loading' });

	useEffect(() => {
		let active = true;
		setState({ kind: 'loading' });
		loadSnapshot().then(
			(snapshot) => {
				if (active) setState({ kind: 'loaded', snapshot });
			},
			() => {
				if (active) setState({ kind: 'failed' });
			},
		);
		return () => {
			active = false;
		};
	}, [attempt]);

	return { state, retry: () => setAttempt((n) => n + 1) };
}

interface CentreListProps {
	state: SnapshotState;
	retry: () => void;
	/** Picks this list's centres from the loaded snapshot. */
	select: (snapshot: Snapshot) => SnapshotCentre[];
	countText: (count: number) => string;
	noneText: string;
	/** Only one list announces a load failure, so it is not read out twice. */
	announceFailure: boolean;
}

function CentreList({ state, retry, select, countText, noneText, announceFailure }: CentreListProps) {
	const { t } = useI18n();

	if (state.kind === 'loading') {
		return (
			<div class="about__centres" aria-busy="true">
				<p>{t('about.not_checked.loading')}</p>
			</div>
		);
	}

	if (state.kind === 'failed') {
		return (
			<div class="about__centres">
				<p role={announceFailure ? 'alert' : undefined}>{t('about.not_checked.error')}</p>
				<button type="button" class="about__retry" onClick={retry}>
					{t('about.not_checked.retry')}
				</button>
			</div>
		);
	}

	const centres = select(state.snapshot);
	if (centres.length === 0) {
		return (
			<div class="about__centres">
				<p>{noneText}</p>
			</div>
		);
	}

	return (
		<div class="about__centres">
			<p>{countText(centres.length)}</p>
			<ul class="about__centre-list">
				{centres.map((centre) => {
					const href = centre.test_page_url ?? centre.website;
					return (
						<li key={centre.centre_id} class="about__centre">
							{href ? (
								<ExternalLink href={href} label={centre.name}>
									<span lang="de">{centre.name}</span>
								</ExternalLink>
							) : (
								<span lang="de">{centre.name}</span>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** Section ids a fragment key can scroll to (`#not-checked`, `#no-location=&lang=de`, …). */
const TARGET_IDS = [NOT_CHECKED_ID, NO_LOCATION_ID] as const;

/**
 * Scrolls a targeted section into view when the fragment has its key, and again once `ready`
 * turns true: `#no-location` sits below a list that grows when the snapshot loads, and browsers
 * without scroll anchoring (Safari) would otherwise leave it off-screen.
 */
function useSectionTarget(ready: boolean): void {
	useEffect(() => {
		const scrollIfTargeted = () => {
			const params = parseFragment(location.hash);
			const id = TARGET_IDS.find((candidate) => params.has(candidate));
			if (id === undefined) return;
			document.getElementById(id)?.scrollIntoView();
		};
		scrollIfTargeted();
		window.addEventListener('hashchange', scrollIfTargeted);
		return () => window.removeEventListener('hashchange', scrollIfTargeted);
	}, [ready]);
}

function AboutContent() {
	const { t } = useI18n();
	const { state, retry } = useSnapshot();
	useSectionTarget(state.kind === 'loaded');

	return (
		<div class="about">
			<h1>{t('about.heading')}</h1>

			<section>
				<h2>{t('about.how.heading')}</h2>
				<p>{t('about.how.body')}</p>
			</section>

			<section id={NOT_CHECKED_ID}>
				<h2>{t('about.not_checked.heading')}</h2>
				<p>{t('about.not_checked.intro')}</p>
				<ul>
					<li>{t('about.not_checked.reason_system')}</li>
					<li>{t('about.not_checked.reason_opted_out')}</li>
					<li>{t('about.not_checked.reason_failed')}</li>
				</ul>
				<CentreList
					state={state}
					retry={retry}
					select={uncheckedCentres}
					countText={(count) => t('about.not_checked.count', { count })}
					noneText={t('about.not_checked.none')}
					announceFailure
				/>
			</section>

			<section id={NO_LOCATION_ID}>
				<h2>{t('about.no_location.heading')}</h2>
				<p>{t('about.no_location.intro')}</p>
				<CentreList
					state={state}
					retry={retry}
					select={unlocatedCentres}
					countText={(count) => t(count === 1 ? 'about.no_location.count_one' : 'about.no_location.count', { count })}
					noneText={t('about.no_location.none')}
					announceFailure={false}
				/>
			</section>

			<section>
				<h2>{t('about.sources.heading')}</h2>
				<ul>
					<li>{t('about.sources.directory')}</li>
					<li>{t('about.sources.websites')}</li>
				</ul>
			</section>

			<section>
				<h2>{t('about.attribution.heading')}</h2>
				<p>
					<ExternalLink href={OSM_COPYRIGHT_URL} label={t('about.attribution.osm')} />
				</p>
				<p>
					<ExternalLink href={NOMINATIM_URL} label={t('about.attribution.nominatim')} />
				</p>
			</section>

			<section>
				<h2>{t('about.opt_out.heading')}</h2>
				<p>{t('about.opt_out.body')}</p>
				<p>
					<ExternalLink href={OPT_OUT_URL} label={t('about.opt_out.link')} />
				</p>
			</section>
		</div>
	);
}

export function AboutPage({ catalogues }: { catalogues?: Catalogues }) {
	return (
		<I18nProvider titleKey="about.title" catalogues={catalogues}>
			<PageShell page="about">
				<AboutContent />
			</PageShell>
		</I18nProvider>
	);
}
