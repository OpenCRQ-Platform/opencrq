import { t } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ThreatRelevanceSettings } from '../../../../../../../features/threat-relevance-settings';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/settings/engine/threat-relevance/')({
  loader: () => ({ crumb: t`Threat Relevance` }),
  component: ThreatRelevanceSettings,
});
