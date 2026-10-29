import { z } from 'zod';

/** Reader systems a centre can be read with. `none` = not read automatically. */
export const READERS = ['kuferweb', 'itemkg', 'none'] as const;
export type Reader = (typeof READERS)[number];

/** Where a directory entry came from. */
export const SOURCES = ['rtpartner'] as const;

export const CENTRE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A plausible public hostname: only `[a-z0-9.-]`, at least one dot, a final label of 2+ letters. */
export const isPlausibleHostname = (hostname: string): boolean =>
	/^[a-z0-9.-]+$/.test(hostname) && hostname.includes('.') && /\.[a-z]{2,}$/.test(hostname);

/** An http(s) URL whose hostname is plausible (rejects typos such as `www.vhs-kisshab,de`). */
export const isHttpUrl = (value: string): boolean => {
	if (!URL.canParse(value)) return false;
	const { protocol, hostname } = new URL(value);
	return (protocol === 'http:' || protocol === 'https:') && isPlausibleHostname(hostname);
};

const httpUrl = z.string().refine(isHttpUrl, { message: 'must be an http(s) URL with a plausible hostname' });

/** A generous bounding box around Bavaria; every stored coordinate must lie inside it. */
export const BAVARIA_BBOX = { minLat: 47.2, maxLat: 50.6, minLon: 8.9, maxLon: 13.9 } as const;

/** True when the point lies inside `BAVARIA_BBOX` (edges included). */
export const isInBavariaBox = (lat: number, lon: number): boolean =>
	lat >= BAVARIA_BBOX.minLat && lat <= BAVARIA_BBOX.maxLat && lon >= BAVARIA_BBOX.minLon && lon <= BAVARIA_BBOX.maxLon;

export const addressSchema = z.strictObject({
	street: z.string().min(1),
	postcode: z.string().regex(/^\d{5}$/, { message: 'must be 5 digits' }),
	city: z.string().min(1),
});

export const readerConfigSchema = z.strictObject({ list_url: httpUrl });

/** The directory centre fields, without the cross-field checks (extend this, then add `checkCentre`). */
export const centreFieldsSchema = z.strictObject({
	centre_id: z.string().regex(CENTRE_ID_PATTERN, { message: 'must be a lowercase slug' }),
	name: z.string().min(1),
	address: addressSchema,
	lat: z.number().nullable(),
	lon: z.number().nullable(),
	website: httpUrl.nullable(),
	test_page_url: httpUrl.nullable(),
	reader: z.enum(READERS),
	reader_config: readerConfigSchema.nullable(),
	opted_out: z.boolean(),
	source: z.enum(SOURCES),
	verified_at: z.iso.datetime().nullable(),
});

type CentreFields = z.infer<typeof centreFieldsSchema>;

/** Cross-field centre checks: coords pair, Bavaria box, `reader_config` null for reader `none`. */
export function checkCentre(centre: CentreFields, ctx: z.RefinementCtx): void {
	if ((centre.lat === null) !== (centre.lon === null)) {
		ctx.addIssue({
			code: 'custom',
			path: [centre.lat === null ? 'lat' : 'lon'],
			message: 'lat and lon must both be numbers or both be null',
		});
	}
	if (centre.lat !== null && (centre.lat < BAVARIA_BBOX.minLat || centre.lat > BAVARIA_BBOX.maxLat)) {
		ctx.addIssue({ code: 'custom', path: ['lat'], message: `must lie inside Bavaria (${BAVARIA_BBOX.minLat}–${BAVARIA_BBOX.maxLat})` });
	}
	if (centre.lon !== null && (centre.lon < BAVARIA_BBOX.minLon || centre.lon > BAVARIA_BBOX.maxLon)) {
		ctx.addIssue({ code: 'custom', path: ['lon'], message: `must lie inside Bavaria (${BAVARIA_BBOX.minLon}–${BAVARIA_BBOX.maxLon})` });
	}
	if (centre.reader === 'none' && centre.reader_config !== null) {
		ctx.addIssue({ code: 'custom', path: ['reader_config'], message: 'must be null when reader is "none"' });
	}
}

export const centreSchema = centreFieldsSchema.superRefine(checkCentre);

export const directorySchema = z.array(centreSchema).superRefine((centres, ctx) => {
	const seen = new Set<string>();
	centres.forEach((centre, index) => {
		if (seen.has(centre.centre_id)) {
			ctx.addIssue({
				code: 'custom',
				path: [index, 'centre_id'],
				message: `duplicate centre_id "${centre.centre_id}"`,
			});
		}
		seen.add(centre.centre_id);
	});
});

export type Address = z.infer<typeof addressSchema>;
export type Centre = z.infer<typeof centreSchema>;
export type Directory = z.infer<typeof directorySchema>;

/** `street, postcode city`: the one address format for the UI and the listing address fallback. */
export function formatAddress(address: Address): string {
	return `${address.street}, ${address.postcode} ${address.city}`;
}

const SLUG_MAX = 60;

/** Lowercase ASCII slug: ä→ae ö→oe ü→ue ß→ss, other accents stripped, the rest → `-`. */
export function slugify(text: string): string {
	let slug = text
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (slug.length > SLUG_MAX) {
		const cut = slug.slice(0, SLUG_MAX + 1);
		const lastDash = cut.lastIndexOf('-');
		slug = (lastDash > 0 ? cut.slice(0, lastDash) : cut.slice(0, SLUG_MAX)).replace(/-+$/, '');
	}
	return slug;
}

/** Sorted by `centre_id`, the order the directory file is kept in. */
export const sortDirectory = (centres: readonly Centre[]): Centre[] =>
	[...centres].sort((a, b) => (a.centre_id < b.centre_id ? -1 : a.centre_id > b.centre_id ? 1 : 0));

/** The canonical file text: sorted, tab-indented, trailing newline. */
export const serializeDirectory = (centres: readonly Centre[]): string =>
	`${JSON.stringify(sortDirectory(centres), null, '\t')}\n`;
