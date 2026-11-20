import { createFileRoute, Navigate, stripSearchParams } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { CapabilityValidationEvidence } from '../../../../../../features/controls/capability/components/capability-validation-evidence';
import {
  CAPABILITY_VALIDATION_EVIDENCE_LIST_SEARCH_DEFAULTS,
  capabilityValidationEvidenceListSearchSchema,
} from '../../../../../../features/controls/capability/capability-validation-evidence-list-search';
import { useCapabilityValidation } from '../../../../../../features/controls/capability/hooks/use-capability-validation';
import { isSimulationReachable } from '../../../../../../features/controls/capability/utils/function-posture-utils';
import { Route as ControlRoute } from './route';

const CapabilityValidationPage = () => {
  const { capability } = ControlRoute.useLoaderData();
  const { isAvailable, openaevUrl } = useCapabilityValidation(capability.id, isSimulationReachable(capability));

  // The tab that leads here is absent without a simulation connector, and for a control out of
  // simulation reach, so a bookmarked URL must not resurrect the page: there would be nothing to
  // list, and the read would run for nothing.
  if (isAvailable === false) {
    return <Navigate from="/$tenantId/{-$organizationId}/controls/$controlId" to="overview" replace />;
  }
  if (isAvailable === undefined) {
    return null;
  }

  return (
    <CapabilityValidationEvidence
      capabilityId={capability.id}
      securityPlatformFamilies={capability.securityPlatformFamilies}
      openaevUrl={openaevUrl}
    />
  );
};

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/controls/$controlId/validation')({
  validateSearch: capabilityValidationEvidenceListSearchSchema,
  search: { middlewares: [stripSearchParams(CAPABILITY_VALIDATION_EVIDENCE_LIST_SEARCH_DEFAULTS)] },
  loader: () => ({ crumb: t`Validation` }),
  component: CapabilityValidationPage,
});
