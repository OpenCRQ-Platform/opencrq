import { z } from 'zod';

/** Branded type: only produced by Zod validation (hex-only device ID from Defender). */
export const deviceIdSchema = z.string().regex(/^[a-f0-9]+$/i).brand('DeviceId');
export type DeviceId = z.infer<typeof deviceIdSchema>;

/** Advanced Hunting serializes an absent attribute as `""`: a blank or non-string value reads as `null`. */
export const optionalText = z.unknown().optional().transform((v) => (typeof v === 'string' && v.trim() !== '' ? v : null));

export interface GraphSyncPayload extends Record<string, unknown> {
  serviceAccountId: string,
}

export interface GraphSyncState extends Record<string, unknown> {
  pageIndex: number,
  cursor: DeviceId | null,
  devicesProcessed: number,
  findingsDismissed: number,
  pageSize: number,
  syncStartedAt: string,
}
