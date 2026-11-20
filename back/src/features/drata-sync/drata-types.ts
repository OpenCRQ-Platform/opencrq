import { z } from 'zod';

export interface DrataSyncPayload extends Record<string, unknown> {
  serviceAccountId: string,
}

export const drataPageSchema = <T extends z.ZodType>(item: T) => z.object({
  data: z.array(item),
  pagination: z.object({
    cursor: z.string().nullish(),
  }).nullish(),
});

export const drataFrameworkSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullish(),
  slug: z.string(),
  tag: z.string(),
  isReady: z.boolean().nullish(),
  isEnabled: z.boolean().nullish(),
  numInScopeControls: z.number().nullish(),
  numInScopeRequirements: z.number().nullish(),
  numReadyInScopeRequirements: z.number().nullish(),
});
export type DrataFrameworkOutput = z.infer<typeof drataFrameworkSchema>;

export const drataRequirementSchema = z.object({
  id: z.number(),
  code: z.string().nullish(),
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  archivedAt: z.string().nullish(),
});
export type DrataRequirementOutput = z.infer<typeof drataRequirementSchema>;

export const drataControlSchema = z.object({
  id: z.number(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  archivedAt: z.string().nullish(),
  flags: z.object({
    isReady: z.boolean().nullish(),
    isMonitored: z.boolean().nullish(),
    hasEvidence: z.boolean().nullish(),
    hasPolicy: z.boolean().nullish(),
  }).nullish(),
  requirements: z.array(z.object({
    id: z.number(),
  })).nullish(),
});
export type DrataControlOutput = z.infer<typeof drataControlSchema>;
