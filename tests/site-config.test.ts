import { existsSync } from 'node:fs';
import { posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ABOUT_URL, SITE_URL, USER_AGENT } from '../pipeline/config.ts';
import pkg from '../package.json' with { type: 'json' };
import viteConfig from '../vite.config.ts';

const webRoot = fileURLToPath(new URL('../web/', import.meta.url));
const aboutHtml = fileURLToPath(new URL('../web/about/index.html', import.meta.url));

describe('site config', () => {
	it('identifies the bot with its version and the About URL', () => {
		expect(USER_AGENT).toMatch(/^bgtsearch-bot\/\d+\.\d+\.\d+ \(\+https:\/\/esiak\.github\.io\/testplatz\/about\/\)$/);
		expect(ABOUT_URL).toBe('https://esiak.github.io/testplatz/about/');
		expect(USER_AGENT).toBe(`bgtsearch-bot/${pkg.version} (+${ABOUT_URL})`);
	});

	it('serves the site under the same path as the Vite base', () => {
		expect(viteConfig.base).toBe(new URL(SITE_URL).pathname);
	});

	it('builds the About page at the path named in the bot User-Agent', () => {
		const input = viteConfig.build?.rollupOptions?.input;
		const entries = typeof input === 'string' ? [input] : Array.isArray(input) ? input : Object.values(input ?? {});
		expect(entries).toContain(aboutHtml);
		expect(existsSync(aboutHtml)).toBe(true);

		const pageDir = `${posix.dirname(relative(webRoot, aboutHtml).split(sep).join('/'))}/`;
		const aboutPath = new URL(ABOUT_URL).pathname.slice(new URL(SITE_URL).pathname.length);
		expect(pageDir).toBe('about/');
		expect(aboutPath).toBe(pageDir);
	});
});
