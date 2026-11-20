import { ACTIVITY_ACTIVE_WINDOW_DAYS, STRONG_OUTCOME_MATCH_SCORE } from '@app/module/client';
import { TooltipProvider } from '@filigran/design-system';
import { Skeleton } from '@filigran/ui';
import { i18n } from '@lingui/core';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent, ReactNode } from 'react';
import { KpiCard } from '../../../components/shared/kpi-card';
import { useTRPC } from '../../../lib';
import { formatPanelCount } from '../../findings-home/findings-panel-utils';
import { formatFractionAsPercent } from '../../../utils/format-number';
import { threatCatalogTotal } from './threat-list-utils';

const TOOLTIP_DELAY_MS = 150;

const BandGrid: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  // `md:grid-cols-3` is shipped unlayered by `fds.css`, hence the arbitrary form.
  <div className="grid grid-cols-1 gap-3 md:grid-cols-[repeat(3,minmax(0,1fr))]">{children}</div>
);

/** The tenant's whole catalogue, whatever the list below is filtered on. */
export const ThreatCatalogKpiBand: FunctionComponent = () => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.threats.getCatalogKpis.queryOptions());

  if (data === undefined) {
    return (
      <BandGrid>
        {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-[138px] w-full rounded-sm" />)}
      </BandGrid>
    );
  }

  const locale = i18n.locale || 'en';
  const strongThreshold = formatFractionAsPercent(STRONG_OUTCOME_MATCH_SCORE, 0);
  const totalLabel = plural(threatCatalogTotal(data), { one: 'out of # threat', other: 'out of # threats' });
  const actorsLabel = plural(data.threatActors, { one: '# threat actor', other: '# threat actors' });
  const intrusionSetsLabel = plural(data.intrusionSets, { one: '# intrusion set', other: '# intrusion sets' });
  const campaignsLabel = plural(data.campaigns, { one: '# campaign', other: '# campaigns' });
  const onEstateLabel = plural(data.targetedCvesOnEstate, { one: '# of them on your estate', other: '# of them on your estate' });

  return (
    <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
      <BandGrid>
        <KpiCard
          label={t`Active threats`}
          icon="activity"
          tone="warning"
          figure={formatPanelCount(data.active, locale)}
          subtitle={<Trans>{totalLabel}: {actorsLabel}, {intrusionSetsLabel}, {campaignsLabel}</Trans>}
          tooltip={<Trans>A threat is active when it was last observed less than {ACTIVITY_ACTIVE_WINDOW_DAYS} days ago.</Trans>}
        />
        <KpiCard
          label={t`Strong match with your outcomes`}
          icon="custom/target"
          tone="warning"
          figure={formatPanelCount(data.strongOutcomeMatches, locale)}
          subtitle={<Trans>at least {strongThreshold} with one of your attack outcomes</Trans>}
          tooltip={<Trans>Threats whose top attack outcome reaches {strongThreshold}, the level at which its chip turns red.</Trans>}
        />
        <KpiCard
          label={t`Targeted CVEs`}
          icon="bug"
          tone="info"
          figure={formatPanelCount(data.targetedCves, locale)}
          subtitle={onEstateLabel}
          tooltip={<Trans>A CVE several threats target counts once, among the claims that pass the confidence gate. It is on your estate when it is one of your unique findings, read on the whole estate whatever the risk scope.</Trans>}
        />
      </BandGrid>
    </TooltipProvider>
  );
};
