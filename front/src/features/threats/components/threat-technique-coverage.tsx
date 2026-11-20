import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { CapabilityFunction, TechniqueFunctionCoverage } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import type { HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import type { SegmentedCount } from '../../../components/ui/segmented-counts';
import type { CellContext } from '../../controls/capability/ui/technique-cell-highlights';
import type { OtherControlLine, OtherControlStatus, TestedAbsentControlReading } from './threat-coverage-utils';
import type { ThreatTechniqueRow } from './threat-ttp-utils';
import { EmptyValue } from '../../../components/ui/empty-value';
import { cn } from '../../../utils';
import { EngineEfficacyFigure, OpenAevResult } from '../../controls/capability/components/engine-efficacy-cells';
import {
  DeclareOnControlButton,
  EngineEfficacyDialog,
  EngineEfficacyExplanation,
  EvidenceLinkButton,
} from '../../controls/capability/components/engine-efficacy-explanation';
import { coveredHighlight, uncoveredHighlight } from '../../controls/capability/ui/technique-cell-highlights';
import { evidenceLinkOf, formatEnginePercent } from '../../controls/capability/utils/engine-efficacy-utils';
import { FUNCTION_COLOR } from '../../controls/capability/utils/technique-matrix-utils';
import { otherControlLine, presentControlCount, shownReadingOf, testedAbsentReadingOf, testedUncoveredReadingOf } from './threat-coverage-utils';
import { revokedCitationNote } from './threat-ttp-utils';

/** Past it, the tooltip counts the remaining controls rather than naming them. */
const OTHER_CONTROLS_SHOWN = 5;

const statusText = (status: OtherControlStatus, efficacy: number | null): string => {
  const figure = efficacy === null ? '' : formatEnginePercent(efficacy);
  switch (status) {
    case 'confirmed': {
      const verdict = t({ message: 'Confirmed by the tests', context: 'technique filter' });
      return t`${figure} · ${verdict}`;
    }
    case 'lowered': {
      const verdict = t({ message: 'Lowered by the tests', context: 'technique filter' });
      return t`${figure} · ${verdict}`;
    }
    case 'untested': {
      const verdict = t`Not tested`;
      return t`${figure} · ${verdict}`;
    }
    case 'absent':
      return t`Declared at no coverage`;
    case 'unassessed':
      return t`Not assessed`;
    case 'testedNotCovered':
      return t({ message: 'Tested, not covered', context: 'technique filter' });
    case 'notCovered':
      return t({ message: 'Not covered', context: 'engine efficacy' });
  }
};

const ControlLine: FunctionComponent<{ line: OtherControlLine }> = ({ line }) => (
  <span className="flex items-baseline justify-between gap-2 txt-sub-content">
    <span className="min-w-0 truncate" title={line.capabilityName}>
      <span className="font-mono">{line.capabilityExternalId}</span>
      {' '}{line.capabilityName}
    </span>
    <span className="shrink-0 text-muted-foreground">{statusText(line.status, line.efficacy)}</span>
  </span>
);

interface ControlLines {
  /** Names what the lines are: the controls beside the best one, or every control listed where none covers the technique. */
  heading: string,
  lines: Array<OtherControlLine>,
}

/** Under a technique's tooltip: the other controls listed there with their verdicts, and the note on a revoked citation. */
const OtherControls: FunctionComponent<ControlLines & { note: string | null }> = ({ heading, lines, note }) => {
  const hidden = lines.length - OTHER_CONTROLS_SHOWN;
  return (
    <span className="flex flex-col gap-1 border-t border-border pt-1.5">
      {lines.length > 0 && <span className="txt-sub-content text-muted-foreground">{heading}</span>}
      {lines.slice(0, OTHER_CONTROLS_SHOWN).map((line) => <ControlLine key={line.capabilityId} line={line} />)}
      {hidden > 0 && (
        <span className="txt-sub-content text-muted-foreground">
          {plural(hidden, { one: '# more control', other: '# more controls' })}
        </span>
      )}
      {note !== null && <span className="txt-sub-content text-muted-foreground">{note}</span>}
    </span>
  );
};

/** The lines a tooltip with no content of its own shows, kept when the other controls are added under them. */
const PlainLines: FunctionComponent<{ highlight: HighlightedTechnique }> = ({ highlight }) => (
  <span className="flex flex-col">
    {highlight.categoryLabel !== undefined && <span>{highlight.categoryLabel}</span>}
    {highlight.tooltipExtra?.map((entry) => <span key={entry.label}>{entry.label}: {entry.value}</span>)}
  </span>
);

const withOtherControls = (highlight: HighlightedTechnique, { heading, lines }: ControlLines, note: string | null): HighlightedTechnique =>
  (lines.length === 0 && note === null
    ? highlight
    : {
      ...highlight,
      tooltipContent: (
        <>
          {highlight.tooltipContent ?? <PlainLines highlight={highlight} />}
          <OtherControls heading={heading} lines={lines} note={note} />
        </>
      ),
    });

const explainOnClick = (techniqueId: string, onExplain: (techniqueId: string) => void): HighlightedTechnique['renderLink'] => ({ className, children }) => (
  <button type="button" className={cn(className, 'text-left')} onClick={() => onExplain(techniqueId)}>
    {children}
  </button>
);

const controlName = ({ capabilityExternalId, capabilityName }: { capabilityExternalId: string, capabilityName: string }): string =>
  `${capabilityExternalId} ${capabilityName}`;

/** Why the engine reads a linked control as absent: declared at no coverage, or never assessed. */
const absentWording = (reading: TestedAbsentControlReading): string => statusText(otherControlLine(reading).status, null);

/** A threat technique's cell before its coverage is read, or where it could not be: the technique alone. */
export const plainTechniqueHighlight = (technique: ThreatTechniqueRow, capabilityFunction: CapabilityFunction): HighlightedTechnique => ({
  id: technique.id,
  color: FUNCTION_COLOR[capabilityFunction],
  categoryLabel: revokedCitationNote(technique.externalId, technique.citedExternalIds) ?? undefined,
});

/**
 * A threat technique's cell on one function, the control page's cell for its best covering control,
 * named in the tooltip with the others; where none covers it, the first tested control, one linked to it
 * by why the engine reads it as absent; "Not covered" otherwise.
 */
export const techniqueCoverageHighlight = (
  technique: ThreatTechniqueRow,
  coverage: TechniqueFunctionCoverage | undefined,
  capabilityFunction: CapabilityFunction,
  onExplain: (techniqueId: string) => void,
): HighlightedTechnique => {
  const note = revokedCitationNote(technique.externalId, technique.citedExternalIds);
  const identity = { techniqueExternalId: technique.externalId, techniqueName: technique.name };
  const best = coverage?.best ?? null;
  if (coverage !== undefined && best !== null) {
    const context: CellContext = { capabilityFunction, isLinked: () => true, onExplain };
    const count = presentControlCount(coverage);
    const origin = [
      { label: count > 1 ? t`Best of ${count} controls` : t`Control`, value: controlName(best) },
      ...(best.tested === null
        ? [
          { label: t`Engine efficacy`, value: formatEnginePercent(best.efficacy) },
          { label: t({ message: 'Declared', context: 'engine efficacy' }), value: formatEnginePercent(best.declared) },
          { label: t`OpenAEV`, value: t`Not tested` },
        ]
        : []),
    ];
    const highlight = coveredHighlight(technique.id, origin, { ...best, ...identity }, context);
    return withOtherControls(
      { ...highlight, renderLink: highlight.renderLink ?? explainOnClick(technique.id, onExplain), tooltipHint: t`Click for the calculation` },
      { heading: t`Other controls`, lines: coverage.others.map(otherControlLine) },
      note,
    );
  }
  const tested = testedUncoveredReadingOf(coverage);
  if (coverage !== undefined && tested !== null) {
    const context: CellContext = { capabilityFunction, isLinked: () => tested.linked, onExplain };
    const lines = [tested, ...coverage.others.filter((other) => other.capabilityId !== tested.capabilityId)].map(otherControlLine);
    return withOtherControls(uncoveredHighlight({ ...tested, ...identity }, context), { heading: t`Controls`, lines }, note);
  }
  const absent = testedAbsentReadingOf(coverage);
  if (coverage !== undefined && absent !== null) {
    const context: CellContext = { capabilityFunction, isLinked: () => true, onExplain };
    const lines = [absent, ...coverage.others.filter((other) => other.capabilityId !== absent.capabilityId)].map(otherControlLine);
    const { capabilityId, function: fn, mitreTechniqueId, familyTechniqueId, tested: result, capabilityExternalId, capabilityName, capabilityRungs } = absent;
    // The engine prices no figure for it, so its cell is drawn as an unread control's, its result alone.
    const unread = { covered: false as const, capabilityId, function: fn, mitreTechniqueId, familyTechniqueId, tested: result, capabilityExternalId, capabilityName, capabilityRungs };
    return withOtherControls(uncoveredHighlight({ ...unread, ...identity }, context, absentWording(absent)), { heading: t`Controls`, lines }, note);
  }
  const notCovered: HighlightedTechnique = {
    id: technique.id,
    color: FUNCTION_COLOR[capabilityFunction],
    categoryLabel: t({ message: 'Not covered', context: 'engine efficacy' }),
    outlined: true,
  };
  return withOtherControls(notCovered, { heading: t`Controls`, lines: (coverage?.others ?? []).map(otherControlLine) }, note);
};

/** The result filters with their counts, every technique under `all`. */
export const coverageSegments = (total: number, bySegment: Record<'confirmed' | 'lowered' | 'untested' | 'uncovered', Set<string>>): Array<SegmentedCount> => [
  { key: 'all', label: t`All`, count: total },
  { key: 'confirmed', label: t({ message: 'Confirmed by the tests', context: 'technique filter' }), count: bySegment.confirmed.size },
  { key: 'lowered', label: t({ message: 'Lowered by the tests', context: 'technique filter' }), count: bySegment.lowered.size },
  { key: 'untested', label: t`Not tested`, count: bySegment.untested.size },
  { key: 'uncovered', label: t({ message: 'Tested, not covered', context: 'technique filter' }), count: bySegment.uncovered.size },
];

/**
 * The evidence behind a reading's result, and the declaration of a test no active edge ties to the
 * technique, unless the link it lacks is the parent's, which is changed on the parent's page.
 */
const footerActionOf = (coverage: TechniqueFunctionCoverage | undefined, techniqueExternalId: string, isValidationAvailable: boolean): ReactNode => {
  const reading = shownReadingOf(coverage);
  if (reading === null) {
    return undefined;
  }
  const link = evidenceLinkOf(reading, techniqueExternalId, isValidationAvailable);
  const evidence = link === null ? null : <EvidenceLinkButton controlId={reading.capabilityId} control={reading.capabilityExternalId} link={link} />;
  return reading.covered || reading.linked || reading.removedOn === 'parent'
    ? evidence ?? undefined
    : (
      <>
        {evidence}
        <DeclareOnControlButton
          capabilityId={reading.capabilityId}
          control={reading.capabilityExternalId}
          techniqueId={reading.mitreTechniqueId}
          capabilityFunction={reading.function}
          isRemoved={reading.removedOn === 'technique'}
        />
      </>
    );
};

/** A list row's engine efficacy, read as the matrix cell reads it, with the control it comes from. */
export const CoverageEfficacyCell: FunctionComponent<{
  technique: ThreatTechniqueRow,
  coverage: TechniqueFunctionCoverage | undefined,
  /** The coverage is not read yet, or could not be. */
  isUnavailable: boolean,
  isValidationAvailable: boolean,
}> = ({ technique, coverage, isUnavailable, isValidationAvailable }) => {
  if (isUnavailable) {
    return <EmptyValue />;
  }
  const reading = shownReadingOf(coverage);
  if (reading === null) {
    return <span className="text-default-secondary"><Trans context="engine efficacy">Not covered</Trans></span>;
  }
  const absent = testedAbsentReadingOf(coverage);
  if (absent !== null) {
    return (
      <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <span className="text-default-secondary">{absentWording(absent)}</span>
        <EngineEfficacyExplanation
          reading={absent}
          control={absent.capabilityExternalId}
          techniqueExternalId={technique.externalId}
          techniqueName={technique.name}
          footerAction={footerActionOf(coverage, technique.externalId, isValidationAvailable)}
        />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
      <EngineEfficacyFigure reading={reading} isUnlinked={!reading.linked} />
      <EngineEfficacyExplanation
        reading={reading}
        control={reading.capabilityExternalId}
        techniqueExternalId={technique.externalId}
        techniqueName={technique.name}
        footerAction={footerActionOf(coverage, technique.externalId, isValidationAvailable)}
      />
    </span>
  );
};

/** A list row's OpenAEV result for the control its efficacy comes from. */
export const CoverageResultCell: FunctionComponent<{ coverage: TechniqueFunctionCoverage | undefined, isUnavailable: boolean }> = ({ coverage, isUnavailable }) => {
  const reading = shownReadingOf(coverage);
  if (isUnavailable || reading === null) {
    return isUnavailable ? <EmptyValue /> : <span className="text-default-secondary"><Trans>Not tested</Trans></span>;
  }
  return <OpenAevResult reading={reading} />;
};

/** The control a list row reads, by catalogue id and name. */
export const CoverageControlCell: FunctionComponent<{ coverage: TechniqueFunctionCoverage | undefined }> = ({ coverage }) => {
  const reading = shownReadingOf(coverage);
  if (reading === null) {
    return <EmptyValue />;
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-mono txt-sub-content text-muted-foreground">{reading.capabilityExternalId}</span>
      <span className="truncate" title={reading.capabilityName}>{reading.capabilityName}</span>
    </span>
  );
};

/** The dialog a matrix cell opens: its control's efficacy on the technique, leading to the evidence. */
export const CoverageDialog: FunctionComponent<{
  technique: ThreatTechniqueRow,
  coverage: TechniqueFunctionCoverage | undefined,
  isValidationAvailable: boolean,
  onClose: () => void,
}> = ({ technique, coverage, isValidationAvailable, onClose }) => {
  const reading = shownReadingOf(coverage);
  if (reading === null) {
    return null;
  }
  return (
    <EngineEfficacyDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      reading={reading}
      control={reading.capabilityExternalId}
      techniqueExternalId={technique.externalId}
      techniqueName={technique.name}
      footerAction={footerActionOf(coverage, technique.externalId, isValidationAvailable)}
    />
  );
};
