import { EXPECTATION_TYPE_VALUES, SEVERITY_BANDS } from '@app/module';
import { z } from 'zod';

export const UniqueFindingRowSchema = z.object({
  key: z.string(),
  cveId: z.string().nullable(),
  cveTitle: z.string().nullable(),
  knownExploited: z.boolean().nullable(),
  epss: z.number().nullable(),
  mitreTechniqueExternalId: z.string().nullable(),
  mitreTechniqueName: z.string().nullable(),
  expectationType: z.enum(EXPECTATION_TYPE_VALUES).nullable(),
  score: z.number().int().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
  worstScore: z.number().int().nullable(),
  worstBand: z.enum(SEVERITY_BANDS).nullable(),
  pendingVector: z.boolean(),
  affectedAssetCount: z.number().int(),
  sources: z.array(z.string()),
  firstSeenAt: z.date(),
});
