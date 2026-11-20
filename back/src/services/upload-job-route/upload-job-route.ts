import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import type { DrizzleDB } from '@app/module';
import { createServices, jobsService, originTrigger, tenantsService } from '@app/module';
import type { FastifyInstance } from 'fastify';
import { resolveRequestAuth, XTM_ONE_SESSION_ID } from '../../trpc';
import { isTenantReachable } from '../../features/app-router/tenant-edition-utils';
import { fileStorageOperations } from '../file-storage';
import { createLogger } from '../../utils/logger';

export interface UploadJobRouteOptions {
  path: string,
  jobKind: string,
  idempotencyKeyPrefix: string,
  featureKey: string,
  uploadFailedMessage: string,
}

/**
 * Registers a raw (non-tRPC) multipart upload route that streams the uploaded file straight to
 * RustFS instead of buffering it in memory, then enqueues a job to process it. Generic building
 * block for the "upload a file, process it asynchronously" pattern — extracted from the
 * threat STIX bundle upload route so other features can reuse it (see
 * `features/threat-uploader/index.ts` for the first consumer).
 */
export const registerUploadJobRoute = (server: FastifyInstance, db: DrizzleDB, options: UploadJobRouteOptions): void => {
  const tenantReadServices = createServices([tenantsService], db);
  const resolveAuth = resolveRequestAuth(db);
  const { logFromError } = createLogger({ feature: options.featureKey });

  server.post(options.path, async (req, reply) => {
    await resolveAuth(req, reply);
    const user = req.authUser;
    // Browser-only surface: require a real cookie session. Bearer schemes (service-account
    // tokens, XTM One synthetic JWT session) must not reach this upload route — same guard as
    // the XTM One chat proxy (see xtm-one-http.ts).
    if (!user || !req.authSession || req.authSession.id === XTM_ONE_SESSION_ID) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const tenantIdHeader = req.headers['x-tenant-id'];
    const tenantId = Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader;
    if (!tenantId) {
      reply.code(400).send({ error: 'Missing x-tenant-id header' });
      return;
    }

    const origin = { type: 'client' as const, userId: user.id, tenantId };

    // This route reads `x-tenant-id` itself instead of going through the tRPC
    // middleware, so the Community Edition limit has to be asked here too.
    const reachable = await isTenantReachable(
      tenantId,
      async () => (await tenantReadServices.withOrigin(origin).tenants.getTenants()).map(({ id }) => id),
    );
    if (!reachable) {
      reply.code(403).send({ error: 'Reaching more than one tenant requires an Enterprise Edition license' });
      return;
    }

    try {
      const part = await req.file();
      if (!part) {
        reply.code(400).send({ error: 'No file uploaded' });
        return;
      }

      const sha256 = createHash('sha256');
      const hashingStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          sha256.update(chunk);
          callback(null, chunk);
        },
      });

      const stored = await fileStorageOperations.writeFile(db, origin, {
        stream: part.file.pipe(hashingStream),
        originalName: part.filename,
        mimeType: part.mimetype,
      });
      const fileHash = sha256.digest('hex');

      const services = createServices([jobsService], db).withOrigin(origin);
      const { jobId } = await services.jobs.enqueueJob({
        kind: options.jobKind,
        tenantId,
        payload: { storedFileId: stored.id, userId: user.id },
        idempotencyKey: `${options.idempotencyKeyPrefix}-${fileHash}`,
        ...originTrigger(origin),
        interactive: true,
      });

      reply.send({ jobId });
    } catch (error) {
      logFromError(error, options.uploadFailedMessage, { tenantId, userId: user.id });
      reply.code(500).send({ error: 'Upload failed' });
    }
  });
};
