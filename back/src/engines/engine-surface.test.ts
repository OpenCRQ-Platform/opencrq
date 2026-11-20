import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// An engine's only public surface is the <engine>Engine object returned by
// registerEngine(). Its barrel must therefore re-export exactly that object and
// nothing else — no `export *` (which would leak any internal export) and no
// extra named exports. Combined with the no-restricted-imports rule (see
// local.eslint.config.ts) that forbids deep imports, the barrel is the engine's
// whole public API. This test is the guard against that surface widening.
const here = dirname(fileURLToPath(import.meta.url));

describe('engine barrels expose only their <engine>Engine object', () => {
  it.each([
    { engine: 'db', surface: 'dbEngine' },
    { engine: 'filigran-telemetry', surface: 'filigranTelemetryEngine' },
    { engine: 'http-server', surface: 'httpServerEngine' },
    { engine: 'job-runtime', surface: 'jobRuntimeEngine' },
  ])('$engine re-exports only $surface', ({ engine, surface }) => {
    const source = readFileSync(join(here, engine, 'index.ts'), 'utf8');
    const exportLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('export'));
    expect(exportLines).toEqual([`export { ${surface} } from './${engine}-engine';`]);
  });
});
