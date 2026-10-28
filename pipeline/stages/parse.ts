/**
 * Parse stage: runs one reader for one centre (AD-4). Never throws: a reader that throws becomes
 * `failed('reader-error')`, and output that fails the contract becomes `failed('schema')`, so one
 * centre's bad output never affects another.
 */
import type { Centre } from '../../shared/directory.ts';
import { checkParseResult, type FetchedPage, type ParseContext, type ParseResult, type Reader } from '../../shared/reader.ts';

export function parseCentre(reader: Reader, centre: Centre, pages: readonly FetchedPage[], ctx: ParseContext): ParseResult {
	let result: unknown;
	try {
		result = reader.parse(pages, centre, ctx);
	} catch {
		return { kind: 'failed', reason: 'reader-error' };
	}
	return checkParseResult(result);
}
