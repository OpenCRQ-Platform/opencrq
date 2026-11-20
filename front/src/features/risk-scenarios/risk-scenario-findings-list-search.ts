import { z } from 'zod';
import { EVIDENCE_STATE_FILTERS } from '../../utils';
import { SEVERITY_FILTER_VALUES } from './components/risk-scenario-findings-utils';

// `applicable` is this tab's business default, kept as it was: `stripSearchParams` drops it from
// the address, so a bare `…/findings` stays short and still shows the applicable findings, and
// `?state=all` is what an explicit "every state" looks like.
export const RISK_SCENARIO_FINDINGS_LIST_SEARCH_DEFAULTS = { state: 'applicable', severity: 'all', view: 'all' } as const;

export const riskScenarioFindingsListSearchSchema = z.object({
  state: z.enum(EVIDENCE_STATE_FILTERS).catch('applicable').default('applicable'),
  severity: z.enum(SEVERITY_FILTER_VALUES).catch('all').default('all'),
  view: z.enum(['all', 'unique']).catch('all').default('all'),
});
