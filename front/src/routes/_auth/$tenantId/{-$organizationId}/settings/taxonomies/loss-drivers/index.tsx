import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LossDriversDataTable } from '../../../../../../../features';

const RouteComponent = () => {
  const navigate = useNavigate();
  const onSelectDriver = (id: string) => {
    void navigate({
      from: '/$tenantId/{-$organizationId}/settings/taxonomies/loss-drivers',
      to: '$lossDriverId',
      params: { lossDriverId: id },
    });
  };
  return <LossDriversDataTable onSelectDriver={onSelectDriver} />;
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/taxonomies/loss-drivers/')({
  component: RouteComponent,
});
