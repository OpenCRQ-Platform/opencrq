import { plural, t } from '@lingui/core/macro';
import type { OnboardingStepKey } from './onboarding-steps';
import type { StepProgressCount, StepSyncSource } from './onboarding-utils';

export const threatsCountLabel = (count: number): string => plural(count, { one: '# threat', other: '# threats' });

export const assetsCountLabel = (count: number): string => plural(count, { one: '# asset', other: '# assets' });

export const threatsTotalLabel = (count: number): string => plural(count, { one: '# threat in this tenant', other: '# threats in this tenant' });

export const assetsTotalLabel = (count: number): string => plural(count, { one: '# asset in this tenant', other: '# assets in this tenant' });

/** A source's items worded with their unit: Defender delivers assets, the other sources threats. */
export const sourceCountLabel = (source: StepSyncSource, count: number): string =>
  source === 'microsoft_graph' ? assetsCountLabel(count) : threatsCountLabel(count);

export const capabilitiesByHandLabel = (count: number): string => plural(count, { one: '# capability assessed by hand', other: '# capabilities assessed by hand' });

export const capabilitiesAssessedTotalLabel = (assessed: number, total: number): string =>
  plural(total, { one: `${assessed} of # capability assessed`, other: `${assessed} of # capabilities assessed` });

export const assessedOfLabel = (assessed: number, total: number): string => t`${assessed} of ${total} assessed`;

export const answeredOfLabel = (answeredCount: number, totalCount: number): string => t`${answeredCount} of ${totalCount} answered`;

export const declaredKindsOfLabel = (declared: number, total: number): string => t`${declared} of ${total} kinds declared`;

/** What is left of a started step, worded as its own page does; null for a step that has no progress to show. */
export const stepProgressCaption = (key: OnboardingStepKey, { done, total }: StepProgressCount): string | null => {
  if (key === 'finances') {
    return answeredOfLabel(done, total);
  }
  if (key === 'defenses') {
    return assessedOfLabel(done, total);
  }
  return key === 'assets' ? declaredKindsOfLabel(done, total) : null;
};

/** The started step's state for a reader who cannot see its ring. */
export const startedProgressLabel = ({ done, total }: StepProgressCount): string => t`Started, ${done} of ${total}`;
