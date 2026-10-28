import type { RefObject } from 'preact';
import { useI18n } from '../i18n/i18n.tsx';
import { RADII, searchFragment, snapRadius, type FieldErrorCode, type Radius } from './search.ts';

export const FIELD_ID = 'search-place';
export const FIELD_MESSAGE_ID = 'search-place-message';
const RADIUS_ID = 'search-radius';

export interface FieldError {
	code: FieldErrorCode;
	suggestions: string[];
	/** Changes with every search, so the same message twice is announced again. */
	id: number;
}

export interface SearchBarProps {
	text: string;
	radius: Radius;
	error: FieldError | null;
	fieldRef: RefObject<HTMLInputElement | null>;
	onText: (text: string) => void;
	onRadius: (radius: Radius) => void;
	onSubmit: () => void;
}

const ERROR_KEYS = { place_not_found: 'error.place_not_found', outside_bavaria: 'error.outside_bavaria' } as const;

/** Place field, native radius select and the search button. Changing the select alone never searches. */
export function SearchBar({ text, radius, error, fieldRef, onText, onRadius, onSubmit }: SearchBarProps) {
	const { lang, t } = useI18n();

	return (
		<form
			class="search-bar"
			role="search"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<div class="search-bar__field">
				<label class="search-bar__label" for={FIELD_ID}>
					{t('search.place_label')}
				</label>
				<input
					ref={fieldRef}
					id={FIELD_ID}
					class="search-bar__input"
					type="text"
					name="q"
					autocomplete="off"
					spellcheck={false}
					value={text}
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? FIELD_MESSAGE_ID : undefined}
					onInput={(event) => onText(event.currentTarget.value)}
				/>
				{error ? (
					<div key={error.id} class="field-message">
						<p id={FIELD_MESSAGE_ID} class="field-message__text" role="alert">
							{t(ERROR_KEYS[error.code])}
						</p>
						{error.suggestions.length > 0 ? (
							<ul class="field-message__suggestions">
								{error.suggestions.map((name) => (
									<li key={name}>
										<a class="field-message__suggestion" href={searchFragment(name, radius, lang)}>
											{t('error.did_you_mean', { name })}
										</a>
									</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</div>

			<div class="search-bar__radius">
				<label class="search-bar__label" for={RADIUS_ID}>
					{t('search.radius_label')}
				</label>
				<select
					id={RADIUS_ID}
					class="search-bar__select"
					name="r"
					value={String(radius)}
					onChange={(event) => onRadius(snapRadius(event.currentTarget.value))}
				>
					{RADII.map((km) => (
						<option key={km} value={String(km)}>
							{t('search.radius_option', { km })}
						</option>
					))}
				</select>
			</div>

			<button class="button-primary search-bar__submit" type="submit">
				{t('search.submit')}
			</button>
		</form>
	);
}
