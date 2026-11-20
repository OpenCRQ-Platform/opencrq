import { t } from '@lingui/core/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { ScoreHistoryLifeline } from '../../finding-score';
import { useTRPC } from '../../../lib';
import { DossierCard } from './dossier-card';

interface FindingScoreHistoryCardProps {
  tenantId: string,
  evidenceId: string,
  className?: string,
}

/** Opens on twelve months, the year the state card beside it covers. */
export const FindingScoreHistoryCard: FunctionComponent<FindingScoreHistoryCardProps> = ({ tenantId, evidenceId, className }) => {
  const trpc = useTRPC();
  const { data: lines, isError } = useQuery(trpc.findingScore.getFindingScoreHistory.queryOptions({ evidenceId }));
  return (
    <DossierCard label={t`Score history`} className={className}>
      <ScoreHistoryLifeline
        tenantId={tenantId}
        evidenceId={evidenceId}
        lines={lines}
        isError={isError}
        withFigure
        defaultWindow="12m"
      />
    </DossierCard>
  );
};
