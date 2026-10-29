import { useI18n } from '../i18n/i18n.tsx';
import { FreshnessLine } from './result-card.tsx';
import type { UndatedResult } from './results.ts';
import { destinationDomain, formatAddress, mapsUrl } from './search.ts';

/**
 * A covered centre whose last check succeeded and found no upcoming date. Laid out like a result
 * card: the whole card is one stretched link (the h3's link, holding the centre name) to the
 * centre's test page; the address with "Map ↗" sits above the link layer.
 */
export function NoDatesCard({ item, now }: { item: UndatedResult; now: number }) {
	const { lang, t } = useI18n();
	const { centre, distanceKm } = item;
	const unknown = t('card.fact.distance_unknown');
	const distance = distanceKm === null ? unknown : t('card.fact.distance_value', { km: Math.round(distanceKm) });
	const href = centre.test_page_url ?? centre.website;
	const domain = href ? destinationDomain(href) : null;
	const address = formatAddress(centre.address);
	const noDates = t('status.no_dates');

	// A centre has no registration data of its own, and there is no date to take it from.
	const facts: Array<[string, string]> = [
		[t('card.fact.distance'), distance],
		[t('card.fact.status'), noDates],
		[t('card.fact.deadline'), unknown],
		[t('card.fact.registration'), unknown],
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
							aria-label={t('card.no_dates_link_label', { name: centre.name, domain: domain ?? href })}
						>
							<span lang="de">{centre.name}</span>
						</a>
					) : (
						centre.name
					)}
				</h3>
				<span class="chip chip--booked" aria-hidden="true">
					{noDates}
				</span>
			</div>

			<p class="card__address">
				<span class="card__address-text">{address}</span>
				<a class="card__map" href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" aria-label={t('card.map_label', { address })}>
					<span>{t('card.map')}</span>
					<span aria-hidden="true">{t('link.external_mark')}</span>
				</a>
			</p>

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
				{centre.last_success_at !== null ? <FreshnessLine lastSuccessAt={centre.last_success_at} now={now} /> : null}
			</div>
		</article>
	);
}
