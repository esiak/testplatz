import type { SnapshotCentre } from '../../../shared/snapshot.ts';
import { NOT_CHECKED_ID, serialiseFragment } from '../fragment.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { AddressLine, CardHeading, distanceText, IconTile, MetaLine } from './card-parts.tsx';
import { destinationDomain, formatAddress } from './search.ts';

/** About the data, at the given section (a fragment key such as `not-checked`), in the given language. */
export function aboutSectionUrl(lang: string, sectionId: string): string {
	return `${import.meta.env.BASE_URL}about/${serialiseFragment(new URLSearchParams([[sectionId, ''], ['lang', lang]]))}`;
}

/** About the data, at the not-checked section, in the given language. */
export function whyUrl(lang: string): string {
	return aboutSectionUrl(lang, NOT_CHECKED_ID);
}

/**
 * A centre with no automatic check, or (`rightNow`) a covered centre whose check failed or never
 * ran. Laid out like a result card, with a question mark on the unknown tint in the tile, no
 * freshness line and no icons. The whole card is one stretched link (the h3's link, wrapping the
 * tile) to the centre's test page; the map pin and "Why?" sit above the link layer.
 */
export function UncoveredCard({
	item,
	rightNow = false,
}: {
	item: { centre: SnapshotCentre; distanceKm: number | null };
	rightNow?: boolean;
}) {
	const { lang, t } = useI18n();
	const { centre, distanceKm } = item;
	const href = centre.test_page_url ?? centre.website;
	const domain = href ? (destinationDomain(href) ?? href) : null;
	const reason = t(rightNow ? 'card.not_checked_right_now' : 'card.not_checked_automatically');
	const short = t(rightNow ? 'card.meta_not_checked_right_now' : 'card.meta_not_checked_automatically');

	return (
		<article class="card">
			<CardHeading href={href} label={t('card.link_label', { name: centre.name, reason, domain: domain ?? '' })} hiddenName={centre.name}>
				<IconTile name="unknown" unknown />
			</CardHeading>

			<div class="card__text">
				<AddressLine address={formatAddress(centre.address)} />
				<MetaLine parts={[{ text: short, warn: true }, { text: distanceText(distanceKm, t), nowrap: true }]} />
				<p class="card__centre" lang="de">
					{centre.name}
				</p>
				<a class="card__why" href={whyUrl(lang)} aria-label={t('card.why_label', { name: centre.name })}>
					{t('card.why')}
				</a>
			</div>
		</article>
	);
}
