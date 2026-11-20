import { Chip } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { AssetCategory, ExpectationType } from '@app/module/client';
import { DEFAULT_PHISHING_SUSCEPTIBILITY, resolveSeverityBand } from '@app/module/client';
import { Bug, Eye, Shield, UserRound } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDefWithOptionsHeader } from '../../../components/ui/data-table-types';
import type { CellBar, HighlightedTechnique } from '../../../components/shared/ttp-matrix-cell';
import type { TechniqueScoreCell, TechniqueScoreFinding } from './technique-scores-utils';
import type { TechniqueTests, TestTally } from './technique-tests-utils';
import { MetricInfo } from '../../../components/shared';
import { DataPageWithTtpMatrix } from '../../../components/ui/data-page-layout';
import { EmptyValue } from '../../../components/ui/empty-value';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { ScoreGaugeMark, severityBandFigureColor, severityBandFillColor } from '../../finding-score';
import { createTechniqueColumn, useTechniqueRowNavigate } from '../../mitre-attack/components';
import { TechniqueScoreDialog } from './technique-score-dialog';
import { gaugeLabel } from './technique-score-labels';
import { holdingFindingOf, ratePercent } from './technique-scores-utils';
import { tallyHereLabel, tallyText, testTypeLabel } from './technique-test-labels';
import { TechniqueTestTiles } from './technique-test-tiles';
import { hasTestReading, heldSeverityBand, heldShare, testedTechniqueCount } from './technique-tests-utils';

type TechniqueOrigin = 'inherent' | 'applicable';

interface AssetTechnique {
  id: string,
  externalId: string,
  name: string,
  origin: TechniqueOrigin,
  scores: TechniqueScoreCell | null,
  tests: TechniqueTests | undefined,
}

interface SupportingAssetTtpsProps {
  categoryId: AssetCategory,
  supportingAssetId: string,
}

const TechniqueOriginBadge: FunctionComponent<{ origin: TechniqueOrigin }> = ({ origin }) => {
  if (origin === 'applicable') {
    return <Chip severity="high" label={t`Applicable`} />;
  }
  return <Chip severity="info" label={t`Inherent`} />;
};

const scoreLabel = (score: number): string => gaugeLabel(t`Score`, score);

const BAR_ICON_SIZE = 12;

const emptyBar = (label: string, icon: ReactNode): CellBar => ({
  ratio: 0,
  fillColor: 'transparent',
  figureColor: 'var(--fds-text-default-secondary)',
  figure: EMPTY_VALUE,
  label,
  icon,
});

const vulnerabilityBar = (cell: TechniqueScoreCell | null): CellBar => {
  const isSusceptibility = cell?.source === 'susceptibility';
  const icon = isSusceptibility ? <UserRound size={BAR_ICON_SIZE} /> : <Bug size={BAR_ICON_SIZE} />;
  if (cell === null) {
    return emptyBar(t`Vulnerability: no finding`, icon);
  }
  const band = resolveSeverityBand(cell.score);
  return {
    ratio: cell.score / 100,
    fillColor: severityBandFillColor(band),
    figureColor: severityBandFigureColor(band),
    figure: String(cell.score),
    label: gaugeLabel(isSusceptibility ? t`Susceptibility` : t`Vulnerability`, cell.score),
    icon,
  };
};

/** The figure is the ratio, never the share: a technique tested once must not read as one tested a hundred times. */
const testBar = (type: ExpectationType, tally: TestTally | null): CellBar => {
  const icon = type === 'prevention' ? <Shield size={BAR_ICON_SIZE} /> : <Eye size={BAR_ICON_SIZE} />;
  if (tally === null) {
    return emptyBar(tallyHereLabel(type, null), icon);
  }
  const band = heldSeverityBand(tally);
  const { held, total } = tally;
  return {
    ratio: heldShare(tally) / 100,
    fillColor: severityBandFillColor(band),
    figureColor: severityBandFigureColor(band),
    figure: `${held}/${total}`,
    label: tallyHereLabel(type, tally),
    icon,
  };
};

const scoreColumn = (): ColumnDefWithOptionsHeader<AssetTechnique, unknown> => ({
  id: 'score',
  accessorFn: (row) => row.scores?.score,
  sortUndefined: 'last',
  header: t`Score`,
  size: 130,
  cell: ({ row }) => {
    const score = row.original.scores?.score;
    if (score === undefined) {
      return <span className="text-muted-foreground"><EmptyValue /></span>;
    }
    return <ScoreGaugeMark score={score} band={resolveSeverityBand(score)} label={scoreLabel(score)} />;
  },
});

const findingColumn = (findingsById: ReadonlyMap<string, TechniqueScoreFinding>): ColumnDefWithOptionsHeader<AssetTechnique, unknown> => ({
  id: 'finding',
  accessorFn: (row) => (row.scores?.source === 'susceptibility' ? t`Susceptibility` : holdingFindingOf(row.scores, findingsById)?.cveId ?? ''),
  header: t`Finding`,
  size: 180,
  cell: ({ row }) => {
    if (row.original.scores?.source === 'susceptibility') {
      return <span><Trans>Susceptibility</Trans></span>;
    }
    const cveId = holdingFindingOf(row.original.scores, findingsById)?.cveId;
    return cveId === undefined
      ? <span className="text-muted-foreground"><Trans>No finding</Trans></span>
      : <span>{cveId}</span>;
  },
});

const testColumn = (type: ExpectationType): ColumnDefWithOptionsHeader<AssetTechnique, unknown> => ({
  id: type,
  accessorFn: (row) => {
    const tally = row.tests?.[type] ?? null;
    return tally === null ? undefined : heldShare(tally);
  },
  sortUndefined: 'last',
  header: testTypeLabel(type),
  size: 170,
  cell: ({ row }) => {
    const tally = row.original.tests?.[type] ?? null;
    if (tally === null) {
      return <span className="text-muted-foreground"><Trans>Never tested here</Trans></span>;
    }
    return <span className="tabular-nums" style={{ color: severityBandFigureColor(heldSeverityBand(tally)) }}>{tallyText(type, tally)}</span>;
  },
});

export const SupportingAssetTtps: FunctionComponent<SupportingAssetTtpsProps> = ({ categoryId, supportingAssetId }) => {
  const trpc = useTRPC();
  const navigateToTechnique = useTechniqueRowNavigate<AssetTechnique>();
  const [openTechniqueId, setOpenTechniqueId] = useState<string | null>(null);
  const defaultPercent = ratePercent(DEFAULT_PHISHING_SUSCEPTIBILITY);
  const { data: categoryTechniquesData, isPending: isCategoryPending } = useQuery(trpc.supportingAssets.getTechniquesByCategory.queryOptions({ categoryId }));
  const { data: applicableData, isPending: isApplicablePending } = useQuery(trpc.supportingAssets.getApplicableTechniquesForAsset.queryOptions({ assetId: supportingAssetId }));
  const { data: scoresData, isPending: isScoresPending, isError: isScoresError } = useQuery(trpc.findingScore.getAssetTechniqueScores.queryOptions({ supportingAssetId }));
  const { data: testsData, isPending: isTestsPending, isError: isTestsError } = useQuery(trpc.findingScore.getAssetTechniqueTests.queryOptions({ supportingAssetId }));
  const isLoading = isCategoryPending || isApplicablePending || isScoresPending || isTestsPending;
  const categoryTechniques = categoryTechniquesData ?? [];
  const applicableTechniques = applicableData ?? [];
  const scoredTechniques = scoresData?.techniques ?? [];
  const findingsById = new Map((scoresData?.findings ?? []).map((finding) => [finding.evidenceId, finding]));
  const testsById = new Map<string, TechniqueTests>((testsData?.techniques ?? []).map((technique) => [technique.mitreTechniqueId, technique]));

  // Category techniques are added first (blue), then overridden by techniques with an
  // applicable finding on this specific asset (orange) — a real finding is more specific
  // and takes priority over the generic inherent (category-level) reachability match.
  const techniqueMap = new Map<string, AssetTechnique>();
  for (const tech of categoryTechniques) {
    techniqueMap.set(tech.id, { id: tech.id, externalId: tech.externalId, name: tech.name, origin: 'inherent', scores: null, tests: testsById.get(tech.id) });
  }
  for (const tech of applicableTechniques) {
    techniqueMap.set(tech.id, {
      id: tech.id,
      externalId: tech.externalId,
      name: tech.name,
      origin: 'applicable',
      scores: null,
      tests: testsById.get(tech.id),
    });
  }
  // An unclassified asset carries every technique while its category lists none, so a scored
  // technique may be missing from both lists above.
  for (const cell of scoredTechniques) {
    const known = techniqueMap.get(cell.mitreTechniqueId);
    techniqueMap.set(cell.mitreTechniqueId, {
      id: cell.mitreTechniqueId,
      externalId: cell.externalId,
      name: cell.name,
      origin: known?.origin ?? 'inherent',
      scores: cell,
      tests: testsById.get(cell.mitreTechniqueId),
    });
  }
  const techniques = [...techniqueMap.values()];
  const openTechnique = openTechniqueId === null ? null : techniqueMap.get(openTechniqueId) ?? null;
  const opensDialog = (tech: AssetTechnique): boolean => tech.scores !== null || hasTestReading(tech.tests);
  const shownIds = techniques.map((tech) => tech.id);

  const hasTechniques = techniques.length > 0;

  const columns: Array<ColumnDefWithOptionsHeader<AssetTechnique, unknown>> = [
    createTechniqueColumn<AssetTechnique>(),
    {
      id: 'origin',
      accessorKey: 'origin',
      header: t`Relevance`,
      size: 120,
      cell: ({ row }) => <TechniqueOriginBadge origin={row.original.origin} />,
    },
    // A failed read is not an absence: a dash would assert that no finding gives a score.
    ...(isScoresError ? [] : [scoreColumn(), findingColumn(findingsById)]),
    ...(isTestsError ? [] : [testColumn('prevention'), testColumn('detection')]),
  ];

  const highlightedTechniques: Array<HighlightedTechnique> = techniques.map((tech) => {
    const highlight: HighlightedTechnique = {
      id: tech.id,
      color: tech.origin === 'applicable' ? 'orange' : 'blue',
      categoryLabel: tech.origin === 'applicable' ? t`Applicable` : t`Inherent`,
    };
    if (!opensDialog(tech)) {
      return highlight;
    }
    const openDialog = ({ className, children }: { className: string, children: ReactNode }) => (
      <button type="button" className={cn(className, 'text-left')} onClick={() => setOpenTechniqueId(tech.id)}>
        {children}
      </button>
    );
    return {
      ...highlight,
      ...(tech.scores === null ? {} : { accent: severityBandFillColor(resolveSeverityBand(tech.scores.score)) }),
      bars: [
        vulnerabilityBar(tech.scores),
        testBar('prevention', tech.tests?.prevention ?? null),
        testBar('detection', tech.tests?.detection ?? null),
      ],
      renderLink: openDialog,
    };
  });

  if (!hasTechniques && !isLoading) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg border py-12">
        <Shield className="h-12 w-12 text-muted-foreground" />
        <div className="text-center">
          <p className="txt-subtitle2">
            <Trans>No ATT&CK techniques associated</Trans>
          </p>
          <p className="txt-sub-content text-muted-foreground">
            <Trans>Techniques are managed on the supporting asset category configuration.</Trans>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {isTestsError && (
        <p className="txt-sub-content text-muted-foreground">
          <Trans>The OpenAEV results could not be loaded.</Trans>
        </p>
      )}
      {testsData !== undefined && (
        <TechniqueTestTiles
          prevention={testsData.prevention}
          detection={testsData.detection}
          testedPrevention={testedTechniqueCount(shownIds, testsById, 'prevention')}
          testedDetection={testedTechniqueCount(shownIds, testsById, 'detection')}
          shown={shownIds.length}
        />
      )}
      <DataPageWithTtpMatrix
        data={techniques}
        columns={columns}
        storageKey="supporting-asset-ttps"
        highlightedTechniques={highlightedTechniques}
        initialSorting={[{ id: 'externalId', desc: false }]}
        leftHeaderContent={
          <div className="flex items-start gap-1.5">
            <p className="txt-sub-content text-muted-foreground">
              <Trans>Techniques identified as enabling compromise of this asset.</Trans>
            </p>
            {isScoresError
              ? (
                <p className="txt-sub-content text-muted-foreground">
                  <Trans>The technique scores could not be loaded.</Trans>
                </p>
              )
              : (
                <MetricInfo
                  className="mt-0.5"
                  title={t`Technique score`}
                  what={<Trans>How likely an attacker playing the technique on this asset is to compromise it, out of 100, controls aside.</Trans>}
                  how={(
                    <>
                      <Trans>Each open vulnerability finding scores the techniques it opens and this asset's category carries: its vector access, times its threat, times the impact its CVSS vector gives, as the finding score reads them. The technique takes its worst finding.</Trans>
                      {' '}
                      <Trans>An enabled user account has no finding: its phishing cell is the susceptibility of its people, the share of people caught by the phishing simulation declared in the settings, or a default of {defaultPercent} % without one or once it has expired.</Trans>
                    </>
                  )}
                  caveat={<Trans>A dash is no data, never a safe technique: no vulnerability finding opens it here. Controls are not counted.</Trans>}
                />
              )}
          </div>
        }
        isLoading={isLoading}
        onClickRow={(row) => (opensDialog(row.original) ? setOpenTechniqueId(row.original.id) : navigateToTechnique(row))}
      />
      <TechniqueScoreDialog
        technique={openTechnique}
        supportingAssetId={supportingAssetId}
        findingsById={findingsById}
        onClose={() => setOpenTechniqueId(null)}
      />
    </div>
  );
};
