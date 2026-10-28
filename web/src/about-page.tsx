import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { SnapshotCentre } from '../../shared/snapshot.ts';
import { loadSnapshot, uncheckedCentres } from './data/snapshot.ts';
import { parseFragment } from './fragment.ts';
import { I18nProvider, useI18n, type Catalogues } from './i18n/i18n.tsx';
import { PageShell } from './shell/page-shell.tsx';

/** The issue form centres use to ask to be removed (`.github/ISSUE_TEMPLATE/opt-out-request.yml`). */
export const OPT_OUT_URL = 'https://github.com/esiak/testplatz/issues/new?template=opt-out-request.yml';
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
const NOMINATIM_URL = 'https://nominatim.org/';

/** The id of the not-checked section; also a fragment key (`#not-checked`, `#not-checked=&lang=en`). */
export const NOT_CHECKED_ID = 'not-checked';

/** A link that opens in a new tab: visible `↗` (hidden from screen readers) and a "new tab" name. */
function ExternalLink({ href, label, children }: { href: string; label: string; children?: ComponentChildren }) {
	const { t } = useI18n();
	return (
		<a class="about__link" href={href} target="_blank" rel="noopener noreferrer" aria-label={t('link.new_tab', { label })}>
			<span>{children ?? label}</span> <span aria-hidden="true">{t('link.external_mark')}</span>
		</a>
	);
}

type ListState = { kind: 'loading' } | { kind: 'loaded'; centres: SnapshotCentre[] } | { kind: 'failed' };

function CentreList() {
	const { t } = useI18n();
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<ListState>({ kind: 'loading' });

	useEffect(() => {
		let active = true;
		setState({ kind: 'loading' });
		loadSnapshot().then(
			(snapshot) => {
				if (active) setState({ kind: 'loaded', centres: uncheckedCentres(snapshot) });
			},
			() => {
				if (active) setState({ kind: 'failed' });
			},
		);
		return () => {
			active = false;
		};
	}, [attempt]);

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
				<p role="alert">{t('about.not_checked.error')}</p>
				<button type="button" class="about__retry" onClick={() => setAttempt((n) => n + 1)}>
					{t('about.not_checked.retry')}
				</button>
			</div>
		);
	}

	const { centres } = state;
	if (centres.length === 0) {
		return (
			<div class="about__centres">
				<p>{t('about.not_checked.none')}</p>
			</div>
		);
	}

	return (
		<div class="about__centres">
			<p>{t('about.not_checked.count', { count: centres.length })}</p>
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

/** Scrolls the not-checked section into view when the fragment has a `not-checked` key. */
function useNotCheckedTarget(): void {
	useEffect(() => {
		const scrollIfTargeted = () => {
			if (!parseFragment(location.hash).has(NOT_CHECKED_ID)) return;
			document.getElementById(NOT_CHECKED_ID)?.scrollIntoView();
		};
		scrollIfTargeted();
		window.addEventListener('hashchange', scrollIfTargeted);
		return () => window.removeEventListener('hashchange', scrollIfTargeted);
	}, []);
}

function AboutContent() {
	const { t } = useI18n();
	useNotCheckedTarget();

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
				<CentreList />
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
