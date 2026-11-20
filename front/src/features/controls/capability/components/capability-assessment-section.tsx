import { Button, Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link, linkOptions } from '@tanstack/react-router';
import { PencilIcon } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import type { LifelineGuide } from '../hooks/use-lifeline-guide';
import type { CapabilityDetail } from '../types/capability';
import { DashboardGroup } from '../../../../components/shared';
import { AssessmentFigures } from './assessment-figures';
import { CapabilityAssessmentEditDrawer } from './capability-assessment-edit-drawer';
import { EffectivenessLifeline } from './effectiveness-lifeline';

interface CapabilityAssessmentSectionProps {
  capability: CapabilityDetail,
  guide: LifelineGuide,
}

export const CapabilityAssessmentSection: FunctionComponent<CapabilityAssessmentSectionProps> = ({
  capability,
  guide,
}) => {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  return (
    <>
      <DashboardGroup
        icon="clipboard-list"
        tone="brand"
        title={t`Assessment`}
        action={(
          <Button priority="tertiary" size="sm" startIcon={<PencilIcon className="size-3" />} onClick={() => setIsDrawerOpen(true)}>
            <Trans>Edit assessment</Trans>
          </Button>
        )}
      >
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
          <Paper elevation={2} padding={16}>
            <AssessmentFigures
              capability={capability}
              provenanceAction={(
                <Link
                  {...linkOptions({ from: '/$tenantId/{-$organizationId}/controls/$controlId', to: 'events' })}
                  className="txt-sub-content text-primary hover:underline"
                >
                  <Trans>View events</Trans>
                </Link>
              )}
            />
          </Paper>
          <Paper elevation={2} padding={0} className="p-[12px_16px]">
            <EffectivenessLifeline capabilityId={capability.id} guide={guide} />
          </Paper>
        </div>
      </DashboardGroup>
      {isDrawerOpen && (
        <CapabilityAssessmentEditDrawer
          capabilityId={capability.id}
          externalId={capability.externalId}
          name={capability.name}
          onClose={() => setIsDrawerOpen(false)}
        />
      )}
    </>
  );
};
