import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { FindingsFlowWindow } from './findings-dashboard-utils';
import { CisoDashboard } from './ciso-dashboard';
import { FindingsDashboard } from './findings-dashboard';
import { RemediationPaceDashboard } from './remediation-pace-dashboard';
import { RiskTreatmentDashboard } from './risk-treatment-dashboard';
import { SlickDashboard } from './slick-dashboard';

export type DashboardId = 'risk' | 'risk-treatment' | 'risk-sankey' | 'findings-assets' | 'remediation-pace';

export interface DashboardProps {
  organizationId?: string,
  windowDays: FindingsFlowWindow,
}

export interface DashboardDefinition {
  id: DashboardId,
  getLabel: () => string,
  getDescription: () => string,
  /** Puts the window select in the page header. Without it, `windowDays` is always the default. */
  timeWindow?: true,
  component: FunctionComponent<DashboardProps>,
}

const RISK_DASHBOARD: DashboardDefinition = {
  id: 'risk',
  getLabel: () => t`CISO`,
  getDescription: () => t`Aggregate risk, recommendations, top risks and scope inputs`,
  component: CisoDashboard,
};

export const DASHBOARD_DEFINITIONS: ReadonlyArray<DashboardDefinition> = [
  RISK_DASHBOARD,
  {
    id: 'risk-treatment',
    getLabel: () => t`Risk treatment`,
    getDescription: () => t`Each risk scenario's likelihood, annual loss exposure and the controls to improve first`,
    component: RiskTreatmentDashboard,
  },
  {
    id: 'risk-sankey',
    getLabel: () => t`Risk (Sankey)`,
    getDescription: () => t`Annual loss expectancy flow and reduction levers`,
    component: SlickDashboard,
  },
  {
    id: 'findings-assets',
    getLabel: () => t`Findings & Assets`,
    getDescription: () => t`Findings backlog, triage and exposed estate`,
    component: FindingsDashboard,
  },
  {
    id: 'remediation-pace',
    getLabel: () => t`Remediation pace`,
    getDescription: () => t`Incoming findings against the team's closing capacity, per severity band`,
    timeWindow: true,
    component: RemediationPaceDashboard,
  },
];

export const DEFAULT_DASHBOARD_ID: DashboardId = 'risk';

export const isDashboardId = (value: string): value is DashboardId =>
  DASHBOARD_DEFINITIONS.some((definition) => definition.id === value);

export const getDashboardDefinition = (id: DashboardId): DashboardDefinition =>
  DASHBOARD_DEFINITIONS.find((definition) => definition.id === id) ?? RISK_DASHBOARD;
