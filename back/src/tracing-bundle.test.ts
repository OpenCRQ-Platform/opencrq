import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlingOptions, runtimeDependencies } from '../esbuild-config';

// A string only tracing.ts emits, so its presence in a bundle means that bundle carries a copy of
// the telemetry bootstrap.
const BOOTSTRAP_SENTINEL = 'Starting OpenTelemetry SDK...';

// One string per instrumented package, found nowhere else in node_modules, so its presence in a
// bundle means that bundle inlined the package instead of leaving it resolvable by the loader.
const INSTRUMENTED_PACKAGE_SENTINELS = {
  pg: 'Release called on client which has already been released to the pool.',
  winston: 'not defined: conflicts with the method',
  pino: 'prettyPrint option is no longer supported, see the pino-pretty package',
  '@grpc/grpc-js': 'No address added out of total',
  '@smithy/core': 'Waiter has timed out',
};

// instrumentation-winston loads it inside a try only to add the transport `utils/logger.ts` already
// adds, and installing it would bring a second, unregistered `@opentelemetry/api` with it.
const UNRESOLVED_ON_PURPOSE = ['@opentelemetry/winston-transport'];

const ENTRY_BUNDLES = ['index-http.mjs', 'index-worker.mjs', 'index.mjs', 'index-pm.mjs', 'tracing.mjs'];

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

const packageNameOf = (specifier: string): string =>
  specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

// The packages a bundle loads through a `createRequire(import.meta.url)` binding, builtins left out.
const createRequiredPackages = (bundle: string): Array<string> => {
  const bindings = [...bundle.matchAll(/([\w$]+)\s*=\s*(?:\/\*[^*]*\*\/\s*)?(?:\(\(\)\s*=>\s*)?[\w$]+\(import\.meta\.url\)/g)]
    .map((m) => m[1]);
  const packages = bindings.flatMap((binding) =>
    [...bundle.matchAll(new RegExp(`(?<![\\w$.])${binding.replaceAll('$', '\\$')}\\(["'\`]([^"'\`]+)["'\`]\\)`, 'g'))]
      .map((m) => m[1])
      .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:') && !isBuiltin(specifier))
      .map(packageNameOf));
  return [...new Set(packages)].sort();
};

// Asserted on the emitted bundles, not on the source: every entry point is bundled whole with no
// splitting, so a module importing tracing.ts gets a second copy of it inlined into its own
// program — two NodeSDK.start(), no error. In-process the module registry dedupes that away.
describe('telemetry bootstrap isolation in the built output', () => {
  let outdir: string;
  const bundleOf = async (entry: string) => readFile(join(outdir, entry), 'utf8');

  beforeAll(async () => {
    outdir = await mkdtemp(join(tmpdir(), 'opencrq-bundle-'));
    await esbuild.build({
      ...bundlingOptions,
      absWorkingDir: workspaceRoot,
      outdir,
      minify: false,
      sourcemap: false,
      logLevel: 'silent',
    });
  }, 120_000);

  afterAll(async () => {
    await rm(outdir, { recursive: true, force: true });
  });

  it('emits the bootstrap in its own entry, which every child loads through --import', async () => {
    expect(await bundleOf('tracing.mjs')).toContain(BOOTSTRAP_SENTINEL);
  });

  it('inlines it into the process manager, the one program allowed to own the SDK directly', async () => {
    expect(await bundleOf('index-pm.mjs')).toContain(BOOTSTRAP_SENTINEL);
  });

  it.each(['index-http.mjs', 'index-worker.mjs', 'index.mjs'])('carries no second copy of it in %s', async (entry) => {
    expect(await bundleOf(entry)).not.toContain(BOOTSTRAP_SENTINEL);
  });

  // OpenTelemetry patches each of these packages through the module specifier the loader
  // resolves. Inlining one leaves its instrumentation nothing to intercept, so the corresponding
  // telemetry signal (spans, metrics, or log enrichment, depending on the package) is silently
  // never produced while every unit test — which fabricates the producer — stays green.
  it.each(Object.entries(INSTRUMENTED_PACKAGE_SENTINELS))('leaves %s resolvable by the loader in every entry, so it can still be instrumented', async (_pkg, sentinel) => {
    for (const entry of ENTRY_BUNDLES) {
      expect(await bundleOf(entry)).not.toContain(sentinel);
    }
  });

  // A package missing from the image fails at boot for an unconditional load and disables its
  // feature silently for one inside a try, while every test running against node_modules passes.
  it.each(ENTRY_BUNDLES)('loads through createRequire only packages the production image installs, in %s', async (entry) => {
    const missing = createRequiredPackages(await bundleOf(entry)).filter((pkg) => !runtimeDependencies.includes(pkg) && !UNRESOLVED_ON_PURPOSE.includes(pkg));
    expect(missing).toEqual([]);
  });
});

// Yarn merges into one entry every descriptor a single version satisfies, so entries are copies.
const lockEntryCount = (lock: string, mod: string): number =>
  lock
    .split('\n')
    .filter((line) => !line.startsWith(' ') && line.endsWith(':'))
    .filter((header) => header
      .slice(0, -1)
      .replaceAll('"', '')
      .split(', ')
      .some((descriptor) => descriptor.startsWith(`${mod}@`)))
    .length;

describe('single resolution point for the externalised packages', () => {
  const lock = readFileSync(join(workspaceRoot, '..', 'yarn.lock'), 'utf8');

  // Keeping a package external still inlines its dependents, so the surviving import is emitted in
  // dist/ and resolves from there, out of reach of any copy Yarn nested under a dependent to
  // satisfy a tighter range. A second copy is therefore one the bundle can never run.
  it.each(runtimeDependencies)('%s resolves to one version, which the whole bundle shares', (mod) => {
    expect(lockEntryCount(lock, mod)).toBe(1);
  });
});
