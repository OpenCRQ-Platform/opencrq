import { z } from 'zod';

export const dashboardIdSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(64);
