import type { DeclaredEstateBand, DeclaredEstateKind } from '@app/module/client';
import { DECLARED_ESTATE_KINDS } from '@app/module/client';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { DeclaredEstateAnswerShape, DeclaredEstateState } from './declared-estate-utils';
import { getAssetCategoryLabel } from '../../utils/asset-category-utils';
import { formatNumber } from '../../utils/format-number';
import { answerShapeOf } from './declared-estate-utils';

const declaredEstateSubcategoryLabel = (kind: DeclaredEstateKind): string | null => {
  switch (kind) {
    case 'workstations':
      return t`Workstations and laptops`;
    case 'servers':
      return t`Servers and virtual machines`;
    case 'people':
      return t`User accounts`;
    case 'service_accounts':
      return t`Service accounts`;
    case 'mobile_devices':
    case 'containers':
    case 'cloud_resources':
    case 'web_applications':
    case 'saas_applications':
    case 'ai_systems':
    case 'network_devices':
    case 'iot_ot_devices':
      return null;
  }
};

export interface DeclaredEstateKindNames {
  readonly category: string,
  readonly subcategory: string | null,
}

export const declaredEstateKindNames = (kind: DeclaredEstateKind): DeclaredEstateKindNames => ({
  category: getAssetCategoryLabel(DECLARED_ESTATE_KINDS[kind].category),
  subcategory: declaredEstateSubcategoryLabel(kind),
});

export const declaredEstateKindLabel = (kind: DeclaredEstateKind): string => {
  const { category, subcategory } = declaredEstateKindNames(kind);
  return subcategory === null ? category : t`${category} › ${subcategory}`;
};

const range = (low: number, high: number): string =>
  i18n._({ id: '{low} to {high}', message: '{low} to {high}', values: { low: formatNumber(low), high: formatNumber(high) } });

/** A sum of answers, which reads as a plain range even where it matches a band or no band at all. */
export const declaredEstateRangeLabel = (low: number, high: number): string => {
  if (high === 0) {
    return t`None`;
  }
  return low === high ? formatNumber(low) : range(low, high);
};

export const declaredEstateBandLabel = (band: DeclaredEstateBand): string => {
  switch (band) {
    case 'none':
      return t`None`;
    case '1_10':
      return range(1, 10);
    case '11_50':
      return range(11, 50);
    case '51_250':
      return range(51, 250);
    case '251_1000':
      return range(251, 1000);
    case '1001_5000':
      return range(1001, 5000);
    case 'over_5000':
      return i18n._({ id: 'More than {low}', message: 'More than {low}', values: { low: formatNumber(5000) } });
  }
};

export const declaredEstateAnswerLabel = (shape: DeclaredEstateAnswerShape): string => {
  switch (shape.type) {
    case 'none':
      return t`No answer`;
    case 'band':
      return declaredEstateBandLabel(shape.band);
    case 'exact':
      return formatNumber(shape.count);
    case 'range':
      return i18n._({ id: 'Between {low} and {high}', message: 'Between {low} and {high}', values: { low: formatNumber(shape.low), high: formatNumber(shape.high) } });
  }
};

/** An answer in one line, its exposure appended when the kind was asked it. */
export const declaredEstateStateLabel = (state: DeclaredEstateState): string => {
  const answer = declaredEstateAnswerLabel(answerShapeOf(state.bounds));
  if (state.internetFacing === null) {
    return answer;
  }
  const exposure = state.internetFacing ? t`reachable from the Internet` : t`not reachable from the Internet`;
  return t`${answer}, ${exposure}`;
};

export const declaredEstateExposureLabel = (internetFacing: boolean | null): string => {
  if (internetFacing === null) {
    return t`No answer`;
  }
  return internetFacing ? t`Yes` : t`No`;
};
