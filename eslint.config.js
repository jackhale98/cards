import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

/**
 * Lint: catches bugs the type checker doesn't (unused results, accidental fallthrough, unsafe
 * comparisons…). Formatting is Prettier's job (`pnpm format`), so no style rules here.
 */
export default ts.config(
  { ignores: ['dist', 'node_modules', 'relay', 'test-results', 'playwright-report', '.claude'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  {
    rules: {
      // (the type checker already reports these, with noUnusedLocals/noUnusedParameters)
      '@typescript-eslint/no-unused-vars': 'off',
      // game state is plain JSON shared across many shapes; `any` is used deliberately at the edges
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
