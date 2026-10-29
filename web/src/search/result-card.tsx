import type { ComponentChildren } from 'preact';
import type { RegistrationMethod, StatusCode } from '../../../shared/listing.ts';
import { useI18n, type MessageKey } from '../i18n/i18n.tsx';
import { cardDate, deadlineState, freshness } from './format.ts';
import type { DatedResult } from './results.ts';
import { destinationDomain, mapsUrl } from './search.ts';

const STATUS_WORD: Record<StatusCode, MessageKey> = {
	free: 'status.free',
	booked_out: 'status.booked',
	waitlist: 'status.booked_waitlist',
	unknown: 'status.unknown',
};

const CHIP_VARIANT: Record<StatusCode, string> = {
	free: 'chip--free',
	booked_out: 'chip--booked',
	waitlist: 'chip--booked',
	unknown: 'chip--unknown',
};

const REGISTRATION_WORD: Record<RegistrationMethod, MessageKey> = {
	online: 'card.registration.online',
	email: 'card.registration.email',
	post: 'card.registration.post',
	in_person: 'card.registration.in_person',
};

/** Marks the placeholder a message is split on, so a glyph can be rendered `aria-hidden` in its place. */
const MARK = '\u0000';

/** "Checked 2 h ago" / "◷ Checked Tue 14:00": the centre's last successful check, never per date. */
function FreshnessLine({ lastSuccessAt, now }: { lastSuccessAt: string; now: number }) {
	const { lang, t } = useI18n();
	const state = freshness(lastSuccessAt, now, lang);
	let text;
	if (state.kind === 'under_hour') text = t('freshness.under_hour');
	else if (state.kind === 'relative') text = t('freshness.relative', { hours: state.hours });
	else {
		const [before, after] = t('freshness.exact', { mark: MARK, time: state.time }).split(MARK);
		text =
			after === undefined ? (
				before
			) : (
				<>
					{before}
					<span aria-hidden="true">◷</span>
					{after}
				</>
			);
	}
	return (
		<p class="card__freshness">
			<time dateTime={lastSuccessAt}>{text}</time>
		</p>
	);
}

/**
 * One test date. The whole card is one stretched link (the h3's link) to the date's page, or to
 * the centre's test page when the deep link was dead; the address with "Map ↗" and the
 * "Who may register" line sit above the link layer.
 */
export function ResultCard({ result, now }: { result: DatedResult; now: number }) {
	const { lang, t } = useI18n();
	const { listing, centre, distanceKm } = result;

	const date = cardDate(listing.starts_at, lang);
	const statusWord = t(STATUS_WORD[listing.status]);
	const statusSpoken = listing.status === 'waitlist' ? t('status.booked_waitlist_spoken') : statusWord;
	const unknown = t('card.fact.distance_unknown');

	const href = listing.link_ok ? listing.source_url : (centre.test_page_url ?? centre.website ?? listing.source_url);
	const domain = destinationDomain(href) ?? href;
	const testPage = !listing.link_ok && centre.test_page_url !== null;
	const destination = testPage ? t('card.destination_test_page') : t('card.destination', { domain });

	const distance = distanceKm === null ? unknown : t('card.fact.distance_value', { km: Math.round(distanceKm) });
	const deadline = deadlineState(listing.deadline, now, lang);
	const deadlineText = deadline.kind === 'unknown' ? unknown : deadline.kind === 'passed' ? t('card.deadline_passed') : deadline.date;
	const registration = listing.registration_method === null ? unknown : t(REGISTRATION_WORD[listing.registration_method]);
	const status =
		statusSpoken === statusWord ? (
			statusWord
		) : (
			<>
				<span aria-hidden="true">{statusWord}</span>
				<span class="visually-hidden">{statusSpoken}</span>
			</>
		);

	const facts: Array<[string, ComponentChildren]> = [
		[t('card.fact.distance'), distance],
		[t('card.fact.status'), status],
		[t('card.fact.deadline'), deadlineText],
		[t('card.fact.registration'), registration],
	];

	return (
		<article class="card">
			<div class="card__top">
				<h3 class="card__date">
					<a
						class="card__link"
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={t('card.result_link_label', { date, name: centre.name, status: statusSpoken, domain })}
					>
						{date}
					</a>
				</h3>
				{/* "New" badge slot (Story 3.1). */}
				<span class={`chip ${CHIP_VARIANT[listing.status]}`} aria-hidden="true">
					{statusWord}
				</span>
			</div>

			<p class="card__centre" lang="de">
				{centre.name}
			</p>

			<p class="card__address">
				<span class="card__address-text">{listing.address}</span>
				<a
					class="card__map"
					href={mapsUrl(listing.address)}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={t('card.map_label', { address: listing.address })}
				>
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

			<p class="card__eligibility">
				{listing.eligibility === null ? (
					t('card.eligibility_unknown')
				) : (
					<>
						{t('card.eligibility_label')} <span lang="de">{listing.eligibility}</span>
					</>
				)}
			</p>

			<div class="card__bottom">
				<span class="card__destination" aria-hidden="true">
					{destination}
				</span>
				{centre.last_success_at !== null ? <FreshnessLine lastSuccessAt={centre.last_success_at} now={now} /> : null}
			</div>
		</article>
	);
}
