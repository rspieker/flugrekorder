import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['source/flugrekorder.ts'],
	format: ['esm', 'iife'],
	target: 'node22',
	// no declaration map: it would point at source/, which is not published
	dts: { sourcemap: false },
	sourcemap: true,
	globalName: 'Flugrekorder',
	// keep the 1.x file names: flugrekorder.js, flugrekorder.d.ts, flugrekorder.global.js
	fixedExtension: false,
	outputOptions: (options, format) =>
		format === 'iife'
			? { ...options, entryFileNames: '[name].global.js' }
			: options,
});
