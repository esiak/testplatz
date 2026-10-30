import { describe, expect, it } from 'vitest';
import { LOCATE_MAX_LOOKUPS_PER_RUN, NOMINATIM_SEARCH_URL, USER_AGENT } from '../pipeline/config.ts';
import type { FetchImpl } from '../pipeline/fetch/index.ts';
import { decideLocation, locateRun, type LocateInput } from '../pipeline/stages/locate.ts';
import type { NormalisedOutcome } from '../pipeline/stages/normalise.ts';
import type { Centre } from '../shared/directory.ts';
import type { Listing } from '../shared/listing.ts';
import { emptyVenues, VENUE_MISS_RETRY_MS, venuesSchema, type VenueEntry, type Venues } from '../shared/venues.ts';

const RUN_AT = new Date('2026-10-30T05:17:00.000Z');
const AT = RUN_AT.toISOString();
const DAY = 24 * 60 * 60 * 1000;

const centre = (extra: Partial<Centre> = {}): Centre => ({
	centre_id: 'coburg',
	name: 'VHS Coburg',
	address: { street: 'Löwenstr. 15', postcode: '96450', city: 'Coburg' },
	lat: 50.258,
	lon: 10.964,
	website: 'https://www.vhs-coburg.de/',
	test_page_url: null,
	reader: 'kuferweb',
	reader_config: { list_url: 'https://www.vhs-coburg.de/kurse' },
	opted_out: false,
	source: 'rtpartner',
	verified_at: null,
	...extra,
});

let minute = 0;
const listing = (address: string, centreId = 'coburg'): Listing => {
	minute += 1;
	const mm = String(minute % 60).padStart(2, '0');
	const hh = String(10 + Math.floor(minute / 60)).padStart(2, '0');
	return {
		id: `${centreId}@2026-11-12T${hh}:${mm}`,
		centre_id: centreId,
		starts_at: `2026-11-12T${hh}:${mm}:00+01:00`,
		place: null,
		address,
		status: 'free',
		deadline: null,
		registration_method: 'online',
		source_url: `https://${centreId}.example.de/k/${minute}`,
		link_ok: true,
		eligibility: null,
	};
};

const ok = (listings: Listing[], centreAddressIds: string[] = []): NormalisedOutcome => ({ kind: 'ok', listings, centreAddressIds });

const hitBody = (postcode: string | null, extra: Record<string, unknown> = {}) =>
	JSON.stringify([
		{ lat: '47.9987654321', lon: '11.1712345678', place_rank: 30, display_name: 'x', address: { 'ISO3166-2-lvl4': 'DE-BY', ...(postcode ? { postcode } : {}) }, ...extra },
	]);

/** A fake Nominatim; `respond` maps the request URL to a response (default: a hit with the asked postcode). */
function nominatim(respond?: (url: URL) => Response | Promise<Response>) {
	const calls: { url: string; userAgent: string | null }[] = [];
	const fetchImpl: FetchImpl = async (url, init) => {
		calls.push({ url, userAgent: new Headers(init.headers).get('user-agent') });
		const parsed = new URL(url);
		if (respond) return respond(parsed);
		return new Response(hitBody(parsed.searchParams.get('postalcode')), { status: 200 });
	};
	return { calls, fetchImpl };
}

async function locate(input: Partial<LocateInput> & Pick<LocateInput, 'outcomes'>, net = nominatim()) {
	const logs: string[] = [];
	const sleeps: number[] = [];
	const result = await locateRun({
		directory: [centre()],
		venues: emptyVenues(),
		runAt: RUN_AT,
		fetchImpl: net.fetchImpl,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		timeoutMs: 1000,
		log: (line) => logs.push(line),
		...input,
	});
	const listings = Object.values(result.outcomes).flatMap((o) => (o.kind === 'ok' ? o.listings : []));
	return { ...result, logs, sleeps, calls: net.calls, listings };
}

const venuesWith = (entries: Record<string, VenueEntry>): Venues => ({ venuesVersion: 1, entries });

describe('locateRun: the I/O matrix', () => {
	it('same as centre: centre coordinates, venue, no request', async () => {
		const r = await locate({ outcomes: { coburg: ok([listing('Löwenstraße 15, 96450 Coburg')]) } });
		expect(r.listings[0]).toMatchObject({ lat: 50.258, lon: 10.964, location: 'venue' });
		expect(r.calls).toEqual([]);
		expect(r.lookups).toEqual({});
	});

	it('cached hit: cached coordinates, venue, no request', async () => {
		const venues = venuesWith({ 'jahnstr 10, 82211 herrsching': { fetched_at: '2026-01-01T00:00:00.000Z', lat: 48.0, lon: 11.17, reason: null } });
		const r = await locate({ outcomes: { coburg: ok([listing('Jahnstraße 10, 82211 Herrsching')]) }, venues });
		expect(r.listings[0]).toMatchObject({ lat: 48.0, lon: 11.17, location: 'venue' });
		expect(r.calls).toEqual([]);
		expect(r.stats).toMatchObject({ requests: 0, cacheHits: 1 });
	});

	it('new hit: one polite request, venue with 6-decimal coordinates, cached as a hit', async () => {
		const r = await locate({ outcomes: { coburg: ok([listing('Jahnstraße 10, 82211 Herrsching')]) } });
		expect(r.calls).toHaveLength(1);
		const url = new URL(r.calls[0]!.url);
		expect(`${url.origin}${url.pathname}`).toBe(NOMINATIM_SEARCH_URL);
		expect(Object.fromEntries(url.searchParams)).toMatchObject({ street: 'Jahnstraße 10', postalcode: '82211', city: 'Herrsching' });
		expect(r.calls[0]!.userAgent).toBe(USER_AGENT);
		expect(r.listings[0]).toMatchObject({ lat: 47.998765, lon: 11.171235, location: 'venue' });
		expect(r.lookups).toEqual({ 'jahnstr 10, 82211 herrsching': { fetched_at: AT, lat: 47.998765, lon: 11.171235, reason: null } });
	});

	it('rejected hit: centre with the reason, cached as a miss', async () => {
		const net = nominatim(() => new Response(hitBody('95615'), { status: 200 }));
		const r = await locate({ outcomes: { coburg: ok([listing('Hofer Str. 2, 95100 Selb')]) } }, net);
		expect(r.listings[0]).toMatchObject({ lat: 50.258, lon: 10.964, location: 'centre' });
		expect(r.lookups).toEqual({ 'hofer str 2, 95100 selb': { fetched_at: AT, lat: null, lon: null, reason: 'postcode mismatch (95615)' } });
		expect(r.logs).toContain('locate coburg: "Hofer Str. 2, 95100 Selb" at the centre (postcode mismatch (95615))');
	});

	it('no match: centre, cached as a miss', async () => {
		const r = await locate({ outcomes: { coburg: ok([listing('Nirgendwo 1, 96450 Coburg')]) } }, nominatim(() => new Response('[]', { status: 200 })));
		expect(r.listings[0]).toMatchObject({ location: 'centre' });
		expect(r.lookups['nirgendwo 1, 96450 coburg']).toEqual({ fetched_at: AT, lat: null, lon: null, reason: 'no match' });
	});

	it.each(['Raum 2, Hauptstr. 1, 80331 München', 'Hauptstr. 1, München', 'Turnhalle'])('unparseable %j: centre, no request', async (address) => {
		const r = await locate({ outcomes: { coburg: ok([listing(address)]) } });
		expect(r.listings[0]).toMatchObject({ lat: 50.258, lon: 10.964, location: 'centre' });
		expect(r.calls).toEqual([]);
		expect(r.logs[0]).toBe(`locate coburg: "${address}" at the centre (unparseable address)`);
	});

	it('provider fallback: centre, no provider address, even though it equals the centre address', async () => {
		const l = listing('Löwenstr. 15, 96450 Coburg');
		const r = await locate({ outcomes: { coburg: ok([l], [l.id]) } });
		expect(r.listings[0]).toMatchObject({ lat: 50.258, lon: 10.964, location: 'centre' });
		expect(r.logs[0]).toContain('(no provider address)');
		expect(r.calls).toEqual([]);
	});

	it.each([
		['a 503', () => new Response('busy', { status: 503 }), 'lookup failed: http-error 503'],
		['bad JSON', () => new Response('<html>', { status: 200 }), 'lookup failed: invalid response body'],
		['a timeout', () => new Promise<Response>(() => {}), 'lookup failed: timeout'],
	])('Nominatim down (%s): centre, nothing cached', async (_name, respond, reason) => {
		const r = await locate({ outcomes: { coburg: ok([listing('Jahnstraße 10, 82211 Herrsching')]) }, timeoutMs: 20 }, nominatim(respond));
		expect(r.listings[0]).toMatchObject({ lat: 50.258, lon: 10.964, location: 'centre' });
		expect(r.lookups).toEqual({});
		expect(r.logs[0]).toBe(`locate coburg: "Jahnstraße 10, 82211 Herrsching" at the centre (${reason})`);
	});

	it('cap reached: one request, the second address at the centre, not cached', async () => {
		const r = await locate({ outcomes: { coburg: ok([listing('Jahnstraße 10, 82211 Herrsching'), listing('Am Markt 1, 91161 Hilpoldstein')]) }, maxLookups: 1 });
		expect(r.calls).toHaveLength(1);
		expect(r.listings.map((l) => l.location)).toEqual(['venue', 'centre']);
		expect(Object.keys(r.lookups)).toEqual(['jahnstr 10, 82211 herrsching']);
		expect(r.logs).toContain('locate coburg: "Am Markt 1, 91161 Hilpoldstein" at the centre (lookup cap reached)');
	});

	it('defaults the cap to LOCATE_MAX_LOOKUPS_PER_RUN = 50', async () => {
		expect(LOCATE_MAX_LOOKUPS_PER_RUN).toBe(50);
		const listings = Array.from({ length: 52 }, (_, i) => listing(`Weg ${i + 1}, 82211 Herrsching`));
		const r = await locate({ outcomes: { coburg: ok(listings) } });
		expect(r.calls).toHaveLength(50);
		expect(r.listings.filter((l) => l.location === 'centre')).toHaveLength(2);
	});

	it('old miss: a miss 31 days old is looked up again; a 29-day-old one is not', async () => {
		const key = 'jahnstr 10, 82211 herrsching';
		const miss = (ageDays: number): Venues =>
			venuesWith({ [key]: { fetched_at: new Date(RUN_AT.getTime() - ageDays * DAY).toISOString(), lat: null, lon: null, reason: 'no match' } });
		const old = await locate({ outcomes: { coburg: ok([listing('Jahnstraße 10, 82211 Herrsching')]) }, venues: miss(31) });
		expect(old.calls).toHaveLength(1);
		expect(old.listings[0]!.location).toBe('venue');
		const fresh = await locate({ outcomes: { coburg: ok([listing('Jahnstraße 10, 82211 Herrsching')]) }, venues: miss(29) });
		expect(fresh.calls).toEqual([]);
		expect(fresh.listings[0]!.location).toBe('centre');
		expect(fresh.logs[0]).toContain('(no match)');
		expect(VENUE_MISS_RETRY_MS).toBe(30 * DAY);
	});

	it('centre without coordinates: fallback is lat/lon null; the centre address is still looked up', async () => {
		const unlocated = centre({ lat: null, lon: null });
		const fallback = listing('Löwenstr. 15, 96450 Coburg');
		const r = await locate({ directory: [unlocated], outcomes: { coburg: ok([fallback, listing('Löwenstraße 15, 96450 Coburg')], [fallback.id]) } });
		expect(r.listings[0]).toMatchObject({ lat: null, lon: null, location: 'centre' });
		expect(r.listings[1]).toMatchObject({ location: 'venue' });
		expect(r.calls).toHaveLength(1);
	});

	it('shared address: three listings, one request, one log line per (centre, address)', async () => {
		const down = nominatim(() => new Response('busy', { status: 503 }));
		const addresses = ['Jahnstraße 10, 82211 Herrsching', 'Jahnstrasse 10, 82211 Herrsching', 'Jahnstraße 10, 82211 Herrsching'];
		const r = await locate({ outcomes: { coburg: ok(addresses.map((a) => listing(a))) } }, down);
		expect(down.calls).toHaveLength(1);
		expect(r.logs.filter((l) => l.startsWith('locate coburg:'))).toHaveLength(2);
		const ok3 = await locate({ outcomes: { coburg: ok(addresses.map((a) => listing(a))) } });
		expect(ok3.calls).toHaveLength(1);
		expect(ok3.listings.every((l) => l.location === 'venue')).toBe(true);
	});

	it('requests are serial and at least 1 s apart, whatever delayMs says', async () => {
		const r = await locate({ outcomes: { coburg: ok([listing('Weg 1, 82211 Herrsching'), listing('Weg 2, 82211 Herrsching')]) }, delayMs: 0 });
		expect(r.calls).toHaveLength(2);
		expect(r.sleeps).toEqual([1000]);
	});
});

describe('locateRun: outcomes, summary and output', () => {
	it('passes failed and skipped through and logs a summary without URLs', async () => {
		const r = await locate({
			outcomes: {
				coburg: ok([listing('Löwenstr. 15, 96450 Coburg'), listing('Jahnstraße 10, 82211 Herrsching'), listing('Turnhalle')]),
				f: { kind: 'failed', reason: 'list-page' },
				s: { kind: 'skipped', reason: 'budget' },
			},
		});
		expect(r.outcomes.f).toEqual({ kind: 'failed', reason: 'list-page' });
		expect(r.outcomes.s).toEqual({ kind: 'skipped', reason: 'budget' });
		expect(r.stats).toEqual({ venue: 2, centre: 1, requests: 1, cacheHits: 0 });
		expect(r.logs.at(-1)).toBe('locate: 2 at venue, 1 at centre; 1 requests, 0 cache hits');
		for (const line of r.logs) expect(line).not.toMatch(/https?:/);
	});

	it('produces lookups that make a valid venue cache', async () => {
		const r = await locate({ outcomes: { coburg: ok([listing('Jahnstraße 10, 82211 Herrsching'), listing('Hofer Str. 2, 95100 Selb')]) } });
		expect(venuesSchema.safeParse({ venuesVersion: 1, entries: r.lookups }).success).toBe(true);
	});
});

describe('decideLocation', () => {
	it('applies rules 1–4 in order without any I/O', () => {
		const c = centre();
		const v = emptyVenues();
		expect(decideLocation({ address: 'Löwenstr. 15, 96450 Coburg' }, c, true, v, RUN_AT)).toMatchObject({ kind: 'placed', placement: { location: 'centre', reason: 'no provider address' } });
		expect(decideLocation({ address: 'Löwenstr. 15, 96450 Coburg' }, c, false, v, RUN_AT)).toMatchObject({ kind: 'placed', placement: { location: 'venue', reason: null } });
		expect(decideLocation({ address: 'Raum 2, A 1, 96450 Coburg' }, c, false, v, RUN_AT)).toMatchObject({ kind: 'placed', placement: { reason: 'unparseable address' } });
		expect(decideLocation({ address: 'Jahnstraße 10, 82211 Herrsching' }, c, false, v, RUN_AT)).toEqual({
			kind: 'lookup',
			key: 'jahnstr 10, 82211 herrsching',
			address: { street: 'Jahnstraße 10', postcode: '82211', city: 'Herrsching' },
		});
	});
});
