import { z } from 'zod';
import { urlSearchText } from '../../utils';
import { ASSESSMENT_SOURCES } from './compliance-assessments-utils';

export const COMPLIANCE_ASSESSMENTS_LIST_SEARCH_DEFAULTS = { search: '', source: 'all' } as const;

export const complianceAssessmentsListSearchSchema = z.object({
  search: urlSearchText,
  source: z.enum(['all', ...ASSESSMENT_SOURCES]).catch('all').default('all'),
});
