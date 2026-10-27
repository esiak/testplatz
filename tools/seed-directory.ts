/**
 * Seeds data/directory/centres.json from the rtpartner.de table of Bavarian test centres.
 *
 *   node tools/seed-directory.ts [--source <url>] [--force]
 *
 * Writes only data/directory/ (centres.json and the source section of review-note.md).
 * Phone numbers and e-mail addresses in the table are never read.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';
import { createFetchClient, type FetchImpl } from '../pipeline/fetch/index.ts';
import { directorySchema, serializeDirectory, slugify, type Centre } from '../shared/directory.ts';

export const LIVE_SOURCE_URL = 'https://www.rtpartner.de/immigration/einbuergerungstest-pruefstellen-bayern/';

export const DIRECTORY_DIR = fileURLToPath(new URL('../data/directory/', import.meta.url));
export const CENTRES_PATH = join(DIRECTORY_DIR, 'centres.json');

export interface SourceRow {
	name: string;
	street: string;
	postcode: string;
	city: string;
	website: string | null;
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** "Street Nr, PLZ City" → parts; the postcode is the last 5-digit group after a comma. */
export function parseAddress(text: string): { street: string; postcode: string; city: string } | null {
	const match = clean(text).match(/^(.+?),\s*(\d{5})\s+(.+)$/);
	if (!match) return null;
	return { street: match[1]!.trim(), postcode: match[2]!, city: match[3]!.trim() };
}

/** An http(s) URL normalised by WHATWG URL parsing, or null. */
export function normaliseWebsite(href: string | undefined): string | null {
	const value = href?.trim();
	if (!value || !URL.canParse(value)) return null;
	const url = new URL(value);
	return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

/**
 * Rows of the rtpartner `#myTable` (Einrichtung | Adresse | Telefon | E-Mail | Webseite).
 * Throws when the page has no table, a row has no parsable address, or the table is empty.
 */
export function parseRtpartnerTable(html: string): SourceRow[] {
	const $ = load(html);
	const table = $('#myTable');
	if (table.length === 0) throw new Error('source page has no #myTable');
	const rows: SourceRow[] = [];
	table.find('tbody tr').each((index, tr) => {
		const cells = $(tr).children('td');
		if (cells.length < 5) throw new Error(`row ${index + 1}: expected 5 cells, found ${cells.length}`);
		const name = clean(cells.eq(0).text());
		const address = parseAddress(cells.eq(1).text());
		if (!name) throw new Error(`row ${index + 1}: empty name`);
		if (!address) throw new Error(`row ${index + 1} (${name}): cannot parse address "${clean(cells.eq(1).text())}"`);
		rows.push({ name, ...address, website: normaliseWebsite(cells.eq(4).find('a').attr('href')) });
	});
	if (rows.length === 0) throw new Error('source table has no rows');
	return rows;
}

/** The "Informationen automatisch aktualisiert: DD.MM.YYYY - HH:MM" stamp on the page, if any. */
export function parseSourceDate(html: string): string | null {
	const match = load(html).text().match(/aktualisiert:\s*(\d{2})\.(\d{2})\.(\d{4})(?:\s*-\s*(\d{2}:\d{2}))?/);
	if (!match) return null;
	return `${match[3]}-${match[2]}-${match[1]}${match[4] ? ` ${match[4]}` : ''}`;
}

/** One entry per row; ids from the name, collisions get `-<city>`, then `-2`, `-3`, … */
export function buildEntries(rows: readonly SourceRow[]): Centre[] {
	const used = new Set<string>();
	const entries = rows.map((row): Centre => {
		const base = slugify(row.name);
		let id = base;
		if (used.has(id)) id = `${base}-${slugify(row.city)}`;
		for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
		used.add(id);
		return {
			centre_id: id,
			name: row.name,
			address: { street: row.street, postcode: row.postcode, city: row.city },
			lat: null,
			lon: null,
			website: row.website,
			test_page_url: null,
			reader: 'none',
			reader_config: null,
			opted_out: false,
			source: 'rtpartner',
			verified_at: null,
		};
	});
	return directorySchema.parse(entries);
}

export function sourceSection(sourceUrl: string, sourceDate: string | null, seededAt: string, count: number): string {
	return [
		'## Source',
		'',
		`- Source URL: ${sourceUrl}`,
		`- Source date: ${sourceDate ?? 'not stated on the page'}`,
		`- Seeded at: ${seededAt}`,
		`- Rows seeded: ${count}`,
		'',
	].join('\n');
}

function hasEntries(path: string): boolean {
	if (!existsSync(path)) return false;
	try {
		const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
		return !Array.isArray(data) || data.length > 0;
	} catch {
		return true;
	}
}

export interface SeedOptions {
	sourceUrl: string;
	force: boolean;
	/** Directory to write centres.json and review-note.md into. */
	dir?: string;
	fetchImpl?: FetchImpl;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

/** Seeds the directory; returns the exit code. Writes nothing unless the whole table parsed. */
export async function runSeed(options: SeedOptions): Promise<number> {
	const { sourceUrl, force, dir = DIRECTORY_DIR, log = console.log, error = console.error } = options;
	const centresPath = join(dir, 'centres.json');
	if (!force && hasEntries(centresPath)) {
		error(`${centresPath} already has entries; pass --force to overwrite`);
		return 1;
	}

	const seededAt = new Date().toISOString();
	const result = await createFetchClient({ fetchImpl: options.fetchImpl }).get(sourceUrl);
	if (!result.ok) {
		error(`could not fetch ${result.url}: ${result.reason}${result.status ? ` ${result.status}` : ''}`);
		return 1;
	}

	let entries: Centre[];
	try {
		entries = buildEntries(parseRtpartnerTable(result.text));
	} catch (caught) {
		error(`could not read the source table: ${(caught as Error).message}`);
		return 1;
	}

	mkdirSync(dir, { recursive: true });
	writeFileSync(centresPath, serializeDirectory(entries));
	writeFileSync(
		join(dir, 'review-note.md'),
		`# Directory review note\n\n${sourceSection(sourceUrl, parseSourceDate(result.text), seededAt, entries.length)}\n## Verification run\n\nNot run yet: run \`npm run verify:directory\`.\n`,
	);
	log(`${entries.length} centres seeded from ${sourceUrl}`);
	return 0;
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const sourceIndex = argv.indexOf('--source');
	const sourceUrl = sourceIndex >= 0 ? argv[sourceIndex + 1] : LIVE_SOURCE_URL;
	if (!sourceUrl) {
		console.error('--source needs a URL');
		process.exitCode = 1;
	} else {
		process.exitCode = await runSeed({ sourceUrl, force: argv.includes('--force') });
	}
}
