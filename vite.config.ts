import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const fromRoot = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	root: fromRoot('./web'),
	base: '/testplatz/',
	plugins: [preact()],
	build: {
		outDir: fromRoot('./dist'),
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: fromRoot('./web/index.html'),
				about: fromRoot('./web/about/index.html'),
			},
		},
	},
});
