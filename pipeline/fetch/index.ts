import { FETCH_DELAY_MS, FETCH_TIMEOUT_MS, USER_AGENT } from '../config.ts';
import { decodeBody } from './decode.ts';
import { ALLOW_ALL, DISALLOW_ALL, parseRobots, type RobotsRules } from './robots.ts';

/**
 * The one polite HTTP client for all outbound requests (AD-5). One client = one run:
 * robots.txt is fetched once per origin, requests to one host run one at a time with a delay
 * between them, and redirects are followed here so every hop gets the same rules.
 */

export type FetchFailureReason =
	| 'robots-disallowed'
	| 'host-blocked'
	| 'timeout'
	| 'network-error'
	| 'http-error'
	| 'too-many-redirects';

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
	/**
	 * URLs whose origin and pathname exactly match an entry skip the robots check (no robots.txt
	 * is fetched for them). Every other URL, including redirect targets, keeps the full rules.
	 * The users are tools/geocode with Nominatim's `/search` and tools/build-places with Overpass's
	 * `/api/interpreter` (AD-5); each passes only its own entry.
	 */
	robotsExempt?: readonly RobotsExemption[];
	/**
	 * Hosts that must not be contacted at all (the visit budget, Story 2.2). Checked before every
	 * request: robots.txt, pages and every redirect hop. A `get` that would need a blocked host,
	 * directly or via its robots.txt chain, returns `host-blocked` and sends nothing to it.
	 */
	isHostBlocked?: (host: string) => boolean;
}

export interface RobotsExemption {
	origin: string;
	path: string;
}

/** What one client (one run) sent, counted by the client itself, never from URL paths. */
export interface FetchStats {
	/** robots.txt requests sent (redirect hops included). */
	robotsRequests: number;
	/** `get` calls, keyed by the host of the URL passed to `get`. One `get` = one page. */
	pageGets: Record<string, number>;
	/** Every HTTP request sent (robots.txt, pages and redirect hops), keyed by the requested host. */
	rawRequests: Record<string, number>;
	/** Redirect hops followed by `get` (not counted as pages). */
	redirectHops: number;
	/** Per origin whose robots.txt could not be used (5xx, timeout, network error, bad redirects): why. */
	robotsUnavailable: Record<string, string>;
}

export interface FetchClient {
	get(url: string): Promise<FetchResult>;
	/** A snapshot of this client's request counts. */
	stats(): FetchStats;
}

export const MAX_REDIRECTS = 5;

/** The platform fetch, for callers that wrap the client's transport (e.g. to count requests). */
export const nativeFetch: FetchImpl = (url, init) => globalThis.fetch(url, init);

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type RawResult =
	| { kind: 'response'; status: number; location: string | null; contentType: string | null; bytes: Uint8Array }
	| { kind: 'error'; reason: 'timeout' | 'network-error' };

const isRedirect = (status: number): boolean => [301, 302, 303, 307, 308].includes(status);

interface RobotsOutcome {
	rules: RobotsRules;
	/** Why robots.txt was unusable (so the whole origin is disallowed), or null. */
	unavailable: string | null;
	/** The robots.txt chain reached a blocked host, so pages on this origin are `host-blocked`. */
	blocked: boolean;
}

export function createFetchClient(options: FetchClientOptions = {}): FetchClient {
	const userAgent = options.userAgent ?? USER_AGENT;
	const delayMs = options.delayMs ?? FETCH_DELAY_MS;
	const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
	const fetchImpl = options.fetchImpl ?? nativeFetch;
	const sleep = options.sleep ?? defaultSleep;
	const robotsExempt = [...(options.robotsExempt ?? [])];
	const isExempt = (url: URL): boolean => robotsExempt.some((e) => e.origin === url.origin && e.path === url.pathname);
	const isHostBlocked = options.isHostBlocked ?? (() => false);

	/** Per host: the tail of its request chain and whether it has been contacted yet. */
	const queues = new Map<string, { tail: Promise<unknown>; used: boolean }>();
	/** Per robots.txt URL: the raw response, requested once. */
	const robotsRaw = new Map<string, Promise<RawResult>>();
	/** Per origin: its resolved robots rules. */
	const robotsByOrigin = new Map<string, Promise<RobotsOutcome>>();

	const counts = {
		robotsRequests: 0,
		pageGets: {} as Record<string, number>,
		rawRequests: {} as Record<string, number>,
		redirectHops: 0,
		robotsUnavailable: {} as Record<string, string>,
	};
	const bump = (record: Record<string, number>, key: string): void => {
		record[key] = (record[key] ?? 0) + 1;
	};

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

	/** One HTTP request, no redirect following. The timeout covers headers and body. Never rejects. */
	async function attempt(url: URL): Promise<RawResult> {
		bump(counts.rawRequests, url.host);
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<RawResult>((resolve) => {
			timer = setTimeout(() => {
				controller.abort();
				resolve({ kind: 'error', reason: 'timeout' });
			}, timeoutMs);
		});
		const work = (async (): Promise<RawResult> => {
			try {
				const response = await fetchImpl(url.href, {
					redirect: 'manual',
					signal: controller.signal,
					headers: { 'User-Agent': userAgent },
				});
				const bytes = new Uint8Array(await response.arrayBuffer());
				return {
					kind: 'response',
					status: response.status,
					location: response.headers.get('location'),
					contentType: response.headers.get('content-type'),
					bytes,
				};
			} catch {
				return { kind: 'error', reason: controller.signal.aborted ? 'timeout' : 'network-error' };
			}
		})();
		try {
			return await Promise.race([work, timedOut]);
		} finally {
			clearTimeout(timer);
		}
	}

	const request = (url: URL): Promise<RawResult> => enqueue(url.host, () => attempt(url));

	/** The raw robots.txt response at one URL, requested at most once per client. */
	function robotsAt(target: URL): Promise<RawResult> {
		let raw = robotsRaw.get(target.href);
		if (!raw) {
			counts.robotsRequests++;
			raw = request(target);
			robotsRaw.set(target.href, raw);
		}
		return raw;
	}

	/**
	 * The rules for one origin: 2xx → parsed, 4xx → allow all; a 5xx, timeout, network error,
	 * redirect loop or more than 5 redirects → disallow all. Redirects are followed here without
	 * waiting on other origins' resolution, so cycles can never deadlock.
	 */
	async function resolveRobots(origin: string): Promise<RobotsOutcome> {
		const unavailable = (reason: string): RobotsOutcome => {
			counts.robotsUnavailable[origin] = reason;
			return { rules: DISALLOW_ALL, unavailable: reason, blocked: false };
		};
		let target = new URL('/robots.txt', origin);
		const visited = new Set<string>();
		for (let hops = 0; ; hops++) {
			if (visited.has(target.href)) return unavailable('redirect loop');
			visited.add(target.href);
			if (isHostBlocked(target.host)) return { rules: DISALLOW_ALL, unavailable: null, blocked: true };
			const raw = await robotsAt(target);
			if (raw.kind === 'error') return unavailable(raw.reason);
			if (isRedirect(raw.status) && raw.location !== null) {
				if (hops >= MAX_REDIRECTS) return unavailable('too many redirects');
				if (!URL.canParse(raw.location, target)) return unavailable('bad redirect');
				const next = new URL(raw.location, target);
				if (next.protocol !== 'http:' && next.protocol !== 'https:') return unavailable('bad redirect');
				next.hash = '';
				target = next;
				continue;
			}
			if (raw.status >= 200 && raw.status < 300) {
				return { rules: parseRobots(decodeBody(raw.bytes, raw.contentType)), unavailable: null, blocked: false };
			}
			if (raw.status >= 400 && raw.status < 500) return { rules: ALLOW_ALL, unavailable: null, blocked: false };
			return unavailable(`HTTP ${raw.status}`);
		}
	}

	function robotsFor(origin: string): Promise<RobotsOutcome> {
		let outcome = robotsByOrigin.get(origin);
		if (!outcome) {
			outcome = resolveRobots(origin);
			robotsByOrigin.set(origin, outcome);
		}
		return outcome;
	}

	async function get(url: string): Promise<FetchResult> {
		if (!URL.canParse(url)) return { ok: false, reason: 'network-error', url, status: null };
		let current = new URL(url);
		current.hash = '';
		bump(counts.pageGets, current.host);

		for (let redirects = 0; ; redirects++) {
			if (current.protocol !== 'http:' && current.protocol !== 'https:') {
				return { ok: false, reason: 'network-error', url: current.href, status: null };
			}
			if (isHostBlocked(current.host)) {
				return { ok: false, reason: 'host-blocked', url: current.href, status: null };
			}
			if (!isExempt(current)) {
				const { rules, blocked } = await robotsFor(current.origin);
				if (blocked) return { ok: false, reason: 'host-blocked', url: current.href, status: null };
				if (!rules.isAllowed(current.pathname + current.search)) {
					return { ok: false, reason: 'robots-disallowed', url: current.href, status: null };
				}
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
				counts.redirectHops++;
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

	const stats = (): FetchStats => ({
		robotsRequests: counts.robotsRequests,
		pageGets: { ...counts.pageGets },
		rawRequests: { ...counts.rawRequests },
		redirectHops: counts.redirectHops,
		robotsUnavailable: { ...counts.robotsUnavailable },
	});

	return { get, stats };
}
