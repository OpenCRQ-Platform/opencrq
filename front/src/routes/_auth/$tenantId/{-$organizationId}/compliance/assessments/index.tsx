import { createFileRoute, stripSearchParams } from '@tanstack/react-router';
import {
  COMPLIANCE_ASSESSMENTS_LIST_SEARCH_DEFAULTS,
  complianceAssessmentsListSearchSchema,
} from '../../../../../../features/compliance-assessments/compliance-assessments-list-search';
import { ComplianceAssessmentsPage } from '../../../../../../features/compliance-assessments';

export const Route = createFileRoute('/_auth/$tenantId/{-$organizationId}/compliance/assessments/')({
  validateSearch: complianceAssessmentsListSearchSchema,
  search: { middlewares: [stripSearchParams(COMPLIANCE_ASSESSMENTS_LIST_SEARCH_DEFAULTS)] },
  component: ComplianceAssessmentsPage,
});
