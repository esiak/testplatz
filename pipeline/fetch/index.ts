import { FETCH_DELAY_MS, FETCH_TIMEOUT_MS, USER_AGENT } from '../config.ts';
import { decodeBody } from './decode.ts';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type RobotsRules } from './robots.ts';

/**
 * The one polite HTTP client for all outbound requests (AD-5). One client = one run:
 * robots.txt is fetched once per origin, requests to one host run one at a time with a delay
 * between them, and redirects are followed here so every hop gets the same rules.
 */

export type FetchFailureReason = 'robots-disallowed' | 'timeout' | 'network-error' | 'http-error' | 'too-many-redirects';

export interface FetchSuccess {
	ok: true;
	status: number;
	url: string;
	contentType: string | null;
	text: string;
}

export interface FetchFailure {
	ok: false;
	reason: FetchFailureReason;
	url: string;
	status: number | null;
}

export type FetchResult = FetchSuccess | FetchFailure;

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchClientOptions {
	userAgent?: string;
	delayMs?: number;
	timeoutMs?: number;
	fetchImpl?: FetchImpl;
	sleep?: (ms: number) => Promise<void>;
}

export interface FetchClient {
	get(url: string): Promise<FetchResult>;
}

export const MAX_REDIRECTS = 5;

/** The platform fetch, for callers that wrap the client's transport (e.g. to count requests). */
export const nativeFetch: FetchImpl = (url, init) => globalThis.fetch(url, init);

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type RawResult =
	| { kind: 'response'; status: number; location: string | null; contentType: string | null; bytes: Uint8Array }
	| { kind: 'error'; reason: 'timeout' | 'network-error' };

const isRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

export function createFetchClient(options: FetchClientOptions = {}): FetchClient {
	const userAgent = options.userAgent ?? USER_AGENT;
	const delayMs = options.delayMs ?? FETCH_DELAY_MS;
	const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
	const fetchImpl = options.fetchImpl ?? nativeFetch;
	const sleep = options.sleep ?? defaultSleep;

	/** Per host: the tail of its request chain and whether it has been contacted yet. */
	const queues = new Map<string, { tail: Promise<unknown>; used: boolean }>();
	/** Per robots.txt URL: the parsed rules, fetched once. */
	const robots = new Map<string, Promise<RobotsRules>>();

	/** Runs one request to `host` after every earlier one has finished, `delayMs` apart. */
	function enqueue<T>(host: string, task: () => Promise<T>): Promise<T> {
		let queue = queues.get(host);
		if (!queue) {
			queue = { tail: Promise.resolve(), used: false };
			queues.set(host, queue);
		}
		const state = queue;
		const run = state.tail.then(async () => {
			if (state.used) await sleep(delayMs);
			state.used = true;
			return task();
		});
		state.tail = run.catch(() => undefined);
		return run;
	}

	/** One HTTP request, no redirect following; the timeout covers headers and body. */
	function request(url: URL): Promise<RawResult> {
		return enqueue(url.host, async () => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				const response = await fetchImpl(url.href, {
					redirect: 'manual',
					signal: controller.signal,
					headers: { 'User-Agent': userAgent },
				});
				const bytes = new Uint8Array(await response.arrayBuffer());
				return {
					kind: 'response' as const,
					status: response.status,
					location: response.headers.get('location'),
					contentType: response.headers.get('content-type'),
					bytes,
				};
			} catch {
				return { kind: 'error' as const, reason: controller.signal.aborted ? 'timeout' : 'network-error' };
			} finally {
				clearTimeout(timer);
			}
		});
	}

	/**
	 * The rules served at one robots.txt URL: 2xx → parsed, 4xx → allow all, anything else →
	 * disallow all. Redirects are followed (max 5); every robots.txt URL is requested at most
	 * once per client, so origins that redirect to the same place share one fetch.
	 */
	function robotsAt(target: URL, hops: number): Promise<RobotsRules> {
		let rules = robots.get(target.href);
		if (!rules) {
			rules = (async () => {
				const raw = await request(target);
				if (raw.kind === 'error') return DISALLOW_ALL;
				if (isRedirect(raw.status) && raw.location !== null) {
					if (hops >= MAX_REDIRECTS || !URL.canParse(raw.location, target)) return DISALLOW_ALL;
					const next = new URL(raw.location, target);
					next.hash = '';
					return robotsAt(next, hops + 1);
				}
				if (raw.status >= 200 && raw.status < 300) return parseRobots(decodeBody(raw.bytes, raw.contentType));
				if (raw.status >= 400 && raw.status < 500) return ALLOW_ALL;
				return DISALLOW_ALL;
			})();
			robots.set(target.href, rules);
		}
		return rules;
	}

	const robotsFor = (origin: string): Promise<RobotsRules> => robotsAt(new URL('/robots.txt', origin), 0);

	async function get(url: string): Promise<FetchResult> {
		if (!URL.canParse(url)) return { ok: false, reason: 'network-error', url, status: null };
		let current = new URL(url);
		current.hash = '';

		for (let redirects = 0; ; redirects++) {
			if (current.protocol !== 'http:' && current.protocol !== 'https:') {
				return { ok: false, reason: 'network-error', url: current.href, status: null };
			}
			const rules = await robotsFor(current.origin);
			if (!rules.isAllowed(current.pathname + current.search)) {
				return { ok: false, reason: 'robots-disallowed', url: current.href, status: null };
			}

			const raw = await request(current);
			if (raw.kind === 'error') return { ok: false, reason: raw.reason, url: current.href, status: null };

			if (isRedirect(raw.status) && raw.location !== null) {
				if (redirects >= MAX_REDIRECTS) {
					return { ok: false, reason: 'too-many-redirects', url: current.href, status: raw.status };
				}
				if (!URL.canParse(raw.location, current)) {
					return { ok: false, reason: 'network-error', url: current.href, status: raw.status };
				}
				current = new URL(raw.location, current);
				current.hash = '';
				continue;
			}
			if (raw.status < 200 || raw.status >= 300) {
				return { ok: false, reason: 'http-error', url: current.href, status: raw.status };
			}
			return {
				ok: true,
				status: raw.status,
				url: current.href,
				contentType: raw.contentType,
				text: decodeBody(raw.bytes, raw.contentType),
			};
		}
	}

	return { get };
}
