import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent } from 'react';
import { DescriptionField, DetailPageLayout, InfoField, SectionCard } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { getDwellSensitivityLabel, getScalingVariableLabel } from '../loss-driver-labels';
import { LossDriverActivationMatrix } from './loss-driver-activation-matrix';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
export type LossDriverDetailData = NonNullable<RouterOutputs['lossDrivers']['getLossDriver']>;

interface LossDriverBodyProps {
  lossDriver: LossDriverDetailData,
  /** One column in a drawer, two on a page: the same cards, laid out for the width they get. */
  columns: 1 | 2,
}

/** The driver's own content, without a page or drawer shell around it. */
export const LossDriverBody: FunctionComponent<LossDriverBodyProps> = ({ lossDriver, columns }) => (
  <div className="flex flex-col gap-6">
    <div className={columns === 2 ? 'grid grid-cols-2 gap-6' : 'flex flex-col gap-6'}>
      <SectionCard title={t`Details`}>
        <DescriptionField title={t`Description`} value={lossDriver.description} />
      </SectionCard>

      <SectionCard title={t`Loss Driver Information`}>
        <InfoField title={t`Loss category`} value={lossDriver.lossCategoryName} />
        <InfoField title={t`Dwell sensitivity`} value={getDwellSensitivityLabel(lossDriver.dwellSensitivity)} />
        <InfoField title={t`Scaling variable`} value={getScalingVariableLabel(lossDriver.scalingVariable)} />
      </SectionCard>
    </div>

    <LossDriverActivationMatrix lossDriverId={lossDriver.id} />

    <p className="txt-sub-content text-muted-foreground">
      <Trans>Loss drivers are platform reference data and cannot be edited.</Trans>
    </p>
  </div>
);

interface LossDriverDetailProps {
  initialData: LossDriverDetailData,
}

/** The taxonomy rail's detail page. The organization Details "Loss Driver" tab opens a drawer instead. */
export const LossDriverDetail: FunctionComponent<LossDriverDetailProps> = ({ initialData }) => {
  const trpc = useTRPC();
  const { data: lossDriver } = useQuery(trpc.lossDrivers.getLossDriver.queryOptions(
    { id: initialData.id },
    { initialData },
  ));

  if (!lossDriver) {
    return null;
  }

  return (
    <DetailPageLayout title={lossDriver.name}>
      <LossDriverBody lossDriver={lossDriver} columns={2} />
    </DetailPageLayout>
  );
};
