import { t } from '@lingui/core/macro';
import { Plural, Trans } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ExternalLink } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { ActivityGradeBadge } from '../../threats/components/activity-grade-badge';
import { buildOpenCtiObjectLink } from '../../supporting-assets/connectors-utils';
import { formatDate } from '../../../utils';
import { DossierCard } from './dossier-card';
import { MonoChip } from './mono-chip';

export interface CitingThreat {
  id: string,
  name: string,
  mitreGroupId: string | null,
  techniqueCount: number,
  lastObservedAt: Date | string | null,
  /** The vulnerability object this analysis' own source pointed at, the card-level deep link target. */
  vulnerabilityStixId: string | null,
}

interface ThreatsCitingCardProps {
  analyses: Array<CitingThreat>,
  cveId: string,
  tenantId: string,
  /** Base URL of the tenant's OpenCTI platform, null when no connector is configured. */
  openctiUrl: string | null,
  vulnerabilityStixId: string | null,
}

/**
 * The actors the ingested corpus links to this flaw, most recently active first.
 *
 * The rows are the same actors the score's threat factor counted, so a reader who disagrees with
 * the figure can name what set it.
 */
export const ThreatsCitingCard: FunctionComponent<ThreatsCitingCardProps> = ({
  analyses,
  cveId,
  tenantId,
  openctiUrl,
  vulnerabilityStixId,
}) => {
  const vulnerabilityLink = buildOpenCtiObjectLink(openctiUrl, vulnerabilityStixId);

  return (
    <DossierCard
      label={t`Threats citing this CVE`}
      headerAction={vulnerabilityLink !== null ? (
        <a
          href={vulnerabilityLink}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1.5 font-content-compact text-content-compact text-primary underline-offset-4 hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <Trans>Open {cveId} in OpenCTI</Trans>
        </a>
      ) : null}
    >
      {analyses.length === 0 ? (
        <p className="font-content-base text-content-base text-default-secondary">
          <Trans>No ingested threat cites this CVE. What the tenant has ingested decides this, not the flaw itself.</Trans>
        </p>
      ) : (
        <ul className="flex flex-col">
          {analyses.map((analysis) => {
            const actorName = analysis.name;
            const lastObservedLabel = analysis.lastObservedAt === null ? '' : formatDate(analysis.lastObservedAt);
            return (
              <li
                key={analysis.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-3 last:border-b-0"
                style={{ borderColor: 'var(--fds-border-elevation-subtle-soft)' }}
              >
                <Link
                  to="/$tenantId/{-$organizationId}/threat-center/threats/$threatId"
                  params={{ tenantId, threatId: analysis.id }}
                  className="font-content-base text-content-base text-primary underline-offset-4 hover:underline"
                >
                  {actorName}
                </Link>
                {analysis.mitreGroupId !== null && <MonoChip>{analysis.mitreGroupId}</MonoChip>}
                <ActivityGradeBadge lastObservedAt={analysis.lastObservedAt} />
                <span className="ml-auto flex items-center gap-3 font-content-compact text-content-compact text-default-secondary">
                  <span>
                    <Plural value={analysis.techniqueCount} one="# technique" other="# techniques" />
                    {analysis.lastObservedAt !== null && (
                      <Trans> · last observed {lastObservedLabel}</Trans>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {vulnerabilityLink !== null && (
        <p className="font-content-caption text-content-caption text-default-secondary">
          <Trans>The deep link resolves the stored STIX id on the tenant's connected OpenCTI platform.</Trans>
        </p>
      )}
    </DossierCard>
  );
};
