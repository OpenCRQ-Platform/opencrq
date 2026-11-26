import type { DrizzleDB } from '@app/module';
import { clientErrorReportBatchSchema } from '@app/module';
import type { FastifyInstance } from 'fastify';
import { resolveRequestAuth } from '../../trpc';
import { createLogger } from '../../utils/logger';

// Fastify's default bodyLimit (1 MB) is much larger than needed here. Our shared schema allows up to
// 10 reports each carrying up to ~12k chars of content, so the worst-case JSON payload would be ~120 KB.
// Keep a tight cap, but ensure it is large enough to accept any payload permitted by the schema.
const CLIENT_ERRORS_BODY_LIMIT_BYTES = 256 * 1024;

/**
 * Registers the raw (non-tRPC) `/api/errors` route the frontend uses to report client errors
 * that never reached the backend (so they are otherwise invisible in server logs). Auth is
 * optional: the highest-value reports (e.g. a chunk-load failure on the login page) happen with
 * no session, so the route accepts anonymous reports rather than rejecting them. Anonymous access
 * means the route still needs a rate limiter — tracked as a follow-up.
 */
export const registerClientErrorsRoute = (server: FastifyInstance, db: DrizzleDB): void => {
  const resolveAuth = resolveRequestAuth(db);
  const { logWarn, logError } = createLogger({ engine: 'http-server' });

  server.post('/api/errors', { bodyLimit: CLIENT_ERRORS_BODY_LIMIT_BYTES }, async (req, reply) => {
    const parsed = clientErrorReportBatchSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'Invalid report payload' });
      return;
    }

    await resolveAuth(req, reply);
    const user = req.authUser;
    const tenantIdHeader = req.headers['x-tenant-id'];
    const tenantId = Array.isArray(tenantIdHeader) ? tenantIdHeader[0] : tenantIdHeader;

    parsed.data.reports.forEach((report) => {
      // A call the browser lost on the way (network, a proxy's error page) succeeds on its next try,
      // so only the other kinds alert.
      const log = report.kind === 'transport' ? logWarn : logError;
      log('Client Error Report', {
        kind: report.kind,
        message: report.message,
        stack: report.stack,
        componentStack: report.componentStack,
        navigationHistory: report.navigationHistory,
        occurrences: report.occurrences,
        firstSeen: report.firstSeen,
        lastSeen: report.lastSeen,
        userId: user?.id,
        tenantId,
        anonymous: !user,
      });
    });

    reply.send({ status: 'ok' });
  });
};
