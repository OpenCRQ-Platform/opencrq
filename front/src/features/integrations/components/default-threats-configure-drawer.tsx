import { Alert, Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle, Switch } from '@filigran/design-system';
import { zodResolver } from '@hookform/resolvers/zod';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import type { ConnectorSchedule } from '../connector-detail-types';
import type { ConfigureValues } from './configure-integration-form';
import { Loader } from '../../../components';
import { DrawerForm, DrawerFormActions, FormDrawer, useFormDrawerContext } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { browserTimeZone } from '../../../utils/date-utils';
import { toSchedule, toScheduleFields } from '../connector-schedule-utils';
import { buildConfigureSchema, MANUAL_SCHEDULE, ScheduleFields } from './configure-integration-form';
import { getConnectors } from './connectors-list';

interface DisableDialogProps {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onConfirm: () => void,
  ownThreats: number,
  otherThreats: number,
}

/** Says what goes and what stays: the connector's threats are removed, every other source's are kept. */
export const DisableDefaultThreatsDialog: FunctionComponent<DisableDialogProps> = ({ open, onOpenChange, onConfirm, ownThreats, otherThreats }) => {
  const connectorName = getConnectors().default_threats.name;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogTitle><Trans>Disable {connectorName}</Trans></DialogTitle>
        <DialogDescription>
          {plural(ownThreats, {
            one: 'Its # threat is removed from this tenant, and your risk scenarios are simulated again without it.',
            other: 'Its # threats are removed from this tenant, and your risk scenarios are simulated again without them.',
          })}
          {' '}
          {otherThreats > 0 && plural(otherThreats, {
            one: 'The # threat from your other sources stays.',
            other: 'The # threats from your other sources stay.',
          })}
        </DialogDescription>
        {otherThreats === 0 ? (
          <Alert
            severity="warning"
            title={<Trans>This tenant has no threat from another source.</Trans>}
            description={<Trans>Every risk scenario will be refused for lack of an admitted threat until you connect OpenCTI or upload a STIX bundle.</Trans>}
          />
        ) : (
          <p className="txt-sub-content text-muted-foreground">
            <Trans>Past simulations keep the names of the threats they used. Enabling the connector again loads the threats back.</Trans>
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button priority="secondary"><Trans>Cancel</Trans></Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive" onClick={onConfirm}><Trans>Disable</Trans></Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** The switch acts at once, as OpenCTI's does: switching off asks first, switching on loads the dataset. */
const EnabledSwitch: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data: overview } = useSuspenseQuery(trpc.defaultThreats.getOverview.queryOptions());
  const [confirming, setConfirming] = useState(false);
  const ownThreats = overview.groups + overview.campaigns;
  // The Switch's own state flip is the feedback, per the toaster convention for inline state changes.
  const setEnabled = useMutation(trpc.defaultThreats.setEnabled.mutationOptions({ meta: { skipSuccessToast: true } }));

  return (
    <div className="flex flex-col gap-1">
      <Switch
        checked={overview.enabled}
        disabled={setEnabled.isPending}
        onCheckedChange={(enabled) => (enabled ? setEnabled.mutate({ enabled }) : setConfirming(true))}
        label={overview.enabled ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>}
      />
      {overview.enabled && ownThreats > 0 && (
        <span className="txt-sub-content text-muted-foreground">
          {plural(ownThreats, {
            one: 'Disabling removes its # threat from this tenant.',
            other: 'Disabling removes its # threats from this tenant.',
          })}
        </span>
      )}
      <DisableDefaultThreatsDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => setEnabled.mutate({ enabled: false })}
        ownThreats={ownThreats}
        otherThreats={overview.otherThreats}
      />
    </div>
  );
};

const ScheduleForm: FunctionComponent<{ schedule: ConnectorSchedule }> = ({ schedule }) => {
  const trpc = useTRPC();
  const { closeDrawer } = useFormDrawerContext();
  const [openedAtMs] = useState(() => Date.now());
  // No service account: the connector writes as the platform, and the field stays empty.
  const form = useForm<ConfigureValues>({
    resolver: zodResolver(buildConfigureSchema()),
    defaultValues: {
      serviceAccountMode: 'existing',
      newServiceAccountName: '',
      serviceAccountId: '',
      ...toScheduleFields(schedule ?? MANUAL_SCHEDULE, browserTimeZone()),
    },
  });
  const setSchedule = useMutation(trpc.connectors.setSchedule.mutationOptions({
    meta: { successMessage: msg`Integration configured successfully.` },
    onSuccess: () => {
      closeDrawer();
    },
  }));

  return (
    <DrawerForm
      form={form}
      onSubmit={(values) => {
        const saved = toSchedule(values);
        if (saved !== null) {
          setSchedule.mutate({ source: 'default_threats', ...saved });
        }
      }}
      className="h-auto flex-1"
      footer={<DrawerFormActions isPending={setSchedule.isPending} />}
    >
      <ScheduleFields control={form.control} offered={schedule.offeredCadences} openedAtMs={openedAtMs} />
    </DrawerForm>
  );
};

const ConfigureForm: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data: schedule } = useSuspenseQuery(trpc.connectors.getSchedule.queryOptions({ source: 'default_threats' }));
  return (
    <div className="flex h-full flex-col gap-5">
      <EnabledSwitch />
      {schedule !== null && <ScheduleForm schedule={schedule} />}
    </div>
  );
};

export const DefaultThreatsConfigureDrawer: FunctionComponent<{ trigger: ReactNode }> = ({ trigger }) => (
  <FormDrawer title={t`Configure integration`} trigger={trigger}>
    <Suspense fallback={<Loader />}>
      <ConfigureForm />
    </Suspense>
  </FormDrawer>
);
