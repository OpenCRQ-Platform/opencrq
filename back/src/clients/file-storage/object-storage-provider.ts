import type { BucketLocationConstraint } from '@aws-sdk/client-s3';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Readable } from 'node:stream';
import type { FileStorageProvider } from './file-storage-provider';
import { config } from '../../config';

// The S3 CreateBucket API requires omitting LocationConstraint for this region only.
// All other regions must provide it explicitly.
const S3_NO_LOCATION_CONSTRAINT_REGION = 'us-east-1';

// A dead endpoint must fail fast on every real call instead of hanging/retrying — this replaces
// the old background `setInterval` healthcheck's job (detecting an outage) with a per-call,
// fail-fast primitive.
const CONNECTION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;

interface ObjectStorageConfig {
  endpoint: string,
  accessKey: string,
  secretKey: string,
  bucket: string,
  region: string,
}

export const createObjectStorageProvider = (cfg: ObjectStorageConfig): FileStorageProvider => {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true,
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
    }),
  });

  const initialize = async (): Promise<void> => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- AWS SDK errors carry a name property; shape validated by AWS SDK contract
      const code = (err as { name?: string }).name;
      if (code === 'NotFound' || code === 'NoSuchBucket') {
        if (!config().inDev) {
          throw new Error(
            `File storage bucket "${cfg.bucket}" does not exist. `
            + 'Create it manually before starting the application in production.',
          );
        }
        const input = cfg.region === S3_NO_LOCATION_CONSTRAINT_REGION
          ? { Bucket: cfg.bucket }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- region is a validated S3 region string; BucketLocationConstraint is the SDK's string union for this field
          : { Bucket: cfg.bucket, CreateBucketConfiguration: { LocationConstraint: cfg.region as BucketLocationConstraint } };
        await client.send(new CreateBucketCommand(input));
      } else {
        throw err;
      }
    }
  };

  const putObject = async (key: string, body: Readable | Buffer, contentType: string, contentLength?: number): Promise<void> => {
    if (contentLength === undefined) {
      // Size unknown ahead of time (e.g. streaming multipart upload) — use the S3 multipart
      // upload helper, which reads the body in bounded-memory parts and needs no Content-Length.
      const upload = new Upload({
        client,
        params: {
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        },
      });
      await upload.done();
      return;
    }

    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: contentLength,
    }));
  };

  const getObject = async (key: string): Promise<Readable> => {
    const response = await client.send(new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    }));
    if (!(response.Body instanceof Readable)) {
      throw new Error(`Object not found or empty response for key: ${key}`);
    }
    return response.Body;
  };

  const deleteObject = async (key: string): Promise<void> => {
    await client.send(new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    }));
  };

  return { initialize, putObject, getObject, deleteObject };
};
