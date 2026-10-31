import { mdsvex } from 'mdsvex';
import mdsvexConfig from './mdsvex.config.js';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Known, intentional warnings in generated Markdown pages:
			// - mdsvex still emits <script context="module">
			// - code blocks are <pre tabindex="0"> so keyboard users can scroll them
			onwarn: (warning, handler) => {
				if (warning.code === 'a11y_no_noninteractive_tabindex') return;
				if (warning.code === 'script_context_deprecated') return;
				handler(warning);
			},

			// The guide is fully prerendered, so it deploys to any static host.
			adapter: adapter(),
			preprocess: [mdsvex(mdsvexConfig)],
			extensions: ['.svelte', '.svx', '.md']
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
