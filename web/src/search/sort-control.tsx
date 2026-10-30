import { useI18n } from '../i18n/i18n.tsx';
import { SORTS, type Sort } from './search.ts';

const LABEL_KEYS = { soonest: 'results.sort_soonest', nearest: 'results.sort_nearest' } as const;

/** "Sort by": two native radios styled as segments, Soonest | Nearest. Applies on change. */
export function SortControl({ sort, onSort }: { sort: Sort; onSort: (sort: Sort) => void }) {
	const { t } = useI18n();
	return (
		<fieldset class="sort-control">
			<legend class="sort-control__legend">{t('results.sort_legend')}</legend>
			<div class="sort-control__segments">
				{SORTS.map((value) => (
					<label key={value} class="sort-control__segment">
						<input
							type="radio"
							class="sort-control__input"
							name="sort"
							value={value}
							checked={sort === value}
							onChange={() => onSort(value)}
						/>
						<span class="sort-control__label">{t(LABEL_KEYS[value])}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
