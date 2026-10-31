import type { RegistrationMethod, StatusCode } from '../../../shared/listing.ts';
import { useI18n, type MessageKey } from '../i18n/i18n.tsx';
import { AddressLine, CardHeading, CardIcon, DateTile, distanceText, Glyph, MetaLine, type GlyphName, type IconTint, type MetaPart } from './card-parts.tsx';
import { cardDate, cardTime, deadlineState, freshness, tileDate } from './format.ts';
import type { DatedResult } from './results.ts';
import { destinationDomain } from './search.ts';

const STATUS_WORD: Record<StatusCode, MessageKey> = {
	free: 'status.free',
	booked_out: 'status.booked',
	waitlist: 'status.booked_waitlist',
	unknown: 'status.unknown',
};

/** Each status has its own shape; the tint repeats it, never alone. */
const STATUS_ICON: Record<StatusCode, { glyph: GlyphName; tint: IconTint }> = {
	free: { glyph: 'free', tint: 'free' },
	booked_out: { glyph: 'booked', tint: 'booked' },
	waitlist: { glyph: 'waitlist', tint: 'booked' },
	unknown: { glyph: 'unknown', tint: 'unknown' },
};

const REGISTRATION_WORD: Record<RegistrationMethod, MessageKey> = {
	online: 'card.registration.online',
	email: 'card.registration.email',
	post: 'card.registration.post',
	in_person: 'card.registration.in_person',
};

const REGISTRATION_GLYPH: Record<RegistrationMethod, GlyphName> = {
	online: 'online',
	email: 'email',
	post: 'post',
	in_person: 'in_person',
};

/** Marks the placeholder a message is split on, so a glyph can be rendered `aria-hidden` in its place. */
const MARK = '\u0000';

/** "Checked 2 h ago" / "◷ Checked Tue 14:00": the centre's last successful check, never per date. */
export function FreshnessLine({ lastSuccessAt, now }: { lastSuccessAt: string; now: number }) {
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
 * One test date, variant B: date tile | address, meta line, centre, freshness | status,
 * registration (and eligibility-unknown) icons, with the eligibility rule as a full-width line.
 * The whole card is one stretched link (the h3's link, wrapping the tile) to the date's page, or
 * to the centre's test page when the deep link was dead; the map pin, icons, address and
 * eligibility line sit above the link layer.
 */
export function ResultCard({ result, now }: { result: DatedResult; now: number }) {
	const { lang, t } = useI18n();
	const { listing, centre, distanceKm } = result;

	const statusWord = t(STATUS_WORD[listing.status]);
	const statusSpoken = listing.status === 'waitlist' ? t('status.booked_waitlist_spoken') : statusWord;
	const registration =
		listing.registration_method === null ? t('card.registration.unknown') : t(REGISTRATION_WORD[listing.registration_method]);

	const href = listing.link_ok ? listing.source_url : (centre.test_page_url ?? centre.website ?? listing.source_url);
	const domain = destinationDomain(href) ?? href;
	const testPage = !listing.link_ok && centre.test_page_url !== null;

	const deadline = deadlineState(listing.deadline, now, lang);
	const meta: MetaPart[] = [
		{ text: cardTime(listing.starts_at), nowrap: true },
		{ text: distanceText(distanceKm, t), nowrap: true },
		deadline.kind === 'unknown'
			? { text: t('card.deadline_unknown') }
			: deadline.kind === 'passed'
				? { text: t('card.deadline_passed'), warn: true }
				: { text: t('card.deadline', { date: deadline.date }) },
	];

	const label = t('card.result_link_label', {
		date: cardDate(listing.starts_at, lang),
		address: listing.address,
		name: centre.name,
		status: statusSpoken,
		registration,
		domain,
	});
	const statusIcon = STATUS_ICON[listing.status];

	return (
		<article class="card">
			<CardHeading href={href} label={label}>
				<DateTile {...tileDate(listing.starts_at, lang)} />
			</CardHeading>

			<div class="card__text">
				<AddressLine address={listing.address} />
				<MetaLine parts={meta} />
				<p class="card__centre" lang="de">
					{centre.name}
				</p>
				{centre.last_success_at !== null ? <FreshnessLine lastSuccessAt={centre.last_success_at} now={now} /> : null}
				{testPage ? <p class="card__test-page">{t('card.destination_test_page')}</p> : null}
			</div>

			<div class="card__icons">
				<CardIcon glyph={statusIcon.glyph} tint={statusIcon.tint} label={statusWord} spoken={statusSpoken} />
				<CardIcon
					glyph={listing.registration_method === null ? 'registration_unknown' : REGISTRATION_GLYPH[listing.registration_method]}
					tint="info"
					label={registration}
				/>
				{listing.eligibility === null ? <CardIcon glyph="eligibility_unknown" tint="info" label={t('card.eligibility_not_stated')} /> : null}
			</div>

			{listing.eligibility !== null ? (
				<p class="card__eligibility">
					<Glyph name="house" />
					<span>
						<span class="visually-hidden">{t('card.eligibility_label')} </span>
						<span lang="de">{listing.eligibility}</span>
					</span>
				</p>
			) : null}
		</article>
	);
}
