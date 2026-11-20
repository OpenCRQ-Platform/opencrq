import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { MICROSOFT_DEFENDER_DOCUMENTATION_URL, microsoftDefenderEnvBlock } from '../onboarding-utils';
import { ScheduledSourceDrawer } from './scheduled-source-drawer';

interface DefenderSourceDrawerProps {
  tenantId: string,
  open: boolean,
  onClose: () => void,
}

export const DefenderSourceDrawer: FunctionComponent<DefenderSourceDrawerProps> = ({ tenantId, open, onClose }) => (
  <ScheduledSourceDrawer
    source="microsoft_graph"
    unavailableMessage={t`A platform administrator enables Microsoft Defender for this tenant: set the variables below in the platform's environment, then restart the platform.`}
    envBlock={microsoftDefenderEnvBlock(tenantId)}
    documentationUrl={MICROSOFT_DEFENDER_DOCUMENTATION_URL}
    open={open}
    onClose={onClose}
  />
);
