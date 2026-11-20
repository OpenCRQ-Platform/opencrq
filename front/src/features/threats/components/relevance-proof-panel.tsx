import { Chip, Icon, Paper } from '@filigran/design-system';
import { OUTCOME_WEIGHT_THRESHOLD, resolveSeverityBand } from '@app/module/client';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { ComponentPropsWithRef, FunctionComponent, ReactElement, ReactNode } from 'react';
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DisplayDrawer, tileTonePaint, tileToneWash } from '../../../components/shared';
import { useOpenCtiBaseUrl, usePersistedPageSize } from '../../../hooks';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { useTRPC } from '../../../lib';
import { formatDate, formatRelativeTime } from '../../../utils/date-utils';
import { ScoreGauge, severityBandLabel } from '../../finding-score';
import { formatFractionAsPercent } from '../../../utils/format-number';
import { formatOutcomeProbability } from '../../../utils/outcome-probability-utils';
import { buildOpenCtiObjectLink } from '../../supporting-assets/connectors-utils';
import { confidenceGateLevelLabel } from '../../threat-relevance-settings';
import { ActivityGradeBadge } from './activity-grade-badge';
import { ClaimList } from './claim-list';
import { DimensionTags } from './dimension-tags';
import { LastObservedVia } from './last-observed-via';
import {
  CLAIM_LIST_TABLE_ID,
  composeThreatScore,
  DEFAULT_CLAIM_PAGE_SIZE,
  resolveRelevanceBand,
  toRelevancePercent,
  weighsOnOutcome,
} from './relevance-proof-utils';
import { OpenCtiLink } from './opencti-link';
import { ResourceLevelValue } from './resource-level-value';
import { ThreatScoreInfoButton } from './threat-score-explanation';
import { ThreatTypeBadge } from './threat-type-badge';

type Dimension = 'country' | 'sector' | 'outcome';

/** One row of a scenario's Relevant Threats table: the scenario, the threat and the row's own figures. */
export interface RelevanceProofTarget {
  scenarioId: string,
  scenarioName: string,
  analysisId: string,
  name: string,
  combinedRelevance: number,
  resourceLevel: string | null,
  countries: Array<string>,
  sectors: Array<string>,
  matchedCountry: string | null,
  matchedSector: string | null,
}

interface RelevanceProofPanelProps {
  target: RelevanceProofTarget | null,
  onClose: () => void,
  onCloseAutoFocus: NonNullable<ComponentPropsWithRef<typeof DisplayDrawer>['onCloseAutoFocus']>,
}

const dimensionLabel = (dimension: Dimension): string => {
  switch (dimension) {
    case 'country':
      return t`country`;
    case 'sector':
      return t`sector`;
    case 'outcome':
      return t`attack outcome`;
  }
};

const RELEVANCE_SEVERITY = {
  strong: 'critical',
  moderate: 'high',
  weak: 'low',
} as const;

const relevanceBandLabel = (band: keyof typeof RELEVANCE_SEVERITY): string => {
  switch (band) {
    case 'strong':
      return t`Strong`;
    case 'moderate':
      return t`Moderate`;
    case 'weak':
      return t`Weak`;
  }
};

const joinDimensions = (values: Array<string>): string => {
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    const firstValue = values[0];
    const secondValue = values[1];
    return t`${firstValue} and ${secondValue}`;
  }
  const head = values.slice(0, -1).join(', ');
  const tail = values.at(-1) ?? '';
  return t`${head}, and ${tail}`;
};

const CarrySentence: FunctionComponent<{ dimensions: Array<string> }> = ({ dimensions }) => {
  if (dimensions.length === 0) {
    return <>{t`Nothing in this threat's profile matches this scenario.`}</>;
  }
  const verb = plural(dimensions.length, { one: 'carries', other: 'carry' });
  const joinedDimensions = joinDimensions(dimensions);
  return <>{t`${joinedDimensions} ${verb} this threat.`}</>;
};

const MissingDimensionsNote: FunctionComponent<{ dimensions: Array<string> }> = ({ dimensions }) => {
  const joinedDimensions = joinDimensions(dimensions);
  return <>{t`No match on ${joinedDimensions}`}</>;
};

/** A section's summary, marked matched or not so the dimension that missed reads at a glance. */
const MatchSummary: FunctionComponent<{ matched: boolean, children: ReactNode }> = ({ matched, children }) => (
  <span className="inline-flex items-center gap-2 align-middle">
    <Icon
      name={matched ? 'circle-check' : 'circle-x'}
      size={16}
      aria-hidden
      className={matched ? 'shrink-0 text-[color:var(--fds-color-feedback-success-primary)]' : 'shrink-0 text-muted-foreground'}
    />
    <span className="sr-only">{matched ? t`Matched:` : t`Not matched:`}</span>
    <span className={matched ? 'font-medium text-foreground' : 'text-muted-foreground'}>{children}</span>
  </span>
);

const RelevanceSeverityChip: FunctionComponent<{ relevance: number }> = ({ relevance }) => {
  const band = resolveRelevanceBand(toRelevancePercent(relevance));
  return (
    <Chip
      label={relevanceBandLabel(band)}
      severity={RELEVANCE_SEVERITY[band]}
    />
  );
};

const FieldLabel: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <p className="font-content-caption text-content-caption text-muted-foreground uppercase tracking-[var(--fds-tracking-relaxed)]">
    {children}
  </p>
);

const DefectSentence: FunctionComponent = () => (
  <p className="txt-table">
    <Trans>This dimension matched, but no claim behind it could be read. That is a defect, not an absence of evidence.</Trans>
  </p>
);

interface ProofSectionProps {
  summary: ReactNode,
  isOpen: boolean,
  onToggle: (isOpen: boolean) => void,
  children: ReactNode,
}

const ProofSection: FunctionComponent<ProofSectionProps> = ({ summary, isOpen, onToggle, children }) => (
  <Paper elevation={2} className="p-4">
    <details
      open={isOpen}
      onToggle={(event) => onToggle(event.currentTarget.open)}
      className="flex flex-col gap-4"
    >
      <summary className="txt-sub-content cursor-pointer">{summary}</summary>
      <div className="pt-4">{children}</div>
    </details>
  </Paper>
);

interface OutcomeAssessmentBlockProps {
  probability: number | null,
  evidenceSufficient: boolean,
  judgedOn: string | null,
}

/**
 * The verdict on the outcome, and nothing of how it was reached: who gave it (the model, or a
 * judgment set and its date), the percentage stored, and whether the threat's record had enough data
 * for that percentage to count.
 */
const OutcomeAssessmentBlock: FunctionComponent<OutcomeAssessmentBlockProps> = ({ probability, evidenceSufficient, judgedOn }) => {
  const thresholdLabel = formatFractionAsPercent(OUTCOME_WEIGHT_THRESHOLD, 0);
  const judgedOnLabel = judgedOn === null ? null : formatDate(judgedOn);
  return (
    <div className="flex flex-col gap-4">
      <p className="txt-table">
        {judgedOnLabel === null ? <Trans>Assessed by OpenCRQ's internal model</Trans> : <Trans>Judged by OpenCRQ on {judgedOnLabel}</Trans>}
      </p>
      <div className="flex flex-col gap-2">
        <FieldLabel><Trans>Probability</Trans></FieldLabel>
        <span className="txt-default font-medium text-foreground">
          {probability === null || !evidenceSufficient ? EMPTY_VALUE : formatOutcomeProbability(probability)}
        </span>
      </div>
      {!evidenceSufficient && (
        <p className="txt-sub-content text-muted-foreground"><Trans>Not enough data on this threat to weigh it.</Trans></p>
      )}
      {evidenceSufficient && !weighsOnOutcome({ probability, evidenceSufficient }) && (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>At {thresholdLabel} or below, a threat does not weigh on the outcome.</Trans>
        </p>
      )}
    </div>
  );
};

const RelevanceProofBody: FunctionComponent<{
  target: RelevanceProofTarget,
  headingId: string,
}> = ({ target, headingId }) => {
  const trpc = useTRPC();
  const openctiUrl = useOpenCtiBaseUrl();
  const [openSections, setOpenSections] = useState<Record<Dimension, boolean>>({
    country: false,
    sector: false,
    outcome: true,
  });
  const [claimsAnnouncement, setClaimsAnnouncement] = useState('');
  const { pageSize, setPageSize } = usePersistedPageSize(CLAIM_LIST_TABLE_ID, DEFAULT_CLAIM_PAGE_SIZE);
  const { data: proof, isPending, isError } = useQuery(trpc.threats.getRelevanceProof.queryOptions(
    { analysisId: target.analysisId, scenarioId: target.scenarioId },
  ));
  const threatName = target.name;

  if (isPending) {
    return (
      <p role="status" aria-live="polite" className="txt-body2 p-6 text-muted-foreground">
        <Trans>Reading the claims behind this threat's relevance…</Trans>
      </p>
    );
  }

  if (isError || !proof) {
    return (
      <p role="alert" className="txt-table p-6">
        <Trans>The claims behind this threat's relevance could not be read. Close the panel and open it again.</Trans>
      </p>
    );
  }

  const { gate, unstatedConfidence } = proof;
  const gateLabel = confidenceGateLevelLabel(gate);
  const outcomeName = proof.attackOutcomeName;

  // Only a connector origin is on the tenant's platform by construction: any other id would
  // resolve nowhere, so it is shown without a link at all.
  const openctiHref = proof.origin.kind === 'connector' ? buildOpenCtiObjectLink(openctiUrl, proof.origin.stixId) : null;
  const openctiLabel = t`Open in OpenCTI`;

  const outcomeSectionContent = (
    <OutcomeAssessmentBlock
      probability={proof.outcome.probability}
      evidenceSufficient={proof.outcome.evidenceSufficient}
      judgedOn={proof.outcome.judgedOn}
    />
  );

  const country = proof.relevance?.country ?? null;
  const sector = proof.relevance?.sector ?? null;
  // The row's score was computed when the list was fetched; the proof is read at the gate in force
  // now, so a gate changed since then would leave the headline arguing against its own dimensions.
  const combinedRelevance = proof.relevance?.score ?? target.combinedRelevance;
  // Named by the proof, never by the row: the row's matched value is a name comparison, while the
  // proof's is the predicate that actually scored the dimension, and the two can disagree.
  const matchedCountry = country?.matchedValue ?? t`no match`;
  const matchedSector = sector?.matchedValue ?? t`no match`;
  const organizationCountry = country?.organizationValue ?? null;
  const organizationSector = sector?.organizationValue ?? null;
  const outcomeWeighs = weighsOnOutcome(proof.outcome);
  const dimensionMatches: Array<[Dimension, boolean]> = [
    ['country', country?.matched === true],
    ['sector', sector?.matched === true],
    ['outcome', outcomeWeighs],
  ];
  const matchedDimensionNames = dimensionMatches.filter(([, matched]) => matched).map(([dimension]) => dimensionLabel(dimension));
  const missingDimensionNames = dimensionMatches.filter(([, matched]) => !matched).map(([dimension]) => dimensionLabel(dimension));
  const activityAge = proof.lastObservedAt === null ? null : formatRelativeTime(proof.lastObservedAt);
  const score = composeThreatScore(combinedRelevance, proof.activityWeight);
  const band = resolveSeverityBand(score);
  const bandWord = severityBandLabel(band);
  const bandPaint = tileTonePaint(band);

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-6">
      {/* The single announcement point for every claim list below, so several open sections
          never each fire their own page-change announcement. */}
      <p aria-live="polite" role="status" className="sr-only">{claimsAnnouncement}</p>

      <Paper
        elevation={1}
        className="flex items-center gap-4 p-6"
        style={{ backgroundImage: tileToneWash(band), backgroundOrigin: 'border-box' }}
      >
        <span
          aria-hidden="true"
          className="grid size-[52px] shrink-0 place-items-center rounded-sm"
          style={{ background: bandPaint.fill, color: bandPaint.glyph }}
        >
          {/* 52px mirrors the identity stack height and 20px mirrors the threat name's type size. */}
          <Icon name="custom/intrusion-set" size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="font-title-md text-title-md leading-title-md truncate font-medium text-foreground">{threatName}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-4">
            <ThreatTypeBadge entityType={proof.origin.entityType} />
            <Link
              from="/$tenantId/{-$organizationId}"
              to="threat-center/threats/$threatId"
              params={{ threatId: target.analysisId }}
              className="txt-body2 text-primary hover:underline"
            >
              <Trans>Open the threat page</Trans>
            </Link>
            <OpenCtiLink
              href={openctiHref}
              label={openctiLabel}
              className="flex items-center gap-1.5 txt-body2 text-primary hover:underline"
            />
          </p>
        </div>
      </Paper>

      <section className="flex flex-col gap-2">
        <h3 className="txt-default flex items-center gap-1 font-medium text-foreground">
          <Trans>Score</Trans>
          <ThreatScoreInfoButton
            combinedRelevance={combinedRelevance}
            activityWeight={proof.activityWeight}
            assumedActivityAgeDays={proof.lastObservedAt === null ? proof.unknownActivityAgeDays : null}
            country={country}
            sector={sector}
            outcomeProbability={proof.outcome.probability}
            evidenceSufficient={proof.outcome.evidenceSufficient}
            outcomeName={outcomeName}
            lastObservedAt={proof.lastObservedAt}
            activityAge={activityAge}
            lastObservedVia={proof.lastObservedVia}
            gateLabel={gateLabel}
          />
        </h3>
        <Paper elevation={1} className="flex items-center gap-6 p-6">
          <ScoreGauge score={score} band={band} label={t`Threat score: ${score} out of 100, ${bandWord} band`} />
          <div className="grid min-w-0 flex-1 grid-cols-2 content-center gap-6 self-stretch border-l border-[color:var(--fds-border-elevation-subtle)] pl-6">
            <div className="flex flex-col gap-2">
              <FieldLabel><Trans>Relevance</Trans></FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <RelevanceSeverityChip relevance={combinedRelevance} />
                {matchedDimensionNames.length > 0 && (
                  <span className="txt-sub-content text-muted-foreground first-letter:uppercase">{joinDimensions(matchedDimensionNames)}</span>
                )}
                {missingDimensionNames.length > 0 && (
                  <span className="basis-full txt-sub-content text-muted-foreground">
                    <MissingDimensionsNote dimensions={missingDimensionNames} />
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel><Trans>Observed activity</Trans></FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <ActivityGradeBadge lastObservedAt={proof.lastObservedAt} />
                {proof.lastObservedVia !== null && (
                  <span className="txt-sub-content text-muted-foreground">
                    <LastObservedVia via={proof.lastObservedVia} />
                  </span>
                )}
              </div>
            </div>
          </div>
        </Paper>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="txt-default font-medium text-foreground"><Trans>Overview</Trans></h3>
        <Paper elevation={1} className="p-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="col-span-2 flex flex-col gap-2">
              <FieldLabel><Trans>Resource level</Trans></FieldLabel>
              <ResourceLevelValue value={target.resourceLevel} />
            </div>
            <div className="col-span-2 flex flex-col gap-2">
              <FieldLabel><Trans>Targeted countries</Trans></FieldLabel>
              <DimensionTags variant="panel" kind="country" values={target.countries} matchedValue={target.matchedCountry} />
            </div>
            <div className="col-span-2 flex flex-col gap-2">
              <FieldLabel><Trans>Targeted sectors</Trans></FieldLabel>
              <DimensionTags variant="panel" kind="sector" values={target.sectors} matchedValue={target.matchedSector} />
            </div>
          </div>
        </Paper>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="txt-default flex flex-wrap items-center gap-2 font-medium text-foreground">
          <span><Trans>Why the relevance is</Trans></span>
          <RelevanceSeverityChip relevance={combinedRelevance} />
        </h3>
        <Paper elevation={1} className="p-6">
          {/* The sentence opens on a translated dimension name, which no locale capitalises. */}
          <p className="txt-table pb-4 first-letter:uppercase">
            <CarrySentence dimensions={matchedDimensionNames} />
          </p>
          <div className="flex flex-col gap-4">
            <ProofSection
              isOpen={openSections.country}
              onToggle={(isOpen) => setOpenSections((sections) => ({ ...sections, country: isOpen }))}
              summary={(
                <MatchSummary matched={country?.matched === true}>
                  {country?.matched !== true && organizationCountry !== null
                    ? <Trans>Country: no match (scenario: {organizationCountry})</Trans>
                    : <Trans>Country: {matchedCountry}</Trans>}
                </MatchSummary>
              )}
            >
              {country?.matched && country.claims.length === 0
                ? <DefectSentence />
                : (
                  <ClaimList
                    claims={country?.claims ?? []}
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    unstatedConfidence={unstatedConfidence}
                    onAnnounce={setClaimsAnnouncement}
                    renderStatement={({ name }) => <Trans>{threatName} targets {name}.</Trans>}
                  />
                )}
            </ProofSection>

            <ProofSection
              isOpen={openSections.sector}
              onToggle={(isOpen) => setOpenSections((sections) => ({ ...sections, sector: isOpen }))}
              summary={(
                <MatchSummary matched={sector?.matched === true}>
                  {sector?.matched !== true && organizationSector !== null
                    ? <Trans>Sector: no match (scenario: {organizationSector})</Trans>
                    : <Trans>Sector: {matchedSector}</Trans>}
                </MatchSummary>
              )}
            >
              {sector?.matched && sector.claims.length === 0
                ? <DefectSentence />
                : (
                  <ClaimList
                    claims={sector?.claims ?? []}
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    unstatedConfidence={unstatedConfidence}
                    onAnnounce={setClaimsAnnouncement}
                    renderStatement={({ name }) => <Trans>{threatName} targets the {name} sector.</Trans>}
                  />
                )}
            </ProofSection>

            <ProofSection
              isOpen={openSections.outcome}
              onToggle={(isOpen) => setOpenSections((sections) => ({ ...sections, outcome: isOpen }))}
              summary={(
                <MatchSummary matched={outcomeWeighs}>
                  {outcomeName === null
                    ? <Trans>Attack outcome</Trans>
                    : <Trans>Attack outcome: {outcomeName}</Trans>}
                </MatchSummary>
              )}
            >
              {outcomeSectionContent}
            </ProofSection>
          </div>
        </Paper>
      </section>
    </div>
  );
};

/**
 * The claims behind one row's relevance. Rendered as a sibling of the table and never once per row:
 * a drawer instance per row is what makes focus return on close unfixable.
 */
export const RelevanceProofPanel: FunctionComponent<RelevanceProofPanelProps> = ({
  target,
  onClose,
  onCloseAutoFocus,
}): ReactElement => {
  const fallbackHeadingId = useId();
  // The drawer stays mounted through its exit animation, so the last target is kept: reading
  // `target` directly would blank the panel on the way out. Adjusting state during render (rather
  // than in a useEffect) avoids a flash of the stale value: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [renderedTarget, setRenderedTarget] = useState<RelevanceProofTarget | null>(target);
  if (target !== null && target !== renderedTarget) {
    setRenderedTarget(target);
  }
  const headingId = renderedTarget ? `relevance-proof-${renderedTarget.analysisId}` : fallbackHeadingId;
  // The chrome names the scenario the panel was opened from; the body's h2 names the threat, so the
  // two never repeat each other.
  const openedFrom = renderedTarget?.scenarioName ?? null;

  return (
    <DisplayDrawer
      open={target !== null}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      className="w-[55vw] max-w-[960px] min-w-[720px]"
      ariaLabelledBy={headingId}
      title={openedFrom === null ? undefined : <Trans>Score overview for {openedFrom}</Trans>}
    >
      {renderedTarget && (
        <RelevanceProofBody
          key={renderedTarget.analysisId}
          target={renderedTarget}
          headingId={headingId}
        />
      )}
    </DisplayDrawer>
  );
};
