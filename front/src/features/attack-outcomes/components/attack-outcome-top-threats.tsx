import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { OUTCOME_WEIGHT_THRESHOLD } from '@app/module/client';
import type { ThreatEntityType } from '@app/module/client';
import type { FunctionComponent } from 'react';
import { MetricInfo } from '../../../components/shared';
import { formatFractionAsPercent } from '../../../utils/format-number';
import { MatchingOutcomeTable } from '../../threats/components/matching-outcome-table';
import { ThreatTypeBadge } from '../../threats/components/threat-type-badge';

export interface MatchingThreatForOutcome {
  analysisId: string,
  analysisName: string,
  entityType: ThreatEntityType,
  score: number,
}

interface AttackOutcomeTopThreatsProps {
  attackOutcomeId: string,
  threats: ReadonlyArray<MatchingThreatForOutcome>,
}

/**
 * The top matching threats for this outcome (already bounded server-side), each leading to the
 * threat's own page, built on the `MatchingOutcomeTable`.
 *
 * Caller guarantees a non-empty `threats`.
 */
export const AttackOutcomeTopThreats: FunctionComponent<AttackOutcomeTopThreatsProps> = ({
  attackOutcomeId,
  threats,
}) => {
  const thresholdLabel = formatFractionAsPercent(OUTCOME_WEIGHT_THRESHOLD, 0);
  return (
    <MatchingOutcomeTable
      entityColumnLabel={t`Threat`}
      heading={<Trans>Top matching threats</Trans>}
      headingInfo={(
        <MetricInfo
          title={t`Top matching threats`}
          what={<Trans>The threats that lead to this outcome, ranked by outcome probability.</Trans>}
          how={<Trans>OpenCRQ's internal model gives each threat a probability of leading to this outcome. The list ranks threats by that probability, and a threat appears once it is above {thresholdLabel}.</Trans>}
        />
      )}
      rows={threats.map((threat) => ({
        key: threat.analysisId,
        name: threat.analysisName,
        badge: <ThreatTypeBadge entityType={threat.entityType} />,
        score: threat.score,
        renderLink: (name) => (
          <Link
            from="/$tenantId/{-$organizationId}"
            to="threat-center/threats/$threatId"
            params={{ threatId: threat.analysisId }}
            className="txt-default font-medium text-foreground rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {name}
          </Link>
        ),
      }))}
      footer={(
        <Link
          from="/$tenantId/{-$organizationId}/settings/taxonomies/attack-outcomes/$attackOutcomeId"
          to="/$tenantId/{-$organizationId}/threat-center"
          search={{ outcomeId: attackOutcomeId }}
          className="txt-body2 text-primary hover:underline mt-2 inline-block"
        >
          <Trans>View all</Trans>
        </Link>
      )}
    />
  );
};
