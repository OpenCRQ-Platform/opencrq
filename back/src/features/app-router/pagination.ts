import { z } from 'zod';

export const MAX_PAGE_LIMIT = 500;
export const DEFAULT_PAGE_LIMIT = 50;

/** `sortBy` is a closed vocabulary: the ordering has to be one an index supports. */
export const pagedInput = <const T extends readonly [string, ...Array<string>]>(sortKeys: T) => z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  sortBy: z.enum(sortKeys).optional(),
  sortDesc: z.boolean().default(true),
});

/** `total` counts the rows the filters matched, not the rows returned. */
export const pagedOutput = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
