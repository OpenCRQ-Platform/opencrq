import { authService, createServices, loadDoorbellParents } from '@app/module';
import { registerFeature } from '../features-manager';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { httpServerEngine } from '../../engines/http-server';
import { createLogger } from '../../utils/logger';
import { createDataChangedHub, EVERY_TABLE } from './data-changed-hub';
import { createDoorbellCascade } from './doorbell-cascade';
import { recordDoorbellResolution, registerQueryIndexMetrics } from './doorbell-metrics';
import { createDoorbellResolver } from './doorbell-resolver';
import { eventsRouter } from './events-router';
import { installQueryDependencyIndex, QueryDependencyIndex } from './query-dependency-index';
import { startDataChangedListener } from './data-changed-listener';
import { startSessionRevokedListener } from './session-revoked-listener';

const { logTrace, logFromError } = createLogger({ feature: 'events' });

registerFeature({
  key: 'events',
  activate: (signal) => {
    const { db, pool } = dbEngine;
    const { doorbell_window_ms: windowMs, job_doorbell_window_ms: jobWindowMs } = config().events;
    const hub = createDataChangedHub({ windowMs, jobWindowMs });

    // Force-close pending throttle timers on shutdown; live subscriptions end on their own signal.
    signal.addEventListener('abort', () => hub.closeAll(), { once: true });

    const index = new QueryDependencyIndex({
      explain: async (sqlText) => (await pool.query(sqlText)).rows,
      onWidened: ({ procedure, reason, subject, error }) => {
        if (reason === 'explain_refused') {
          logFromError(error, 'Query procedure widened to every doorbell: a statement EXPLAIN was refused', { procedure, sql: subject });
        } else if (reason === 'attribution_deferred') {
          logTrace('Query procedure widened to every doorbell: its statement plan did not come back in time', { procedure, sql: subject });
        } else {
          logTrace('Query procedure widened to every doorbell: it reads a table no doorbell rings for', { procedure, table: subject });
        }
      },
    });
    dbEngine.observeStatements(index);
    installQueryDependencyIndex(index);
    registerQueryIndexMetrics(index);
    const resolveDoorbell = createDoorbellResolver(index, (doorbell, targets) => {
      recordDoorbellResolution(targets);
      logTrace('Doorbell resolved', { tenantId: doorbell.tenantId, tables: doorbell.tables, ...targets, index: index.snapshot() });
    });

    // Outbound: the events.onDataChanged tRPC subscription (tRPC owns transport + auth).
    httpServerEngine.registerRouter(({ protectedProcedure }) => eventsRouter({ protectedProcedure }, db, hub, signal, resolveDoorbell));

    const cascade = createDoorbellCascade({
      loadParents: () => loadDoorbellParents(db),
      onLoadFailed: (err) => logFromError(err, 'Doorbell topology could not be loaded: the change rings for every table'),
    });

    // Inbound: PG data_changed LISTEN → fan-out invalidation to the right tenants.
    startDataChangedListener({
      signal,
      onNotify: (change) => {
        void cascade(change).then((tables) => tables.forEach((table) => hub.publish(change.tenantId, change.origin, change.interactive, table)));
      },
      // After each (re)connect, tell every client to refetch: catches up on NOTIFYs dropped while disconnected.
      onListening: () => hub.publish(null, null, null, EVERY_TABLE),
    }).catch((err) => logFromError(err, 'data_changed LISTEN listener stopped unexpectedly'));

    // Each live stream aborts itself at its session's fixed expiry, and an explicit logout/revocation
    // arrives instantly over session_revoked, so no periodic DB poll is needed. The only gap is a
    // NOTIFY dropped while the LISTEN was reconnecting: on every (re)connect, re-validate the sessions
    // that still hold a stream in one batched query and revoke those that have vanished. One query per
    // reconnect, regardless of how many streams are open.
    const { auth } = createServices([authService], db).withOrigin({ type: 'auth' });
    const reconcileRevokedSessions = async (): Promise<void> => {
      const watched = hub.watchedSessionIds();
      if (watched.length === 0) {
        return;
      }
      const stillActive = new Set(await auth.listActiveSessionIds(watched));
      for (const sessionId of watched) {
        if (!stillActive.has(sessionId)) {
          hub.notifySessionRevoked(sessionId);
        }
      }
    };

    // Inbound: PG session_revoked LISTEN → close the matching live stream immediately on logout.
    startSessionRevokedListener({
      signal,
      onRevoke: (sessionId) => hub.notifySessionRevoked(sessionId),
      // On any (re)connect, recover revocations whose NOTIFY we may have missed while disconnected.
      onListening: () => {
        reconcileRevokedSessions().catch((err) => logFromError(err, 'session reconcile after reconnect failed'));
      },
    }).catch((err) => logFromError(err, 'session_revoked LISTEN listener stopped unexpectedly'));
  },
});
