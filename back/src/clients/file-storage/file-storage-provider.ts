import type { Readable } from 'node:stream';

export interface FileStorageProvider {
  initialize: () => Promise<void>,
  /**
   * Uploads an object to the bucket. When `contentLength` is provided, uses a single
   * PutObject call. When omitted (size unknown ahead of time, e.g. streaming multipart
   * upload), switches internally to a bounded-memory S3 multipart upload.
   */
  putObject: (key: string, body: Readable | Buffer, contentType: string, contentLength?: number) => Promise<void>,
  getObject: (key: string) => Promise<Readable>,
  deleteObject: (key: string) => Promise<void>,
}
