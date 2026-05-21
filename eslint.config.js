// @ts-check
// ESLint v9 flat config — lints src/ and electron/ TypeScript.
// Run via `npm run lint`.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Ignore generated / vendored files
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      'electron/preload.cjs', // hand-maintained CJS twin of preload.ts
      'resources/**',
      'scripts/**', // CommonJS Node scripts; lint separately if needed
    ],
  },

  // Base recommended JS rules
  js.configs.recommended,

  // TypeScript recommended rules (type-aware checks intentionally skipped
  // to keep lint fast and runnable without a typecheck pass).
  ...tseslint.configs.recommended,

  // Project rules for src/ and electron/
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Allow `_unused` parameters / vars (used throughout the codebase to
      // mark intentionally-unused IPC event args).
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // `any` is occasionally needed for IPC payloads from preload — warn
      // rather than error so PRs can land while we tighten types.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Tests and inline error handlers commonly use empty blocks; allow
      // empty catch clauses but warn elsewhere.
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // Console output is the app's primary diagnostics channel; do not block.
      'no-console': 'off',
    },
  },

  // Renderer-only files (src/) — assume browser globals
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Main process files (electron/) — assume Node globals
  {
    files: ['electron/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Test files — vitest globals on demand, relaxed rules
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
