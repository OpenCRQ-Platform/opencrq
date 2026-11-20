import { CAPABILITY_FUNCTIONS, TECHNIQUE_EXTERNAL_ID_PATTERN } from '@app/module/client';
import { z } from 'zod';

export const EVIDENCE_RESULT_FILTERS = ['all', 'validated', 'contradicted'] as const;
export type EvidenceResultFilter = typeof EVIDENCE_RESULT_FILTERS[number];

export const EVIDENCE_FUNCTION_FILTERS = ['all', ...CAPABILITY_FUNCTIONS] as const;
export type EvidenceFunctionFilter = typeof EVIDENCE_FUNCTION_FILTERS[number];

export const CAPABILITY_VALIDATION_EVIDENCE_LIST_SEARCH_DEFAULTS = { function: 'all', result: 'all' } as const;

// Held to the server's bounds, which refuse the whole query past them.
export const capabilityValidationEvidenceListSearchSchema = z.object({
  /** A technique's ATT&CK id, which keeps its lines and its sub-techniques'. */
  technique: z.string().regex(TECHNIQUE_EXTERNAL_ID_PATTERN).optional().catch(undefined),
  function: z.enum(EVIDENCE_FUNCTION_FILTERS).catch('all').default('all'),
  result: z.enum(EVIDENCE_RESULT_FILTERS).catch('all').default('all'),
  /** A platform family's integration key; one the control has not falls back to every family on screen. */
  family: z.string().min(1).max(256).optional().catch(undefined),
});

export type CapabilityValidationEvidenceListSearch = z.infer<typeof capabilityValidationEvidenceListSearchSchema>;
