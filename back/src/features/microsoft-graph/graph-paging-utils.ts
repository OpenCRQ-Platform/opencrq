import { StructuredError } from '@app/utils';

/** Advanced Hunting silently truncates a result past this many rows. */
export const HUNTING_ROW_CAP = 100_000;
export const MAX_PAGE_DEVICES = 500;

/** A result at the cap is taken as truncated: the rows it dropped are unknowable. */
export const isTruncated = (rowCount: number): boolean => rowCount >= HUNTING_ROW_CAP;

/**
 * Advanced Hunting refuses a response past ~124MB with a 400, distinct from (and reached before)
 * the 100k-row cap: a page can carry far fewer than 100k rows and still weigh too much. Thrown by
 * `executeQuery` and handled exactly like a truncated page — shrink the page size and retry.
 */
export class ResultTooLargeError extends StructuredError {
  override readonly name: string = 'ResultTooLargeError';

  constructor(message: string) {
    super(message, { data: {} });
  }
}

const RESULT_TOO_LARGE_MARKER = 'exceeded the allowed result size';

export const isResultTooLargeResponse = (status: number, body: string): boolean =>
  status === 400 && body.includes(RESULT_TOO_LARGE_MARKER);

export const shrinkPageSize = (pageSize: number): number => Math.max(1, Math.floor(pageSize / 2));

/**
 * Grows back once a page came in well under the cap, so one dense device does not slow the whole
 * sync. Only the findings fan-out is guessed at, being the one query whose row count a page size
 * does not bound: the device query returns at most one row per device asked for, and a page too
 * large in bytes rather than in rows is shrunk by the `ResultTooLargeError` path instead.
 */
export const growPageSize = (pageSize: number, rowCount: number): number =>
  (rowCount * 4 < HUNTING_ROW_CAP ? Math.min(MAX_PAGE_DEVICES, pageSize * 2) : pageSize);

/** The join returns a page's rows in no particular order, so the cursor is the largest id, not the last one. */
export const lastDeviceId = <T extends string>(deviceIds: ReadonlyArray<T>): T | null =>
  deviceIds.reduce<T | null>((max, id) => (max === null || id > max ? id : max), null);

export interface DeviceChunk<R> {
  rows: Array<R>,
  deviceCount: number,
}

/** Groups rows so that each chunk holds every row of at most `devicesPerChunk` devices. */
export const chunkRowsByDevice = <R>(
  rows: ReadonlyArray<R>,
  deviceIdOf: (row: R) => string,
  devicesPerChunk: number,
): Array<DeviceChunk<R>> => {
  const byDevice = new Map<string, Array<R>>();
  for (const row of rows) {
    const id = deviceIdOf(row);
    const bucket = byDevice.get(id);
    if (bucket) {
      bucket.push(row);
    } else {
      byDevice.set(id, [row]);
    }
  }
  const chunks: Array<DeviceChunk<R>> = [];
  let current: DeviceChunk<R> = { rows: [], deviceCount: 0 };
  for (const deviceRows of byDevice.values()) {
    if (current.deviceCount === devicesPerChunk) {
      chunks.push(current);
      current = { rows: [], deviceCount: 0 };
    }
    current.rows.push(...deviceRows);
    current.deviceCount += 1;
  }
  if (current.deviceCount > 0) {
    chunks.push(current);
  }
  return chunks;
};
