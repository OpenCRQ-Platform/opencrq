import { Button, Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { COVERAGE_BUCKETS, STRENGTH_RUNGS } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import type { CapabilityFunction } from '@app/module/client';
import type { FunctionComponent, ReactElement } from 'react';
import type { TechniqueCapability } from '../types/capability';
import type { TechniqueControlTestReading } from '../types/validation';
import type { TechniqueControlRow } from '../utils/technique-controls-utils';
import type { ColumnDefWithOptionsHeader } from '../../../../components/ui/data-table-types';
import { DataPageLayout } from '../../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../../components/ui/empty-value';
import { ControlIdPill, SectionCard } from '../../../../components/shared';
import { useTRPC } from '../../../../lib';
import { CoverageBadge } from '../ui/coverage-badge';
import { EdgeStateBadge } from '../ui/edge-state-badge';
import { StrengthBadge } from '../ui/strength-badge';
import { useOpenaevConnector } from '../hooks/use-capability-validation';
import { useTechniqueLink } from '../hooks/use-technique-link';
import { useScopePosture } from '../hooks/use-scope-posture';
import { overlayScopeAssessment } from '../utils/scope-posture-utils';
import { controlCounts, controlRowsForFunction, readingOf, rungsOf } from '../utils/technique-controls-utils';
import { evidenceLinkOf } from '../utils/engine-efficacy-utils';
import { efficacyExplanationColumn, ENGINE_EFFICACY_COLUMN_ID, ENGINE_EFFICACY_COLUMN_SIZE, EngineEfficacyFigure, FILLS_SPARE_WIDTH, isTestedNotDeclared, OpenAevResult } from './engine-efficacy-cells';
import { DeclareOnControlButton, EngineEfficacyExplanation, EvidenceLinkButton } from './engine-efficacy-explanation';

const UnassessedBadge = (): ReactElement => <Chip label={t`Not assessed`} />;

const InheritedChip: FunctionComponent<{ externalId: string }> = ({ externalId }) => (
  <Chip label={t`Inherited from ${externalId}`} />
);

const countLabel = (rows: ReadonlyArray<TechniqueControlRow>, readings: ReadonlyArray<TechniqueControlTestReading> | undefined): string => {
  const { covering, notCovered } = controlCounts(rows, readings);
  return notCovered === 0
    ? `${covering}`
    : plural(notCovered, { one: `${covering} + # not covered`, other: `${covering} + # not covered` });
};

/** The technique a row's explanation names. */
export interface TechniqueIdentity {
  id: string,
  externalId: string,
  name: string,
}

const isUnassessed = (control: TechniqueControlRow, reading: TechniqueControlTestReading | undefined): boolean =>
  control.kind === 'edge' && control.assessment === null && reading?.covered !== false;

const isUnlinkedRow = (control: TechniqueControlRow): boolean => control.kind === 'tested' || control.state === 'removed';

const EngineEfficacy: FunctionComponent<{
  control: TechniqueControlRow,
  reading: TechniqueControlTestReading | undefined,
}> = ({ control, reading }) => {
  if (isUnassessed(control, reading)) {
    return <UnassessedBadge />;
  }
  if (reading === undefined) {
    return <EmptyValue />;
  }
  return <EngineEfficacyFigure reading={reading} isUnlinked={isUnlinkedRow(control)} />;
};

const isRemovedRow = (control: TechniqueControlRow): boolean => control.kind === 'edge' && control.state === 'removed';

/**
 * A link inherited from the parent, unlinked or not, is changed on the parent's page only: the engine
 * reads it on the parent's row, so changing it from here would change it for every sibling too.
 */
const isInheritedRow = (control: TechniqueControlRow): boolean => control.kind === 'edge' && control.inheritedFrom !== null;

const DeclareButton: FunctionComponent<{ control: TechniqueControlRow, technique: TechniqueIdentity, inRow?: boolean }> = ({ control, technique, inRow }) => (
  <DeclareOnControlButton
    capabilityId={control.id}
    control={control.externalId}
    techniqueId={technique.id}
    capabilityFunction={control.function}
    isRemoved={isRemovedRow(control)}
    inRow={inRow}
  />
);

const isUndeclaredRow = (control: TechniqueControlRow, reading: TechniqueControlTestReading | undefined): boolean =>
  reading !== undefined && isTestedNotDeclared(reading, isUnlinkedRow(control));

const isDeclarableRow = (control: TechniqueControlRow, reading: TechniqueControlTestReading | undefined): boolean =>
  isUndeclaredRow(control, reading) && !isInheritedRow(control);

/** Unlinks a linked row, and links back one the tenant unlinked. */
const LinkToggleButton: FunctionComponent<{ control: TechniqueControlRow, technique: TechniqueIdentity }> = ({ control, technique }) => {
  const { link, unlink, isPending } = useTechniqueLink();
  const isRemoved = isRemovedRow(control);
  return (
    <Button
      priority="tertiary"
      size="sm"
      disabled={isPending}
      onClick={(event) => {
        event.stopPropagation();
        const target = { capabilityId: control.id, techniqueId: technique.id, function: control.function };
        if (isRemoved) {
          link(target, true);
        } else {
          unlink(target);
        }
      }}
    >
      {isRemoved ? <Trans>Link</Trans> : <Trans>Unlink</Trans>}
    </Button>
  );
};

const EngineEfficacyInfo: FunctionComponent<{
  control: TechniqueControlRow,
  reading: TechniqueControlTestReading | undefined,
  technique: TechniqueIdentity,
  isValidationAvailable: boolean,
}> = ({ control, reading, technique, isValidationAvailable }) => {
  if (reading === undefined || isUnassessed(control, reading)) {
    return null;
  }
  const link = evidenceLinkOf(reading, technique.externalId, isValidationAvailable);
  const evidence = link === null ? undefined : <EvidenceLinkButton controlId={control.id} control={control.externalId} link={link} />;
  return (
    <EngineEfficacyExplanation
      reading={reading}
      control={control.externalId}
      techniqueExternalId={technique.externalId}
      techniqueName={technique.name}
      footerAction={isDeclarableRow(control, reading) ? <>{evidence}<DeclareButton control={control} technique={technique} /></> : evidence}
    />
  );
};

const buildControlColumns = (
  readings: ReadonlyArray<TechniqueControlTestReading> | undefined,
  technique: TechniqueIdentity,
  isValidationAvailable: boolean,
): Array<ColumnDefWithOptionsHeader<TechniqueControlRow, unknown>> => [
  {
    id: 'externalId',
    accessorKey: 'externalId',
    header: t`ID`,
    size: 96,
    cell: ({ row }): ReactElement => <ControlIdPill externalId={row.original.externalId} />,
  },
  {
    id: 'name',
    accessorKey: 'name',
    header: t`Control`,
    size: 170,
    cell: ({ row }): ReactElement => (
      <span className="flex flex-wrap items-center gap-2 whitespace-normal">
        <span className="font-medium">{row.original.name}</span>
        {row.original.kind === 'edge' && row.original.inheritedFrom && <InheritedChip externalId={row.original.inheritedFrom.externalId} />}
        {row.original.kind === 'edge' && <EdgeStateBadge value={row.original.state} />}
      </span>
    ),
  },
  {
    id: 'posture',
    accessorFn: (row) => {
      const rungs = rungsOf(row);
      return rungs === null ? undefined : STRENGTH_RUNGS.indexOf(rungs.strengthRung) * COVERAGE_BUCKETS.length + COVERAGE_BUCKETS.indexOf(rungs.coverageBucket);
    },
    sortUndefined: 'last',
    header: t`Declared posture`,
    size: 135,
    cell: ({ row }): ReactElement => {
      const rungs = rungsOf(row.original);
      return rungs === null
        ? <UnassessedBadge />
        : (
          <span className="flex flex-col items-start gap-1">
            <StrengthBadge value={rungs.strengthRung} />
            <CoverageBadge value={rungs.coverageBucket} />
          </span>
        );
    },
  },
  {
    id: 'openaevResult',
    accessorFn: (row) => readingOf(readings, row)?.tested?.rate,
    sortUndefined: 'last',
    header: t`OpenAEV result`,
    size: 215,
    cell: ({ row }): ReactElement => <OpenAevResult reading={readingOf(readings, row.original)} />,
  },
  {
    id: ENGINE_EFFICACY_COLUMN_ID,
    accessorFn: (row) => {
      const reading = readingOf(readings, row);
      return rungsOf(row) === null || reading?.covered !== true ? undefined : reading.efficacy;
    },
    sortUndefined: 'last',
    sortDescFirst: true,
    header: t`Engine efficacy`,
    size: ENGINE_EFFICACY_COLUMN_SIZE,
    cell: ({ row }): ReactElement => <EngineEfficacy control={row.original} reading={readingOf(readings, row.original)} />,
  },
  efficacyExplanationColumn<TechniqueControlRow>((row) => (
    <EngineEfficacyInfo control={row} reading={readingOf(readings, row)} technique={technique} isValidationAvailable={isValidationAvailable} />
  )),
  {
    id: 'declare',
    header: () => <span className="sr-only">{t`Actions`}</span>,
    optionsHeader: () => null,
    ...FILLS_SPARE_WIDTH,
    enableSorting: false,
    enableHiding: false,
    enableResizing: false,
    cell: ({ row }): ReactElement | null => {
      if (isDeclarableRow(row.original, readingOf(readings, row.original))) {
        return <DeclareButton control={row.original} technique={technique} inRow />;
      }
      return row.original.kind === 'edge' && !isInheritedRow(row.original)
        ? <LinkToggleButton control={row.original} technique={technique} />
        : null;
    },
  },
];

interface TechniqueControlsCardProps {
  title: string,
  emptyState: ReactElement,
  storageKey: string,
  controls: Array<TechniqueCapability>,
  readings: ReadonlyArray<TechniqueControlTestReading> | undefined,
  technique: TechniqueIdentity,
  capabilityFunction: CapabilityFunction,
  isLoading: boolean,
  /** Whether a control's validation evidence can be listed, which its dialog then leads to. */
  isValidationAvailable: boolean,
}

const TechniqueControlsCard: FunctionComponent<TechniqueControlsCardProps> = ({
  title,
  emptyState,
  storageKey,
  controls,
  readings,
  technique,
  capabilityFunction,
  isLoading,
  isValidationAvailable,
}) => {
  const navigate = useNavigate();
  const rows = controlRowsForFunction(controls, readings, capabilityFunction);
  return (
    <SectionCard
      title={title}
      headerAction={rows.length > 0 ? <Chip label={countLabel(rows, readings)} /> : undefined}
    >
      <DataPageLayout
        data={rows}
        columns={buildControlColumns(readings, technique, isValidationAvailable)}
        storageKey={storageKey}
        isLoading={isLoading}
        hideToolbar
        emptyState={emptyState}
        onClickRow={(row) => void navigate({
          from: '/$tenantId/{-$organizationId}',
          to: 'controls/$controlId/overview',
          params: { controlId: row.original.id },
        })}
      />
    </SectionCard>
  );
};

interface TechniqueControlsSectionProps {
  technique: TechniqueIdentity,
}

export const TechniqueControlsSection: FunctionComponent<TechniqueControlsSectionProps> = ({ technique }) => {
  const trpc = useTRPC();
  const { data, isLoading: isLoadingControls } = useQuery(trpc.controlCapabilities.getCapabilitiesForTechnique.queryOptions({
    techniqueId: technique.id,
  }));
  const { organizationId, postures, isAwaitingScope } = useScopePosture();
  const { data: readings, isLoading: isLoadingReadings } = useQuery(trpc.controlValidation.getTechniqueTestReadings.queryOptions({
    techniqueId: technique.id,
    organizationId: organizationId ?? null,
  }));
  // A control carrying a result is one a simulation reaches, so the connector is all its validation still needs.
  const isValidationAvailable = useOpenaevConnector().isConfigured === true;
  const isLoading = isLoadingControls || isLoadingReadings || isAwaitingScope;
  const controls = data === undefined || isAwaitingScope ? [] : overlayScopeAssessment(data, postures);
  return (
    <>
      <TechniqueControlsCard
        title={t`Prevented by`}
        storageKey="technique.controls.prevention"
        controls={controls}
        readings={readings}
        technique={technique}
        capabilityFunction="prevent"
        isLoading={isLoading}
        isValidationAvailable={isValidationAvailable}
        emptyState={(
          <p className="txt-sub-content text-default-secondary">
            <Trans>No control in the catalogue prevents this technique.</Trans>
          </p>
        )}
      />
      <TechniqueControlsCard
        title={t`Detected by`}
        storageKey="technique.controls.detection"
        controls={controls}
        readings={readings}
        technique={technique}
        capabilityFunction="detect"
        isLoading={isLoading}
        isValidationAvailable={isValidationAvailable}
        emptyState={(
          <p className="txt-sub-content text-default-secondary">
            <Trans>No control in the catalogue detects this technique.</Trans>
          </p>
        )}
      />
    </>
  );
};
