import { Paper } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ScorePart } from '@app/module/client';
import { partFigure, resolveSeverityBand, UNCLASSIFIED_ASSET_CATEGORY } from '@app/module/client';
import { useQuery } from '@tanstack/react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactNode } from 'react';
import { DEFAULT_PERIOD_WINDOW } from '../../../components/shared/period-window';
import { ControlIdPill } from '../../../components/shared/control-id-pill';
import { useTRPC } from '../../../lib';
import { cn, formatDate, formatFixed, getAssetCategoryLabel } from '../../../utils';
import { AnswerStrip } from './answer-strip';
import { criticalityLabel, cvssMetricLabel, cvssValueLabel, exposureLabel } from './column-vocabulary';
import { scorePartLabel } from './factor-labels';
import { FactorGauge } from './score-gauge';
import { severityBandLabel, severityBandWash } from './severity-ramp';
import { confidenceLabel } from './technique-mapping-vocabulary';
import { ScoreInfoButton } from './score-explanation/score-explanation-dialog';
import { ScoreHistoryLifeline } from './score-history-lifeline';
import {
  EvidenceColumn,
  EvidenceGroupDivider,
  EvidenceRow,
  StrengthCells,
} from './evidence-column';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;
type FindingBreakdown = NonNullable<RouterOutputs['findingScore']['getFindingScoreBreakdown']>;
export type FindingScoreBreakdown = Extract<FindingBreakdown, { score: number }>;

type DeclaredControl = NonNullable<FindingScoreBreakdown['columns']['mitigations']>[number];

/** Three cells, so L0 to L3 maps onto none to all filled. */
const STRENGTH_FILLED: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

const ControlRow: FunctionComponent<{ control: DeclaredControl, struckDown: boolean }> = ({ control, struckDown }) => (
  <EvidenceRow
    label={(
      <span className="flex items-center gap-2">
        <ControlIdPill externalId={control.externalId} size="compact" />
        {control.name}
      </span>
    )}
    absent={!control.scoredHere}
  >
    <StrengthCells filled={STRENGTH_FILLED[control.strengthRung] ?? 0} struckDown={struckDown} />
  </EvidenceRow>
);

/**
 * What the platform's expectation runs observed on the techniques in reach, on this asset.
 *
 * The block reports runs, never the finding's own connector history: on a CVE finding that history
 * is the last vulnerability-scanner sync, and reading it as a verdict presents a scan result as a
 * control validation. A scope nothing ran at says so in words, since a zero would claim a run held
 * nothing.
 */
const ValidationBlock: FunctionComponent<{
  validation: FindingScoreBreakdown['columns']['validation'],
}> = ({ validation }) => {
  if (validation === null) {
    return (
      <>
        <EvidenceGroupDivider label={t`tested here`} />
        <EvidenceRow label={t`Runs`} absent><Trans>never tested here</Trans></EvidenceRow>
      </>
    );
  }
  const { techniquesTested, techniquesInReach, prevention, detection, lastRunAt } = validation;
  return (
    <>
      <EvidenceGroupDivider label={t`tested here`} />
      <EvidenceRow label={t`Techniques run`}>{`${techniquesTested}/${techniquesInReach}`}</EvidenceRow>
      {prevention !== null && (
        <EvidenceRow label={t`Prevented`}>{`${prevention.held}/${prevention.total}`}</EvidenceRow>
      )}
      {detection !== null && (
        <EvidenceRow label={t`Detected`}>{`${detection.held}/${detection.total}`}</EvidenceRow>
      )}
      {lastRunAt !== null && (
        <EvidenceRow label={t`Last run`}>{formatDate(lastRunAt)}</EvidenceRow>
      )}
    </>
  );
};

/** A slice of the published vector, or the statement that no vector was published. */
const CvssRows: FunctionComponent<{
  metrics: Array<{ metric: string, value: string }>,
  absentLabel: string,
  vector: string | null,
}> = ({ metrics, absentLabel, vector }) => {
  if (metrics.length > 0) {
    return metrics.map((entry) => (
      <EvidenceRow key={entry.metric} label={cvssMetricLabel(entry.metric, vector)}>
        {cvssValueLabel(entry.metric, entry.value, vector)}
      </EvidenceRow>
    ));
  }
  return <EvidenceRow label={absentLabel} absent><Trans>none published</Trans></EvidenceRow>;
};

/**
 * EPSS is published on a 0 to 1 scale, so it reads on that scale and is never rescaled here.
 * Three decimals, the precision the header tile already prints: one published figure, one precision.
 */
const epssLabel = (probability: number): string => (
  probability > 0 && probability < 0.0005 ? t`< 0.001` : formatFixed(probability, 3)
);

const ScorePartSection: FunctionComponent<{
  part: ScorePart,
  value: number,
  finding: FindingScoreBreakdown,
  className?: string,
  children: ReactNode,
}> = ({ part, value, finding, className, children }) => {
  const figure = partFigure(value);
  const band = resolveSeverityBand(figure);
  const name = scorePartLabel(part);
  const bandWord = severityBandLabel(band);
  return (
    <Paper
      elevation={2}
      padding={16}
      className={cn('min-w-0', className)}
      style={{ backgroundImage: severityBandWash(band), backgroundOrigin: 'border-box' }}
    >
      <section aria-label={name} className="flex flex-col gap-4">
        <span className="flex items-center gap-2.5">
          <FactorGauge figure={figure} band={band} label={t`${name}: ${figure} out of 100, ${bandWord} band`} />
          <span className="font-title-md text-title-md">{name}</span>
          <ScoreInfoButton subject={part} finding={finding} />
        </span>
        {children}
      </section>
    </Paper>
  );
};

type WeakestPath = FindingScoreBreakdown['columns']['weakestPath'];

const WeakestPathRow: FunctionComponent<{ path: WeakestPath }> = ({ path }) => {
  if (path === null) {
    return null;
  }
  const { externalId } = path;
  const confidence = confidenceLabel(path.confidence);
  return <EvidenceRow label={t`Weakest path`}><Trans>{externalId} · {confidence}</Trans></EvidenceRow>;
};

/**
 * The section carries no arithmetic, the three dialogs do. The exploitation controls tile names its
 * weakest path with the confidence of its claim, which tells a figure held up by a control from one
 * held down by a shaky claim. The impact side is a mean, which no single path decides.
 */
const ScoredFindingSection: FunctionComponent<{ tenantId: string, finding: FindingScoreBreakdown }> = ({ tenantId, finding }) => {
  const trpc = useTRPC();
  const { columns, factors } = finding;
  const { data: history, isError: historyFailed } = useQuery(trpc.findingScore.getFindingScoreHistory.queryOptions({ evidenceId: finding.evidenceId }));
  // A control that does not protect the asset's family earns the exploitation nothing, so it is left out.
  const standing = columns.mitigations?.filter((control) => control.protectsAssetFamily) ?? [];
  // The estate stands most of the catalogue on some impact technique: only what earns is listed.
  const standingOnImpact = columns.impactControls.mitigations?.filter((control) => control.scoredHere) ?? [];
  const uncoveredCount = columns.uncoveredTechniqueExternalIds.length;
  const impactTechniqueCount = factors.impactControls.paths.length;
  // Only what the asset's family carries: the score reads that list, and a denominator counting the
  // techniques set aside would report coverage of a reach the factor never had.
  const reachCount = new Set((columns.techniques?.rows ?? [])
    .filter((row) => row.group === 'exploitation' && row.carriedByAssetFamily)
    .map((row) => row.externalId)).size;
  const measuredOn = columns.reachability.categoryId === UNCLASSIFIED_ASSET_CATEGORY
    ? t`the whole estate`
    : getAssetCategoryLabel(columns.reachability.categoryId);

  return (
    <Paper
      elevation={1}
      padding={0}
      className="flex flex-col"
      style={{ backgroundImage: severityBandWash(finding.band), backgroundOrigin: 'border-box' }}
    >
      <AnswerStrip
        score={finding.score}
        band={finding.band}
        exploitability={partFigure(finding.exploitability)}
        impact={partFigure(finding.impact)}
        limitingTerm={finding.limitingTerm}
        titleAdornment={<ScoreInfoButton subject="score" finding={finding} />}
        aside={(
          <ScoreHistoryLifeline
            tenantId={tenantId}
            evidenceId={finding.evidenceId}
            lines={history}
            isError={historyFailed}
            withFigure={false}
            defaultWindow={DEFAULT_PERIOD_WINDOW}
          />
        )}
      />

      <div className="flex flex-wrap gap-4 px-4 pb-4">
        <ScorePartSection part="exploitability" value={finding.exploitability} finding={finding} className="min-w-[34rem] flex-[3_1_0]">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            <EvidenceColumn
              accent="reachability"
              reading="exposure"
              value={factors.reachability.value}
              nameAdornment={<ScoreInfoButton subject="reachability" finding={finding} />}
            >
              <EvidenceRow label={t`Zone`}>{exposureLabel(columns.reachability.exposure)}</EvidenceRow>
              <EvidenceRow label={t`Family`}>
                {getAssetCategoryLabel(columns.reachability.categoryId)}
              </EvidenceRow>
              {columns.reachability.assetLastSeenAt !== null && (
                <EvidenceRow label={t`Still seen`}>
                  {formatDate(columns.reachability.assetLastSeenAt)}
                </EvidenceRow>
              )}
              <CvssRows
                metrics={columns.reachability.cvssMetrics}
                absentLabel={t`Vector metrics`}
                vector={finding.cvssVector}
              />
            </EvidenceColumn>

            <EvidenceColumn
              accent="threat"
              reading="exposure"
              value={factors.threat.value}
              nameAdornment={<ScoreInfoButton subject="threat" finding={finding} />}
            >
              {columns.threat.exploitationProbability === null ? (
                <EvidenceRow label={t`EPSS`} absent><Trans>none published</Trans></EvidenceRow>
              ) : (
                <EvidenceRow label={t`EPSS`}>
                  {epssLabel(columns.threat.exploitationProbability)}
                </EvidenceRow>
              )}
              <EvidenceRow label={t`KEV`}>
                {columns.threat.knownExploited ? t`yes` : t`no`}
              </EvidenceRow>
              <EvidenceRow label={t`Active actors`}>
                {columns.threat.activeThreatCount}
              </EvidenceRow>
              {columns.threat.attackComplexity !== null && (
                <EvidenceRow label={cvssMetricLabel('AC', finding.cvssVector)}>
                  {cvssValueLabel('AC', columns.threat.attackComplexity, finding.cvssVector)}
                </EvidenceRow>
              )}
            </EvidenceColumn>

            <EvidenceColumn
              accent="controls"
              reading="defence"
              value={factors.exploitationControls.value}
              nameAdornment={<ScoreInfoButton subject="exploitationControls" finding={finding} />}
            >
              <EvidenceRow label={t`Measured on`}>{measuredOn}</EvidenceRow>
              {columns.validation === null && standing.length === 0 && (
                <EvidenceRow label={t`Creditable here`}><Trans>none</Trans></EvidenceRow>
              )}
              {standing.map((control) => (
                <ControlRow
                  key={control.capabilityId}
                  control={control}
                  struckDown={control.knockedDownHere}
                />
              ))}
              <ValidationBlock validation={columns.validation} />
              <WeakestPathRow path={columns.weakestPath} />
              {uncoveredCount > 0 && (
                <p className="pt-2 font-content-compact text-content-compact text-default-secondary">
                  {t`No control here prevents ${uncoveredCount}/${reachCount} techniques in reach.`}
                </p>
              )}
            </EvidenceColumn>
          </div>
        </ScorePartSection>

        <ScorePartSection
          part="impact"
          value={finding.impact}
          finding={finding}
          className="min-w-[24rem] flex-[2_1_0]"
        >
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            <EvidenceColumn
              accent="potentialImpact"
              reading="exposure"
              value={factors.potentialImpact.value}
              nameAdornment={<ScoreInfoButton subject="potentialImpact" finding={finding} />}
            >
              <EvidenceRow label={t`Criticality`}>
                {criticalityLabel(columns.potentialImpact.criticality)}
              </EvidenceRow>
              <CvssRows
                metrics={columns.potentialImpact.cvssMetrics}
                absentLabel={t`Impact metrics`}
                vector={finding.cvssVector}
              />
              {columns.potentialImpact.ownerName !== null && (
                <EvidenceRow label={t`Owner`}>{columns.potentialImpact.ownerName}</EvidenceRow>
              )}
            </EvidenceColumn>

            <EvidenceColumn
              accent="controls"
              reading="defence"
              value={factors.impactControls.value}
              nameAdornment={<ScoreInfoButton subject="impactControls" finding={finding} />}
            >
              <EvidenceRow label={t`Measured on`}>{t`the whole estate`}</EvidenceRow>
              {standingOnImpact.length === 0 && (
                <EvidenceRow label={t`Creditable here`}><Trans>none</Trans></EvidenceRow>
              )}
              {standingOnImpact.map((control) => (
                <ControlRow key={control.capabilityId} control={control} struckDown={false} />
              ))}
              {impactTechniqueCount > 0 && (
                <EvidenceRow label={t`Techniques averaged`}>{impactTechniqueCount}</EvidenceRow>
              )}
            </EvidenceColumn>
          </div>
        </ScorePartSection>
      </div>
    </Paper>
  );
};

interface FindingScoreSectionProps {
  tenantId: string,
  finding: FindingBreakdown,
  /** An NVD pass read the CVE and found no record: the vector a pending finding waits on will not come from NVD. */
  nvdRecordMissing: boolean,
}

const UnscoredSentence: FunctionComponent<{ pendingVector: boolean, nvdRecordMissing: boolean }> = ({ pendingVector, nvdRecordMissing }) => {
  if (!pendingVector) {
    return <Trans>This finding has not been scored yet. Its score appears once the next recompute has run.</Trans>;
  }
  return nvdRecordMissing
    ? <Trans>This finding has no score: NVD has no record of its CVE, or rejected it, so no CVSS vector comes from NVD. Check that the CVE id is correct.</Trans>
    : <Trans>This finding is pending a vector: its CVE has no usable CVSS vector yet. It is scored by the first recompute once one is available.</Trans>;
};

export const FindingScoreSection: FunctionComponent<FindingScoreSectionProps> = ({ tenantId, finding, nvdRecordMissing }) => (
  finding.score === null ? (
    <Paper elevation={1} padding={16}>
      <p className="font-content-base text-content-base text-default-secondary">
        <UnscoredSentence pendingVector={finding.pendingVector} nvdRecordMissing={nvdRecordMissing} />
      </p>
    </Paper>
  ) : <ScoredFindingSection tenantId={tenantId} finding={finding} />
);
