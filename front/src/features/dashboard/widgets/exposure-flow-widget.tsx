import { Chip } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { Skeleton } from '@filigran/ui';
import { Link, linkOptions, useNavigate, useRouter } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { ExposureFlowData, ScenarioRef } from '../use-exposure-flow-data';
import type { MissingDataRow } from '../../../components/shared';
import type { PositionedNode } from '../exposure-flow-utils';
import type { FlowNodeLink } from '../components/sankey-flow';
import { buildExposureFlow } from '../exposure-flow-utils';
import { useTRPC } from '../../../lib';
import { MetricInfo, MISSING_DATA_ACTION_CLASS, MissingDataAccordion } from '../../../components/shared';
import { formatDollar, formatFixed } from '../../../utils';
import { tabForAction } from '../../organizations/scope-drawer-tabs';
import { SankeyFlow } from '../components/sankey-flow';
import { Panel } from '../components/slick-primitives';

const FINANCIAL_IMPACT_ROUTE = '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/financial-impact' as const;
const CRQ_ROUTE = '/$tenantId/{-$organizationId}/risk-scenarios/$riskScenarioId/crq' as const;

interface ExposureFlowWidgetProps {
  data: ExposureFlowData,
  organizationId?: string,
}

export const ExposureFlowWidget: FunctionComponent<ExposureFlowWidgetProps> = ({ data, organizationId }) => {
  const trpc = useTRPC();
  const router = useRouter();
  const navigate = useNavigate();

  const flow = buildExposureFlow(data.scenarios, { techniqueLabels: data.techniqueLabels });

  const findingsQuery = useQuery(trpc.dashboard.getTechniqueFindingCounts.queryOptions({ organizationId }));
  const findingsByTechnique = new Map((findingsQuery.data ?? []).map((row) => [row.mitreTechniqueId, row.applicableFindings]));

  // Indexed once rather than rescanned per outcome chip: `nodeMeta` runs for every node on every
  // hover, and hovering is what the diagram is for.
  const scenarioCountByOutcome = new Map<string, number>();
  for (const scenario of data.scenarios) {
    if (scenario.outcomeId === null || scenario.outcomeId === undefined) {
      continue;
    }
    scenarioCountByOutcome.set(scenario.outcomeId, (scenarioCountByOutcome.get(scenario.outcomeId) ?? 0) + 1);
  }

  /**
   * One extra fact per column, all of it already fetched. Nothing here is invented: the actor
   * figure is the engine's own per-actor vulnerability, the outcome count is how many scenarios
   * feed the node, and the technique counts are estate corroboration.
   *
   * The driver column gets nothing: a loss driver's share is already its whole story, and the
   * chip shows it.
   */
  const nodeMeta = (node: PositionedNode): string | null => {
    if (node.column === 'actor') {
      const vulnerability = data.actorVulnerability.get(node.id);
      if (vulnerability === undefined) {
        return null;
      }
      const value = formatFixed(vulnerability, 2);
      return t`V ${value}`;
    }
    if (node.entityId === null) {
      return null;
    }
    switch (node.column) {
      case 'outcome': {
        const count = scenarioCountByOutcome.get(node.entityId) ?? 0;
        return count === 0 ? null : plural(count, { one: '# scenario', other: '# scenarios' });
      }
      case 'technique': {
        const findings = findingsByTechnique.get(node.entityId);
        return findings === undefined ? null : plural(findings, { one: '# finding', other: '# findings' });
      }
      case 'driver':
        return null;
    }
  };

  /**
   * Every chip that stands for one entity opens that entity's page. The four columns land on
   * four different sections, so the mapping is spelled out per column rather than derived:
   * each route names its own parameter and TanStack type-checks the pair.
   *
   * `from: '/$tenantId/{-$organizationId}'` is what fills the tenant in, exactly as the detail pages do it. The
   * dashboard has no tenant param of its own to forward.
   */
  const linkForNode = (node: PositionedNode): FlowNodeLink | null => {
    const id = node.entityId;
    if (id === null) {
      return null;
    }
    /*
     * `linkOptions` per branch, and the two-line resolution repeated with it. Both were tried as a
     * shared helper: the only parameter type that accepts all four option objects is the router's
     * fully-general `NavigateOptions`, which no branch's literal satisfies, so the helper stops
     * compiling before it stops repeating. Four small copies are the price of `to` and its params
     * being checked against each other per route.
     */
    switch (node.column) {
      case 'actor': {
        const options = linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'threat-center/threats/$threatId', params: { threatId: id } });
        return { href: router.buildLocation(options).href, navigate: () => void navigate(options) };
      }
      case 'outcome': {
        const options = linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/attack-outcomes/$attackOutcomeId', params: { attackOutcomeId: id } });
        return { href: router.buildLocation(options).href, navigate: () => void navigate(options) };
      }
      case 'technique': {
        const techniqueExternalId = data.techniqueLabels.get(id)?.externalId;
        if (techniqueExternalId === undefined) {
          return null;
        }
        const options = linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/mitre-attack/techniques/$techniqueExternalId', params: { techniqueExternalId } });
        return { href: router.buildLocation(options).href, navigate: () => void navigate(options) };
      }
      case 'driver': {
        const options = linkOptions({ from: '/$tenantId/{-$organizationId}', to: 'settings/taxonomies/loss-drivers/$lossDriverId', params: { lossDriverId: id } });
        return { href: router.buildLocation(options).href, navigate: () => void navigate(options) };
      }
    }
  };

  // The dashboard is tenant- or organization-wide, so unlike the scenario pages it has to
  // supply the route params explicitly rather than inheriting them from `from`.
  const scenarioRow = (
    scenario: ScenarioRef,
    reason: string,
    to: typeof FINANCIAL_IMPACT_ROUTE | typeof CRQ_ROUTE,
    linkText: string,
  ): MissingDataRow => ({
    key: `${to}:${scenario.id}`,
    label: scenario.name,
    description: reason,
    action: (
      <Link
        to={to}
        params={(prev) => ({
          ...prev,
          tenantId: prev.tenantId ?? '',
          organizationId: scenario.organizationId,
          riskScenarioId: scenario.id,
        })}
        className={MISSING_DATA_ACTION_CLASS}
      >
        {linkText}
      </Link>
    ),
  });

  const unmappedRow = (scenario: ScenarioRef): MissingDataRow => ({
    key: `unmapped:${scenario.id}`,
    label: scenario.name,
    description: t`No mapped asset`,
    action: (
      <Link
        to="/$tenantId/{-$organizationId}/details/overview"
        params={(prev) => ({ ...prev, tenantId: prev.tenantId ?? '', organizationId: scenario.organizationId })}
        search={{ scopeDrawerTab: tabForAction('manage-assets') }}
        className={MISSING_DATA_ACTION_CLASS}
      >
        {t`Manage assets`}
      </Link>
    ),
  });

  const attentionItems: Array<MissingDataRow> = [
    ...data.unmappedScenarios.map(unmappedRow),
    ...data.unpricedScenarios.map((scenario) =>
      scenarioRow(scenario, t`No loss driver estimate`, FINANCIAL_IMPACT_ROUTE, t`Go to Financial Impact`)),
    ...data.unsimulatedScenarios.map((scenario) =>
      scenarioRow(scenario, t`Not simulated yet`, CRQ_ROUTE, t`Go to CRQ`)),
  ];

  const hasResidualNode = flow.nodes.some((node) => node.residualKind !== null);

  return (
    <Panel
      title={<Trans>Exposure flow</Trans>}
      info={
        <MetricInfo
          title={t`Exposure flow`}
          what={<Trans>Where each annual loss dollar comes from, and what it ends up paying for.</Trans>}
          how={
            <>
              <Trans>
                Four columns, each a split of the same total, so the ribbon widths add up at every
                stage. Select any node to open it. Beside each value sits one extra figure: an
                actor's V is the vulnerability conditional on that actor, an outcome shows how
                many scenarios feed it, and a technique shows the open technique findings recorded
                against it. The bar on a technique is its resistance: the share of attempts the
                current control set is expected to stop.
              </Trans>
              {hasResidualNode && (
                <>
                  {' '}
                  <Trans>
                    Greyed nodes are residual buckets rather than single entities (mixture mass
                    outside the actor catalogue, or the folded tail of a ranking), so they have no
                    page to open.
                  </Trans>
                </>
              )}
              {flow.unallocatedScenarioCount > 0 && (
                <>
                  {' '}
                  <Plural
                    value={flow.unallocatedScenarioCount}
                    one="# scenario has no complete loss estimate, so its exposure lands in Unallocated."
                    other="# scenarios have no complete loss estimate, so their exposure lands in Unallocated."
                  />
                </>
              )}
            </>
          }
          caveat={
            <>
              <Trans>
                Actor shares and the loss-driver split are decompositions the engine asserts. The
                technique column is an attribution by persisted exposure: it is what makes the
                ribbons add up, and the engine does not assert it.
              </Trans>
              {findingsByTechnique.size > 0 && (
                <>
                  {' '}
                  <Trans>
                    The finding count on a technique is corroboration, not an input: the engine
                    models how much of the estate a technique touches and how well controls resist
                    it, never whether an asset is actually vulnerable. So a finding never moves
                    these figures.
                  </Trans>
                </>
              )}
            </>
          }
        />
      }
      action={
        <Chip
          label={t({
            message: plural(data.simulatedCount, {
              one: '# simulated scenario',
              other: '# simulated scenarios',
            }),
          })}
        />
      }
    >
      {data.isLoading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : data.hasError ? (
        // One query stands behind the whole diagram, so its failure is total. An empty Sankey
        // beside a zero total reads as "nothing is exposed", which is the opposite of what is
        // known here: nothing is known at all.
        <p className="txt-sub-content text-destructive py-16 text-center">
          <Trans>Exposure data could not be loaded, so the flow cannot be drawn.</Trans>
        </p>
      ) : flow.total === 0 ? (
        <div className="py-6">
          {data.scenarioCount === 0 ? (
            <p className="txt-sub-content text-muted-foreground text-center">
              <Trans>No risk scenario in scope yet.</Trans>
            </p>
          ) : (
            // No headline sentence: every row of the accordion already names the scenario,
            // states why it is out and links to the page that fixes it.
            <MissingDataAccordion title={<Trans>Scenarios needing attention</Trans>} items={attentionItems} />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="scrollbar-discreet overflow-x-auto">
            <SankeyFlow
              flow={flow}
              formatValue={(value) => formatDollar(value)}
              linkForNode={linkForNode}
              nodeMeta={nodeMeta}
            />
          </div>

          {attentionItems.length > 0 && (
            <div>
              <p className="txt-sub-content text-muted-foreground pb-2">
                <Plural
                  value={attentionItems.length}
                  one="# scenario is excluded from the flow above."
                  other="# scenarios are excluded from the flow above."
                />
              </p>
              <MissingDataAccordion title={<Trans>Scenarios needing attention</Trans>} items={attentionItems} />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};
