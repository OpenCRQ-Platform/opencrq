import { z } from 'zod';
import { XTM_SIGN_IN_ERRORS } from '@app/utils/xtm-sign-in';

export const loginListSearchSchema = z.object({
  redirect: z.string().optional(),
  // An unknown reason still reads as a failed attempt: no going straight back to XTM One.
  xtm_sign_in_error: z.enum(XTM_SIGN_IN_ERRORS).optional().catch('failed'),
});
