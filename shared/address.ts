import type { Address } from './directory.ts';

/**
 * Free-text address helpers for locating test dates (FR36). `normaliseAddress` is the only key
 * function for comparing addresses and for the venue cache (`data/state/venues.json`).
 */

/**
 * The comparison key of an address: NFC, lowercase, `straße` / `strasse` / `str.` as one form
 * (`str`), whitespace collapsed and `, ` around every comma. Two addresses that differ only in
 * these ways get the same key.
 */
export function normaliseAddress(text: string): string {
	return text
		.normalize('NFC')
		.toLowerCase()
		.replace(/stra(?:ß|ss)e/g, 'str')
		.replace(/str\./g, 'str ')
		.replace(/\s+/g, ' ')
		.replace(/ ?, ?/g, ', ')
		.trim();
}

const POSTCODE_CITY = /^(\d{5}) (.+)$/;

/**
 * The parts of a `street, NNNNN city` address (exactly one comma, after collapsing whitespace),
 * or null when the text has another shape (no postcode, a room before the street, …).
 */
export function parseAddress(text: string): Address | null {
	const parts = text.replace(/\s+/g, ' ').trim().split(',');
	if (parts.length !== 2) return null;
	const street = parts[0]!.trim();
	const match = POSTCODE_CITY.exec(parts[1]!.trim());
	if (street === '' || match === null) return null;
	return { street, postcode: match[1]!, city: match[2]!.trim() };
}
