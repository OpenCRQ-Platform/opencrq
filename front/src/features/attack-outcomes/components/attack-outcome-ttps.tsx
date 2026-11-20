import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import { Trans } from '@lingui/react/macro';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import { Shield } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import type { DisplayCategory } from '../../mitre-attack/components';
import { DataPageWithTtpMatrix } from '../../../components/ui/data-page-layout';
import { useTRPC } from '../../../lib';
import {
  createTechniqueCategoryColumn,
  createTechniqueColumn,
  resolveDisplayCategory,
  TECHNIQUE_CATEGORY_STYLE,
  techniqueCategoryLabel,
  useTechniqueRowNavigate,
} from '../../mitre-attack/components';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type CuratedTechniqueRow = RouterOutputs['attackOutcomes']['getCuratedMitreTechniquesForOutcome'][number];

interface CuratedTechnique {
  id: string,
  externalId: string,
  name: string,
  category: DisplayCategory,
}

interface AttackOutcomeTtpsProps {
  attackOutcomeId: string,
}

const toCuratedTechnique = (technique: CuratedTechniqueRow): CuratedTechnique => ({
  id: technique.mitreTechniqueId,
  externalId: technique.externalId,
  name: technique.name,
  category: resolveDisplayCategory(technique),
});

export const AttackOutcomeTtps: FunctionComponent<AttackOutcomeTtpsProps> = ({ attackOutcomeId }) => {
  const trpc = useTRPC();
  const onClickRow = useTechniqueRowNavigate<CuratedTechnique>();
  const { data, isLoading, isError } = useQuery(trpc.attackOutcomes.getCuratedMitreTechniquesForOutcome.queryOptions({ attackOutcomeId }));

  const techniques: Array<CuratedTechnique> = (data ?? []).map(toCuratedTechnique);

  const columns: Array<ColumnDefWithOptionsHeader<CuratedTechnique, unknown>> = [
    createTechniqueColumn<CuratedTechnique>(),
    createTechniqueCategoryColumn<CuratedTechnique>(),
  ];

  const highlightedTechniques: Array<HighlightedTechnique> = techniques.map((technique) => ({
    id: technique.id,
    color: TECHNIQUE_CATEGORY_STYLE[technique.category].highlight,
    categoryLabel: techniqueCategoryLabel(technique.category),
  }));

  if (isError) {
    return (
      <p className="txt-sub-content text-muted-foreground">
        <Trans>TTPs could not be loaded.</Trans>
      </p>
    );
  }

  if (!isLoading && techniques.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
        <Shield className="h-12 w-12 text-muted-foreground" />
        <div className="text-center">
          <p className="txt-subtitle2">
            <Trans>No ATT&CK techniques associated</Trans>
          </p>
          <p className="txt-sub-content text-muted-foreground">
            <Trans>Techniques are curated on this attack outcome.</Trans>
          </p>
        </div>
      </div>
    );
  }

  return (
    <DataPageWithTtpMatrix
      data={techniques}
      columns={columns}
      storageKey="attack-outcome-ttps"
      isLoading={isLoading}
      highlightedTechniques={highlightedTechniques}
      initialSorting={[{ id: 'externalId', desc: false }]}
      leftHeaderContent={
        <p className="txt-sub-content text-muted-foreground">
          <Trans>Techniques curated on this outcome, the reference set every threat is matched against.</Trans>
        </p>
      }
      onClickRow={onClickRow}
    />
  );
};
