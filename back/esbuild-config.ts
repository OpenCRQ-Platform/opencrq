import type { BuildOptions } from 'esbuild';
import { EsmPlugin } from './esbuild-plugins/esm-plugin';

export const nativeModules = ['@pyroscope/nodejs'];

// OpenTelemetry patches a library through the module specifier the loader resolves, so a copy
// inlined by the bundler is never seen and its instrumentation silently produces nothing.
export const instrumentedModules = ['pg', 'winston', 'pino', '@grpc/grpc-js', '@smithy/core'];

// Loaded by a bundled package through `createRequire(import.meta.url)`, a call esbuild does not
// follow: the specifier survives into dist/ and resolves only against the production node_modules.
export const createRequiredModules = ['forwarded-parse', 'winston-transport'];

// Installed in the production image, which ships only `dist/package.json`'s dependencies.
export const runtimeDependencies = [...nativeModules, ...instrumentedModules, ...createRequiredModules];

export const entryPoints = [
  'src/index.ts',
  'src/index-http.ts',
  'src/index-worker.ts',
  'src/index-pm.ts',
  'src/tracing.ts',
];

// Everything deciding how the entry points split into separate programs, shared with the test
// asserting that split: reconstructing these options there would guard nothing about this build.
export const bundlingOptions: BuildOptions = {
  entryPoints,
  bundle: true,
  target: 'es2024',
  external: [...runtimeDependencies, 'pg-native'],
  keepNames: true,
  plugins: [EsmPlugin],
};

// What separates a development build from a production one, shared with the test asserting what a
// production build leaves out. The constant is defined in both: left undefined in production, the
// code reading it would survive as a runtime lookup instead of folding away with its branch.
export const buildModeOptions = (development: boolean): BuildOptions => ({
  minify: !development,
  lineLimit: development ? undefined : 160,
  define: { __DEVELOPMENT_BUILD__: String(development) },
});
