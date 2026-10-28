import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { OPT_OUT_URL } from '../web/src/about-page.tsx';

const TEMPLATE_DIR = '../.github/ISSUE_TEMPLATE/';

interface FormField {
	type: string;
	id?: string;
	validations?: { required?: boolean };
}

interface IssueForm {
	name: string;
	description: string;
	title: string;
	labels?: unknown;
	body: FormField[];
}

describe('opt-out issue form', () => {
	const templateName = new URL(OPT_OUT_URL).searchParams.get('template');

	it('is the template the About page links to', () => {
		expect(OPT_OUT_URL.startsWith('https://github.com/esiak/testplatz/issues/new?')).toBe(true);
		expect(templateName).toBe('opt-out-request.yml');
	});

	const form = parseYaml(readFileSync(fileURLToPath(new URL(`${TEMPLATE_DIR}${templateName}`, import.meta.url)), 'utf8')) as IssueForm;

	it('has the name, a description and the title prefix, and no labels', () => {
		expect(form.name).toBe('Opt-out request');
		expect(form.description).toEqual(expect.any(String));
		expect(form.description.length).toBeGreaterThan(0);
		expect(form.title).toBe('Opt-out request: ');
		expect(form).not.toHaveProperty('labels');
	});

	it('asks for centre name, website and contact, all required', () => {
		const inputs = form.body.filter((field) => field.type === 'input');
		for (const id of ['centre_name', 'website', 'contact']) {
			const field = inputs.find((f) => f.id === id);
			expect(field, id).toBeDefined();
			expect(field!.validations?.required, id).toBe(true);
		}
	});
});
