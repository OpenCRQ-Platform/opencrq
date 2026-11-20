import { Button, Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTitle, Spinner } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { ExpectationType, TechniqueClaimLane } from '@app/module/client';
import { partFigure, resolveSeverityBand } from '@app/module/client';
import { Link } from '@tanstack/react-router';
import { Bug, Eye, Shield, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import type { TechniqueScoreCell, TechniqueScoreFinding } from './technique-scores-utils';
import type { TestTally } from './technique-tests-utils';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { cn, formatAtMost, formatDate, formatFixed } from '../../../utils';
import { EmptyScoreGauge, ScoreGauge, ScoreGaugeMark, severityBandFigureColor, severityBandFillColor } from '../../finding-score';
import { gaugeLabel } from './technique-score-labels';
import { fleetTallyText, tallyHereLabel, testTypeLabel, viewResultsText } from './technique-test-labels';
import { holdingFindingOf, openingEvidence, ratePercent } from './technique-scores-utils';
import { heldSeverityBand, heldShare } from './technique-tests-utils';

const claimLaneLabel = (lane: TechniqueClaimLane): string => {
  switch (lane) {
    case 'supplied': return t`Claim supplied by the connector`;
    case 'curated': return t`Curated claim`;
    case 'structural': return t`Derived from the weakness`;
    case 'topology': return t`Read from the CVSS vector`;
  }
};

const epssSignal = (epss: string): string => t`EPSS ${epss}`;

const FindingLink: FunctionComponent<{ evidenceId: string, className: string, children: ReactNode }> = ({ evidenceId, className, children }) => (
  <Link
    from="/$tenantId/{-$organizationId}"
    to="findings/$evidenceId"
    params={{ evidenceId }}
    className={cn('text-primary underline-offset-4 hover:underline', className)}
  >
    {children}
  </Link>
);

const TermMark: FunctionComponent<{ name: string, value: number }> = ({ name, value }) => {
  const figure = partFigure(value);
  return (
    <span className="flex items-center gap-2">
      <ScoreGaugeMark
        score={figure}
        band={resolveSeverityBand(figure)}
        label={gaugeLabel(name, figure)}
      />
      <span className="font-content-caption text-content-caption text-default-secondary">{name}</span>
    </span>
  );
};

const Times: FunctionComponent = () => (
  <span aria-hidden="true" className="font-content-base text-content-base text-default-secondary">×</span>
);

const HoldingFindingCard: FunctionComponent<{ finding: TechniqueScoreFinding, lane: TechniqueClaimLane | null }> = ({ finding, lane }) => {
  const evidence = openingEvidence(finding.cvssVector);
  const epss = finding.epss === null ? null : formatFixed(finding.epss, 3);
  const signals = [
    ...evidence.accessMetrics.map(({ metric, value }) => `${metric}:${value}`),
    ...(epss === null ? [] : [epssSignal(epss)]),
    ...(finding.knownExploited ? [t`CISA KEV`] : []),
    ...(evidence.highComplexity ? [t`high attack complexity`] : []),
    ...(evidence.requirementsPresent ? [t`attack requirements present`] : []),
  ];
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <FindingLink evidenceId={finding.evidenceId} className="font-content-base-bold text-content-base-bold">
          {finding.cveId}
        </FindingLink>
        {lane !== null && (
          <span className="font-content-compact text-content-compact text-default-secondary">{claimLaneLabel(lane)}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <TermMark name={t`Vector access`} value={finding.access} />
        <Times />
        <TermMark name={t`Threat`} value={finding.threat} />
        <Times />
        <TermMark name={t`Impact`} value={finding.impact} />
      </div>
      <span className="font-content-compact text-content-compact text-default-secondary">{signals.join(' · ')}</span>
    </div>
  );
};

const BAR_TRACK_COLOR = 'var(--fds-color-feedback-neutral-secondary-transparency-30)';

const TallyBar: FunctionComponent<{ tally: TestTally | null, thick?: boolean }> = ({ tally, thick }) => (
  <span aria-hidden="true" className={cn('block overflow-hidden rounded-full', thick === true ? 'h-1.5' : 'h-1')} style={{ backgroundColor: BAR_TRACK_COLOR }}>
    {tally !== null && (
      <span
        className="block h-full rounded-full"
        style={{ width: `${heldShare(tally)}%`, backgroundColor: severityBandFillColor(heldSeverityBand(tally)) }}
      />
    )}
  </span>
);

const tallyFigure = ({ held, total }: TestTally): string => `${held}/${total}`;

const SectionHeading: FunctionComponent<{ icon: ReactNode, children: ReactNode }> = ({ icon, children }) => (
  <h3 className="flex items-center gap-2.5 font-content-compact-bold text-content-compact-bold">
    <span aria-hidden="true" className="flex text-default-secondary">{icon}</span>
    {children}
  </h3>
);

const VulnerabilitySection: FunctionComponent<{
  cell: TechniqueScoreCell | null,
  findingsById: ReadonlyMap<string, TechniqueScoreFinding>,
}> = ({ cell, findingsById }) => {
  const finding = holdingFindingOf(cell, findingsById);
  return (
    <section className="flex flex-col gap-3 rounded-sm border border-[var(--fds-border-elevation-subtle)] p-4">
      <SectionHeading icon={<Bug size={18} />}><Trans>Vulnerability</Trans></SectionHeading>
      <div className="flex items-center gap-5 border-t border-[var(--fds-border-elevation-subtle)] pt-3">
        {cell === null
          ? <EmptyScoreGauge label={t`Score: no finding`} />
          : <ScoreGauge score={cell.score} band={resolveSeverityBand(cell.score)} label={gaugeLabel(t`Score`, cell.score)} />}
        <div className="min-w-0 flex-1">
          {cell === null && (
            <span className="font-content-compact text-content-compact text-default-secondary"><Trans>No finding</Trans></span>
          )}
          {cell !== null && cell.evidenceId !== null && finding === undefined && (
            <FindingLink evidenceId={cell.evidenceId} className="font-content-compact text-content-compact">
              {cell.evidenceId}
            </FindingLink>
          )}
          {cell !== null && finding !== undefined && <HoldingFindingCard finding={finding} lane={cell.lane} />}
        </div>
      </div>
    </section>
  );
};

const SusceptibilitySection: FunctionComponent<{ cell: TechniqueScoreCell }> = ({ cell }) => {
  const { score } = cell;
  const rate = formatAtMost(ratePercent(cell.susceptibility?.rate ?? score / 100), 1);
  const measuredOn = cell.susceptibility?.measuredOn;
  const date = measuredOn === null || measuredOn === undefined ? null : formatDate(measuredOn);
  const isDeclared = cell.susceptibility?.declared === true && date !== null;
  const isExpired = cell.susceptibility?.expired === true && date !== null;
  return (
    <section className="flex flex-col gap-3 rounded-sm border border-[var(--fds-border-elevation-subtle)] p-4">
      <SectionHeading icon={<UserRound size={18} />}><Trans>Susceptibility</Trans></SectionHeading>
      <div className="flex items-center gap-5 border-t border-[var(--fds-border-elevation-subtle)] pt-3">
        <ScoreGauge score={score} band={resolveSeverityBand(score)} label={gaugeLabel(t`Score`, score)} />
        <div className="flex min-w-0 flex-1 flex-col gap-2 font-content-compact text-content-compact">
          <p>
            {isDeclared && <Trans>{rate} % of the people were caught by the phishing simulation measured on {date}, read as measured under the awareness training declared today.</Trans>}
            {isExpired && <Trans>{rate} % of the people take a compromising action on a phishing email, before any awareness training. The phishing simulation measured on {date} is older than the validity of a test result, so this is the default.</Trans>}
            {!isDeclared && !isExpired && <Trans>{rate} % of the people take a compromising action on a phishing email, before any awareness training. No simulation rate is declared, so this is the default.</Trans>}
            {' '}
            <Trans>The score rounds this rate to the nearest whole number.</Trans>
          </p>
          <p className="text-default-secondary">
            <Trans>Controls are not counted here: their effect is read on the Controls tab of a risk scenario.</Trans>
          </p>
        </div>
      </div>
    </section>
  );
};

interface TestSectionData {
  here: TestTally | null,
  fleet: TestTally | null,
  platforms: Array<TestTally & { securityPlatformType: string | null, lastRunAt: Date | string | null }>,
}

const TestSection: FunctionComponent<{
  type: ExpectationType,
  data: TestSectionData,
  supportingAssetId: string,
  techniqueExternalId: string,
}> = ({ type, data, supportingAssetId, techniqueExternalId }) => {
  const here = data.here;
  const fleet = data.fleet;
  return (
    <section className="flex flex-col gap-3 rounded-sm border border-[var(--fds-border-elevation-subtle)] p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_200px_72px] items-center gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <SectionHeading icon={type === 'prevention' ? <Shield size={18} /> : <Eye size={18} />}>{testTypeLabel(type)}</SectionHeading>
          {fleet !== null && (
            <span className="font-content-caption text-content-caption text-default-secondary">{fleetTallyText(type, fleet)}</span>
          )}
        </div>
        <TallyBar tally={here} thick />
        <span
          role="img"
          aria-label={tallyHereLabel(type, here)}
          className="text-right font-content-base text-content-base font-medium tabular-nums"
          style={here === null ? undefined : { color: severityBandFigureColor(heldSeverityBand(here)) }}
        >
          {here === null ? <EmptyValue /> : tallyFigure(here)}
        </span>
      </div>
      {here === null
        ? (
          <span className="border-t border-[var(--fds-border-elevation-subtle)] pt-3 font-content-compact text-content-compact text-default-secondary">
            <Trans>Never tested here</Trans>
          </span>
        )
        : (
          <>
            <div role="table" className="flex flex-col border-t border-[var(--fds-border-elevation-subtle)]">
              <div role="row" className={cn('grid grid-cols-[96px_minmax(0,1fr)_64px_96px] items-center gap-3 py-2 font-content-caption text-content-caption uppercase text-default-secondary')}>
                <span role="columnheader"><Trans>Platform</Trans></span>
                <span role="columnheader" />
                <span role="columnheader" className="text-right"><Trans>Here</Trans></span>
                <span role="columnheader" className="text-right"><Trans>Last test</Trans></span>
              </div>
              {data.platforms.map((platform) => (
                <div
                  key={platform.securityPlatformType ?? ''}
                  role="row"
                  className={cn('grid min-h-10 grid-cols-[96px_minmax(0,1fr)_64px_96px] items-center gap-3 border-t border-[var(--fds-border-elevation-subtle)] font-content-compact text-content-compact')}
                >
                  <span role="cell" className="truncate font-medium">{platform.securityPlatformType ?? t`Unknown platform`}</span>
                  <span role="cell"><TallyBar tally={platform} /></span>
                  <span role="cell" className="text-right tabular-nums" style={{ color: severityBandFigureColor(heldSeverityBand(platform)) }}>
                    {tallyFigure(platform)}
                  </span>
                  <span role="cell" className="text-right text-default-secondary">
                    {platform.lastRunAt === null ? <EmptyValue /> : formatDate(platform.lastRunAt)}
                  </span>
                </div>
              ))}
            </div>
            <Link
              from="/$tenantId/{-$organizationId}"
              to="assets/$supportingAssetId/findings"
              params={{ supportingAssetId }}
              search={{ state: 'all', technique: techniqueExternalId, expectation: type }}
              className="self-start font-content-compact text-content-compact text-primary underline-offset-4 hover:underline"
            >
              {viewResultsText(here.total)}
            </Link>
          </>
        )}
    </section>
  );
};

const TestSections: FunctionComponent<{ supportingAssetId: string, mitreTechniqueId: string, techniqueExternalId: string }> = ({
  supportingAssetId,
  mitreTechniqueId,
  techniqueExternalId,
}) => {
  const trpc = useTRPC();
  const { data, isError } = useQuery(trpc.findingScore.getAssetTechniqueTestDetail.queryOptions({ supportingAssetId, mitreTechniqueId }));
  if (isError) {
    return (
      <p className="font-content-compact text-content-compact text-default-secondary">
        <Trans>The OpenAEV results could not be loaded.</Trans>
      </p>
    );
  }
  if (data === undefined) {
    return (
      <div className="flex justify-center py-6">
        <Spinner size="md" label={t`Loading the OpenAEV results`} />
      </div>
    );
  }
  return (
    <>
      <TestSection type="prevention" data={data.prevention} supportingAssetId={supportingAssetId} techniqueExternalId={techniqueExternalId} />
      <TestSection type="detection" data={data.detection} supportingAssetId={supportingAssetId} techniqueExternalId={techniqueExternalId} />
    </>
  );
};

export interface DialogTechnique {
  id: string,
  externalId: string,
  name: string,
  scores: TechniqueScoreCell | null,
}

interface TechniqueScoreDialogProps {
  technique: DialogTechnique | null,
  supportingAssetId: string,
  findingsById: ReadonlyMap<string, TechniqueScoreFinding>,
  onClose: () => void,
}

export const TechniqueScoreDialog: FunctionComponent<TechniqueScoreDialogProps> = ({ technique, supportingAssetId, findingsById, onClose }) => (
  <Dialog open={technique !== null} onOpenChange={(open) => !open && onClose()}>
    {technique !== null && (
      <DialogContent size="lg">
        <DialogTitle>
          <span className="block font-content-code text-content-code text-default-secondary">{technique.externalId}</span>
          {technique.name}
        </DialogTitle>
        <DialogBody className="flex flex-col gap-4 py-2">
          {technique.scores?.source === 'susceptibility'
            ? <SusceptibilitySection cell={technique.scores} />
            : <VulnerabilitySection cell={technique.scores} findingsById={findingsById} />}
          <TestSections supportingAssetId={supportingAssetId} mitreTechniqueId={technique.id} techniqueExternalId={technique.externalId} />
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button priority="secondary"><Trans>Close</Trans></Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    )}
  </Dialog>
);
