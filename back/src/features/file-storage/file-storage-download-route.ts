import type { DrizzleDB } from '@app/module';
import { createServices, tenantsService } from '@app/module';
import type { FastifyInstance } from 'fastify';
import { resolveRequestAuth, XTM_ONE_SESSION_ID } from '../../trpc';
import { isTenantReachable } from '../app-router/tenant-edition-utils';
import { FileNotFoundError, fileStorageOperations } from '../../services/file-storage';

/**
 * Registers `GET /api/file-storage/:id/download`: a plain (non-tRPC) route so the file content
 * can be streamed straight from RustFS to the response instead of being loaded in memory. Auth
 * follows the same session-cookie + `x-tenant-id` convention as the threat upload route.
 */
export const registerFileStorageDownloadRoute = (server: FastifyInstance, db: DrizzleDB): void => {
  const resolveAuth = resolveRequestAuth(db);
  const services = createServices([tenantsService], db);

  server.get('/api/file-storage/:id/download', async (req, reply) => {
    await resolveAuth(req, reply);
    const user = req.authUser;
    if (!user || !req.authSession || req.authSession.id === XTM_ONE_SESSION_ID) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    // Meant to be used as a plain browser navigation target (native download, no in-tab memory
    // buffering): a query param is used as a fallback since a direct `<a href>` navigation
    // can't set custom headers like `x-tenant-id`.
    const tenantIdHeader = req.headers['x-tenant-id'];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fastify query string; type guaranteed by route usage
    const { tenantId: tenantIdQuery } = req.query as { tenantId?: string };
    const tenantId = (Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader) ?? tenantIdQuery;
    if (!tenantId) {
      reply.code(400).send({ error: 'Missing tenant id (x-tenant-id header or tenantId query param)' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fastify route params; type guaranteed by route pattern
    const { id } = req.params as { id: string };
    const origin = { type: 'client' as const, userId: user.id, tenantId };

    // This route reads `x-tenant-id` itself instead of going through the tRPC
    // middleware, so the Community Edition limit has to be asked here too.
    const reachable = await isTenantReachable(
      tenantId,
      async () => (await services.withOrigin(origin).tenants.getTenants()).map((tenant) => tenant.id),
    );
    if (!reachable) {
      reply.code(403).send({ error: 'Reaching more than one tenant requires an Enterprise Edition license' });
      return;
    }

    let file;
    try {
      file = await fileStorageOperations.readFile(db, origin, id);
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        reply.code(404).send({ error: 'File not found' });
        return;
      }
      throw err;
    }

    // `return` matters here: this is an async handler, and Fastify awaits the returned promise
    // after invoking it. If we don't return the Reply instance, Fastify sees the handler resolve
    // with `undefined` right after `.send(stream)` synchronously kicks off the pipe (the stream
    // itself flows asynchronously) and treats that as "send an empty reply", terminating the
    // response before any stream data has flushed: a 200 OK with `Content-Length: 0`.
    const safeFilename = file.originalName.replaceAll(/[\r\n"]/g, '');
    return reply
      .header('Content-Type', file.mimeType)
      .header('Content-Disposition', `attachment; filename="${safeFilename || 'download'}"`)
      .send(file.stream);
  });
};
