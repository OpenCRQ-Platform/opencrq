import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { ImportProgressIndicator } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { useOptionalTenant } from '../../../providers';

/**
 * Badge for the OpenCTI Live Stream's initial historical catch-up — hidden once the connector
 * reaches the live tail (see `getBackfillProgress`). The bottom-edge bar (gray → blue) reflects
 * `progressPercent`, a monotonic high-water mark (see `opencti-connector-manager.ts`) so it only
 * ever moves forward — no percent/date text, the color fill is the whole signal.
 */
export const OpenctiBackfillIndicator: FunctionComponent = () => {
  const trpc = useTRPC();
  const tenantContext = useOptionalTenant();
  const { data } = useQuery(trpc.opencti.getBackfillProgress.queryOptions(undefined, {
    enabled: !!tenantContext,
    refetchInterval: 15_000,
  }));

  if (!data?.isCatchingUp) {
    return null;
  }

  const { mirroredObjectCount, progressPercent } = data;

  return (
    <ImportProgressIndicator
      label={<Trans>Initial import from the OpenCTI Live Stream</Trans>}
      progressPercent={progressPercent}
      detail={<Trans>{mirroredObjectCount} objects imported so far</Trans>}
    />
  );
};
