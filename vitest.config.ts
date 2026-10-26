import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: that config roots Vite in web/, which would
// hide the tests under tests/, pipeline/ and shared/.
export default defineConfig({
	root: fileURLToPath(new URL('.', import.meta.url)),
	test: {
		environment: 'node',
		include: ['**/*.test.{ts,tsx}'],
		// An explicit `exclude` replaces Vitest's defaults, so spread them back in.
		exclude: [...configDefaults.exclude, 'dist/**', '_bmad/**', '.claude/**'],
	},
});
