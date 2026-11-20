import { MIN_TOLERANCE_EXCEEDANCE_PROBABILITY } from '@app/module';
import { z } from 'zod';

export const RiskToleranceSchema = z.object({
  annualLoss: z.number().positive(),
  maxExceedanceProbability: z.number().min(MIN_TOLERANCE_EXCEEDANCE_PROBABILITY).max(1),
});
