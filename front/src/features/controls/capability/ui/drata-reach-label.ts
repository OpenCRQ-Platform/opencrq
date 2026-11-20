import { t } from '@lingui/core/macro';
import type { DrataEvidencePair } from '@app/module/client';

type DrataEvidenceReach = NonNullable<DrataEvidencePair['reach']>;

/** Kept apart from the coverage buckets' words: a slice pair can be one of many that cover everything. */
export const drataReachLabel = (reach: DrataEvidenceReach): string => (reach === 'org_wide' ? t`Org-wide` : t`Subset`);
