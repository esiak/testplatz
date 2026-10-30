import pkg from '../package.json' with { type: 'json' };

/** Public site root on GitHub Pages. Its path must equal the Vite `base`. */
export const SITE_URL = 'https://esiak.github.io/testplatz/';

/** Stable About page, named in the bot User-Agent. */
export const ABOUT_URL = `${SITE_URL}about/`;

/** Identified User-Agent for every outbound request (AD-5). */
export const USER_AGENT = `bgtsearch-bot/${pkg.version} (+${ABOUT_URL})`;

/** Default pause between two requests to the same host (pipeline/fetch). */
export const FETCH_DELAY_MS = 2000;

/** Default per-request timeout, covering headers and body (pipeline/fetch). */
export const FETCH_TIMEOUT_MS = 20000;

/** Nominatim structured search, the only Nominatim endpoint used (tools/geocode and stages/locate, AD-5). */
export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/** Pause between two Nominatim requests: ≤ 1 req/s per the OSMF usage policy. */
export const NOMINATIM_DELAY_MS = 1100;

/**
 * A robots exemption in pipeline/fetch (AD-5): Nominatim's `/search`, governed by the OSMF usage
 * policy rather than its crawler robots.txt. Passed only by tools/geocode and pipeline/stages/locate.
 */
export const NOMINATIM_ROBOTS_EXEMPT = { origin: 'https://nominatim.openstreetmap.org', path: '/search' } as const;

/**
 * At most this many Nominatim requests per pipeline run (stages/locate, FR36). Further uncached
 * test addresses fall back to the centre's coordinates until a later run.
 */
export const LOCATE_MAX_LOOKUPS_PER_RUN = 50;

/** Overpass API interpreter, the only Overpass endpoint used (tools/build-places, AD-5). */
export const OVERPASS_INTERPRETER_URL = 'https://overpass-api.de/api/interpreter';

/** Pause between two Overpass requests: serial and well spaced, as the query slots are shared. */
export const OVERPASS_DELAY_MS = 10_000;

/** Per-request timeout for Overpass; matches the `[timeout:900]` in every query. */
export const OVERPASS_TIMEOUT_MS = 900_000;

/**
 * The second robots exemption in pipeline/fetch (AD-5 amendment, operator decision 2026-10-27):
 * Overpass's `/api/interpreter`, called manually and cached, never on a schedule. Its robots.txt
 * disallows `/api/` for all bots. Passed only by tools/build-places.
 */
export const OVERPASS_ROBOTS_EXEMPT = { origin: 'https://overpass-api.de', path: '/api/interpreter' } as const;

/** Politeness budget (NFR3): at most this many visits per host in any rolling `VISIT_WINDOW_MS`. */
export const VISIT_LIMIT_PER_HOST = 4;

/** The rolling window of the visit budget: 24 h. */
export const VISIT_WINDOW_MS = 24 * 60 * 60 * 1000;
