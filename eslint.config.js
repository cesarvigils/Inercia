// ESLint flat config (ESLint 9+). Kept intentionally small: this project has
// no build-time type checking and no test coverage for most of the frontend,
// so catching unused variables/functions, undefined globals, and obvious
// correctness slips here is cheap insurance. Run with `npm run lint`.
import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'public/**',
      'tests/**/*.output',
    ],
  },

  js.configs.recommended,

  // vite.config.js: Vite loads/bundles this file itself before running it,
  // which is why __dirname works here in practice despite "type": "module"
  // in package.json — this is Vite's own config-loading behavior, not a
  // runtime bug in the app.
  {
    files: ['vite.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { __dirname: 'readonly', __filename: 'readonly' },
    },
  },

  // Server-side: Vercel serverless functions + Node scripts.
  {
    files: ['api/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
    },
  },

  // Browser-side frontend scripts (not linted for unused-vars as strictly,
  // since several are loaded as plain <script> tags and intentionally
  // define globals other inline scripts rely on).
  {
    files: ['js/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        crypto: 'readonly',
        FormData: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        Intl: 'readonly',
        HTMLElement: 'readonly',
        Option: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        queueMicrotask: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
