import { z } from 'zod';
import { RISK_SCOPE_LIST_SEARCH_DEFAULTS, riskScopeListSearchSchema } from '../organizations/risk-scope-list-search';
import { DEFAULT_FINDINGS_FLOW_WINDOW } from './findings-dashboard-utils';

export const DASHBOARD_PAGE_LIST_SEARCH_DEFAULTS = { ...RISK_SCOPE_LIST_SEARCH_DEFAULTS, window: DEFAULT_FINDINGS_FLOW_WINDOW } as const;

export const dashboardPageListSearchSchema = riskScopeListSearchSchema.extend({
  window: z.union([z.literal(30), z.literal(90)]).catch(DEFAULT_FINDINGS_FLOW_WINDOW).default(DEFAULT_FINDINGS_FLOW_WINDOW),
});
