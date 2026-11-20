import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertOutcomeCounterModelPresent, OUTCOME_COUNTER_MODEL_FILES } from './model-files';

describe('assertOutcomeCounterModelPresent', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-model-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts the model shipped with the code', () => {
    expect(() => assertOutcomeCounterModelPresent()).not.toThrow();
  });

  it('names the files a directory lacks', () => {
    fs.writeFileSync(path.join(dir, OUTCOME_COUNTER_MODEL_FILES[0]), '{}');

    expect(() => assertOutcomeCounterModelPresent(dir)).toThrow('The outcome counter model is missing from the build');
    expect(() => assertOutcomeCounterModelPresent(dir)).toThrow(/calibration\.json.*known-groups\.json/);
  });
});
