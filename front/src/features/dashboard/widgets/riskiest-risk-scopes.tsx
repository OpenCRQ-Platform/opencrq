import { Card, CardHeader, CardTitle, Text } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';
import type { FunctionComponent, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LifelineDirection } from '../../../components/shared';
import { roundPercentPoints } from '@app/utils/decimals';
import { BadgeGroup } from '../../../components';
import { MetricInfo } from '../../../components/shared';
import { directionBetween } from '../../../components/shared/lifeline-utils';
import { tileTonePaint } from '../../../components/shared/tile-tone';
import { EmptyValue } from '../../../components/ui/empty-value';
import { CARD_CONTENT_FILLS } from '../../../components/ui/card-content-fills';
import { useTRPC } from '../../../lib';
import { formatCompactCount, formatDollar, formatDollarChange, formatFractionAsPercent, formatRevenueBand } from '../../../utils';
import { estateLabel } from '../../organizations/estate-label';
import { AGGREGATE_RISK_WINDOW_DAYS } from '../aggregate-risk-utils';
import { changeTitleSince, TrendChangeChip } from '../components/trend-change-chip';
import { fitRiskScopeSlots, RISK_SCOPE_CARD_GAP, summarizeOtherRiskScopes } from '../dashboard-utils';

type RiskScopeFigures = inferRouterOutputs<TRPCRouter>['dashboard']['getRiskScopeFigures'][number];
type RiskScopeProfile = inferRouterOutputs<TRPCRouter>['organizations']['getOrganizations'][number];

const linkClassName = 'text-filigran-brand-primary hover:underline focus-visible:underline';

const aleReading = (ale: number | null, change: number | null): { change: number | null, direction: LifelineDirection } => ({
  change,
  direction: ale === null || change === null ? 'flat' : directionBetween(ale - change, ale),
});

const AleFigure: FunctionComponent<{ ale: number | null, change: number | null, changeTitle: string | undefined, children?: ReactNode }> = ({ ale, change, changeTitle, children }) => (
  <div className="flex flex-col gap-1">
    <Text as="span" variant="content-compact" className="text-default-secondary">{t`Annual loss exposure`}</Text>
    <div className="flex flex-wrap items-center gap-2">
      <Text as="span" variant="title-xl" className="tabular-nums">{ale === null ? <EmptyValue /> : formatDollar(ale)}</Text>
      <TrendChangeChip reading={aleReading(ale, change)} formatChange={formatDollarChange} title={changeTitle} />
    </div>
    {children}
  </div>
);

const RankBadge: FunctionComponent<{ rank: number }> = ({ rank }) => {
  const paint = tileTonePaint(rank === 1 ? 'high' : 'neutral');
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)] font-content-compact text-content-compact font-semibold tabular-nums"
      style={{ background: paint.fill, color: paint.text }}
    >
      {rank}
    </span>
  );
};

const RiskScopeProfileFooter: FunctionComponent<{ profile: RiskScopeProfile }> = ({ profile }) => {
  const badges: Array<{ title: string }> = [{ title: estateLabel(profile) }];
  if (profile.sector) {
    badges.push({ title: profile.sector.name });
  }
  if (profile.country) {
    badges.push({ title: profile.country.name });
  }
  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-elevation-subtle-soft pt-3">
      <BadgeGroup items={badges} />
      <Text as="div" variant="content-compact" className="text-default-secondary">
        {formatCompactCount(profile.employeeCount ?? null)}
        {' '}
        {t`employees`}
        {' · '}
        {formatRevenueBand(profile.revenueBand ?? null)}
      </Text>
    </div>
  );
};

const RiskScopeCard: FunctionComponent<{ scope: RiskScopeFigures, rank: number, profile: RiskScopeProfile | undefined }> = ({ scope, rank, profile }) => (
  <li className="flex min-w-0">
    <Card elevation={2} gap={16} padding={16} className={`h-full ${CARD_CONTENT_FILLS}`}>
      <CardHeader icon={<RankBadge rank={rank} />} className="gap-2">
        <CardTitle as="h4">
          <Link
            to="/$tenantId/{-$organizationId}"
            params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: scope.organizationId })}
            className={linkClassName}
          >
            {scope.name}
          </Link>
        </CardTitle>
      </CardHeader>
      <AleFigure ale={scope.ale} change={scope.aleChange} changeTitle={changeTitleSince(scope.aleBaseline?.date ?? null, scope.windowStart)} />
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 font-content-compact text-content-compact tabular-nums">
        <dt className="text-default-secondary">{t`Likelihood`}</dt>
        <dd className="m-0 text-right">{scope.likelihood === null ? <EmptyValue /> : formatFractionAsPercent(scope.likelihood, 0)}</dd>
        <dt className="text-default-secondary">{t`Loss magnitude`}</dt>
        <dd className="m-0 text-right">{scope.magnitude === null ? <EmptyValue /> : formatDollar(scope.magnitude)}</dd>
        <dt className="text-default-secondary">{t`Risk scenarios`}</dt>
        <dd className="m-0 text-right">{scope.scenarioCount}</dd>
      </dl>
      {profile !== undefined && <RiskScopeProfileFooter profile={profile} />}
    </Card>
  </li>
);

const OtherRiskScopesCard: FunctionComponent<{ scopes: Array<RiskScopeFigures>, shownCount: number }> = ({ scopes, shownCount }) => {
  const other = summarizeOtherRiskScopes(scopes, shownCount);
  const share = other.share === null ? null : roundPercentPoints(other.share, 0);
  const windowStart = scopes.at(0)?.windowStart;
  const changeTitle = windowStart === undefined ? undefined : changeTitleSince(other.aleSince, windowStart);
  return (
    <li className="flex min-w-0">
      <Card
        elevation={2}
        gap={16}
        padding={16}
        className={`h-full ${CARD_CONTENT_FILLS}`}
        style={{ borderStyle: 'dashed', borderColor: tileTonePaint('brand').glyph }}
      >
        <CardHeader>
          <CardTitle as="h4">
            {i18n._({
              id: '{scopeCount, plural, one {# other risk scope} other {# other risk scopes}}',
              message: '{scopeCount, plural, one {# other risk scope} other {# other risk scopes}}',
              values: { scopeCount: other.scopeCount },
            })}
          </CardTitle>
        </CardHeader>
        <AleFigure ale={other.ale} change={other.aleChange} changeTitle={changeTitle}>
          <Text as="span" variant="content-compact" className="text-default-secondary tabular-nums">
            {share === null
              ? i18n._({
                id: '{scenarioCount, plural, one {# risk scenario} other {# risk scenarios}}',
                message: '{scenarioCount, plural, one {# risk scenario} other {# risk scenarios}}',
                values: { scenarioCount: other.scenarioCount },
              })
              : i18n._({
                id: '{share}% of the tenant · {scenarioCount, plural, one {# risk scenario} other {# risk scenarios}}',
                message: '{share}% of the tenant · {scenarioCount, plural, one {# risk scenario} other {# risk scenarios}}',
                values: { share, scenarioCount: other.scenarioCount },
              })}
          </Text>
        </AleFigure>
        <Link
          to="/$tenantId/{-$organizationId}/risk-scopes"
          params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: undefined })}
          className={`mt-auto font-content-compact text-content-compact ${linkClassName}`}
        >
          {t`See all risk scopes`}
        </Link>
      </Card>
    </li>
  );
};

const useMeasuredWidth = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    let frame: number | null = null;
    const measure = (): void => {
      frame = null;
      setWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);
  return { ref, width };
};

export const RiskiestRiskScopes: FunctionComponent = () => {
  const trpc = useTRPC();
  const titleId = useId();
  const { data } = useQuery(trpc.dashboard.getRiskScopeFigures.queryOptions({ windowDays: AGGREGATE_RISK_WINDOW_DAYS }));
  const { data: profiles } = useQuery(trpc.organizations.getOrganizations.queryOptions());
  const profileById = new Map(profiles?.map((profile) => [profile.id, profile]));
  const { ref, width } = useMeasuredWidth();
  const slots = fitRiskScopeSlots(width, data?.length ?? 0);

  let content: ReactNode;
  if (data === undefined) {
    content = <Skeleton className="h-56 w-full" />;
  } else if (data.length === 0) {
    content = (
      <Text as="p" variant="content-base" className="text-default-secondary">
        <Trans>No risk scope holds a simulated scenario yet.</Trans>
      </Text>
    );
  } else {
    content = (
      <ol
        aria-label={t`Risk scopes by annual loss exposure`}
        className="m-0 grid list-none p-0"
        style={{ gridTemplateColumns: `repeat(${slots.columns}, minmax(0, 1fr))`, gap: RISK_SCOPE_CARD_GAP }}
      >
        {data.slice(0, slots.shownCount).map((scope, index) => (
          <RiskScopeCard key={scope.organizationId} scope={scope} rank={index + 1} profile={profileById.get(scope.organizationId)} />
        ))}
        {slots.hasOther && <OtherRiskScopesCard scopes={data} shownCount={slots.shownCount} />}
      </ol>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex items-center gap-1">
        <Text as="h3" variant="title-sm" id={titleId}>{t`Riskiest risk scopes`}</Text>
        <MetricInfo
          title={t`Riskiest risk scopes`}
          what={<Trans>The risk scopes ranked by annual loss exposure, highest first.</Trans>}
          how={(
            <Trans>
              Each risk scope's figures add up its scenarios exactly as its own Aggregate risk does: the mean annual loss
              exposure of each scenario's latest simulation, a likelihood of 1 − e^−LEF and a loss magnitude of the
              exposure divided by the LEF. The change compares today with the first day of the last 12 months that has a
              figure. The row shows as many risk scopes as its width holds, and the last card sums up the rest.
            </Trans>
          )}
          caveat={<Trans>A risk scope with no simulated scenario is left out.</Trans>}
        />
      </div>
      <div ref={ref}>{content}</div>
    </section>
  );
};
