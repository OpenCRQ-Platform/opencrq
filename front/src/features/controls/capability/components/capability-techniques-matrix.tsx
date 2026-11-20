import { Button } from '@filigran/design-system';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { useNavigate, useParams, useRouter } from '@tanstack/react-router';
import type { CapabilityFunction } from '@app/module/client';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { CapabilityEdge } from '../types/capability';
import type { ControlTechniqueTestReading } from '../types/validation';
import type { HighlightedTechnique } from '../../../../components/shared/ttp-matrix-cell';
import type { SegmentedCount } from '../../../../components/ui/segmented-counts';
import type { EfficacySegment } from '../utils/control-technique-readings-utils';
import type { CellContext } from '../ui/technique-cell-highlights';
import { ConfirmDialog, DashboardGroup } from '../../../../components/shared';
import { DataPageWithTtpMatrix } from '../../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../../components/ui/empty-value';
import { useTRPC } from '../../../../lib';
import { useCapabilityValidation, validationCellKey } from '../hooks/use-capability-validation';
import { useTechniqueLink } from '../hooks/use-technique-link';
import { cn } from '../../../../utils';
import { EdgeStateBadge, edgeStateLabel } from '../ui/edge-state-badge';
import { coveredHighlight, MatrixLegend, uncoveredHighlight } from '../ui/technique-cell-highlights';
import { evidenceLinkOf } from '../utils/engine-efficacy-utils';
import { coveredTechniquesForFunction, FUNCTION_COLOR } from '../utils/technique-matrix-utils';
import {
  hasTestedReading,
  isEfficacySegment,
  isLinkedTechnique,
  isRemovedTechnique,
  readingsByTechnique,
  readingsWithoutEdge,
  techniquesBySegment,
  testedUncoveredReadings,
} from '../utils/control-technique-readings-utils';
import { AddTechniqueDialog } from './add-technique-dialog';
import { efficacyExplanationColumn, ENGINE_EFFICACY_COLUMN_ID, ENGINE_EFFICACY_COLUMN_SIZE, EngineEfficacyFigure, FILLS_SPARE_WIDTH, isTestedNotDeclared, OpenAevResult } from './engine-efficacy-cells';
import { DeclareOnControlButton, EngineEfficacyDialog, EngineEfficacyExplanation, EvidenceLinkButton } from './engine-efficacy-explanation';

interface CapabilityTechniquesMatrixProps {
  capabilityId: string,
  /** The control's catalogue id, which the efficacy's explanation names it by. */
  controlExternalId: string,
  /** Every edge of the control: the surface keeps only the ones of its own function. */
  edges: Array<CapabilityEdge>,
  capabilityFunction: CapabilityFunction,
  /** `isSimulationReachable` of the control; false keeps every validation addition off the matrix. */
  isReachable: boolean,
}

/** A line of the table: an edge of the control, or a technique only OpenAEV tested it on. */
type TechniqueRow = { id: string } & (
  | CapabilityEdge & { kind: 'edge' }
  | Pick<CapabilityEdge, 'techniqueId' | 'techniqueExternalId' | 'techniqueName' | 'function'> & { kind: 'tested' }
)

export const CapabilityTechniquesMatrix = ({
  capabilityId,
  controlExternalId,
  edges,
  capabilityFunction,
  isReachable,
}: CapabilityTechniquesMatrixProps): ReactNode => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const router = useRouter();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [segment, setSegment] = useState<EfficacySegment>('all');
  const [explainedTechniqueId, setExplainedTechniqueId] = useState<string | null>(null);

  const validation = useCapabilityValidation(capabilityId, isReachable);
  const hasEvidence = (techniqueId: string): boolean =>
    validation.isVisible && validation.cellByTechnique.has(validationCellKey(techniqueId, capabilityFunction));
  const { organizationId } = useParams({ strict: false });
  const { data: readingsData, isLoading: isLoadingReadings } = useQuery(trpc.controlValidation.getControlTechniqueTestReadings.queryOptions({
    capabilityId,
    function: capabilityFunction,
    organizationId: organizationId ?? null,
  }));
  const readings = readingsByTechnique(readingsData);
  // A control OpenAEV cannot test and has no stored result for keeps the page it had: no result to
  // show and nothing to filter on. A stored result shows even once the connector is gone, since the
  // engine still reads it.
  const showsResults = validation.isAvailable === true || hasTestedReading(readingsData);

  const isPrevention = capabilityFunction === 'prevent';
  const functionEdges = edges.filter((edge) => edge.function === capabilityFunction);
  const overrideCount = functionEdges.filter((edge) => edge.state !== 'recommended').length;

  const refresh = async () => {
    await router.invalidate();
  };

  const techniqueLink = useTechniqueLink(refresh);
  const resetOverrides = useMutation(trpc.controlCapabilities.resetTechniqueOverrides.mutationOptions({
    meta: { successMessage: msg`Technique links reset to catalogue recommendations successfully.` },
    onSuccess: refresh,
  }));

  const addButton = (
    <Button priority="secondary" onClick={() => setIsAddOpen(true)}>
      <Trans>Link a technique</Trans>
    </Button>
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {addButton}
      <Button
        priority="secondary"
        disabled={overrideCount === 0}
        onClick={() => setIsResetOpen(true)}
        aria-label={isPrevention
          ? t`Reset the prevention links to catalogue recommendations`
          : t`Reset the detection links to catalogue recommendations`}
      >
        {isPrevention ? <Trans>Reset prevention links</Trans> : <Trans>Reset detection links</Trans>}
      </Button>
    </div>
  );

  const resetDescription = isPrevention
    ? plural(overrideCount, {
      one: '# technique you linked or unlinked on prevention is discarded and the catalogue recommendations apply again. Detection is left untouched. This cannot be undone.',
      other: '# techniques you linked or unlinked on prevention are discarded and the catalogue recommendations apply again. Detection is left untouched. This cannot be undone.',
    })
    : plural(overrideCount, {
      one: '# technique you linked or unlinked on detection is discarded and the catalogue recommendations apply again. Prevention is left untouched. This cannot be undone.',
      other: '# techniques you linked or unlinked on detection are discarded and the catalogue recommendations apply again. Prevention is left untouched. This cannot be undone.',
    });

  const dialogs = (
    <>
      <AddTechniqueDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        capabilityFunction={capabilityFunction}
        coveredTechniqueIds={functionEdges.map((edge) => edge.techniqueId)}
        onConfirm={(techniqueId) =>
          techniqueLink.link({ capabilityId, techniqueId, function: capabilityFunction }, false)}
      />
      <ConfirmDialog
        open={isResetOpen}
        onOpenChange={setIsResetOpen}
        onConfirm={() => {
          resetOverrides.mutate({ capabilityId, function: capabilityFunction });
          setIsResetOpen(false);
        }}
        title={isPrevention
          ? <Trans>Reset the prevention links to catalogue recommendations</Trans>
          : <Trans>Reset the detection links to catalogue recommendations</Trans>}
        description={resetDescription}
        submitButtonText={<Trans>Reset</Trans>}
      />
    </>
  );

  const inPaper = (content: ReactNode, action?: ReactNode) => (
    <DashboardGroup icon="layout-grid" title={t`Techniques`} action={action}>{content}</DashboardGroup>
  );

  const withoutEdge = readingsWithoutEdge(readings, functionEdges.map((edge) => edge.techniqueId));

  if (functionEdges.length === 0 && withoutEdge.length === 0) {
    const emptyState = (
      <div className="flex flex-col items-center gap-4 py-12">
        <div className="text-center">
          <p className="txt-subtitle2">
            {isPrevention
              ? <Trans>This control does not prevent any technique.</Trans>
              : <Trans>This control does not detect any technique.</Trans>}
          </p>
          <p className="txt-sub-content text-muted-foreground">
            {isPrevention
              ? <Trans>The catalogue credits it with no prevention. If your deployment prevents something the catalogue does not credit, link it.</Trans>
              : <Trans>The catalogue credits it with no detection. If your deployment detects something the catalogue does not credit, link it.</Trans>}
          </p>
        </div>
        {addButton}
        {dialogs}
      </div>
    );
    return inPaper(emptyState);
  }

  const covered = coveredTechniquesForFunction(edges, capabilityFunction);
  const uncovered = testedUncoveredReadings(readings);
  const bySegment = techniquesBySegment(covered.map((technique) => technique.techniqueId), readings);
  const segments: Array<SegmentedCount> = [
    { key: 'all', label: t`All`, count: functionEdges.length + withoutEdge.length },
    { key: 'confirmed', label: t({ message: 'Confirmed by the tests', context: 'technique filter' }), count: bySegment.confirmed.size },
    { key: 'lowered', label: t({ message: 'Lowered by the tests', context: 'technique filter' }), count: bySegment.lowered.size },
    { key: 'untested', label: t`Not tested`, count: bySegment.untested.size },
    { key: 'uncovered', label: t({ message: 'Tested, not covered', context: 'technique filter' }), count: bySegment.uncovered.size },
  ];

  const activeSegment: EfficacySegment = showsResults ? segment : 'all';
  const isInSegment = (techniqueId: string): boolean =>
    activeSegment === 'all' || bySegment[activeSegment].has(techniqueId);

  const rows: Array<TechniqueRow> = [
    ...functionEdges.map((edge): TechniqueRow => ({ ...edge, kind: 'edge', id: edge.techniqueId })),
    ...withoutEdge.map(({ mitreTechniqueId, techniqueExternalId, techniqueName }): TechniqueRow => ({
      kind: 'tested',
      id: mitreTechniqueId,
      techniqueId: mitreTechniqueId,
      techniqueExternalId,
      techniqueName,
      function: capabilityFunction,
    })),
  ].filter((row) => isInSegment(row.techniqueId));

  const evidenceAction = (reading: ControlTechniqueTestReading, techniqueExternalId: string): ReactNode => {
    const link = evidenceLinkOf(reading, techniqueExternalId, validation.isAvailable === true);
    return link === null ? undefined : <EvidenceLinkButton controlId={capabilityId} control={controlExternalId} link={link} />;
  };

  const isLinked = (techniqueId: string): boolean => isLinkedTechnique(functionEdges, techniqueId);
  /** The evidence behind a result, or, for a technique OpenAEV tested the control on without its being linked, the way to declare it. */
  const footerActionOf = (reading: ControlTechniqueTestReading, techniqueExternalId: string, onDeclared?: () => void): ReactNode => {
    if (!isTestedNotDeclared(reading, !isLinked(reading.mitreTechniqueId))) {
      return evidenceAction(reading, techniqueExternalId);
    }
    return (
      <>
        {evidenceAction(reading, techniqueExternalId)}
        <DeclareOnControlButton
          capabilityId={capabilityId}
          control={controlExternalId}
          techniqueId={reading.mitreTechniqueId}
          capabilityFunction={capabilityFunction}
          isRemoved={isRemovedTechnique(functionEdges, reading.mitreTechniqueId)}
          onDeclared={() => {
            onDeclared?.();
            void refresh();
          }}
        />
      </>
    );
  };

  /** A removed technique reads only the results it kept, not covered. */
  const readingOfRow = (row: TechniqueRow): ControlTechniqueTestReading | undefined => readings.get(row.techniqueId);
  const isRemoved = (row: TechniqueRow): boolean => row.kind === 'edge' && row.state === 'removed';

  const columns: Array<ColumnDefWithOptionsHeader<TechniqueRow, unknown>> = [
    {
      id: 'techniqueExternalId',
      accessorKey: 'techniqueExternalId',
      header: t`Technique`,
      size: 280,
      cell: ({ row }) => (
        <span className={cn(isRemoved(row.original) && 'line-through text-muted-foreground')}>
          <span className="font-mono txt-sub-content text-muted-foreground">{row.original.techniqueExternalId}</span>
          {' '}{row.original.techniqueName}
        </span>
      ),
    },
    {
      id: 'state',
      accessorKey: 'state',
      header: t`Origin`,
      size: 140,
      cell: ({ row }) => (row.original.kind === 'edge' ? <EdgeStateBadge value={row.original.state} /> : <EmptyValue />),
    },
    ...(showsResults
      ? [{
        id: 'openaevResult',
        accessorFn: (row: TechniqueRow) => readingOfRow(row)?.tested?.rate,
        sortUndefined: 'last' as const,
        header: t`OpenAEV result`,
        size: 220,
        cell: ({ row }: { row: { original: TechniqueRow } }) => (isRemoved(row.original) && readingOfRow(row.original) === undefined
          ? null
          : (
            <OpenAevResult reading={isLoadingReadings ? undefined : readingOfRow(row.original)} />
          )),
      } satisfies ColumnDefWithOptionsHeader<TechniqueRow, unknown>]
      : []),
    {
      id: ENGINE_EFFICACY_COLUMN_ID,
      accessorFn: (row) => {
        const reading = readingOfRow(row);
        return reading?.covered === true ? reading.efficacy : undefined;
      },
      sortUndefined: 'last',
      sortDescFirst: true,
      header: t`Engine efficacy`,
      size: ENGINE_EFFICACY_COLUMN_SIZE,
      cell: ({ row }) => {
        const reading = readingOfRow(row.original);
        if (reading === undefined) {
          return isRemoved(row.original) ? null : <EmptyValue />;
        }
        return <EngineEfficacyFigure reading={reading} isUnlinked={!isLinked(row.original.techniqueId)} />;
      },
    },
    efficacyExplanationColumn<TechniqueRow>((row) => {
      const reading = readingOfRow(row);
      return reading === undefined
        ? null
        : (
          <EngineEfficacyExplanation
            reading={reading}
            control={controlExternalId}
            techniqueExternalId={row.techniqueExternalId}
            techniqueName={row.techniqueName}
            footerAction={footerActionOf(reading, row.techniqueExternalId)}
          />
        );
    }),
    {
      id: 'actions',
      accessorKey: 'techniqueId',
      header: '',
      ...FILLS_SPARE_WIDTH,
      cell: ({ row }) => (
        <Button
          priority="tertiary"
          size="sm"
          disabled={techniqueLink.isPending}
          onClick={(event) => {
            event.stopPropagation();
            const target = { capabilityId, techniqueId: row.original.techniqueId, function: capabilityFunction };
            if (row.original.kind === 'tested' || isRemoved(row.original)) {
              techniqueLink.link(target, isRemoved(row.original));
            } else {
              techniqueLink.unlink(target);
            }
          }}
        >
          {row.original.kind === 'tested' || isRemoved(row.original) ? <Trans>Link</Trans> : <Trans>Unlink</Trans>}
        </Button>
      ),
    },
  ];

  const cellContext: CellContext = { capabilityFunction, isLinked, onExplain: setExplainedTechniqueId };
  const addedLabel = edgeStateLabel('added');
  const highlightedTechniques: Array<HighlightedTechnique> = [
    ...covered.map((technique) => coveredHighlight(
      technique.techniqueId,
      technique.edges.some((edge) => edge.state === 'added') ? [{ label: t`Origin`, value: addedLabel }] : [],
      showsResults ? readings.get(technique.techniqueId) : undefined,
      cellContext,
    )),
    // A removed technique covers nothing, so it drops out of the matrix unless OpenAEV tested it; the
    // table keeps its line so the departure from the catalogue stays visible and restorable.
    ...(showsResults ? uncovered.filter((reading) => !covered.some((technique) => technique.techniqueId === reading.mitreTechniqueId)).map((reading) => uncoveredHighlight(reading, cellContext)) : []),
    ...(showsResults ? withoutEdge.filter((reading) => reading.covered).map((reading) => coveredHighlight(reading.mitreTechniqueId, [], reading, cellContext)) : []),
  ].filter((highlight) => isInSegment(highlight.id));

  const explained = explainedTechniqueId === null ? undefined : [...functionEdges, ...withoutEdge.map((reading) => ({
    techniqueId: reading.mitreTechniqueId,
    techniqueExternalId: reading.techniqueExternalId,
    techniqueName: reading.techniqueName,
  }))].find((technique) => technique.techniqueId === explainedTechniqueId);
  const explainedReading = explained === undefined ? undefined : readings.get(explained.techniqueId);

  const page = (
    <DataPageWithTtpMatrix
      data={rows}
      columns={columns}
      storageKey={`capability-techniques-${capabilityFunction}`}
      highlightedTechniques={highlightedTechniques}
      defaultColor={FUNCTION_COLOR[capabilityFunction]}
      defaultView="matrix"
      isLoading={isLoadingReadings}
      {...(showsResults && {
        segments,
        activeSegment,
        onSegmentChange: (key: string) => {
          if (isEfficacySegment(key)) {
            setSegment(key);
          }
        },
        segmentsLabel: isPrevention ? t`Filter prevention by result` : t`Filter detection by result`,
        forceHighlightedOnly: activeSegment !== 'all',
        matrixHeader: <MatrixLegend />,
      })}
      onClickRow={(row) => {
        if (row.original.kind === 'edge' && row.original.state !== 'removed' && hasEvidence(row.original.techniqueId)) {
          void navigate({
            from: '/$tenantId/{-$organizationId}/controls/$controlId',
            to: 'validation',
            search: { technique: row.original.techniqueExternalId },
          });
          return;
        }
        void navigate({
          to: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
          params: (prev) => ({ tenantId: prev.tenantId!, techniqueExternalId: row.original.techniqueExternalId }),
        });
      }}
    />
  );

  return (
    <>
      {inPaper(page, headerActions)}
      {dialogs}
      {explained !== undefined && explainedReading !== undefined && (
        <EngineEfficacyDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setExplainedTechniqueId(null);
            }
          }}
          reading={explainedReading}
          control={controlExternalId}
          techniqueExternalId={explained.techniqueExternalId}
          techniqueName={explained.techniqueName}
          footerAction={footerActionOf(explainedReading, explained.techniqueExternalId, () => setExplainedTechniqueId(null))}
        />
      )}
    </>
  );
};
