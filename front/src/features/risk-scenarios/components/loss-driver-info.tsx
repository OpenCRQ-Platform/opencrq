import { i18n } from '@lingui/core';
import type { FunctionComponent } from 'react';
import type { RecommendationCell } from '../scenario-loss-utils';
import { InfoTooltip } from '../../../components/shared';
import { businessResourceName } from '../../business-value-categories';

const recommendationReason = (viaCells: ReadonlyArray<RecommendationCell>): string | null => {
  if (viaCells.length === 0) {
    return null;
  }
  const combinations = viaCells
    .map((cell) => {
      const outcome = cell.attackOutcomeName;
      const resource = businessResourceName({ code: cell.businessValueCategoryCode, name: cell.businessValueCategoryName });
      return i18n._({ id: '{outcome} on {resource}', message: '{outcome} on {resource}', values: { outcome, resource } });
    })
    .join(', ');
  return i18n._({ id: 'Recommended for {combinations}', message: 'Recommended for {combinations}', values: { combinations } });
};

interface LossDriverInfoProps {
  lossDriverName: string,
  description: string | null,
  viaCells: ReadonlyArray<RecommendationCell>,
}

export const LossDriverInfo: FunctionComponent<LossDriverInfoProps> = ({ lossDriverName, description, viaCells }) => {
  const reason = recommendationReason(viaCells);
  if (!description && !reason) {
    return null;
  }
  return (
    <InfoTooltip label={i18n._({ id: 'About {lossDriverName}', message: 'About {lossDriverName}', values: { lossDriverName } })}>
      {description && <p>{description}</p>}
      {reason && <p className="txt-sub-content">{reason}</p>}
    </InfoTooltip>
  );
};
