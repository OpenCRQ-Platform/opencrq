import type { PluginBuild } from 'esbuild';
import { loadOutcomeCounter, OUTCOME_COUNTER_MODEL_FILES } from '@app/module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetsPlugin } from './assets-plugin';

describe('AssetsPlugin', () => {
  let outdir: string;

  beforeEach(() => {
    outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-plugin-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    fs.rmSync(outdir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const runBuild = (errors: Array<unknown>) => {
    let onEnd: ((result: { errors: Array<unknown> }) => void) | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the plugin reads `initialOptions.outdir` and registers `onEnd`, nothing else of the build
    const build = {
      initialOptions: { outdir },
      onEnd: (callback: typeof onEnd) => {
        onEnd = callback;
      },
    } as unknown as PluginBuild;
    void AssetsPlugin.setup(build);
    onEnd?.({ errors });
  };

  it('copies the outcome counter model next to the bundle, where the counter loads it from', () => {
    runBuild([]);

    const modelDir = path.join(outdir, 'outcome-counter-model');
    expect(OUTCOME_COUNTER_MODEL_FILES.filter((file) => fs.existsSync(path.join(modelDir, file)))).toEqual([...OUTCOME_COUNTER_MODEL_FILES]);
    expect(() => loadOutcomeCounter(modelDir)).not.toThrow();
  });

  it('copies nothing from a build that failed', () => {
    runBuild([new Error('compile error')]);

    expect(fs.readdirSync(outdir)).toEqual([]);
  });
});
