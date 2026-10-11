/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Relative base + hash routing lets the site work from any GitHub Pages path.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
