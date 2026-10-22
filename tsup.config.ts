import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['source/flugrekorder.ts'],
	format: ['cjs', 'esm', 'iife'],
	target: 'node22',
	dts: true,
	clean: true,
	sourcemap: true,
	globalName: 'Flugrekorder',
});
