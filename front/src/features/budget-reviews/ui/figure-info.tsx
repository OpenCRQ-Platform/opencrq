import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { BudgetLineNature } from '../budget-review-utils';
import { MetricInfo } from '../../../components/shared';
import { lineNatureLabel } from './review-chips';

export const bandCaveat = (): string => t`The p10 to p90 band adds up the scenarios' bands as if they moved together: it is wider than the truth.`;
const prudentHow = (): string => t`The prudent return makes the same computation with the loss avoided's p10.`;
const amortizedHow = (): string => t`The amortized return spreads each build line's spend over the years set on it, and reads the loss avoided against what the work costs a year.`;

export const NatureInfo: FunctionComponent<{ nature: BudgetLineNature }> = ({ nature }) => (nature === 'build'
  ? (
    <MetricInfo
      title={lineNatureLabel('build')}
      what={t`The annual loss the period's posture changes removed, across the build lines together.`}
      how={<>{t`Today's model is priced twice: with the build lines' controls set back to their posture at the fiscal year start, and as they stand at its end. The loss avoided is the difference, and the return is (loss avoided - spent) / spent.`} {prudentHow()} {amortizedHow()}</>}
      caveat={<>{t`Not the sum of the build lines: controls that cover the same techniques return less together than one by one.`} {bandCaveat()}</>}
    />
  )
  : (
    <MetricInfo
      title={lineNatureLabel('run')}
      what={t`The annual loss the controls kept running protect against, across the run lines together.`}
      how={<>{t`Today's model is priced with the run lines' controls absent, then at the level they held at the fiscal year start. The loss avoided is the difference, and the return is (loss avoided - spent) / spent.`} {prudentHow()}</>}
      caveat={<>{t`Not the sum of the run lines: removing controls together costs more than removing them one by one.`} {bandCaveat()}</>}
    />
  ));

export const OverallInfo: FunctionComponent = () => (
  <MetricInfo
    title={t`Overall`}
    what={t`The annual loss everything this review funds removed at once.`}
    how={<>{t`Today's model is priced with the run lines' controls absent and the build-only controls at their posture at the fiscal year start, against its end.`} {prudentHow()}</>}
    caveat={<>{t`Not the sum of build and run: it is priced as one basket, and controls overlap.`} {bandCaveat()}</>}
  />
);
