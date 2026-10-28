import { describe, expect, it } from 'vitest';
import { haversineKm } from '../shared/geo.ts';

describe('haversineKm', () => {
	it('is zero for the same point', () => {
		expect(haversineKm(48.1374, 11.5755, 48.1374, 11.5755)).toBe(0);
	});

	it('is symmetric', () => {
		expect(haversineKm(48.1374, 11.5755, 49.4521, 11.0767)).toBeCloseTo(haversineKm(49.4521, 11.0767, 48.1374, 11.5755), 9);
	});

	it('gives about 151 km from München to Nürnberg', () => {
		expect(Math.abs(haversineKm(48.1374, 11.5755, 49.4521, 11.0767) - 151)).toBeLessThanOrEqual(2);
	});

	it('gives about 111.2 km per degree of latitude', () => {
		expect(haversineKm(48, 11, 49, 11)).toBeCloseTo(111.19, 1);
	});
});
