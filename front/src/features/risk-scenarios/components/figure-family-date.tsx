import { Button } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import { RefreshCw } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import { useTRPC } from '../../../lib';
import { formatDateTime } from '../../../utils';

type FigureFamily = 'levers' | 'techniques' | 'cves';

const RECOMPUTE_LABELS: Record<FigureFamily, ReactNode> = {
  levers: <Trans>Recompute the levers</Trans>,
  techniques: <Trans>Recompute the technique values</Trans>,
  cves: <Trans>Recompute the CVE values</Trans>,
};

interface FigureFamilyDateProps {
  riskScenarioId: string,
  family: FigureFamily,
}

export const FigureFamilyDate: FunctionComponent<FigureFamilyDateProps> = ({ riskScenarioId, family }) => {
  const trpc = useTRPC();
  const { data: dates } = useQuery(trpc.crqIndicators.getFigureFamilyDates.queryOptions({ riskScenarioId }));
  const { data: activeSimulation } = useQuery(trpc.crqIndicators.getActiveSimulation.queryOptions({ riskScenarioId }));
  const { mutate: recompute, isPending } = useMutation(trpc.crqIndicators.enqueueFamilyRecompute.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const dated = dates?.[family];
  if (!dated?.olderThanHeadline) {
    return null;
  }
  const computedAt = formatDateTime(dated.computedAt);

  return (
    <div className="flex items-center gap-2">
      <span className="txt-sub-content text-muted-foreground">
        <Trans>Computed on {computedAt}, before the current ALE.</Trans>
      </span>
      <Button
        priority="tertiary"
        size="sm"
        startIcon={<RefreshCw className="size-3" />}
        loading={isPending || activeSimulation != null}
        onClick={() => recompute({ riskScenarioId, family })}
      >
        {RECOMPUTE_LABELS[family]}
      </Button>
    </div>
  );
};
