/* eslint-disable no-console */
import * as esbuild from 'esbuild';
import { buildModeOptions, bundlingOptions, runtimeDependencies } from './esbuild-config';
import { CleanupPlugin } from './esbuild-plugins/cleanup-plugin';
import { AssetsPlugin } from './esbuild-plugins/assets-plugin';
import { LogPlugin } from './esbuild-plugins/log-plugin';
import { PackagePlugin } from './esbuild-plugins/package-plugin';
import { RunPlugin } from './esbuild-plugins/run-plugin';

const start = process.argv.includes('--start');
const watch = process.argv.includes('--watch');
const development = process.argv.includes('--development');

const context = await esbuild.context({
  ...bundlingOptions,
  outdir: 'dist',
  logLevel: 'info',
  ...buildModeOptions(development),
  sourcemap: true,
  plugins: [
    ...bundlingOptions.plugins ?? [],
    LogPlugin,
    CleanupPlugin,
    AssetsPlugin,
    PackagePlugin(runtimeDependencies),
    ...start ? [RunPlugin] : [],
  ],
});

try {
  if (watch) {
    await context.watch();
  } else {
    await context.rebuild();
    await context.dispose();
  }
} catch (error) {
  console.error(error);
  process.exit(1);
}
