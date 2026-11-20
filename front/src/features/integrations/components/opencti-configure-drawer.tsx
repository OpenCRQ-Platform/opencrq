import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { Suspense } from 'react';
import { Loader } from '../../../components';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { OpenctiConfigureFields, OpenctiEnabledSwitch, useOpenctiConfigure } from './opencti-configure-form';

const ConfigureForm: FunctionComponent = () => {
  const { closeDrawer } = useFormDrawerContext();
  const configure = useOpenctiConfigure({ onSaved: closeDrawer });

  if (!configure.platformConfigured) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>Add this connector to your deployment configuration to use it.</Trans>
      </p>
    );
  }
  if (configure.isStreamsError) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>Unable to load Live Streams from OpenCTI right now. It may be temporarily unavailable, so try again shortly.</Trans>
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <OpenctiEnabledSwitch configure={configure} />
      <DrawerForm
        form={configure.form}
        onSubmit={configure.submit}
        className="h-auto flex-1"
        footer={<DrawerFormActions isPending={configure.isPending} />}
      >
        <OpenctiConfigureFields configure={configure} />
      </DrawerForm>
    </div>
  );
};

export const OpenctiConfigureDrawer: FunctionComponent<{ trigger: ReactNode }> = ({ trigger }) => (
  <FormDrawer title={t`Configure integration`} trigger={trigger}>
    <Suspense fallback={<Loader />}>
      <ConfigureForm />
    </Suspense>
  </FormDrawer>
);
