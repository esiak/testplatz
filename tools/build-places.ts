/**
 * Builds data/public/places.json, the offline place table (AD-9), from OpenStreetMap via Overpass.
 *
 *   node tools/build-places.ts [--refresh | --cached-only]
 *
 * Manual, serial and cached (AD-5): one `index` query (municipality keys and district names), one
 * `ags-<prefix>` query per 3-digit key prefix (municipalities with their place nodes and the
 * postcode areas those nodes lie in, linked server-side) and one `bavaria` query (the state
 * boundary). Each successful raw response is cached in data/places/cache/, so a rerun sends no
 * requests and writes a byte-identical file; `--refresh` ignores the cache. `--cached-only` sends
 * nothing and builds a partial file (`complete: false`, `missing` lists the queries left out) from
 * whatever is cached; it needs the `index` and at least one `ags-*` file. The operator reviews
 * data/places/places-note.md and commits.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createFetchClient, nativeFetch, type FetchImpl } from '../pipeline/fetch/index.ts';
import {
	OVERPASS_DELAY_MS,
	OVERPASS_INTERPRETER_URL,
	OVERPASS_ROBOTS_EXEMPT,
	OVERPASS_TIMEOUT_MS,
	USER_AGENT,
} from '../pipeline/config.ts';
import {
	isInBoundary,
	normalizePlaceName,
	placesSchema,
	PLACES_SCHEMA_VERSION,
	STATE_CODES,
	stateForKey,
	type PlaceRow,
	type Places,
	type StatePrefix,
} from '../shared/places.ts';
import { PLACES_DIR, PLACES_FILE, PLACES_NOTE_FILE, PUBLIC_DIR } from './paths.ts';

export const ATTRIBUTION = 'Place data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)';

/** Place classes whose nodes count as inhabited places, highest class first. */
export const PLACE_CLASSES = [
	'city',
	'town',
	'village',
	'borough',
	'suburb',
	'quarter',
	'neighbourhood',
	'hamlet',
	'isolated_dwelling',
	'locality',
] as const;

/** Douglas–Peucker tolerance for the Bavaria boundary, in degrees. */
export const SIMPLIFY_TOLERANCE = 0.002;

/** Waits before the 1st, 2nd and 3rd retry of a query the server was too busy for. */
export const RETRY_DELAYS_MS = [60_000, 120_000, 240_000] as const;

/** HTTP statuses that mean "busy, try again later". */
export const RETRY_STATUSES = [429, 502, 503, 504] as const;

/** Gzipped size above which the note flags places.json (AD-9: ~300 KB). */
export const GZIP_FLAG_BYTES = 307_200;

const MUNICIPALITY_AGS = /^(0[1-9]|1[0-6])\d{6}$/;
const DISTRICT_AGS = /^\d{5}$/;
const AGS_TAG = 'de:amtlicher_gemeindeschluessel';
const PLACE_REGEX = `^(${PLACE_CLASSES.join('|')})$`;

// ---------------------------------------------------------------------------------------------
// Queries

const HEADER = '[out:json][timeout:900];';

/** Every municipality relation (levels 4/6/8, 8-digit AGS of a German state) and every district. */
export const indexQuery = (): string =>
	[
		HEADER,
		'(',
		`  rel[boundary=administrative][admin_level~"^(4|6|8)$"]["${AGS_TAG}"~"^(0[1-9]|1[0-6])[0-9]{6}$"];`,
		`  rel[boundary=administrative][admin_level=6]["${AGS_TAG}"~"^[0-9]{5}$"];`,
		');',
		'out tags;',
	].join('\n');

/**
 * The municipalities whose AGS starts with `prefix`, then one group per municipality: a tagless
 * relation marker, the place nodes inside it, and the postcode areas those nodes lie in.
 */
export const prefixQuery = (prefix: string): string => {
	if (!/^\d{3}$/.test(prefix)) throw new Error(`invalid AGS prefix: ${prefix}`);
	return [
		HEADER,
		`rel[boundary=administrative][admin_level~"^(4|6|8)$"]["${AGS_TAG}"~"^${prefix}[0-9]{5}$"]->.munis;`,
		'.munis out body center qt;',
		'foreach.munis->.m(',
		'  .m out ids;',
		'  .m map_to_area->.a;',
		`  node(area.a)[place~"${PLACE_REGEX}"]->.p;`,
		'  .p out qt;',
		'  .p is_in->.in;',
		'  area.in[boundary=postal_code];',
		'  out tags;',
		');',
	].join('\n');
};

/** The Bavaria state relation with the geometry of every member. */
export const bavariaQuery = (): string =>
	[HEADER, 'rel[boundary=administrative][admin_level=4]["ISO3166-2"="DE-BY"];', 'out geom;'].join('\n');

/** The GET URL that sends one query to the Overpass interpreter. */
export const queryUrl = (ql: string): string => `${OVERPASS_INTERPRETER_URL}?data=${encodeURIComponent(ql)}`;

// ---------------------------------------------------------------------------------------------
// Responses

export interface OverpassMember {
	type: string;
	ref: number;
	role: string;
	geometry?: { lat: number; lon: number }[];
}

export interface OverpassElement {
	type: string;
	id: number;
	tags?: Record<string, string>;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	members?: OverpassMember[];
}

export interface OverpassResponse {
	/** `osm3s.timestamp_osm_base`. */
	timestamp: string;
	elements: OverpassElement[];
}

/**
 * Parses a raw Overpass JSON response. Returns an error message when it is not JSON, has no
 * `elements` array or OSM timestamp, or carries a runtime error remark (a server-side timeout or
 * out-of-memory answer arrives as HTTP 200 with partial data).
 */
export function parseOverpass(text: string): { ok: true; response: OverpassResponse } | { ok: false; message: string } {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (caught) {
		return { ok: false, message: `not valid JSON: ${(caught as Error).message}` };
	}
	if (data === null || typeof data !== 'object' || Array.isArray(data)) return { ok: false, message: 'not a JSON object' };
	const record = data as Record<string, unknown>;
	const remark = record['remark'];
	if (typeof remark === 'string' && /error/i.test(remark)) return { ok: false, message: `server remark: ${remark}` };
	const elements = record['elements'];
	if (!Array.isArray(elements)) return { ok: false, message: 'no elements array' };
	const osm3s = record['osm3s'];
	const timestamp =
		osm3s !== null && typeof osm3s === 'object' ? (osm3s as Record<string, unknown>)['timestamp_osm_base'] : undefined;
	if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) return { ok: false, message: 'no OSM timestamp' };
	return { ok: true, response: { timestamp, elements: elements as OverpassElement[] } };
}

const isAdmin = (el: OverpassElement): boolean => el.type === 'relation' && el.tags?.['boundary'] === 'administrative';

const isMunicipality = (el: OverpassElement): boolean =>
	isAdmin(el) && ['4', '6', '8'].includes(el.tags?.['admin_level'] ?? '') && MUNICIPALITY_AGS.test(el.tags?.[AGS_TAG] ?? '');

const isDistrict = (el: OverpassElement): boolean =>
	isAdmin(el) && el.tags?.['admin_level'] === '6' && DISTRICT_AGS.test(el.tags?.[AGS_TAG] ?? '');

export interface ParsedIndex {
	/** Distinct first 3 AGS digits of the municipalities, ascending. */
	prefixes: string[];
	/** District name by 5-digit AGS (lower relation id wins). */
	districts: Map<string, string>;
}

export function parseIndex(response: OverpassResponse): ParsedIndex {
	const prefixes = new Set<string>();
	const districts = new Map<string, { id: number; name: string }>();
	for (const el of response.elements) {
		if (isMunicipality(el)) prefixes.add(el.tags![AGS_TAG]!.slice(0, 3));
		if (isDistrict(el)) {
			const name = el.tags!['name']?.trim();
			const ags = el.tags![AGS_TAG]!;
			const existing = districts.get(ags);
			if (name && (existing === undefined || el.id < existing.id)) districts.set(ags, { id: el.id, name });
		}
	}
	return {
		prefixes: [...prefixes].sort(),
		districts: new Map([...districts].map(([ags, d]) => [ags, d.name])),
	};
}

export interface PlaceNode {
	id: number;
	name: string | null;
	place: string;
	lat: number;
	lon: number;
}

export interface MunicipalityInput {
	id: number;
	ags: string;
	name: string | null;
	adminCentre: number | null;
	label: number | null;
	center: { lat: number; lon: number } | null;
	/** Place nodes inside the municipality. */
	places: PlaceNode[];
	/** 5-digit postcodes of the postal-code areas containing those nodes, sorted and unique. */
	postcodes: string[];
}

const memberNode = (el: OverpassElement, role: string): number | null =>
	el.members?.find((m) => m.type === 'node' && m.role === role)?.ref ?? null;

/** The 5-digit postcode of a postal-code area (`postal_code:DE`, else `postal_code`), or null. */
export function areaPostcode(tags: Record<string, string> | undefined): string | null {
	const values = [tags?.['postal_code:DE'], tags?.['postal_code']].map((v) => (v ?? '').trim());
	return values.find((v) => /^\d{5}$/.test(v)) ?? null;
}

/**
 * Splits an `ags-*` response into municipalities: the header block (tagged municipality
 * relations), then per municipality a tagless relation marker followed by its place nodes and
 * postcode areas.
 */
export function parsePrefixResponse(response: OverpassResponse): MunicipalityInput[] {
	const byId = new Map<number, MunicipalityInput>();
	const order: MunicipalityInput[] = [];
	const postcodeSets = new Map<number, Set<string>>();
	let current: MunicipalityInput | null = null;
	for (const el of response.elements) {
		if (el.type === 'relation' && el.tags === undefined) {
			current = byId.get(el.id) ?? null;
			continue;
		}
		if (el.type === 'relation') {
			if (!isMunicipality(el) || byId.has(el.id)) continue;
			const muni: MunicipalityInput = {
				id: el.id,
				ags: el.tags![AGS_TAG]!,
				name: el.tags!['name']?.trim() || null,
				adminCentre: memberNode(el, 'admin_centre'),
				label: memberNode(el, 'label'),
				center: el.center ?? null,
				places: [],
				postcodes: [],
			};
			byId.set(el.id, muni);
			order.push(muni);
			postcodeSets.set(el.id, new Set());
			continue;
		}
		if (current === null) continue;
		if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
			const place = el.tags?.['place'];
			if (place === undefined || !(PLACE_CLASSES as readonly string[]).includes(place)) continue;
			if (current.places.some((p) => p.id === el.id)) continue;
			current.places.push({ id: el.id, name: el.tags?.['name']?.trim() || null, place, lat: el.lat, lon: el.lon });
		} else if (el.type === 'area') {
			const postcode = areaPostcode(el.tags);
			if (postcode !== null) postcodeSets.get(current.id)!.add(postcode);
		}
	}
	for (const muni of order) muni.postcodes = [...postcodeSets.get(muni.id)!].sort();
	return order;
}

// ---------------------------------------------------------------------------------------------
// Boundary geometry

export type Point = [number, number];

const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

/** Joins ways (lists of `[lon, lat]`) end to end into closed rings. Throws if a ring stays open. */
export function stitchRings(ways: readonly Point[][]): Point[][] {
	const remaining = ways.filter((w) => w.length >= 2).map((w) => [...w]);
	const rings: Point[][] = [];
	while (remaining.length > 0) {
		const ring = remaining.shift()!;
		while (!samePoint(ring[0]!, ring.at(-1)!)) {
			const end = ring.at(-1)!;
			const index = remaining.findIndex((w) => samePoint(w[0]!, end) || samePoint(w.at(-1)!, end));
			if (index < 0) throw new Error(`boundary ring does not close (open end at ${end[0]}, ${end[1]})`);
			const [way] = remaining.splice(index, 1);
			const next = samePoint(way![0]!, end) ? way! : [...way!].reverse();
			ring.push(...next.slice(1));
		}
		rings.push(ring);
	}
	return rings;
}

/** Distance from p to the segment a–b, in the units of the coordinates. */
function segmentDistance(p: Point, a: Point, b: Point): number {
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const lengthSq = dx * dx + dy * dy;
	let t = lengthSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
	t = Math.max(0, Math.min(1, t));
	return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on an open polyline (iterative); keeps both ends. */
function simplifyLine(points: readonly Point[], tolerance: number): Point[] {
	if (points.length <= 2) return [...points];
	const keep = new Uint8Array(points.length);
	keep[0] = 1;
	keep[points.length - 1] = 1;
	const stack: [number, number][] = [[0, points.length - 1]];
	while (stack.length > 0) {
		const [first, last] = stack.pop()!;
		let maxDistance = -1;
		let index = -1;
		for (let i = first + 1; i < last; i++) {
			const d = segmentDistance(points[i]!, points[first]!, points[last]!);
			if (d > maxDistance) {
				maxDistance = d;
				index = i;
			}
		}
		if (index >= 0 && maxDistance > tolerance) {
			keep[index] = 1;
			stack.push([first, index], [index, last]);
		}
	}
	return points.filter((_, i) => keep[i] === 1);
}

/**
 * Douglas–Peucker on a closed ring: split at the point farthest from the first one, simplify
 * both halves, rejoin. The result is closed again.
 */
export function simplifyRing(ring: readonly Point[], tolerance: number): Point[] {
	const open = samePoint(ring[0]!, ring.at(-1)!) ? ring.slice(0, -1) : [...ring];
	if (open.length < 3) return [...open, open[0]!];
	let far = 0;
	let farDistance = -1;
	for (let i = 1; i < open.length; i++) {
		const d = Math.hypot(open[i]![0] - open[0]![0], open[i]![1] - open[0]![1]);
		if (d > farDistance) {
			farDistance = d;
			far = i;
		}
	}
	const a = simplifyLine(open.slice(0, far + 1), tolerance);
	const b = simplifyLine([...open.slice(far), open[0]!], tolerance);
	return [...a, ...b.slice(1)];
}

const round4 = (value: number): number => Math.round(value * 1e4) / 1e4;

/**
 * The Bavaria boundary from the `bavaria` response: outer and inner ways stitched into rings,
 * simplified, rounded to 4 decimals. Rings that collapse below 4 points are dropped.
 */
export function bavariaRings(response: OverpassResponse, tolerance = SIMPLIFY_TOLERANCE): Point[][] {
	const relation = response.elements.find(
		(el) => el.type === 'relation' && el.tags?.['ISO3166-2'] === 'DE-BY' && el.tags?.['admin_level'] === '4',
	);
	if (relation === undefined) throw new Error('bavaria response has no DE-BY relation');
	const waysByRole = (role: string): Point[][] =>
		(relation.members ?? [])
			.filter((m) => m.type === 'way' && m.role === role && (m.geometry?.length ?? 0) >= 2)
			.map((m) => m.geometry!.map((g): Point => [g.lon, g.lat]));
	const rings = [...stitchRings(waysByRole('outer')), ...stitchRings(waysByRole('inner'))];
	if (rings.length === 0) throw new Error('bavaria relation has no outer ways with geometry');
	const result: Point[][] = [];
	for (const ring of rings) {
		const rounded: Point[] = [];
		for (const [lon, lat] of simplifyRing(ring, tolerance)) {
			const point: Point = [round4(lon), round4(lat)];
			if (rounded.length === 0 || !samePoint(rounded.at(-1)!, point)) rounded.push(point);
		}
		if (!samePoint(rounded[0]!, rounded.at(-1)!)) rounded.push(rounded[0]!);
		if (rounded.length >= 4) result.push(rounded);
	}
	return result;
}

// ---------------------------------------------------------------------------------------------
// Building the table

export interface ListedMunicipality {
	key: string;
	name: string;
}

export interface DuplicateKey {
	key: string;
	keptId: number;
	droppedIds: number[];
}

export interface BuildInputs {
	index: ParsedIndex;
	municipalities: readonly MunicipalityInput[];
	/** Empty when the `bavaria` query is missing. */
	bavaria: Point[][];
	/** Queries left out of a partial build, sorted; empty for a full build. */
	missing: readonly string[];
	/** `timestamp_osm_base` of every response used. */
	timestamps: readonly string[];
}

export interface BuildResult {
	file: Places;
	/** Dropped: no place node inside and no postcode (unincorporated forests and lakes). */
	uninhabited: ListedMunicipality[];
	/** Dropped: no `name` tag. */
	unnamed: string[];
	duplicates: DuplicateKey[];
	/** Dropped: no node coordinates and no bbox centre. */
	noPoint: ListedMunicipality[];
	/** Bavarian rows whose point lies outside the boundary. */
	outsideBoundary: ListedMunicipality[];
}

const classRank = (place: string): number => (PLACE_CLASSES as readonly string[]).indexOf(place);

/** Coordinates, first match wins: admin_centre node, label node, name-matched place node, bbox centre. */
export function pickPoint(muni: MunicipalityInput): { lat: number; lon: number } | null {
	const byId = (id: number | null): PlaceNode | undefined => (id === null ? undefined : muni.places.find((p) => p.id === id));
	const named = muni.name === null ? null : normalizePlaceName(muni.name);
	const nameMatch =
		named === null
			? undefined
			: muni.places
					.filter((p) => p.name !== null && normalizePlaceName(p.name) === named)
					.sort((a, b) => classRank(a.place) - classRank(b.place) || a.id - b.id)[0];
	const node = byId(muni.adminCentre) ?? byId(muni.label) ?? nameMatch;
	const point = node ?? muni.center;
	return point === null || point === undefined ? null : { lat: round4(point.lat), lon: round4(point.lon) };
}

/** Pure: the places file and what was left out, from parsed responses. */
export function buildPlaces(inputs: BuildInputs): BuildResult {
	const byKey = new Map<string, MunicipalityInput[]>();
	for (const muni of inputs.municipalities) {
		const list = byKey.get(muni.ags) ?? [];
		if (!list.some((m) => m.id === muni.id)) list.push(muni);
		byKey.set(muni.ags, list);
	}
	const uninhabited: ListedMunicipality[] = [];
	const unnamed: string[] = [];
	const duplicates: DuplicateKey[] = [];
	const noPoint: ListedMunicipality[] = [];
	const outsideBoundary: ListedMunicipality[] = [];
	const places: PlaceRow[] = [];
	for (const key of [...byKey.keys()].sort()) {
		const candidates = byKey.get(key)!.sort((a, b) => a.id - b.id);
		const muni = candidates[0]!;
		if (candidates.length > 1) duplicates.push({ key, keptId: muni.id, droppedIds: candidates.slice(1).map((m) => m.id) });
		if (muni.name === null) {
			unnamed.push(key);
			continue;
		}
		if (muni.places.length === 0 && muni.postcodes.length === 0) {
			uninhabited.push({ key, name: muni.name });
			continue;
		}
		const point = pickPoint(muni);
		const state = stateForKey(key);
		if (point === null || state === null) {
			noPoint.push({ key, name: muni.name });
			continue;
		}
		const row: PlaceRow = {
			key,
			name: muni.name,
			postcodes: muni.postcodes,
			district: inputs.index.districts.get(key.slice(0, 5)) ?? muni.name,
			state,
			lat: point.lat,
			lon: point.lon,
		};
		if (state === 'BY' && inputs.bavaria.length > 0 && !isInBoundary(row.lat, row.lon, inputs.bavaria)) outsideBoundary.push({ key, name: row.name });
		places.push(row);
	}
	const oldest = [...inputs.timestamps].sort((a, b) => Date.parse(a) - Date.parse(b))[0];
	const file: Places = {
		schemaVersion: PLACES_SCHEMA_VERSION,
		data_timestamp: oldest === undefined ? '' : new Date(Date.parse(oldest)).toISOString().replace('.000Z', 'Z'),
		attribution: ATTRIBUTION,
		complete: inputs.missing.length === 0,
		missing: [...inputs.missing].sort(),
		bavaria: inputs.bavaria,
		places,
	};
	return { file, uninhabited, unnamed, duplicates, noPoint, outsideBoundary };
}

/** places.json text: minified, trailing newline, no wall-clock timestamp. */
export const serializePlaces = (file: Places): string => `${JSON.stringify(file)}\n`;

// ---------------------------------------------------------------------------------------------
// Note

export interface QueryFailure {
	name: string;
	reason: string;
}

export interface PlacesNoteInput {
	requests: number;
	cacheHits: number;
	queries: number;
	retries: number;
	failures: readonly QueryFailure[];
	/** Queries left out because they were not cached (`--cached-only`). */
	missing: readonly string[];
	allWithUserAgent: boolean;
	allToInterpreter: boolean;
	minGapMs: number | null;
	/** Present when places.json was built. */
	build: { result: BuildResult; rawBytes: number; gzipBytes: number } | null;
}

export function placesNote(input: PlacesNoteInput): string {
	const lines = [
		'# Place table note',
		'',
		'Dataset: OpenStreetMap via the Overpass API (`overpass-api.de/api/interpreter`). Data © OpenStreetMap contributors, ODbL 1.0.',
		'',
		'## Run',
		'',
		`- Queries: ${input.queries}`,
		`- Requests sent: ${input.requests}`,
		`- Retries: ${input.retries}`,
		`- Cache hits: ${input.cacheHits}`,
		`- Failed queries: ${input.failures.length}`,
		`- Every request sent User-Agent \`${USER_AGENT}\`: ${input.requests === 0 ? 'n/a (no requests)' : input.allWithUserAgent ? 'yes' : 'NO'}`,
		`- Every request went to ${OVERPASS_INTERPRETER_URL}: ${input.requests === 0 ? 'n/a (no requests)' : input.allToInterpreter ? 'yes' : 'NO'}`,
		`- Smallest gap between two requests: ${input.minGapMs === null ? 'n/a (fewer than two requests)' : `${input.minGapMs} ms`}`,
		'',
	];
	if (input.missing.length > 0) {
		lines.push(
			`## PARTIAL BUILD: ${input.missing.length} queries not cached and left out (\`--cached-only\`)`,
			'',
			'places.json has `complete: false`. Rows for these key prefixes are absent, and the Bavaria boundary is empty when `bavaria` is listed. Run `npm run build:places` to fetch them.',
			'',
			...input.missing.map((name) => `- ${name}`),
			'',
		);
	}
	if (input.failures.length > 0) {
		lines.push(
			'## Failed queries (nothing cached for them, places.json not written; rerun to retry)',
			'',
			...input.failures.map((f) => `- ${f.name}: ${f.reason}`),
			'',
		);
	}
	if (input.build !== null) {
		const { result, rawBytes, gzipBytes } = input.build;
		const { file } = result;
		// Sorted by AGS prefix: integer-like keys ('10'…'16') would otherwise come first.
		const perState = (Object.keys(STATE_CODES) as StatePrefix[])
			.sort()
			.map((prefix) => STATE_CODES[prefix])
			.map((code) => `${code} ${file.places.filter((r) => r.state === code).length}`);
		const postcodes = new Set(file.places.flatMap((r) => r.postcodes));
		const points = file.bavaria.reduce((sum, ring) => sum + ring.length, 0);
		const list = (entries: readonly string[]): string[] => (entries.length === 0 ? ['None.'] : entries.map((e) => `- ${e}`));
		lines.push(
			'## Output',
			'',
			`- Complete: ${file.complete ? 'yes' : `NO (${file.missing.length} queries missing)`}`,
			`- Data timestamp (oldest OSM base among the responses): ${file.data_timestamp}`,
			`- Rows: ${file.places.length}`,
			`- Rows per state: ${perState.join(', ')}`,
			`- Distinct postcodes: ${postcodes.size}`,
			`- Rows without postcodes: ${file.places.filter((r) => r.postcodes.length === 0).length}`,
			`- Size: ${rawBytes} bytes raw, ${gzipBytes} bytes gzipped${gzipBytes > GZIP_FLAG_BYTES ? ' — FLAG: over 300 KB gzipped' : ''}`,
			file.bavaria.length === 0
				? '- Bavaria boundary: MISSING (bavaria query not cached)'
				: `- Bavaria boundary: ${file.bavaria.length} ring(s), ${points} points (Douglas–Peucker ${SIMPLIFY_TOLERANCE}°)`,
			'',
			`## Dropped: no place node and no postcode (${result.uninhabited.length})`,
			'',
			...list(result.uninhabited.map((m) => `${m.key} ${m.name}`)),
			'',
			`## Dropped: no name (${result.unnamed.length})`,
			'',
			...list(result.unnamed),
			'',
			`## Dropped: no coordinates (${result.noPoint.length})`,
			'',
			...list(result.noPoint.map((m) => `${m.key} ${m.name}`)),
			'',
			`## Duplicate AGS (lower relation id kept) (${result.duplicates.length})`,
			'',
			...list(result.duplicates.map((d) => `${d.key}: kept r${d.keptId}, dropped ${d.droppedIds.map((id) => `r${id}`).join(', ')}`)),
			'',
			...(file.bavaria.length === 0
				? ['## Bavarian rows outside the boundary: not checked (boundary missing)']
				: [
						`## Bavarian rows outside the boundary (${result.outsideBoundary.length})`,
						'',
						...list(result.outsideBoundary.map((m) => `${m.key} ${m.name}`)),
					]),
			'',
		);
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------------------------
// Run

export interface BuildPlacesOptions {
	/** Holds cache/ and places-note.md. */
	dir?: string;
	/** Receives places.json. */
	publicDir?: string;
	fetchImpl?: FetchImpl;
	delayMs?: number;
	timeoutMs?: number;
	/** Waits between retries. */
	sleep?: (ms: number) => Promise<void>;
	/** Ignore the cache and send every query. */
	refresh?: boolean;
	/** Send nothing; build a partial file from the cached queries. Cannot be combined with `refresh`. */
	cachedOnly?: boolean;
	log?: (line: string) => void;
	error?: (line: string) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const formatBytes = (bytes: number): string =>
	bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes >= 1e3 ? `${(bytes / 1e3).toFixed(1)} KB` : `${bytes} B`;

const interpreterPrefix = `${OVERPASS_INTERPRETER_URL}?`;

/** Fetches or reads every query, writes places.json and places-note.md; returns the exit code. */
export async function runBuildPlaces(options: BuildPlacesOptions = {}): Promise<number> {
	const {
		dir = PLACES_DIR,
		publicDir = PUBLIC_DIR,
		sleep = defaultSleep,
		refresh = false,
		cachedOnly = false,
		log = console.log,
		error = console.error,
	} = options;
	const cacheDir = join(dir, 'cache');
	const notePath = join(dir, PLACES_NOTE_FILE);
	const placesPath = join(publicDir, PLACES_FILE);
	const cacheFile = (name: string): string => join(cacheDir, `${name}.json`);
	if (refresh && cachedOnly) {
		error('--refresh and --cached-only cannot be combined');
		return 1;
	}

	// Every cache file must be usable before anything is sent.
	const cached = new Map<string, OverpassResponse>();
	if (!refresh && existsSync(cacheDir)) {
		for (const file of readdirSync(cacheDir).filter((f) => f.endsWith('.json')).sort()) {
			const path = join(cacheDir, file);
			const parsed = parseOverpass(readFileSync(path, 'utf8'));
			if (!parsed.ok) {
				error(`${path} is not a usable Overpass response (${parsed.message}); delete it or rerun with --refresh`);
				return 1;
			}
			cached.set(file.slice(0, -'.json'.length), parsed.response);
		}
	}

	const baseFetch = options.fetchImpl ?? nativeFetch;
	let allWithUserAgent = true;
	let allToInterpreter = true;
	const starts: number[] = [];
	const checkedFetch: FetchImpl = (url, init) => {
		starts.push(performance.now());
		if (new Headers(init.headers).get('user-agent') !== USER_AGENT) allWithUserAgent = false;
		if (!url.startsWith(interpreterPrefix)) allToInterpreter = false;
		return baseFetch(url, init);
	};
	const client = createFetchClient({
		fetchImpl: checkedFetch,
		delayMs: options.delayMs ?? OVERPASS_DELAY_MS,
		timeoutMs: options.timeoutMs ?? OVERPASS_TIMEOUT_MS,
		robotsExempt: [OVERPASS_ROBOTS_EXEMPT],
	});

	let requests = 0;
	let retries = 0;
	let cacheHits = 0;
	let queries = 0;
	const failures: QueryFailure[] = [];
	const missing: string[] = [];

	async function obtain(name: string, ql: string): Promise<OverpassResponse | null> {
		queries++;
		const hit = cached.get(name);
		if (hit !== undefined) {
			cacheHits++;
			return hit;
		}
		if (cachedOnly) {
			missing.push(name);
			log(`${name} → not cached, left out`);
			return null;
		}
		const url = queryUrl(ql);
		for (let attempt = 0; ; attempt++) {
			requests++;
			const started = performance.now();
			const result = await client.get(url);
			const seconds = ((performance.now() - started) / 1000).toFixed(1);
			let reason: string;
			let retryable = false;
			if (result.ok) {
				const parsed = parseOverpass(result.text);
				if (parsed.ok) {
					mkdirSync(cacheDir, { recursive: true });
					writeFileSync(cacheFile(name), result.text);
					log(`[${requests}] ${name} → ${formatBytes(Buffer.byteLength(result.text))}, ${parsed.response.elements.length} elements, ${seconds} s`);
					return parsed.response;
				}
				reason = `invalid response: ${parsed.message}`;
			} else {
				reason = `${result.reason}${result.status !== null ? ` ${result.status}` : ''}`;
				retryable =
					result.reason === 'timeout' ||
					(result.reason === 'http-error' && (RETRY_STATUSES as readonly number[]).includes(result.status ?? 0));
			}
			if (retryable && attempt < RETRY_DELAYS_MS.length) {
				const wait = RETRY_DELAYS_MS[attempt]!;
				log(`[${requests}] ${name} → ${reason} after ${seconds} s; retrying in ${wait / 1000} s`);
				retries++;
				await sleep(wait);
				continue;
			}
			log(`[${requests}] ${name} → failed: ${reason}`);
			failures.push({ name, reason });
			return null;
		}
	}

	const indexResponse = await obtain('index', indexQuery());
	const index = indexResponse === null ? null : parseIndex(indexResponse);
	const prefixResponses: OverpassResponse[] = [];
	for (const prefix of index?.prefixes ?? []) {
		const response = await obtain(`ags-${prefix}`, prefixQuery(prefix));
		if (response !== null) prefixResponses.push(response);
	}
	const bavariaResponse = await obtain('bavaria', bavariaQuery());

	const gaps = starts.slice(1).map((start, i) => start - starts[i]!);
	const noteBase = {
		requests,
		cacheHits,
		queries,
		retries,
		failures,
		missing,
		allWithUserAgent,
		allToInterpreter,
		minGapMs: gaps.length === 0 ? null : Math.floor(Math.min(...gaps)),
	};

	const summary = `${requests} requests sent, ${retries} retries, ${cacheHits} cache hits, ${failures.length} failed${cachedOnly ? `, ${missing.length} not cached` : ''}`;
	if (failures.length > 0 || index === null || (!cachedOnly && bavariaResponse === null) || prefixResponses.length === 0) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(notePath, placesNote({ ...noteBase, build: null }));
		log(summary);
		const why =
			failures.length > 0
				? `${failures.length} queries failed`
				: index === null
					? 'the index query is not cached'
					: index.prefixes.length === 0
						? 'the index lists no municipalities'
						: 'no municipality query is cached';
		error(`${why}; places.json not written (see ${notePath})`);
		return 1;
	}

	let result: BuildResult;
	try {
		result = buildPlaces({
			index,
			municipalities: prefixResponses.flatMap(parsePrefixResponse),
			bavaria: bavariaResponse === null ? [] : bavariaRings(bavariaResponse),
			missing,
			timestamps: [indexResponse!, ...prefixResponses, ...(bavariaResponse === null ? [] : [bavariaResponse])].map((r) => r.timestamp),
		});
	} catch (caught) {
		error(`cannot build places.json, nothing written: ${(caught as Error).message}`);
		return 1;
	}
	const validated = placesSchema.safeParse(result.file);
	if (!validated.success) {
		error(`places.json fails the schema, nothing written:\n${validated.error.message}`);
		return 1;
	}

	const text = serializePlaces(result.file);
	const rawBytes = Buffer.byteLength(text);
	const gzipBytes = gzipSync(text).length;
	const rowsLine = `${result.file.places.length} rows, ${rawBytes} bytes, ${gzipBytes} bytes gzipped`;
	// Keep the note only when it describes this same file (it then records the run that fetched
	// the data); a note left by a failed run has no Output section and is rewritten.
	const unchanged =
		requests === 0 &&
		existsSync(placesPath) &&
		readFileSync(placesPath, 'utf8') === text &&
		existsSync(notePath) &&
		readFileSync(notePath, 'utf8').includes(`- Size: ${rawBytes} bytes raw, ${gzipBytes} bytes gzipped`);
	if (unchanged) {
		log(summary);
		log(`${rowsLine}; nothing changed, files left as they are`);
		return 0;
	}
	mkdirSync(publicDir, { recursive: true });
	mkdirSync(dir, { recursive: true });
	writeFileSync(placesPath, text);
	writeFileSync(notePath, placesNote({ ...noteBase, build: { result, rawBytes, gzipBytes } }));
	log(summary);
	log(`${rowsLine}${gzipBytes > GZIP_FLAG_BYTES ? ' (FLAG: over 300 KB gzipped)' : ''}; see ${notePath}`);
	return 0;
}

if (import.meta.main) {
	process.exitCode = await runBuildPlaces({
		refresh: process.argv.includes('--refresh'),
		cachedOnly: process.argv.includes('--cached-only'),
	});
}
