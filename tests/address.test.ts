import { describe, expect, it } from 'vitest';
import { normaliseAddress, parseAddress } from '../shared/address.ts';

describe('normaliseAddress', () => {
	it.each<[string, string]>([
		['Löwenstraße 15, 96450 Coburg', 'Löwenstr. 15, 96450 Coburg'],
		['Löwenstrasse 15, 96450 Coburg', 'Löwenstr. 15, 96450 Coburg'],
		['LÖWENSTRASSE 15 ,96450  Coburg', 'löwenstr.15, 96450 coburg'],
		['  Hauptstraße 1,   80331 München ', 'Hauptstr 1, 80331 München'],
		['Straße der Einheit 3, 90402 Nürnberg', 'Str. der Einheit 3, 90402 Nürnberg'],
	])('%s and %s get the same key', (a, b) => {
		expect(normaliseAddress(a)).toBe(normaliseAddress(b));
	});

	it('produces a lowercase key with single spaces and ", " around commas', () => {
		expect(normaliseAddress('Jahnstraße  10 ,82211   Herrsching')).toBe('jahnstr 10, 82211 herrsching');
	});

	it('keeps different addresses apart', () => {
		expect(normaliseAddress('Jahnstraße 10, 82211 Herrsching')).not.toBe(normaliseAddress('Jahnstraße 12, 82211 Herrsching'));
	});
});

describe('parseAddress', () => {
	it('splits a street, NNNNN city address', () => {
		expect(parseAddress('Jahnstraße 10, 82211 Herrsching')).toEqual({ street: 'Jahnstraße 10', postcode: '82211', city: 'Herrsching' });
		expect(parseAddress('  Am  Markt 1 ,  92224  Amberg (Opf.) ')).toEqual({ street: 'Am Markt 1', postcode: '92224', city: 'Amberg (Opf.)' });
	});

	it.each([
		'Raum 2, Hauptstr. 1, 80331 München',
		'Hauptstr. 1 80331 München',
		'Hauptstr. 1, München',
		'Hauptstr. 1, 8033 München',
		', 80331 München',
		'Hauptstr. 1, 80331',
	])('returns null for %j', (text) => {
		expect(parseAddress(text)).toBeNull();
	});
});
