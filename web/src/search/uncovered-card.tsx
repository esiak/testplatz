import type { SnapshotCentre } from '../../../shared/snapshot.ts';
import { NOT_CHECKED_ID, serialiseFragment } from '../fragment.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { destinationDomain, formatAddress, mapsUrl } from './search.ts';

/** About the data, at the given section (a fragment key such as `not-checked`), in the given language. */
export function aboutSectionUrl(lang: string, sectionId: string): string {
	return `${import.meta.env.BASE_URL}about/${serialiseFragment(new URLSearchParams([[sectionId, ''], ['lang', lang]]))}`;
}

/** About the data, at the not-checked section, in the given language. */
export function whyUrl(lang: string): string {
	return aboutSectionUrl(lang, NOT_CHECKED_ID);
}

/**
 * A centre with no automatic check. The whole card is one stretched link (the h3's link) to the
 * centre's test page; "Map ↗" and "Why?" sit above the link layer as their own targets.
 */
export function UncoveredCard({ item }: { item: { centre: SnapshotCentre; distanceKm: number | null } }) {
	const { lang, t } = useI18n();
	const { centre, distanceKm } = item;
	const distance = distanceKm === null ? t('card.fact.distance_unknown') : t('card.fact.distance_value', { km: Math.round(distanceKm) });
	const href = centre.test_page_url ?? centre.website;
	const domain = href ? destinationDomain(href) : null;
	const address = formatAddress(centre.address);
	const notChecked = t('card.fact.status_not_checked');
	const seeWebsite = t('card.fact.see_website');

	const facts: Array<[string, string]> = [
		[t('card.fact.distance'), distance],
		[t('card.fact.status'), notChecked],
		[t('card.fact.deadline'), seeWebsite],
		[t('card.fact.registration'), seeWebsite],
	];

	return (
		<article class="card">
			<div class="card__top">
				<h3 class="card__name" lang="de">
					{href ? (
						<a
							class="card__link"
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							lang={lang}
							aria-label={t('card.link_label', { name: centre.name, domain: domain ?? href })}
						>
							<span lang="de">{centre.name}</span>
						</a>
					) : (
						centre.name
					)}
				</h3>
				<span class="chip chip--unknown" aria-hidden="true">
					{t('card.chip_not_checked')}
				</span>
			</div>

			<p class="card__address">
				<span class="card__address-text">{address}</span>
				<a class="card__map" href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" aria-label={t('card.map_label', { address })}>
					<span>{t('card.map')}</span>
					<span aria-hidden="true">{t('link.external_mark')}</span>
				</a>
			</p>

			<p class="card__body">{t('card.not_checked_automatically')}</p>

			<div class="card__facts">
				<dl class="key-facts">
					{facts.map(([label, value]) => (
						<div key={label} class="key-facts__cell">
							<dt class="key-facts__label">{label}</dt>
							<dd class="key-facts__value">{value}</dd>
						</div>
					))}
				</dl>
			</div>

			<div class="card__bottom">
				{href && domain ? (
					<span class="card__destination" aria-hidden="true">
						{t('card.destination', { domain })}
					</span>
				) : null}
				<a class="card__why" href={whyUrl(lang)} aria-label={t('card.why_label', { name: centre.name })}>
					{t('card.why')}
				</a>
			</div>
		</article>
	);
}
