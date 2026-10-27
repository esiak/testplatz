/** Body decoding: Content-Type charset, else an HTML meta charset in the first 1024 bytes, else UTF-8. */

const CHARSET_PARAM = /charset\s*=\s*["']?([\w.:-]+)/i;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i;

/** The charset label in a Content-Type header value, or null. */
export const charsetFromContentType = (contentType: string | null): string | null =>
	contentType?.match(CHARSET_PARAM)?.[1] ?? null;

/** A charset declared by `<meta charset>` or `<meta http-equiv content="…charset=…">` in the first 1024 bytes. */
export function charsetFromMeta(bytes: Uint8Array): string | null {
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
	return head.match(META_CHARSET)?.[1] ?? null;
}

function decoderFor(label: string | null): TextDecoder | null {
	if (label === null) return null;
	try {
		return new TextDecoder(label);
	} catch {
		return null;
	}
}

export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
	const decoder =
		decoderFor(charsetFromContentType(contentType)) ?? decoderFor(charsetFromMeta(bytes)) ?? new TextDecoder('utf-8');
	return decoder.decode(bytes);
}
