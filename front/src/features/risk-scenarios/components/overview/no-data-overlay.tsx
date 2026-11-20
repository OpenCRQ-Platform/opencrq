import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';

export const NoDataOverlay: FunctionComponent = () => (
  <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-card/60 backdrop-blur-[4px]">
    <span className="txt-body2 font-medium text-muted-foreground select-none"><Trans>Insufficient data</Trans></span>
  </div>
);
