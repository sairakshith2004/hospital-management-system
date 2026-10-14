import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**']),
  js.configs.recommended,
  tseslint.configs.recommended,
  { files: ['apps/api/**/*.ts', 'packages/**/*.ts'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser } },
  prettier,
);
