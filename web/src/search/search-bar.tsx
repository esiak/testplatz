import type { RefObject } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PlaceRow } from '../../../shared/places.ts';
import { useI18n } from '../i18n/i18n.tsx';
import { RADII, searchFragment, snapRadius, suggestPlaces, type FieldErrorCode, type PlaceSuggestion, type Radius, type Sort } from './search.ts';

export const FIELD_ID = 'search-place';
export const FIELD_LABEL_ID = 'search-place-label';
export const FIELD_MESSAGE_ID = 'search-place-message';
export const LISTBOX_ID = 'search-place-suggestions';
const RADIUS_ID = 'search-radius';

const optionId = (index: number): string => `${LISTBOX_ID}-${index}`;

export interface FieldError {
	code: FieldErrorCode;
	suggestions: string[];
	/** Changes with every search, so the same message twice is announced again. */
	id: number;
}

export interface SearchBarProps {
	text: string;
	radius: Radius;
	/** The current sort, carried by the "Did you mean …?" links. */
	sort: Sort;
	error: FieldError | null;
	fieldRef: RefObject<HTMLInputElement | null>;
	/** The place rows once the data is ready; null before. No suggestions until then. */
	places: readonly PlaceRow[] | null;
	/** True while the suggestions list is dismissed (Escape, pick, submit, blur, a fill). */
	dismissed: boolean;
	/** Bumped when the page reopens the list (a several-places outcome), so it is announced again. */
	openId: number;
	onText: (text: string) => void;
	onRadius: (radius: Radius) => void;
	onSubmit: () => void;
	/** Closes the list. */
	onDismiss: () => void;
	/** Reopens a dismissed list (↓ on a closed list). */
	onReopen: () => void;
	/** A suggestion was picked: search for its pick text. */
	onPick: (text: string) => void;
	/** The list opened or its rows changed. */
	onSuggestions: (count: number) => void;
}

const ERROR_KEYS = {
	place_not_found: 'error.place_not_found',
	outside_bavaria: 'error.outside_bavaria',
	several_places: 'error.several_places',
} as const;

/** The highlighted row, tied to the rows it was set for so a change of rows clears it. */
type Highlight = { token: string; index: number } | null;

function SuggestionMeta({ meta }: { meta: PlaceSuggestion['meta'] }) {
	const { t } = useI18n();
	if (!meta) return null;
	return (
		<span class="place-suggestions__meta">
			{meta.district === null ? meta.postcode : t('search.suggestion_meta', { postcode: meta.postcode, district: meta.district })}
		</span>
	);
}

/**
 * Place field (an ARIA 1.2 combobox with up to 6 place suggestions), native radius select and
 * the search button. Changing the select alone never searches.
 */
export function SearchBar(props: SearchBarProps) {
	const { text, radius, sort, error, fieldRef, places, dismissed, openId, onText, onRadius, onSubmit, onDismiss, onReopen, onPick, onSuggestions } =
		props;
	const { lang, t } = useI18n();
	const [focused, setFocused] = useState(false);
	const [highlight, setHighlight] = useState<Highlight>(null);

	const suggestions = useMemo(() => (places ? suggestPlaces(text, places) : []), [text, places]);
	const rowsKey = suggestions.map((s) => s.pickText).join('\n');
	const token = `${openId}\n${rowsKey}`;
	const open = focused && places !== null && suggestions.length > 0 && !dismissed;
	const active = open && highlight !== null && highlight.token === token ? highlight.index : null;

	// Announce the count whenever the list opens or its rows change; closing announces nothing.
	useEffect(() => {
		if (!open) {
			setHighlight(null);
			return;
		}
		onSuggestions(suggestions.length);
		// `token` covers the rows and a reopen by the page.
	}, [open, token]);

	const pick = (suggestion: PlaceSuggestion) => onPick(suggestion.pickText);

	const onKeyDown = (event: KeyboardEvent) => {
		const count = suggestions.length;
		switch (event.key) {
			case 'ArrowDown':
				if (open) {
					event.preventDefault();
					setHighlight({ token, index: active === null ? 0 : (active + 1) % count });
				} else if (focused && places !== null && count > 0) {
					event.preventDefault();
					setHighlight({ token, index: 0 });
					onReopen();
				}
				return;
			case 'ArrowUp':
				if (open) {
					event.preventDefault();
					setHighlight({ token, index: active === null || active === 0 ? count - 1 : active - 1 });
				}
				return;
			case 'Escape':
				if (open) {
					event.preventDefault();
					onDismiss();
				}
				return;
			case 'Enter':
				if (open && active !== null) {
					event.preventDefault();
					pick(suggestions[active]!);
				}
				return;
		}
	};

	const listbox = (
		<ul
			id={LISTBOX_ID}
			class="place-suggestions"
			role="listbox"
			aria-labelledby={FIELD_LABEL_ID}
			hidden={!open}
			// Keeps focus in the field for any press on the list, so a pick does not blur (and close) first.
			onPointerDown={(event) => event.preventDefault()}
			onMouseDown={(event) => event.preventDefault()}
		>
			{open
				? suggestions.map((suggestion, index) => (
						<li
							key={suggestion.pickText}
							id={optionId(index)}
							class="place-suggestions__option"
							role="option"
							aria-selected={index === active ? 'true' : 'false'}
							onClick={() => pick(suggestion)}
						>
							<span class="place-suggestions__name">{suggestion.place.name}</span>
							<SuggestionMeta meta={suggestion.meta} />
						</li>
					))
				: null}
		</ul>
	);

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
				<label id={FIELD_LABEL_ID} class="search-bar__label" for={FIELD_ID}>
					{t('search.place_label')}
				</label>
				<div class="search-bar__combobox">
					<input
						ref={fieldRef}
						id={FIELD_ID}
						class="search-bar__input"
						type="text"
						name="q"
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={open ? 'true' : 'false'}
						aria-controls={LISTBOX_ID}
						aria-activedescendant={active !== null ? optionId(active) : undefined}
						autocomplete="off"
						spellcheck={false}
						value={text}
						aria-invalid={error && error.code !== 'several_places' ? 'true' : undefined}
						aria-describedby={error ? FIELD_MESSAGE_ID : undefined}
						onInput={(event) => onText(event.currentTarget.value)}
						onKeyDown={onKeyDown}
						onFocus={() => setFocused(true)}
						onBlur={() => {
							setFocused(false);
							onDismiss();
						}}
					/>
					{/* With a field message, the list sits under it so the message stays visible. */}
					{error ? null : listbox}
				</div>
				{error ? (
					<div key={error.id} class="field-message">
						<p id={FIELD_MESSAGE_ID} class="field-message__text" role="alert">
							{t(ERROR_KEYS[error.code])}
						</p>
						{error.suggestions.length > 0 ? (
							<ul class="field-message__suggestions">
								{error.suggestions.map((name) => (
									<li key={name}>
										<a class="field-message__suggestion" href={searchFragment(name, radius, sort, lang)}>
											{t('error.did_you_mean', { name })}
										</a>
									</li>
								))}
							</ul>
						) : null}
						{listbox}
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
