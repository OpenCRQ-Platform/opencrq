import { i18n } from '@lingui/core';
import type { FunctionComponent } from 'react';
import type { RecommendationCell, RecommendationRequirement } from '../scenario-loss-utils';
import { formatList } from '../../../utils';
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

const requirementReason = (viaRequirements: ReadonlyArray<RecommendationRequirement>): string | null => {
  if (viaRequirements.length === 0) {
    return null;
  }
  const requirements = formatList(viaRequirements.map((requirement) => requirement.requirementName));
  return i18n._({ id: 'Required by {requirements}, which this scenario breaks', message: 'Required by {requirements}, which this scenario breaks', values: { requirements } });
};

interface LossDriverInfoProps {
  lossDriverName: string,
  description: string | null,
  viaCells: ReadonlyArray<RecommendationCell>,
  viaRequirements: ReadonlyArray<RecommendationRequirement>,
}

export const LossDriverInfo: FunctionComponent<LossDriverInfoProps> = ({ lossDriverName, description, viaCells, viaRequirements }) => {
  const reason = recommendationReason(viaCells);
  const required = requirementReason(viaRequirements);
  if (!description && !reason && !required) {
    return null;
  }
  return (
    <InfoTooltip label={i18n._({ id: 'About {lossDriverName}', message: 'About {lossDriverName}', values: { lossDriverName } })}>
      {description && <p>{description}</p>}
      {reason && <p className="txt-sub-content">{reason}</p>}
      {required && <p className="txt-sub-content">{required}</p>}
    </InfoTooltip>
  );
};
