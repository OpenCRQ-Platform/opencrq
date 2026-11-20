import type { SupportToPrimaryLinkRole } from '@app/module/client';
import { inheritedCriteriaOfRoles, SUPPORT_TO_PRIMARY_LINK_ROLES, UNKNOWN_LINK_ROLE } from '@app/module/client';
import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { useId } from 'react';
import { InfoTooltip, SelectableCard } from '../../../components/shared';
import { getLinkRoleLabel } from '../link-role-labels';
import { toggleLinkRole } from '../link-roles-utils';
import { InheritedCriteriaChips, InheritedCriteriaLegend } from './link-role-display';

interface LinkRolesFieldProps {
  value: Array<SupportToPrimaryLinkRole>,
  onChange: (roles: Array<SupportToPrimaryLinkRole>) => void,
}

export const LinkRolesField: FunctionComponent<LinkRolesFieldProps> = ({ value, onChange }) => {
  const roleLabelId = useId();
  const criteriaLabelId = useId();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-1.5">
          <span id={roleLabelId} className="txt-category">{t`Role`}</span>
          <InfoTooltip label={t`About roles`}>
            <span>{t`What the supporting asset does with the primary asset. A link can carry several roles.`}</span>
          </InfoTooltip>
        </span>
        <div role="group" aria-labelledby={roleLabelId} className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
          {SUPPORT_TO_PRIMARY_LINK_ROLES.map((role) => (
            <SelectableCard
              key={role}
              selected={value.includes(role)}
              placeholder={role === UNKNOWN_LINK_ROLE}
              onToggle={() => onChange(toggleLinkRole(value, role))}
            >
              {getLinkRoleLabel(role)}
            </SelectableCard>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2" role="group" aria-labelledby={criteriaLabelId}>
        <span className="flex items-center gap-1.5">
          <span id={criteriaLabelId} className="txt-category">{t`Inherited criteria`}</span>
          <InheritedCriteriaLegend />
        </span>
        <InheritedCriteriaChips criteria={inheritedCriteriaOfRoles(value)} />
      </div>
    </div>
  );
};
