import type { FunctionComponent } from 'react';
import { AggregateRiskGroup } from './widgets/aggregate-risk-group';
import { AttackSurfaceGroup } from './widgets/attack-surface-group';
import { DefensesGroup } from './widgets/defenses-group';
import { AllRiskScopesGroup, RiskScopeGroup } from './widgets/risk-scope-group';
import { ThreatsGroup } from './widgets/threats-group';
import { ToleranceGapGroup } from './widgets/tolerance-gap-group';
import { TreatmentRecommendationsGroup } from './widgets/treatment-recommendations-group';
import { WhereRiskSitsGroup } from './widgets/where-risk-sits-group';

interface CisoDashboardProps {
  organizationId?: string,
}

export const CisoDashboard: FunctionComponent<CisoDashboardProps> = ({ organizationId }) => (
  <div className="flex flex-col gap-6">
    {organizationId === undefined
      ? <AllRiskScopesGroup />
      : <RiskScopeGroup organizationId={organizationId} />}
    <AggregateRiskGroup organizationId={organizationId} />
    <TreatmentRecommendationsGroup organizationId={organizationId} />
    <ToleranceGapGroup organizationId={organizationId} />
    <WhereRiskSitsGroup organizationId={organizationId} />
    <ThreatsGroup organizationId={organizationId} />
    <AttackSurfaceGroup organizationId={organizationId} />
    <DefensesGroup organizationId={organizationId} />
  </div>
);
