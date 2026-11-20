import { z } from 'zod';

export const complianceAnswerFormSchema = z.object({
  ownerId: z.string().nullable(),
  dueDate: z.string().nullable(),
  level: z.number().int().min(0).max(5).nullable(),
  notApplicable: z.boolean(),
  comment: z.string().nullable(),
});

export type ComplianceAnswerFormValues = z.infer<typeof complianceAnswerFormSchema>;
