import type { FunctionComponent } from 'react';
import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Waypoints } from 'lucide-react';
import type { CapabilityCrosswalk } from '../types/capability';
import { SectionCard } from '../../../../components/shared';
import { groupCrosswalkByFramework } from '../utils/crosswalk-frameworks';

interface CrosswalkSectionProps {
  crosswalk: Array<CapabilityCrosswalk>,
}

export const CrosswalkSection: FunctionComponent<CrosswalkSectionProps> = ({ crosswalk }) => {
  const groups = groupCrosswalkByFramework(crosswalk);

  return (
    <SectionCard title={t`Crosswalk to external frameworks`}>
      <div className="flex items-start gap-2">
        <Waypoints className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="txt-sub-content text-muted-foreground">
          <Trans>
            This control is equivalent to the requirements and controls listed below in external
            frameworks and standards. Use them to map your existing compliance work onto this catalogue.
          </Trans>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.framework} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="txt-category">{group.label}</span>
              <span className="txt-sub-content text-muted-foreground">{group.externalIds.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.externalIds.map((externalId) => (
                <Chip key={externalId} className="font-mono" label={externalId} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
};
