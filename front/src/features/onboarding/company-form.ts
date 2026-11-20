import { REVENUE_BAND_VALUES } from '@app/module/client';
import { t } from '@lingui/core/macro';
import { z } from 'zod';

export const companyFormSchema = z.object({
  name: z.string(),
  sectorId: z.string().nullable(),
  countryId: z.string().nullable(),
  revenueBand: z.enum(REVENUE_BAND_VALUES).nullable(),
  employeeCount: z.number().int().nonnegative().nullable(),
}).superRefine((data, ctx) => {
  // Checked here rather than with `min(1)` so the message is translated at validation time, not frozen at module load.
  if (data.name.trim() === '') {
    ctx.addIssue({ code: 'custom', message: t`A name is required`, path: ['name'] });
  }
});

export type CompanyFormValues = z.infer<typeof companyFormSchema>;
