import type { Ref } from 'preact';
import { useI18n } from '../i18n/i18n.tsx';

/** The id of the "N booked-out dates hidden" text, which describes its "Show" button. */
const HIDDEN_COUNT_ID = 'hidden-booked-count';

/** "Hide booked-out": a native checkbox, in the row with the sort control. */
export function HideBookedOut({
	checked,
	checkboxRef,
	onChange,
}: {
	checked: boolean;
	checkboxRef: Ref<HTMLInputElement>;
	onChange: (checked: boolean) => void;
}) {
	const { t } = useI18n();
	return (
		<div class="hide-booked">
			<label class="hide-booked__label">
				<input
					ref={checkboxRef}
					type="checkbox"
					class="hide-booked__input"
					checked={checked}
					onChange={(event) => onChange(event.currentTarget.checked)}
				/>
				<span>{t('results.hide_booked')}</span>
			</label>
		</div>
	);
}

/**
 * "N booked-out dates hidden · Show", below the controls row so neither control moves when it
 * appears; absent when nothing is hidden. Show unticks the checkbox.
 */
export function HiddenBookedLine({ count, onShow }: { count: number; onShow: () => void }) {
	const { t } = useI18n();
	if (count === 0) return null;
	return (
		<p class="hide-booked__line">
			<span id={HIDDEN_COUNT_ID}>{t(count === 1 ? 'results.hidden_count_one' : 'results.hidden_count', { count })}</span>{' '}
			<span aria-hidden="true">·</span>{' '}
			<button type="button" class="link-button notice-line__link" aria-describedby={HIDDEN_COUNT_ID} onClick={onShow}>
				{t('results.show')}
			</button>
		</p>
	);
}
