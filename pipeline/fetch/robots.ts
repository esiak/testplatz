/** robots.txt parsing and matching (RFC 9309 subset: groups, Allow/Disallow, `*` and `$`). */

export const BOT_TOKEN = 'bgtsearch-bot';

interface Rule {
	allow: boolean;
	pattern: string;
	regex: RegExp;
}

export interface RobotsRules {
	/** True when `pathAndQuery` (e.g. `/kurse?x=1`) may be requested. */
	isAllowed(pathAndQuery: string): boolean;
}

export const ALLOW_ALL: RobotsRules = { isAllowed: () => true };
export const DISALLOW_ALL: RobotsRules = { isAllowed: () => false };

function toRegex(pattern: string): RegExp {
	const anchored = pattern.endsWith('$');
	const body = anchored ? pattern.slice(0, -1) : pattern;
	const source = body
		.split('*')
		.map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
		.join('.*');
	return new RegExp(`^${source}${anchored ? '$' : ''}`);
}

interface Group {
	agents: string[];
	rules: Rule[];
}

/** Parses robots.txt and returns the rules that apply to `token` (its own groups win over `*`). */
export function parseRobots(text: string, token: string = BOT_TOKEN): RobotsRules {
	const groups: Group[] = [];
	let current: Group | null = null;
	let lastWasAgent = false;

	for (const rawLine of text.split(/\r\n|\r|\n/)) {
		const line = rawLine.replace(/#.*$/, '').trim();
		const colon = line.indexOf(':');
		if (colon < 0) continue;
		const key = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();

		if (key === 'user-agent') {
			if (!lastWasAgent || current === null) {
				current = { agents: [], rules: [] };
				groups.push(current);
			}
			current.agents.push(value.toLowerCase());
			lastWasAgent = true;
			continue;
		}
		lastWasAgent = false;
		if ((key === 'allow' || key === 'disallow') && current !== null) {
			// An empty Disallow allows everything; it adds no rule.
			if (value === '') continue;
			current.rules.push({ allow: key === 'allow', pattern: value, regex: toRegex(value) });
		}
	}

	const lower = token.toLowerCase();
	const own = groups.filter((g) => g.agents.includes(lower));
	const chosen = own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'));
	const rules = chosen.flatMap((g) => g.rules);

	return {
		isAllowed(pathAndQuery: string): boolean {
			let best: Rule | null = null;
			for (const rule of rules) {
				if (!rule.regex.test(pathAndQuery)) continue;
				if (
					best === null ||
					rule.pattern.length > best.pattern.length ||
					(rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
				) {
					best = rule;
				}
			}
			return best === null || best.allow;
		},
	};
}
