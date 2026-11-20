import { z } from 'zod';

export const supportedLocaleSchema = z.enum(['en', 'fr']);

export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;
