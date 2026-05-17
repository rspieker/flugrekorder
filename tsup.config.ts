import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['source/flugrekorder.ts'],
	format: ['cjs', 'esm', 'iife'],
	dts: true,
	clean: true,
	sourcemap: true,
	globalName: 'Flugrekorder',
});
