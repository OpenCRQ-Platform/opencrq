import { defineConfig } from 'eslint/config';

/**
 * Engine encapsulation boundary. An engine may only be consumed through its
 * barrel (e.g. `../engines/db`), which exposes a single `use<Engine>()` hook.
 * Deep imports into engine internals (`../engines/db/db-engine`,
 * `../engines/job-runtime/execution-loop`, …) are forbidden — they bypass the
 * use<Engine>() gateway that both returns the API and marks the engine started.
 * Intra-engine imports use relative `./` paths and are unaffected.
 */
const enginePatterns = [
  {
    group: ['**/engines/*/*', '**/engines/*/*/**'],
    message: 'Import engines only through their barrel (e.g. "../engines/db"), which exposes use<Engine>(). Deep imports into engine internals are forbidden.',
  },
  {
    group: ['**/clients/*/*', '**/clients/*/*/**'],
    message: 'Import clients only through their barrel (e.g. "../clients/file-storage"). Deep imports into client internals are forbidden.',
  },
];

// `regex` is used instead of `group` because negating a nested path like ./boot/boot with
// gitignore-style globs also re-includes the bare ./boot directory.
const entryPointPattern = {
  regex: '^\\.(?!/features(/|$))(?!/boot/boot$)',
  message: 'Entry point files may only use relative imports from ./features or ./boot/boot.',
};

// esbuild bundles tracing.ts as both its own entry point and inlined into index-pm.mjs, so any
// other importer silently duplicates the OpenTelemetry SDK and its NodeSDK.start() call.
const tracingPattern = {
  regex: '(^|/)tracing$',
  message: 'Only index-pm.ts may import tracing.ts — any other importer silently duplicates the OpenTelemetry SDK and starts it twice.',
};

const entryPoints = ['src/index.ts', 'src/index-http.ts', 'src/index-worker.ts'];

// Each block below targets a mutually exclusive set of files and lists every pattern that
// applies to it: when several blocks match the same file, ESLint replaces (not merges) a
// rule's options, so a shared pattern must be repeated rather than relied upon from another block.
export default defineConfig([
  {
    files: entryPoints,
    rules: {
      'no-restricted-imports': ['error', { patterns: [...enginePatterns, entryPointPattern, tracingPattern] }],
    },
  },
  {
    files: ['src/index-pm.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: enginePatterns }],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [...entryPoints, 'src/index-pm.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...enginePatterns, tracingPattern] }],
    },
  },
]);
