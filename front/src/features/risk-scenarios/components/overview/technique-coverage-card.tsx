import { Skeleton } from '@filigran/ui';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { SectionCard } from '../../../../components/shared';

type TechniqueCoverageCardProps = {
  techniqueCount: number | null,
  coveredTechniqueCount: number | null,
  runDate: string | null,
};

export const TechniqueCoverageCard: FunctionComponent<TechniqueCoverageCardProps> = ({ techniqueCount, coveredTechniqueCount, runDate }) => (
  <SectionCard title={t`Technique Coverage`} className="h-full" cardClassName="flex-1 p-4">
    <div className="flex items-center justify-between">
      <span className="txt-sub-content text-muted-foreground">
        <Trans>Total techniques</Trans>
      </span>
      {techniqueCount !== null ? <span className="txt-body2 font-medium">{techniqueCount}</span> : <Skeleton className="h-4 w-8" />}
    </div>
    <div className="flex items-center justify-between">
      <span className="txt-sub-content text-muted-foreground">
        <Trans>Covered by controls</Trans>
      </span>
      {coveredTechniqueCount !== null ? <span className="txt-body2 font-medium">{coveredTechniqueCount}</span> : <Skeleton className="h-4 w-8" />}
    </div>
    <div className="flex items-center justify-between">
      <span className="txt-sub-content text-muted-foreground">
        <Trans>Uncovered</Trans>
      </span>
      {techniqueCount !== null && coveredTechniqueCount !== null ? <span className="txt-body2 font-medium">{techniqueCount - coveredTechniqueCount}</span> : <Skeleton className="h-4 w-8" />}
    </div>
    {runDate && (
      <p className="txt-mini mt-2 text-muted-foreground">
        <Trans>Run date: {runDate}</Trans>
      </p>
    )}
  </SectionCard>
);
