/**
 * The URL fragment holds the shareable page state (`#q=<town>&r=<km>&lang=<lang>`).
 * The query string is never used.
 */

export function parseFragment(hash: string): URLSearchParams {
	return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
}

/** Serialises params to a fragment with a leading `#`, or `''` when there are none. */
export function serialiseFragment(params: URLSearchParams): string {
	const text = params.toString();
	return text ? `#${text}` : '';
}

/** Replaces only the `lang` parameter, keeping every other parameter and its order. */
export function withLang(hash: string, lang: string): string {
	const params = parseFragment(hash);
	params.set('lang', lang);
	return serialiseFragment(params);
}
