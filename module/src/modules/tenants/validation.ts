import { z } from 'zod';

export const tenantNameSchema = z.string().trim().min(1);
