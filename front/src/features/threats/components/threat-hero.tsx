import { Chip, Hero, HeroBody, HeroHeader, Paper, Text, Thumbnail } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Activity, MapPin, Target } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';
import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ThreatAnalysisDetailData } from './threat-detail-tabs';
import { useMediaQuery, useOpenCtiBaseUrl } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { formatDate, formatFractionAsPercent } from '../../../utils';
import { EMPTY_VALUE } from '../../../utils/empty-value';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared/tooltip-hint';
import { buildOpenCtiObjectLink } from '../../supporting-assets/connectors-utils';
import { useCounterparts, XtmConnectActions, XtmPivotButton, XtmPivotButtons } from '../../xtm/xtm-counterparts';
import { ResourceLevelGauge, resourceLevelLabel } from './resource-level-gauge';
import { ThreatActionsMenu } from './threat-actions-menu';
import { countConcerningTargets, pickBestOutcomeMatch, threatActivityStatus, threatActivityStatusLabel } from './threat-hero-utils';
import { ThreatQuantifyAction } from './threat-quantify-action';
import { ThreatTypeChip } from './threat-type-chip';
import { ThreatTypeIcon } from './threat-type-icon';

interface HeroFigureProps {
  icon: ReactNode,
  /** Alert tone for a figure that bears on the tenant, highlight otherwise. */
  alert: boolean,
  value: string,
  label: string,
  /** For a label of unbounded length: the figure narrows down to 15rem, its label ellipsized, before the row breaks. */
  shrinkable?: boolean,
}

const HeroFigure: FunctionComponent<HeroFigureProps> = ({ icon, alert, value, label, shrinkable }) => (
  <Paper padding={8} className={shrinkable ? 'flex min-w-0 max-w-fit grow basis-60 items-center gap-2 bg-transparent' : 'flex items-center gap-2 bg-transparent'}>
    <span aria-hidden className={alert ? 'inline-flex shrink-0 text-icon-alert' : 'inline-flex shrink-0 text-icon-highlight'}>{icon}</span>
    <span className="flex min-w-0 items-center gap-1">
      <Text as="span" variant="content-base-bold" className="shrink-0 whitespace-nowrap">{value}</Text>
      {shrinkable
        ? <Text as="span" variant="content-compact" className="truncate text-default-secondary" title={label}>{label}</Text>
        : <Text as="span" variant="content-compact" className="text-default-secondary">{label}</Text>}
    </span>
  </Paper>
);

/** Below it the hero actions leave the title too little room: the cross-product pivots go icon-only. */
// eslint-disable-next-line lingui/no-unlocalized-strings -- media query, not copy
export const HERO_WIDE_QUERY = '(min-width: 1280px)';

interface ThreatHeroProps {
  detail: ThreatAnalysisDetailData,
}

/**
 * The header every tab of a threat shares. It carries no description and no confidence, which
 * would repeat on every tab: the overview holds them.
 */
export const ThreatHero: FunctionComponent<ThreatHeroProps> = ({ detail }) => {
  const trpc = useTRPC();
  const { analysis, origin, activity, locations, sectors } = detail;
  const titleId = useId();
  const openctiUrl = useOpenCtiBaseUrl();
  const compact = !useMediaQuery(HERO_WIDE_QUERY);
  const { data: outcomes } = useQuery(trpc.threats.getOutcomeScoresForAnalysis.queryOptions({ analysisId: analysis.id }));

  const openctiLink = origin.kind === 'connector' ? buildOpenCtiObjectLink(openctiUrl, origin.stixId) : null;
  // The same threat in the other XTM products, by its STIX id: OpenAEV scenarios generated from it,
  // and OpenCTI when the threat came from a STIX import rather than the OpenCTI stream.
  const counterparts = useCounterparts('THREAT', [analysis.stixId])
    .filter((c) => c.product === 'openaev' || openctiLink === null);
  const pivots = counterparts.length > 0 ? <XtmPivotButtons counterparts={counterparts} compact={compact} /> : null;

  const activityStatus = threatActivityStatus(activity.lastObservedAt, new Date());
  const date = activity.lastObservedAt ? formatDate(activity.lastObservedAt) : null;
  // Read from data presence, not the query status: a failed refetch keeps the last scores, which still hold.
  const scored = (outcomes ?? []).flatMap((item) => (item.score === null ? [] : [{ ...item, score: item.score }]));
  const bestMatch = pickBestOutcomeMatch(scored);
  // Cross-module action: the threat, seen in OpenCTI or simulated in OpenAEV, quantified here.
  const quantify = bestMatch === null ? null : <ThreatQuantifyAction attackOutcomeId={bestMatch.attackOutcomeId} outcomeName={bestMatch.outcomeName} />;
  // Not connected: the connect call to action (or the read-only hint) in the hero, as on the asset
  // and CVE pages and in OpenCTI and OpenAEV. OpenCTI counts as connected when the threat came from it.
  const connect = <XtmConnectActions products={openctiLink === null ? undefined : ['openaev']} compact={compact} />;
  const action = origin.kind === 'stix-import'
    ? <span className="flex items-center gap-2">{quantify}{pivots}{connect}<ThreatActionsMenu threatId={analysis.id} /></span>
    : (
      <span className="flex items-center gap-2">
        {quantify}
        {openctiLink !== null && <XtmPivotButton product="opencti" href={openctiLink} compact={compact} />}
        {pivots}
        {connect}
      </span>
    );
  const outcome = bestMatch?.outcomeName;
  const concerning = countConcerningTargets(locations, sectors);

  return (
    <Hero role="region" aria-labelledby={titleId}>
      <HeroHeader
        icon={(
          <Thumbnail elevation={2}>
            <ThreatTypeIcon entityType={analysis.entityType} size={24} />
          </Thumbnail>
        )}
        action={action}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          {/* A name longer than the room the actions leave keeps its ellipsis and shows whole on hover. */}
          <TooltipHintProvider>
            <TooltipHint hint={analysis.name}>
              <Text as="h1" id={titleId} variant="title-md" className="m-0 truncate">{analysis.name}</Text>
            </TooltipHint>
          </TooltipHintProvider>
          <div className="flex flex-wrap gap-2">
            <ThreatTypeChip entityType={analysis.entityType} />
            {analysis.mitreGroupId && <Chip label={analysis.mitreGroupId} />}
          </div>
        </div>
      </HeroHeader>
      <HeroBody className="flex-wrap">
        <HeroFigure
          icon={<Activity size={24} />}
          alert={activityStatus === 'active'}
          value={threatActivityStatusLabel(activityStatus)}
          label={date === null ? t`Observed activity` : t`Last activity observed: ${date}`}
        />
        <HeroFigure
          icon={<Target size={24} />}
          alert={bestMatch !== null}
          shrinkable
          value={bestMatch === null ? EMPTY_VALUE : formatFractionAsPercent(bestMatch.score, 0)}
          label={outcome !== undefined
            ? t`Best match: ${outcome}`
            : outcomes === undefined ? t`Attack outcomes` : t`No matching attack outcome`}
        />
        <HeroFigure
          icon={<MapPin size={24} />}
          alert={concerning > 0}
          value={String(concerning)}
          label={plural(concerning, { one: 'country or sector concerns you', other: 'countries and sectors concern you' })}
        />
        <HeroFigure
          icon={<ResourceLevelGauge value={analysis.resourceLevel} decorative />}
          alert={false}
          value={analysis.resourceLevel === null ? EMPTY_VALUE : resourceLevelLabel(analysis.resourceLevel)}
          label={t`Resource level`}
        />
      </HeroBody>
    </Hero>
  );
};
