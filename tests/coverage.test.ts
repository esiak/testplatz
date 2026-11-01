import { describe, expect, it } from 'vitest';
import { buildCoverage, classifyCentre, COVERAGE_CATEGORIES, formatCoverageLine, type CoverageCentre, type CoverageOutcome } from '../shared/coverage.ts';

const centre = (id: string, extra: Partial<CoverageCentre> = {}): CoverageCentre => ({
	centre_id: id,
	reader: 'kuferweb',
	test_page_url: `https://${id}.example.de/test`,
	opted_out: false,
	...extra,
});
const none = (id: string, extra: Partial<CoverageCentre> = {}): CoverageCentre => centre(id, { reader: 'none', ...extra });

const ok = (count: number): CoverageOutcome => ({ kind: 'ok', listings: Array.from({ length: count }, () => ({})) });
const failed = (reason: string): CoverageOutcome => ({ kind: 'failed', reason });
const skipped = (reason: string): CoverageOutcome => ({ kind: 'skipped', reason });

describe('classifyCentre: the I/O matrix (Story 4.1)', () => {
	it.each([
		['ok with dates', centre('a'), ok(2), 'parsed', null],
		['ok, none listed', centre('a'), ok(0), 'parsed-empty', null],
		['structure missing', centre('a'), failed('structure-missing'), 'failed', 'structure-missing'],
		['detail page', centre('a'), failed('detail-page'), 'failed', 'detail-page'],
		['date unparseable', centre('a'), failed('date-unparseable'), 'failed', 'date-unparseable'],
		['schema (normalise)', centre('a'), failed('schema'), 'failed', 'schema'],
		['reader error', centre('a'), failed('reader-error'), 'failed', 'reader-error'],
		['list page unreachable', centre('a'), failed('list-page'), 'unreachable', null],
		['no reader, has test page', none('a'), skipped('no-reader'), 'no-reader', null],
		['no reader, no test page', none('a', { test_page_url: null }), skipped('no-reader'), 'no-test-page', null],
		['no reader, no outcome', none('a'), undefined, 'no-reader', null],
		['PDF only', none('a', { pdf_only: true }), skipped('no-reader'), 'pdf-only', null],
		['PDF only without a test page', none('a', { pdf_only: true, test_page_url: null }), skipped('no-reader'), 'pdf-only', null],
		['opted out', centre('a', { opted_out: true }), skipped('opted-out'), 'opted-out', null],
		['opted out wins over pdf-only', none('a', { opted_out: true, pdf_only: true }), skipped('opted-out'), 'opted-out', null],
		['opted out without an outcome', none('a', { opted_out: true, test_page_url: null }), undefined, 'opted-out', null],
		['robots', centre('a'), skipped('robots'), 'robots', null],
		['budget', centre('a'), skipped('budget'), 'budget', null],
		['reader set, no outcome (replay)', centre('a'), undefined, 'failed', 'not-run'],
		['reader set but unregistered', centre('a'), skipped('no-reader'), 'no-reader', null],
		['skipped with an unknown reason', centre('a'), skipped('mystery'), 'failed', 'mystery'],
	] as const)('%s', (_, c, outcome, category, reason) => {
		expect(classifyCentre(c, outcome)).toEqual({ category, reason });
	});
});

describe('buildCoverage', () => {
	const directory = [
		centre('p1'),
		centre('p2', { reader: 'itemkg' }),
		centre('e1'),
		centre('f1', { reader: 'itemkg' }),
		centre('f2'),
		centre('u1'),
		none('n1'),
		none('t1', { test_page_url: null }),
		none('pdf', { pdf_only: true }),
		centre('r1'),
		centre('o1', { opted_out: true }),
		centre('b1', { reader: 'itemkg' }),
		centre('nr'),
	];
	const outcomes: Record<string, CoverageOutcome> = {
		p1: ok(3),
		p2: ok(1),
		e1: ok(0),
		f1: failed('structure-missing'),
		f2: failed('date-unparseable'),
		u1: failed('list-page'),
		n1: skipped('no-reader'),
		t1: skipped('no-reader'),
		pdf: skipped('no-reader'),
		r1: skipped('robots'),
		o1: skipped('opted-out'),
		b1: skipped('budget'),
		gone: ok(5),
	};
	const coverage = buildCoverage(directory, outcomes);

	it('puts every directory centre into exactly one category, all ten keys in order', () => {
		expect(Object.keys(coverage.by_category)).toEqual([...COVERAGE_CATEGORIES]);
		expect(coverage.by_category).toEqual({
			parsed: 2,
			'parsed-empty': 1,
			failed: 3,
			'no-reader': 1,
			unreachable: 1,
			'no-test-page': 1,
			'pdf-only': 1,
			robots: 1,
			'opted-out': 1,
			budget: 1,
		});
		expect(Object.values(coverage.by_category).reduce((sum, n) => sum + n, 0)).toBe(directory.length);
	});

	it('counts failed reasons, sorted by reason, unreachable not among them', () => {
		expect(coverage.by_reason).toEqual({ 'date-unparseable': 1, 'not-run': 1, 'structure-missing': 1 });
		expect(Object.keys(coverage.by_reason)).toEqual(['date-unparseable', 'not-run', 'structure-missing']);
	});

	it('reports per reader, none excluded, skipped = robots + budget + opted-out', () => {
		expect(coverage.by_reader).toEqual({
			itemkg: { assigned: 3, parsed: 1, 'parsed-empty': 0, failed: 1, unreachable: 0, skipped: 1 },
			kuferweb: { assigned: 7, parsed: 1, 'parsed-empty': 1, failed: 2, unreachable: 1, skipped: 2 },
		});
		expect(Object.keys(coverage.by_reader)).toEqual(['itemkg', 'kuferweb']);
	});

	it('computes coverage = (parsed + parsed-empty) / (parsed + parsed-empty + failed + no-reader), one decimal', () => {
		expect(coverage.coverage).toEqual({ numerator: 3, denominator: 7, percent: 42.9 });
	});

	it('has a null percent when the denominator is 0', () => {
		const empty = buildCoverage([none('t', { test_page_url: null }), centre('b')], { b: skipped('budget') });
		expect(empty.coverage).toEqual({ percent: null, numerator: 0, denominator: 0 });
		expect(buildCoverage([], {}).coverage.percent).toBeNull();
	});
});

describe('formatCoverageLine', () => {
	it('lists the coverage then every category in order', () => {
		const coverage = buildCoverage([centre('a'), centre('b'), none('c')], { a: ok(1), b: failed('schema'), c: skipped('no-reader') });
		expect(formatCoverageLine(coverage)).toBe(
			'coverage 1/3 (33.3%): parsed 1, parsed-empty 0, failed 1, no-reader 1, unreachable 0, no-test-page 0, pdf-only 0, robots 0, opted-out 0, budget 0',
		);
	});

	it('shows - for the percent when the denominator is 0', () => {
		expect(formatCoverageLine(buildCoverage([centre('a', { opted_out: true })], {}))).toBe(
			'coverage 0/0 (-): parsed 0, parsed-empty 0, failed 0, no-reader 0, unreachable 0, no-test-page 0, pdf-only 0, robots 0, opted-out 1, budget 0',
		);
	});
});
