import { z } from 'zod';

/**
 * Shared contract between the frontend report queue (`front/src/stores/client-report-queue.ts`)
 * and the `/api/errors` route. Both sides derive from the schema below: a client-side value above a
 * bound produces a 400, and the client drops rejected reports.
 */
export const CLIENT_ERROR_REPORT_LIMITS = {
  maxReportsPerBatch: 10,
  maxOccurrences: 100,
  maxMessageLength: 2000,
  maxStackLength: 4000,
  maxNavigationHistoryLength: 2000,
} as const;

export const clientErrorReportSchema = z.object({
  kind: z.enum(['render', 'route', 'transport', 'chunk']),
  message: z.string().max(CLIENT_ERROR_REPORT_LIMITS.maxMessageLength),
  stack: z.string().max(CLIENT_ERROR_REPORT_LIMITS.maxStackLength).optional(),
  componentStack: z.string().max(CLIENT_ERROR_REPORT_LIMITS.maxStackLength).optional(),
  navigationHistory: z.string().max(CLIENT_ERROR_REPORT_LIMITS.maxNavigationHistoryLength).optional(),
  occurrences: z.number().int().min(1).max(CLIENT_ERROR_REPORT_LIMITS.maxOccurrences),
  firstSeen: z.iso.datetime(),
  lastSeen: z.iso.datetime(),
});

export const clientErrorReportBatchSchema = z.object({
  reports: z.array(clientErrorReportSchema).min(1).max(CLIENT_ERROR_REPORT_LIMITS.maxReportsPerBatch),
});

export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>;
export type ClientErrorKind = ClientErrorReport['kind'];
