import { eq, useLiveQuery } from '@tanstack/react-db';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HomeDashboards } from '../dashboard-catalogue-utils';
import type { DashboardId } from '../dashboard-registry';
import { useTRPC } from '../../../lib';
import { useTenant } from '../../../providers';
import { useLoggedUser } from '../../../providers/logged-user-provider';
import { homeDashboardCollection } from '../../../stores';
import { resolveHomeDashboards } from '../dashboard-catalogue-utils';
import { DEFAULT_DASHBOARD_ID, isDashboardId } from '../dashboard-registry';

/** The server's answer once both levels have loaded, the last one this browser saw until then. */
export const useHomeDashboards = (): HomeDashboards<DashboardId> => {
  const trpc = useTRPC();
  const { tenantId } = useTenant();
  const { userId } = useLoggedUser();
  const key = `${userId}:${tenantId}`;
  const { data: userDashboardId } = useQuery(trpc.users.getUserHomeDashboard.queryOptions());
  const { data: tenantDashboardId } = useQuery(trpc.dashboard.getTenantHomeDashboard.queryOptions());

  const { data: cached } = useLiveQuery({
    query: (q) =>
      q.from({ el: homeDashboardCollection })
        .where(({ el }) => eq(el.id, key))
        .findOne(),
  });

  useEffect(() => {
    if (userDashboardId === undefined || tenantDashboardId === undefined) {
      return;
    }
    const current = homeDashboardCollection.get(key);
    if (!current) {
      homeDashboardCollection.insert({ id: key, userDashboardId, tenantDashboardId });
    } else if (current.userDashboardId !== userDashboardId || current.tenantDashboardId !== tenantDashboardId) {
      homeDashboardCollection.update(key, (draft) => {
        draft.userDashboardId = userDashboardId;
        draft.tenantDashboardId = tenantDashboardId;
      });
    }
  }, [key, userDashboardId, tenantDashboardId]);

  return resolveHomeDashboards(
    {
      user: userDashboardId !== undefined ? userDashboardId : cached?.userDashboardId,
      tenant: tenantDashboardId !== undefined ? tenantDashboardId : cached?.tenantDashboardId,
    },
    isDashboardId,
    DEFAULT_DASHBOARD_ID,
  );
};
