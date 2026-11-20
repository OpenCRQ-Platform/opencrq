import { Chip } from '@filigran/design-system';
import type { CriterionInheritance, InheritedCriteria, SecurityCriterion, SupportToPrimaryLinkRole } from '@app/module/client';
import { UNKNOWN_LINK_ROLE } from '@app/module/client';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { InfoTooltip, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { cn } from '../../../utils';
import {
  getCriterionInheritanceHint,
  getInheritedCriterionChipLabel,
  getLinkRoleLabel,
  getReachedCriterionChipLabel,
  getSecurityCriterionLetter,
} from '../link-role-labels';
import { securityCriteriaOrder } from '../link-roles-utils';

export const LinkRoleChips: FunctionComponent<{ roles: ReadonlyArray<SupportToPrimaryLinkRole> }> = ({ roles }) => (
  <span className="flex flex-wrap gap-1.5">
    {roles.map((role) => (
      <Chip
        key={role}
        label={getLinkRoleLabel(role)}
        className={cn(role === UNKNOWN_LINK_ROLE && 'border border-dashed border-elevation-default bg-transparent text-default-secondary')}
      />
    ))}
  </span>
);

const inheritanceClassName = (inheritance: CriterionInheritance): string => cn(
  inheritance === 'full' && 'bg-[color:var(--fds-text-default-primary)] text-negative-primary',
  inheritance === 'lower' && 'border border-dashed border-elevation-default bg-elevation-highlight text-default-primary',
  inheritance === 'none' && 'border border-elevation-subtle text-default-disabled',
);

export const InheritedCriteriaTiles: FunctionComponent<{ criteria: InheritedCriteria }> = ({ criteria }) => (
  <TooltipHintProvider>
    <span className="flex gap-1">
      {securityCriteriaOrder(i18n.locale).map((criterion) => {
        const hint = getCriterionInheritanceHint(criterion, criteria[criterion]);
        return (
          <TooltipHint key={criterion} hint={hint}>
            <span
              role="img"
              aria-label={hint}
              className={`inline-flex size-6 items-center justify-center rounded-[var(--fds-radius-sm)] txt-sub-content font-semibold ${inheritanceClassName(criteria[criterion])}`}
            >
              {getSecurityCriterionLetter(criterion)}
            </span>
          </TooltipHint>
        );
      })}
    </span>
  </TooltipHintProvider>
);

export const InheritedCriteriaChips: FunctionComponent<{
  criteria: InheritedCriteria,
  chipLabel?: (criterion: SecurityCriterion, inheritance: CriterionInheritance) => string,
}> = ({ criteria, chipLabel }) => (
  <span className="flex flex-wrap gap-2" aria-live="polite">
    {securityCriteriaOrder(i18n.locale).map((criterion) => {
      const inheritance = criteria[criterion];
      const label = chipLabel ?? getInheritedCriterionChipLabel;
      return (
        <span
          key={criterion}
          className={`inline-flex h-8 items-center gap-2 rounded-[var(--fds-radius-sm)] pl-1 pr-3 txt-body2 ${inheritanceClassName(inheritance)}`}
        >
          <span aria-hidden className="inline-flex size-6 items-center justify-center font-semibold">{getSecurityCriterionLetter(criterion)}</span>
          {label(criterion, inheritance)}
        </span>
      );
    })}
  </span>
);

export const CriteriaReachedChips: FunctionComponent<{ criteria: InheritedCriteria }> = ({ criteria }) => (
  <InheritedCriteriaChips criteria={criteria} chipLabel={getReachedCriterionChipLabel} />
);

export const CriteriaReachedLegend: FunctionComponent = () => (
  <InfoTooltip label={t`About the criteria reached`}>
    <span>{t`The security criteria of the targeted primary asset this outcome's loss depends on: confidentiality, integrity, availability and traceability.`}</span>
    <span>{t`Filled: reached, the loss cannot happen without breaching it. Dashed: partly reached, the breach adds a secondary share of the loss. Empty: not reached, no loss driver depends on it.`}</span>
  </InfoTooltip>
);

export const InheritedCriteriaLegend: FunctionComponent = () => (
  <InfoTooltip label={t`About inherited criteria`}>
    <span>{t`The security criteria of the primary asset the supporting asset takes on: confidentiality, integrity, availability and traceability.`}</span>
    <span>{t`Filled: inherited. Dashed: one notch lower. Empty: not inherited. With several roles or several primary assets, the strongest wins.`}</span>
  </InfoTooltip>
);
