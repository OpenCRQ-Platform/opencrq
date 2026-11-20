import fs from 'node:fs';
import path from 'node:path';
import { newError } from '@app/utils';

/** Next to the source in development, copied next to the bundle by the build. */
export const OUTCOME_COUNTER_MODEL_DIR = path.join(__dirname, 'outcome-counter-model');

/** The files `loadOutcomeCounter` reads from the model directory. */
export const OUTCOME_COUNTER_MODEL_FILES = ['logistic.json', 'calibration.json', 'known-groups.json'] as const;

/**
 * Fails when a model file is missing, without reading any: the model is about 2 MB and stays loaded on
 * first use, so a build that left a file out would otherwise surface on every ingestion instead.
 */
export const assertOutcomeCounterModelPresent = (dir: string = OUTCOME_COUNTER_MODEL_DIR): void => {
  const missing = OUTCOME_COUNTER_MODEL_FILES.filter((file) => !fs.existsSync(path.join(dir, file)));
  if (missing.length > 0) {
    throw newError('The outcome counter model is missing from the build', { dir, missing });
  }
};
