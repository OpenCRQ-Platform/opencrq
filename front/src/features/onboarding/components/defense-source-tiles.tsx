import { Button } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { ClipboardCheck } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { getConnectors } from '../../integrations';
import { countAssessedByHand } from '../defenses-utils';
import { useConnectorCard, useControlCapabilities } from '../hooks/use-source-reads';
import { runProgressPercent } from '../onboarding-utils';
import { capabilitiesByHandLabel } from '../source-labels';
import { DrataSourceDrawer } from './drata-source-drawer';
import { SelfAssessmentDrawer } from './self-assessment-drawer';
import { ActiveChip, ConnectorSourceIcon, ConnectorTileChip, SourceGlyph, SourceTile } from './source-tile';

/** No count: no read tells which assessments Drata fed, and a tile never shows the whole catalogue as its own. */
export const DrataTile: FunctionComponent<{ tenantId: string }> = ({ tenantId }) => {
  const [configuring, setConfiguring] = useState(false);
  const connector = useConnectorCard('drata');

  return (
    <SourceTile
      icon={<ConnectorSourceIcon source="drata" />}
      chip={<ConnectorTileChip state={connector?.state} enabled={connector?.enabled ?? true} />}
      name={getConnectors().drata.name}
      count={undefined}
      percent={runProgressPercent(connector?.activeRun ?? null)}
      action={(
        <>
          <Button type="button" priority="secondary" onClick={() => setConfiguring(true)}>{t`Configure`}</Button>
          <DrataSourceDrawer tenantId={tenantId} open={configuring} onClose={() => setConfiguring(false)} />
        </>
      )}
    />
  );
};

export const SelfAssessmentTile: FunctionComponent = () => {
  const [assessing, setAssessing] = useState(false);
  const capabilities = useControlCapabilities();
  const count = capabilities === undefined ? undefined : countAssessedByHand(capabilities);

  return (
    <SourceTile
      icon={<SourceGlyph icon={ClipboardCheck} />}
      chip={<ActiveChip count={count} />}
      name={t`Assess yourself`}
      count={count === undefined ? undefined : capabilitiesByHandLabel(count)}
      percent={null}
      action={(
        <>
          <Button type="button" priority="secondary" onClick={() => setAssessing(true)}>{t`Assess`}</Button>
          <SelfAssessmentDrawer open={assessing} onClose={() => setAssessing(false)} />
        </>
      )}
    />
  );
};
