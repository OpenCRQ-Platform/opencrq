import { t } from '@lingui/core/macro';
import type { AssetCriticality } from '@app/module/client';
import { ArrowUp } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { getAssetCriticalityLabel } from '../../../utils';
import { criticalityRingProperty } from '../dependency-graph-utils';

export const CriticalityBandPill: FunctionComponent<{ criticality: AssetCriticality, lifted: boolean }> = ({ criticality, lifted }) => {
  const ink = `var(${criticalityRingProperty(criticality)})`;
  const band = getAssetCriticalityLabel(criticality);
  return (
    <span
      className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-[7px] txt-sub-content font-semibold"
      style={{ color: ink, backgroundColor: `color-mix(in srgb, ${ink} 20%, transparent)` }}
    >
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: ink }} />
      <span aria-hidden={lifted}>{band}</span>
      {lifted && <ArrowUp className="size-[11px]" strokeWidth={3} aria-hidden />}
      {lifted && <span className="sr-only">{t`${band}, given by the assigned user`}</span>}
    </span>
  );
};
