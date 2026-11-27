import type { SecurityNeedCriterion, SecurityNeedLevel } from '@app/module/client';
import type { DurationUnit } from './primary-asset-fields-utils';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { formatNumber } from '../../utils';
import { splitDuration } from './primary-asset-fields-utils';

export const securityNeedLabel = (level: SecurityNeedLevel): string => {
  switch (level) {
    case 'not_applicable': return t`Not applicable`;
    case 'low': return t`Low`;
    case 'medium': return t`Medium`;
    case 'high': return t`High`;
    case 'very_high': return t`Very High`;
  }
};

export const securityCriterionLabel = (criterion: SecurityNeedCriterion): string => {
  switch (criterion) {
    case 'availability': return t`Availability`;
    case 'integrity': return t`Integrity`;
    case 'confidentiality': return t`Confidentiality`;
    case 'traceability': return t`Traceability`;
  }
};

export const durationUnitLabel = (unit: DurationUnit): string => {
  switch (unit) {
    case 'minutes': return t`minutes`;
    case 'hours': return t`hours`;
    case 'days': return t`days`;
  }
};

/** `4 h`, `1 d`: in the largest unit the minutes divide into evenly, as `splitDuration` picks it. */
export const formatDuration = (minutes: number): string => {
  const { amount, unit } = splitDuration(minutes);
  const value = formatNumber(amount ?? 0);
  switch (unit) {
    case 'minutes': return i18n._({ id: '{value} min', message: '{value} min', values: { value } });
    case 'hours': return i18n._({ id: '{value} h', message: '{value} h', values: { value } });
    case 'days': return i18n._({ id: '{value} d', message: '{value} d', values: { value } });
  }
};
