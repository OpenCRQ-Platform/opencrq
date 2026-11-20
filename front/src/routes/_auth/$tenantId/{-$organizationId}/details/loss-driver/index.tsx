import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { LossDriverDrawer, LossDriversDataTable } from '../../../../../../features';

const RouteComponent = () => {
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  return (
    <>
      <LossDriversDataTable onSelectDriver={setSelectedDriverId} />
      <LossDriverDrawer lossDriverId={selectedDriverId} onClose={() => setSelectedDriverId(null)} />
    </>
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/details/loss-driver/')({
  component: RouteComponent,
});
