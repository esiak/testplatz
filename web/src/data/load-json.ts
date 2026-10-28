import type { z } from 'zod';

/** A published file carries a `schemaVersion` other than the one the app embeds. */
export class SchemaVersionError extends Error {
	constructor(
		readonly file: string,
		readonly found: unknown,
		readonly expected: number,
	) {
		super(`${file}: invalid schemaVersion ${String(found)} (expected ${expected})`);
		this.name = 'SchemaVersionError';
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fetches `url` and validates it with `schema`. Throws on a network error, a non-2xx response,
 * invalid JSON or a schema mismatch; a `schemaVersion` other than `expectedVersion` throws a
 * `SchemaVersionError`, every other failure a plain `Error`.
 */
export async function loadJson<T>(url: string, file: string, schema: z.ZodType<T>, expectedVersion: number, fetchImpl: typeof fetch): Promise<T> {
	const response = await fetchImpl(url);
	if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
	const json: unknown = await response.json();
	if (isRecord(json) && 'schemaVersion' in json && json.schemaVersion !== expectedVersion) {
		throw new SchemaVersionError(file, json.schemaVersion, expectedVersion);
	}
	const parsed = schema.safeParse(json);
	if (!parsed.success) throw new Error(`${file}: invalid (${parsed.error.issues.length} issues)`);
	return parsed.data;
}
