import { t } from '@lingui/core/macro';
import { Skeleton } from '@filigran/ui';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { HighlightColor, HighlightedTechnique } from './ttp-matrix-cell';
import { useDragToScroll } from '../../hooks';
import { useTRPC } from '../../lib';
import { TtpMatrixCell } from './ttp-matrix-cell';
import { TooltipHintProvider } from './tooltip-hint';

interface TtpMatrixViewProps {
  highlightedTechniques: Array<HighlightedTechnique>,
  defaultColor?: HighlightColor,
  isLoading?: boolean,
  filterHighlightedOnly?: boolean,
  /** Opens the cells whose sub-techniques are highlighted, so the matched ids are readable at once. */
  expandHighlightedSubTechniques?: boolean,
  /** The tactics whose columns the matrix keeps, by tactic id; left out, it keeps them all. */
  tacticIds?: ReadonlyArray<string>,
}

interface MatrixRawData {
  tactics: Array<{ id: string, name: string, externalId: string, order: number }>,
  techniques: Array<{ id: string, externalId: string, name: string, isSubtechnique: boolean, parentTechniqueId: string | null }>,
  junctions: Array<{ tacticId: string, techniqueId: string }>,
}

const buildMatrixColumns = (raw: MatrixRawData) => {
  const { tactics, techniques, junctions } = raw;

  const tacticToTechniqueIds = new Map<string, Set<string>>();
  for (const junction of junctions) {
    const set = tacticToTechniqueIds.get(junction.tacticId) ?? new Set();
    set.add(junction.techniqueId);
    tacticToTechniqueIds.set(junction.tacticId, set);
  }

  const techniqueMap = new Map(techniques.map((tech) => [tech.id, tech]));

  const subTechniquesByParent = new Map<string, Array<{ id: string, externalId: string, name: string }>>();
  for (const tech of techniques) {
    if (tech.isSubtechnique && tech.parentTechniqueId) {
      const list = subTechniquesByParent.get(tech.parentTechniqueId) ?? [];
      list.push({ id: tech.id, externalId: tech.externalId, name: tech.name });
      subTechniquesByParent.set(tech.parentTechniqueId, list);
    }
  }

  return tactics.map((tactic) => {
    const techIds = tacticToTechniqueIds.get(tactic.id) ?? new Set();
    const parentTechniques = [...techIds]
      .map((id) => techniqueMap.get(id))
      .filter((tech): tech is NonNullable<typeof tech> => tech != null && !tech.isSubtechnique)
      .map((tech) => ({
        id: tech.id,
        externalId: tech.externalId,
        name: tech.name,
        subTechniques: subTechniquesByParent.get(tech.id) ?? [],
      }))
      .sort((a, b) => a.externalId.localeCompare(b.externalId, undefined, { numeric: true }));

    return { tactic, techniques: parentTechniques };
  });
};

export const TtpMatrixView: FunctionComponent<TtpMatrixViewProps> = ({
  highlightedTechniques,
  defaultColor: defaultColorProp,
  isLoading: externalLoading,
  filterHighlightedOnly: filterHighlightedOnlyProp,
  expandHighlightedSubTechniques,
  tacticIds,
}) => {
  const trpc = useTRPC();
  const defaultColor = defaultColorProp ?? 'red';
  const filterHighlightedOnly = filterHighlightedOnlyProp ?? false;
  const { data, isLoading: matrixLoading } = useQuery(trpc.mitreAttack.getMatrix.queryOptions());
  const { containerRef, onPointerDown, onPointerMove, onPointerUp } = useDragToScroll();

  const highlightMap = new Map(highlightedTechniques.map((ht) => [ht.id, ht]));

  const matrixData = data
    ? buildMatrixColumns(data).filter(({ tactic }) => tacticIds === undefined || tacticIds.includes(tactic.id))
    : null;

  if (matrixLoading || externalLoading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-4">
        {Array.from({ length: 14 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-44 flex-shrink-0" />
        ))}
      </div>
    );
  }

  if (!matrixData) {
    return null;
  }

  return (
    <TooltipHintProvider>
      {/* A static scroller does not clip its absolutely positioned descendants (the cells' sr-only
          labels), so the matrix's far columns would widen the whole page. */}
      <div
        ref={containerRef}
        className="relative cursor-grab overflow-auto touch-none [&[data-dragging]>*]:pointer-events-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex gap-1" style={{ minWidth: `${matrixData.length * 180}px` }}>
          {matrixData.map(({ tactic, techniques }) => {
            const filteredTechniques = filterHighlightedOnly
              ? techniques.filter((tech) => highlightMap.has(tech.id) || tech.subTechniques.some((sub) => highlightMap.has(sub.id)))
              : techniques;

            return (
              <div key={tactic.id} className="flex w-44 flex-shrink-0 flex-col">
                <div className="px-2 py-2 text-center txt-sub-content font-semibold">
                  <Link
                    from="/$tenantId/{-$organizationId}"
                    to="settings/taxonomies/mitre-attack/tactics/$tacticExternalId"
                    params={{ tacticExternalId: tactic.externalId }}
                    className="hover:text-primary hover:underline"
                  >
                    {tactic.name}
                  </Link>
                  <span className="ml-1 txt-mini text-muted-foreground">({filteredTechniques.length})</span>
                </div>
                <div className="flex-1">
                  {filterHighlightedOnly && filteredTechniques.length === 0 && (
                    <p className="p-2 text-center txt-sub-content text-muted-foreground">
                      {filterHighlightedOnly ? t`No highlighted techniques` : t`No techniques`}
                    </p>
                  )}
                  {filteredTechniques.map((tech) => (
                    <TtpMatrixCell
                      key={tech.id}
                      id={tech.id}
                      externalId={tech.externalId}
                      name={tech.name}
                      subTechniques={tech.subTechniques}
                      highlightMap={highlightMap}
                      defaultColor={defaultColor}
                      expandHighlightedSubTechniques={expandHighlightedSubTechniques}
                      highlightedSubTechniquesOnly={filterHighlightedOnly}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TooltipHintProvider>
  );
};
