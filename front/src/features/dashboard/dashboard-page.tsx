import type { FunctionComponent } from 'react';
import type { DashboardId } from './dashboard-registry';
import { DetailPageLayout } from '../../components/shared';
import { useUrlListFilters } from '../../hooks';
import { RiskScopeFilter } from '../organizations/components/risk-scope-filter';
import { useRiskScopeFilter } from '../organizations/use-risk-scope-filter';
import { FlowWindowSelect } from './components/flow-window-select';
import { dashboardPageListSearchSchema } from './dashboard-page-list-search';
import { getDashboardDefinition } from './dashboard-registry';
import { resolveDashboardScope } from './dashboard-utils';
import { DEFAULT_FINDINGS_FLOW_WINDOW } from './findings-dashboard-utils';
import { useHomeDashboards } from './hooks/use-home-dashboards';

interface DashboardPageProps {
  organizationId?: string,
  /** Absent on Home, which opens the user's home dashboard. */
  dashboardId?: DashboardId,
}

export const DashboardPage: FunctionComponent<DashboardPageProps> = ({ organizationId, dashboardId }) => {
  const { userHomeId } = useHomeDashboards();
  const scopeParameterShown = organizationId === undefined;
  const { riskScope, scopes, pending, setRiskScope } = useRiskScopeFilter(scopeParameterShown);
  const { filters, setFilters } = useUrlListFilters(dashboardPageListSearchSchema);
  const definition = getDashboardDefinition(dashboardId ?? userHomeId);
  const ActiveDashboard = definition.component;
  const windowShown = definition.timeWindow === true;
  const actions = windowShown || scopeParameterShown
    ? (
      <div className="flex items-center gap-3">
        {windowShown && <FlowWindowSelect value={filters.window} onChange={(window) => setFilters({ window })} />}
        {scopeParameterShown && <RiskScopeFilter value={riskScope} scopes={scopes} onChange={setRiskScope} />}
      </div>
    )
    : null;

  return (
    <DetailPageLayout title={definition.getLabel()} actions={actions}>
      {!pending && (
        <ActiveDashboard
          organizationId={resolveDashboardScope(organizationId, riskScope)}
          windowDays={windowShown ? filters.window : DEFAULT_FINDINGS_FLOW_WINDOW}
        />
      )}
    </DetailPageLayout>
  );
};
