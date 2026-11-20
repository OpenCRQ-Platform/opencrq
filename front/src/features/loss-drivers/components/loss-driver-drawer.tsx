import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { DisplayDrawer } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { LossDriverBody } from './loss-driver-detail';

interface LossDriverDrawerProps {
  lossDriverId: string | null,
  onClose: () => void,
}

/**
 * The catalogue's row detail, read-only. `lossDriverId` null closes it, and the drawer stays
 * mounted through its exit animation, so the body renders from whatever the last query returned
 * rather than emptying mid-slide.
 */
export const LossDriverDrawer: FunctionComponent<LossDriverDrawerProps> = ({ lossDriverId, onClose }) => {
  const trpc = useTRPC();
  const { data: lossDriver } = useQuery(trpc.lossDrivers.getLossDriver.queryOptions(
    { id: lossDriverId ?? '' },
    { enabled: lossDriverId !== null },
  ));

  return (
    <DisplayDrawer
      open={lossDriverId !== null}
      onClose={onClose}
      title={lossDriver?.name ?? t`Loss driver`}
      className="w-[55vw] max-w-[960px] min-w-[720px]"
    >
      {lossDriver && <LossDriverBody lossDriver={lossDriver} columns={1} />}
    </DisplayDrawer>
  );
};
