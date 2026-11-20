import { Chip } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { skipToken, useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { ProfileLabels, ScopeScenarioTef, TefRead } from '../threat-event-frequency-utils';
import { TooltipHint, TooltipHintProvider } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { formatFixed } from '../../../utils/format-number';
import { profileNotes, ratioFractionDigits, readForOutcome, scenarioTefGap } from '../threat-event-frequency-utils';
import { formatAttempts, formatRange, profileLabels } from './frequency-labels';
import { ProfileChips } from './profile-frequency';

interface ScenarioCatalogLineProps {
  organizationId: string,
  attackOutcomeId: string,
  tefMode: ScopeScenarioTef['tefMode'],
  /** The likely value the scenario runs on, `null` before one is saved or estimated. */
  likely: number | null,
  /** The read the auto estimate records, `null` in manual mode or on an estimate that records none. */
  autoRead: TefRead | null,
}

const profileText = (outcome: string, labels: ProfileLabels): string =>
  [outcome, labels.country, labels.sector, labels.size].filter((part) => part !== null).join(' · ');

/**
 * The catalogue line under a risk scenario's TEF: in auto mode the row it reads, in manual mode the
 * catalogue's value and how far the typed one is from it. The caller hands the TEF over, since reading
 * the auto estimate here would trigger one for a manual scenario.
 */
export const ScenarioCatalogLine: FunctionComponent<ScenarioCatalogLineProps> = ({ organizationId, attackOutcomeId, tefMode, likely, autoRead }) => {
  const trpc = useTRPC();
  const manual = tefMode === 'manual';
  const { data: catalog } = useQuery(trpc.crqIndicators.getTefCatalog.queryOptions());
  const { data: scope } = useQuery(trpc.organizations.getOrganization.queryOptions({ id: organizationId }));
  const { data: reading } = useQuery(trpc.crqIndicators.getTefCatalogReading.queryOptions(
    !manual || scope === undefined || scope === null
      ? skipToken
      : { countryId: scope.countryId, sectorId: scope.sectorId, employeeCount: scope.employeeCount, revenueBand: scope.revenueBand },
  ));
  if (catalog === undefined || scope === undefined || scope === null) {
    return null;
  }
  const outcome = catalog.outcomes.find((candidate) => candidate.id === attackOutcomeId);
  const read = manual ? (reading === undefined ? undefined : readForOutcome(reading, attackOutcomeId)) : autoRead ?? undefined;
  if (outcome === undefined || read === undefined) {
    return null;
  }
  const labels = profileLabels(catalog, scope);
  const catalogLikely = formatAttempts(read.likely);
  const range = formatRange(read.low, read.high);
  const gap = scenarioTefGap({ tefMode, likely, read: autoRead }, read);
  const ratioValue = likely === null ? null : likely / read.likely;
  const ratio = ratioValue === null ? '' : formatFixed(ratioValue, ratioFractionDigits(ratioValue));
  const outcomeName = outcome.name;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 txt-body2 text-muted-foreground">
      {manual
        ? (
          <span className="flex flex-wrap items-center gap-2.5">
            <Trans>Catalog: <span className="font-mono text-foreground">{catalogLikely}</span> per year, range <span className="font-mono">{range}</span></Trans>
            {gap !== null && (
              <TooltipHintProvider>
                <TooltipHint hint={profileText(outcomeName, labels)}>
                  <span><Chip severity="medium" label={i18n._({ id: '×{ratio} the catalog', message: '×{ratio} the catalog', values: { ratio } })} /></span>
                </TooltipHint>
              </TooltipHintProvider>
            )}
          </span>
        )
        : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">{outcomeName}</span>
            <ProfileChips labels={labels} notes={profileNotes([read])} />
          </span>
        )}
      <Link
        to="/$tenantId/{-$organizationId}/threat-event-frequency"
        params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId })}
        search={{ outcome: attackOutcomeId }}
        className="inline-flex items-center gap-1.5 text-primary hover:underline"
      >
        {t`See it in the threat event frequency`}
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
};
