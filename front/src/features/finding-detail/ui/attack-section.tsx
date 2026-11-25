import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { AssetCategory, SupportingAssetExposure } from '@app/module/client';
import type { FindingScoreBreakdown } from '../../finding-score';
import type { AttackCoverage } from '../attack-groups-utils';
import type { CitingThreat } from './threats-citing-card';
import { useTRPC } from '../../../lib';
import { HiddenThreatsAlert } from '../../threats';
import { countActiveThreats } from '../threat-signal-utils';
import { AttackTechniquesCard } from './attack-techniques-card';
import { CitationActivityCard } from './citation-activity-card';
import { ThreatsCitingCard } from './threats-citing-card';
import { ThreatSignalBanner } from './threat-signal-banner';

interface AttackSectionProps {
  cveId: string,
  tenantId: string,
  techniques: FindingScoreBreakdown['columns']['techniques'],
  /** A finding's asset family, or a unique finding's counts over the assets it spans. */
  categoryId?: AssetCategory,
  /** The exposure a finding's asset declares. */
  exposure?: SupportingAssetExposure,
  coverage?: AttackCoverage,
}

const observedTime = (analysis: CitingThreat): number =>
  (analysis.lastObservedAt === null ? 0 : new Date(analysis.lastObservedAt).getTime());

/** Most recently observed actor first; an actor no producer ever dated sits at the bottom. */
const byLastObserved = (left: CitingThreat, right: CitingThreat): number =>
  observedTime(right) - observedTime(left);

/**
 * Who cites this flaw, how it is exploited and what follows, observation first and deduction last.
 *
 * The threats and the citation series are observation. The technique rows are read off a
 * mapping corpus and a rule, which say how a flaw can be used and never that anyone used it here,
 * so they come last: the order is what keeps a deduction from borrowing the standing of an
 * observation.
 */
export const AttackSection: FunctionComponent<AttackSectionProps> = ({ cveId, tenantId, techniques, categoryId, exposure, coverage }) => {
  const trpc = useTRPC();
  const { data: citing } = useQuery(trpc.threats.getByCveId.queryOptions({ cveId }));
  const { data: activity } = useQuery(trpc.threats.getActivityForCve.queryOptions({ cveId }));
  const { data: connectorsStatus } = useQuery(trpc.integrations.getConnectorsStatus.queryOptions());

  if (!citing || !activity) {
    return null;
  }

  const analyses = [...citing].sort(byLastObserved);

  return (
    <div className="flex flex-col gap-5">
      <HiddenThreatsAlert />
      <ThreatSignalBanner
        citingCount={analyses.length}
        activeCount={countActiveThreats(analyses, new Date())}
        lastObservedAt={analyses.find((analysis) => analysis.lastObservedAt !== null)?.lastObservedAt ?? null}
      />
      <ThreatsCitingCard
        analyses={analyses}
        cveId={cveId}
        tenantId={tenantId}
        openctiUrl={connectorsStatus?.opencti.url ?? null}
        vulnerabilityStixId={analyses.find((analysis) => analysis.vulnerabilityStixId !== null)?.vulnerabilityStixId ?? null}
      />
      <CitationActivityCard events={activity} />
      <AttackTechniquesCard techniques={techniques} categoryId={categoryId} exposure={exposure} coverage={coverage} />
    </div>
  );
};
