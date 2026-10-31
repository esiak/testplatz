import { Fragment, type ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useI18n, type I18nValue } from '../i18n/i18n.tsx';
import { mapsUrl } from './search.ts';

/**
 * Shared parts of the variant B "date tile" cards (DESIGN.md Components, mockups/card-b-states.html):
 * glyphs, the tile, the address line with its map pin, the meta line and the icon toggletips.
 */

/** Stroke paths of each glyph, from the mockup's `<symbol>`s (24 × 24 viewBox). */
const GLYPHS = {
	free: <path d="M5 12.5l4.5 4.5L19 7.5" />,
	booked: (
		<>
			<circle cx="12" cy="12" r="8" />
			<path d="M6.5 17.5l11-11" />
		</>
	),
	waitlist: (
		<>
			<circle cx="12" cy="12" r="8" />
			<path d="M12 7.5V12l3 2" />
		</>
	),
	unknown: (
		<>
			<path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.1-1.5 2.1v.4" />
			<path d="M12 17.6v.1" />
		</>
	),
	online: (
		<>
			<rect x="3.5" y="4.5" width="17" height="11" rx="1.5" />
			<path d="M8.5 19.5h7M12 15.5v4" />
		</>
	),
	email: (
		<>
			<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
			<path d="M4 7l8 6 8-6" />
		</>
	),
	post: (
		<>
			<path d="M4 20V10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10z" />
			<path d="M8 6a4 4 0 0 1 4 4v10M14 3h3v3" />
		</>
	),
	in_person: (
		<>
			<circle cx="12" cy="8" r="3.5" />
			<path d="M5 20a7 7 0 0 1 14 0" />
		</>
	),
	registration_unknown: (
		<>
			<rect x="5" y="3.5" width="14" height="17" rx="1.5" />
			<path d="M10 9.5a2 2 0 1 1 2.8 1.8c-.6.3-.8.7-.8 1.3M12 15.6v.1" />
		</>
	),
	eligibility_unknown: (
		<>
			<circle cx="9" cy="8" r="3.2" />
			<path d="M3 19.5a6 6 0 0 1 12 0" />
			<path d="M16.5 8.3a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1M18.5 13.6v.1" />
		</>
	),
	pin: (
		<>
			<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
			<circle cx="12" cy="10" r="2.3" />
		</>
	),
	house: (
		<>
			<path d="M4 11l8-6.5 8 6.5" />
			<path d="M6.5 9.5v10h11v-10" />
		</>
	),
	calendar: (
		<>
			<rect x="4" y="5.5" width="16" height="14" rx="1.5" />
			<path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M9.5 14.5l5 0" />
		</>
	),
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** A decorative stroke icon; `data-icon` names its shape. */
export function Glyph({ name }: { name: GlyphName }) {
	return (
		<svg class="glyph" data-icon={name} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
			{GLYPHS[name]}
		</svg>
	);
}

/** Month, day and weekday of a date; all `aria-hidden`, the card link's name says the date. */
export function DateTile({ month, day, weekday }: { month: string; day: string; weekday: string }) {
	return (
		<span class="date-tile" aria-hidden="true">
			<span class="date-tile__label">{month}</span>
			<span class="date-tile__day">{day}</span>
			<span class="date-tile__label">{weekday}</span>
		</span>
	);
}

/** A tile with an icon instead of a date: a calendar (no dates) or a question mark on the unknown tint (not checked). */
export function IconTile({ name, unknown = false }: { name: GlyphName; unknown?: boolean }) {
	return (
		<span class={unknown ? 'date-tile date-tile--icon date-tile--unknown' : 'date-tile date-tile--icon'} aria-hidden="true">
			<Glyph name={name} />
		</span>
	);
}

/** The card's heading: the stretched link wrapping the tile, or, without a URL, the tile and a hidden name. */
export function CardHeading({
	href,
	label,
	hiddenName,
	children,
}: {
	href: string | null;
	label: string;
	hiddenName?: string;
	children: ComponentChildren;
}) {
	return (
		<h3 class="card__heading">
			{href ? (
				<a class="card__link" href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
					{children}
				</a>
			) : (
				<>
					{children}
					{hiddenName !== undefined ? (
						<span class="visually-hidden" lang="de">
							{hiddenName}
						</span>
					) : null}
				</>
			)}
		</h3>
	);
}

/** The test address, selectable, then an icon-only map-pin link to Google Maps; above the link layer. */
export function AddressLine({ address }: { address: string }) {
	const { t } = useI18n();
	return (
		<p class="card__address">
			<span class="card__address-text">{address}</span>
			<a class="card__map" href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" aria-label={t('card.map_label', { address })}>
				<Glyph name="pin" />
			</a>
			{/* "New" badge slot (Story 3.1): here, after the map pin. */}
		</p>
	);
}

/** "14 km" or "distance unknown". */
export function distanceText(distanceKm: number | null, t: I18nValue['t']): string {
	return distanceKm === null ? t('card.distance_unknown') : t('card.distance', { km: Math.round(distanceKm) });
}

export interface MetaPart {
	text: string;
	/** In the unknown (amber) colour: "Deadline passed", "Not checked …". */
	warn?: boolean;
	/** Short values that must not break inside ("10:00", "14 km"). */
	nowrap?: boolean;
}

/**
 * One meta line; the "·" separators come from CSS, so they are neither text nodes nor spoken.
 * A `<wbr>` after each separator lets the line wrap between parts instead of inside a word.
 */
export function MetaLine({ parts }: { parts: MetaPart[] }) {
	return (
		<p class="card__meta">
			{parts.map((part, i) => (
				<Fragment key={i}>
					{i > 0 ? <wbr /> : null}
					<span
						class={['card__meta-part', part.warn ? 'card__meta-part--warn' : '', part.nowrap ? 'card__meta-part--nowrap' : '']
							.filter(Boolean)
							.join(' ')}
					>
						{part.text}
					</span>
				</Fragment>
			))}
		</p>
	);
}

/** Closes the one open icon label on the page, if any. */
let closeOpen: (() => void) | null = null;

export type IconTint = 'free' | 'booked' | 'unknown' | 'info';

/**
 * A card icon as a toggletip: a button whose `aria-label` is its words, with a visible label above
 * it on hover, keyboard focus or while expanded. Click, Enter or Space toggles it; Escape, a
 * pointerdown elsewhere, or opening another icon closes it. While open, a polite live span holds
 * its words. It sits above the card's link layer, so it never opens the card. Escape on the
 * button also hides a label shown by hover or focus (`data-dismissed`) until blur, pointer leave
 * or the next open (WCAG 1.4.13).
 */
export function CardIcon({ glyph, tint, label, spoken = label }: { glyph: GlyphName; tint: IconTint; label: string; spoken?: string }) {
	const [open, setOpen] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const wrapper = useRef<HTMLSpanElement>(null);
	const close = useCallback(() => setOpen(false), []);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		const onPointer = (event: Event) => {
			if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('pointerdown', onPointer);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('pointerdown', onPointer);
			if (closeOpen === close) closeOpen = null;
		};
	}, [open, close]);

	const toggle = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		if (open) {
			setOpen(false);
			return;
		}
		if (closeOpen && closeOpen !== close) closeOpen();
		closeOpen = close;
		setDismissed(false);
		setOpen(true);
	};

	return (
		<span class="card-icon" ref={wrapper} onPointerLeave={() => setDismissed(false)} onMouseLeave={() => setDismissed(false)}>
			<button
				type="button"
				class={`card-icon__button card-icon__button--${tint}`}
				aria-label={spoken}
				aria-expanded={open}
				data-dismissed={dismissed ? '' : undefined}
				onClick={toggle}
				onKeyDown={(event) => {
					if (event.key === 'Escape') setDismissed(true);
				}}
				onBlur={() => setDismissed(false)}
			>
				<span class="card-icon__circle">
					<Glyph name={glyph} />
				</span>
			</button>
			<span class="card-icon__label" aria-hidden="true">
				{label}
			</span>
			<span class="visually-hidden" aria-live="polite">
				{open ? spoken : ''}
			</span>
		</span>
	);
}
