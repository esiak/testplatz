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
