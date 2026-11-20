import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useTRPC } from '../../../lib';
import { DASHBOARD_DEFINITIONS, getDashboardDefinition, isDashboardId } from '../dashboard-registry';
import { useHomeDashboards } from '../hooks/use-home-dashboards';

const TENANT_HOME_VALUE = '__tenant-home__';

export const HomeDashboardField: FunctionComponent = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { tenantHomeId, userChoiceId } = useHomeDashboards();
  const updateHome = useMutation(trpc.users.updateUser.mutationOptions({
    meta: { successMessage: msg`Home dashboard updated.` },
    // eslint-disable-next-line no-restricted-syntax -- a refresh an immediate action depends on: the mutation stays pending until the new home is read back, so the select never flickers back to the old one.
    onSuccess: () => queryClient.invalidateQueries(trpc.users.getUserHomeDashboard.queryFilter()),
  }));
  const shownChoice = updateHome.isPending ? updateHome.variables.homeDashboardId : userChoiceId;
  const tenantHomeName = getDashboardDefinition(tenantHomeId).getLabel();

  return (
    <Select
      value={shownChoice != null && isDashboardId(shownChoice) ? shownChoice : TENANT_HOME_VALUE}
      disabled={updateHome.isPending}
      onValueChange={(next) => {
        if (next === TENANT_HOME_VALUE) {
          updateHome.mutate({ homeDashboardId: null });
        } else if (isDashboardId(next)) {
          updateHome.mutate({ homeDashboardId: next });
        }
      }}
    >
      <SelectTrigger className="w-[260px]" aria-label={t`Home dashboard`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TENANT_HOME_VALUE} className="italic">
          <Trans>Tenant home ({tenantHomeName})</Trans>
        </SelectItem>
        <SelectSeparator />
        {DASHBOARD_DEFINITIONS.map((definition) => (
          <SelectItem key={definition.id} value={definition.id}>{definition.getLabel()}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
