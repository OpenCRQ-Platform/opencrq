import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import type { RankedRow } from '../components/slick-primitives';
import { MetricInfo } from '../../../components/shared';
import { useTRPC } from '../../../lib';
import { MetaChip, Panel, RankedList } from '../components/slick-primitives';

const MAX_TECHNIQUES = 6;

/**
 * The bridge between this dashboard and the risk one: which ATT&CK techniques the estate's
 * defenses missed in OpenAEV tests.
 *
 * Same counts the exposure Sankey shows on its technique column, so the two screens cannot
 * disagree about the estate. It is deliberately the only widget here that speaks the risk model's
 * vocabulary, and the "i" is explicit that the traffic runs one way: findings corroborate a
 * technique, they never feed the loss simulation.
 */
interface SlickTechniqueWidgetProps {
  organizationId?: string,
}

export const SlickTechniqueWidget: FunctionComponent<SlickTechniqueWidgetProps> = ({ organizationId }) => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery(trpc.dashboard.getTechniqueFindingCounts.queryOptions({ organizationId }));

  // The server ranks them most findings first.
  const techniques = (data ?? []).slice(0, MAX_TECHNIQUES);
  const peak = techniques[0]?.applicableFindings ?? 0;

  const rows: Array<RankedRow> = techniques.map(({ mitreTechniqueId, externalId, name, applicableFindings: findings }) => ({
    id: mitreTechniqueId,
    label: name,
    value: String(findings),
    valueMeta: plural(findings, { one: 'finding', other: 'findings' }),
    ratio: peak > 0 ? findings / peak : null,
    meta: <MetaChip>{externalId}</MetaChip>,
    onClick: () => {
      void navigate({
        to: '/$tenantId/{-$organizationId}/settings/taxonomies/mitre-attack/techniques/$techniqueExternalId',
        params: (prev) => ({ tenantId: prev.tenantId ?? '', techniqueExternalId: externalId }),
      });
    },
  }));

  return (
    <Panel
      title={<Trans>Techniques your defenses missed</Trans>}
      info={
        <MetricInfo
          title={t`Techniques your defenses missed`}
          what={<Trans>The ATT&amp;CK techniques your open technique findings show your defenses did not detect or did not prevent.</Trans>}
          how={
            <Trans>
              Open technique findings grouped by technique, ranked by how many land on each. A
              technique finding is one OpenAEV detection or prevention result on one asset, counted
              while its latest state is applicable: the attack was not detected or not prevented, or
              a person marked it applicable. The chip is the ATT&amp;CK id and the row opens that
              technique, where the same estate can be read against the actors that use it. The
              exposure Sankey shows the same counts on its technique column, so the two screens
              agree by construction.
            </Trans>
          }
          caveat={
            <Trans>
              A finding is one result, not one asset: an asset tested on several security platforms
              or in several scenarios counts once per result. And the traffic runs one way: a
              finding corroborates that a defense misses the technique, it is never an input to the
              loss simulation.
            </Trans>
          }
        />
      }
    >
      <RankedList
        rows={rows}
        isLoading={isLoading}
        empty={<Trans>No technique finding is open yet.</Trans>}
        barClassName="bg-violet-600/60 dark:bg-violet-400/60"
      />
    </Panel>
  );
};
