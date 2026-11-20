import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import { DRATA_DOCUMENTATION_URL, drataEnvBlock } from '../onboarding-utils';
import { ScheduledSourceDrawer } from './scheduled-source-drawer';

interface DrataSourceDrawerProps {
  tenantId: string,
  open: boolean,
  onClose: () => void,
}

export const DrataSourceDrawer: FunctionComponent<DrataSourceDrawerProps> = ({ tenantId, open, onClose }) => (
  <ScheduledSourceDrawer
    source="drata"
    unavailableMessage={t`A platform administrator enables Drata for this tenant: set the variables below in the platform's environment, then restart the platform.`}
    envBlock={drataEnvBlock(tenantId)}
    documentationUrl={DRATA_DOCUMENTATION_URL}
    open={open}
    onClose={onClose}
  />
);
