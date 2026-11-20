import { t } from '@lingui/core/macro';
import type { IntegrationSource } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import { Suspense } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { ConnectorSchedule } from '../connector-detail-types';
import { Loader } from '../../../components';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { ConfigureIntegrationFields, useConfigureIntegration } from './configure-integration-form';

const ConfigureForm: FunctionComponent<{ sourceId: IntegrationSource, schedule: ConnectorSchedule | null }> = ({ sourceId, schedule }) => {
  const { closeDrawer } = useFormDrawerContext();
  const configure = useConfigureIntegration({ sourceId, schedule, onSaved: closeDrawer });

  return (
    <DrawerForm
      form={configure.form}
      onSubmit={configure.submit}
      footer={<DrawerFormActions isPending={configure.isPending} />}
    >
      <ConfigureIntegrationFields configure={configure} />
    </DrawerForm>
  );
};

const ScheduledConfigureForm: FunctionComponent<{ sourceId: IntegrationSource }> = ({ sourceId }) => {
  const trpc = useTRPC();
  const { data: schedule } = useSuspenseQuery(trpc.connectors.getSchedule.queryOptions({ source: sourceId }));
  return <ConfigureForm sourceId={sourceId} schedule={schedule} />;
};

interface ConfigureIntegrationDrawerProps {
  sourceId: IntegrationSource,
  trigger: ReactNode,
}

export const ConfigureIntegrationDrawer: FunctionComponent<ConfigureIntegrationDrawerProps> = ({ sourceId, trigger }) => (
  <FormDrawer title={t`Configure integration`} trigger={trigger}>
    <Suspense fallback={<Loader />}>
      <ScheduledConfigureForm sourceId={sourceId} />
    </Suspense>
  </FormDrawer>
);
