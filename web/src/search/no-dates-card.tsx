import { useI18n } from '../i18n/i18n.tsx';
import { AddressLine, CardHeading, distanceText, IconTile, MetaLine } from './card-parts.tsx';
import { FreshnessLine } from './result-card.tsx';
import type { UndatedResult } from './results.ts';
import { destinationDomain, formatAddress } from './search.ts';

/**
 * A covered centre whose last check succeeded and found no upcoming date. Laid out like a result
 * card, with a calendar in the tile and no icons: the whole card is one stretched link (the h3's
 * link, wrapping the tile) to the centre's test page; the address and map pin sit above the link layer.
 */
export function NoDatesCard({ item, now }: { item: UndatedResult; now: number }) {
	const { t } = useI18n();
	const { centre, distanceKm } = item;
	const href = centre.test_page_url ?? centre.website;
	const domain = href ? (destinationDomain(href) ?? href) : null;

	return (
		<article class="card">
			<CardHeading
				href={href}
				label={t('card.no_dates_link_label', { name: centre.name, domain: domain ?? '' })}
				hiddenName={centre.name}
			>
				<IconTile name="calendar" />
			</CardHeading>

			<div class="card__text">
				<AddressLine address={formatAddress(centre.address)} />
				<MetaLine parts={[{ text: t('status.no_dates') }, { text: distanceText(distanceKm, t), nowrap: true }]} />
				<p class="card__centre" lang="de">
					{centre.name}
				</p>
				{centre.last_success_at !== null ? <FreshnessLine lastSuccessAt={centre.last_success_at} now={now} /> : null}
			</div>
		</article>
	);
}
