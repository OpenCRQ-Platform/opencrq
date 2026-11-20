import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { SettingsField, TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { useHasManageSecurity } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { DASHBOARD_DEFINITIONS, getDashboardDefinition, isDashboardId } from '../dashboard-registry';
import { useHomeDashboards } from '../hooks/use-home-dashboards';

export const TenantHomeDashboardField: FunctionComponent = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const canManage = useHasManageSecurity();
  const { tenantHomeId } = useHomeDashboards();
  const setTenantHome = useMutation(trpc.dashboard.setTenantHomeDashboard.mutationOptions({
    meta: { successMessage: msg`Tenant home dashboard updated.` },
    // eslint-disable-next-line no-restricted-syntax -- a refresh an immediate action depends on: the mutation stays pending until the new default is read back, so the select never flickers back to the old one.
    onSuccess: () => queryClient.invalidateQueries(trpc.dashboard.getTenantHomeDashboard.queryFilter()),
  }));
  const hint = t`Shown on Home to every user who has not chosen their own`;
  const value = setTenantHome.isPending ? setTenantHome.variables.dashboardId : tenantHomeId;

  return (
    <SettingsField
      label={(
        <>
          <Trans>Home dashboard</Trans>
          <TooltipHintProvider>
            <TooltipHint hint={hint}>
              <button
                type="button"
                aria-label={hint}
                className="inline-flex size-4 cursor-help items-center justify-center border-0 bg-transparent p-0 text-default-secondary hover:text-default-primary"
              >
                <Info className="size-3.5" aria-hidden />
              </button>
            </TooltipHint>
          </TooltipHintProvider>
        </>
      )}
    >
      {canManage ? (
        <Select
          value={value}
          disabled={setTenantHome.isPending}
          onValueChange={(next) => {
            if (isDashboardId(next)) {
              setTenantHome.mutate({ dashboardId: next });
            }
          }}
        >
          <SelectTrigger className="w-full" aria-label={t`Home dashboard`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DASHBOARD_DEFINITIONS.map((definition) => (
              <SelectItem key={definition.id} value={definition.id}>{definition.getLabel()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : getDashboardDefinition(tenantHomeId).getLabel()}
    </SettingsField>
  );
};
