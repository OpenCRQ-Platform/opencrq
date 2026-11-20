import { t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { ThreatAnalysisDetailData } from './threat-detail-tabs';
import { SectionCard } from '../../../components/shared';
import { ThreatAttributionsTable } from './threat-attributions-table';
import { ThreatConcernsYouCard } from './threat-concerns-you-card';
import { ThreatDescription } from './threat-description';
import { ThreatOutcomesTable } from './threat-outcomes-table';
import { ThreatProfileCard } from './threat-profile-card';

// `minmax(0, 1fr)`: a long unbroken table row must not widen its column past half the page.
const pairClassName = 'grid grid-cols-[repeat(2,minmax(0,1fr))] items-stretch gap-6';

/** A threat's overview, what decides first: whether it targets the tenant and which of its outcomes it serves. */
export const ThreatOverview: FunctionComponent<{ detail: ThreatAnalysisDetailData }> = ({ detail }) => {
  const { analysis } = detail;

  return (
    <div className="flex flex-col gap-6">
      {analysis.description && (
        <SectionCard title={t`Description`}>
          <ThreatDescription description={analysis.description} kind={detail.origin.kind} />
        </SectionCard>
      )}

      <div className={pairClassName}>
        <ThreatConcernsYouCard locations={detail.locations} sectors={detail.sectors} />
        <ThreatOutcomesTable analysisId={analysis.id} />
      </div>

      <div className={pairClassName}>
        <ThreatProfileCard detail={detail} />
        <ThreatAttributionsTable threat={analysis} attributedTo={detail.attributedTo} attributedFrom={detail.attributedFrom} />
      </div>
    </div>
  );
};
