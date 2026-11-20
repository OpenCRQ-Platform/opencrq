import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { PostureSource } from '@app/module/client';
import type { FunctionComponent, ReactNode } from 'react';
import type { ProtectingControl, Tally, Verdicts } from '../protected-by-utils';
import { coverageLabel } from '../../controls/capability/ui/coverage-label';
import { effectivenessLabel, effectivenessTextClass, isScoredBand } from '../../controls/capability/ui/effectiveness-badge';
import { strengthLabel } from '../../controls/capability/ui/strength-label';
import { computeSoloEffectiveness, formatEffectivenessPercent } from '../../controls/capability/utils/capability-effectiveness';
import { StrengthCells } from '../../finding-score';
import { cn, formatDate } from '../../../utils';
import { coverageCellsFilled, hasLetThrough, strengthCellsFilled, tallyLetThrough, testedTechniqueIds } from '../protected-by-utils';

const preventionText = ({ held, total }: Tally): string => t`Prevented ${held}/${total}`;

const detectionText = ({ held, total }: Tally): string => t`Detected ${held}/${total}`;

interface VerdictReading {
  key: 'prevention' | 'detection',
  label: string,
  tally: Tally,
}

export const verdictReadings = ({ prevention, detection }: Verdicts): Array<VerdictReading> => [
  ...(prevention === null ? [] : [{ key: 'prevention' as const, label: preventionText(prevention), tally: prevention }]),
  ...(detection === null ? [] : [{ key: 'detection' as const, label: detectionText(detection), tally: detection }]),
];

export const VerdictChip: FunctionComponent<{ reading: VerdictReading }> = ({ reading }) => (
  <Chip severity={tallyLetThrough(reading.tally) ? 'high' : 'low'} label={reading.label} />
);

export const NotAssessedText: FunctionComponent = () => (
  <span className="text-muted-foreground">{t`Not assessed`}</span>
);

const LevelCell: FunctionComponent<{
  filled: number,
  value: string,
  note: ReactNode,
}> = ({ filled, value, note }) => (
  <span className="flex flex-col gap-0.5">
    <span className="flex items-center gap-2">
      <StrengthCells filled={filled} large />
      <span>{value}</span>
    </span>
    {note !== null && <span className="txt-sub-content text-muted-foreground">{note}</span>}
  </span>
);

const provenanceNote = (source: PostureSource, tenantValue: string, notesInherited: boolean | undefined): ReactNode => {
  if (source === 'scope') {
    return <Trans>tenant: {tenantValue}</Trans>;
  }
  return notesInherited === true ? <Trans>Inherited from the tenant</Trans> : null;
};

interface AxisCellProps {
  control: ProtectingControl,
  notesInherited?: boolean,
}

export const StrengthCell: FunctionComponent<AxisCellProps> = ({ control, notesInherited }) => {
  if (!control.assessed) {
    return <NotAssessedText />;
  }
  const tenantValue = control.tenantStrengthRung === null ? t`Not assessed` : strengthLabel(control.tenantStrengthRung);
  return (
    <LevelCell
      filled={strengthCellsFilled(control.strengthRung)}
      value={strengthLabel(control.strengthRung)}
      note={provenanceNote(control.strengthSource, tenantValue, notesInherited)}
    />
  );
};

export const CoverageCell: FunctionComponent<AxisCellProps> = ({ control, notesInherited }) => {
  if (!control.assessed) {
    return <NotAssessedText />;
  }
  const tenantValue = control.tenantCoverageBucket === null ? t`Not assessed` : coverageLabel(control.tenantCoverageBucket);
  return (
    <LevelCell
      filled={coverageCellsFilled(control.coverageBucket)}
      value={coverageLabel(control.coverageBucket)}
      note={provenanceNote(control.coverageSource, tenantValue, notesInherited)}
    />
  );
};

export const EffectivenessCell: FunctionComponent<{ control: ProtectingControl }> = ({ control }) => {
  if (!control.assessed) {
    return <NotAssessedText />;
  }
  const { band, score } = computeSoloEffectiveness(control);
  if (!isScoredBand(band)) {
    return <span className="text-muted-foreground">{effectivenessLabel(band)}</span>;
  }
  return (
    <span className={cn('flex items-baseline gap-1.5', effectivenessTextClass(band))}>
      <span className="font-semibold tabular-nums">{formatEffectivenessPercent(score)}</span>
      <span className="txt-sub-content">{effectivenessLabel(band)}</span>
    </span>
  );
};

export const TestedOnAssetCell: FunctionComponent<{ control: ProtectingControl, namesTechniques: boolean }> = ({ control, namesTechniques }) => {
  if (!control.testable) {
    return <span className="text-muted-foreground">{t`Not testable by OpenAEV`}</span>;
  }
  const tested = control.testedHere;
  if (tested === null) {
    return <span className="text-muted-foreground">{t`Never tested here`}</span>;
  }
  const date = tested.lastRunAt === null ? null : formatDate(tested.lastRunAt);
  const techniques = namesTechniques ? testedTechniqueIds(control).join(', ') : null;
  const caption = [techniques, date].filter((part): part is string => part !== null && part !== '').join(' · ');
  return (
    <span className="flex flex-col gap-0.5">
      <span className={cn('flex flex-wrap gap-x-3 tabular-nums', hasLetThrough(tested) && 'text-icon-warning')}>
        {tested.prevention !== null && <span>{preventionText(tested.prevention)}</span>}
        {tested.detection !== null && <span>{detectionText(tested.detection)}</span>}
      </span>
      {caption !== '' && <span className="txt-sub-content text-muted-foreground">{caption}</span>}
    </span>
  );
};
