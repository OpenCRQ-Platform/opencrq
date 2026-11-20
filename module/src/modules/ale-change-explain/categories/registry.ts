import type { ChangeCategory } from '../types';
import { criticalAssetsCategory, highAssetsCategory, otherAssetsCategory } from './asset-posture';
import { controlsCategory } from './controls';
import { attackFrequencyCategory } from './attack-frequency';
import { criticalFindingsCategory, highFindingsCategory, otherFindingsCategory } from './findings';
import { modelCategory } from './model';
import { runResultsCategory } from './run-results';
import { techniqueCoverageCategory } from './technique-coverage';

/** In the order the tiles show. A category belongs here once its input keeps a past. */
export const CHANGE_CATEGORIES: ReadonlyArray<ChangeCategory> = [
  controlsCategory,
  criticalFindingsCategory,
  highFindingsCategory,
  otherFindingsCategory,
  criticalAssetsCategory,
  highAssetsCategory,
  otherAssetsCategory,
  attackFrequencyCategory,
  runResultsCategory,
  techniqueCoverageCategory,
  modelCategory,
];
