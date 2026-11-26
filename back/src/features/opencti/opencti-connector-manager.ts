import type { SyncedMarkingDefinition } from '@app/module';
import { allServiceDefinitions, createServices, isRelevantStixObject, STREAM_LOG_SCOPE_KIND, trimRelevantStixObject } from '@app/module';
import { newError } from '@app/utils';
// Deep import: the barrel is heavy and this is the one pure helper the consumer needs on every event.
import { sanitizeStixNullBytes } from '@app/module/stix-sanitize';
import { uuidv7 } from 'uuidv7';
import { config } from '../../config';
import { dbEngine } from '../../engines/db';
import { sleep } from '../../utils';
import { runInExecutionScope } from '../../utils/execution-scope';
import { endLogScope } from '../../utils/log-capture';
import { createLogger } from '../../utils/logger';
import { startPgListenLoop } from '../../utils/pg-listen-loop';
import { fetchOpenCtiMarkingDefinitions, parseStreamMarking } from './opencti-marking-sync';
import { consumeOpenCtiStream, OpenCtiAuthError, OpenCtiStreamFatalError } from './opencti-sse-client';

const logger = createLogger({ feature: 'opencti' });
const { logTrace, logWarnFromError, logFromError } = logger;

export const STREAM_TIMING = {
  /** Quiet period after the last event that triggers a flush. */
  idleDebounceMs: 3_000,
  /** Reconnect backoff (mirrors `startPgListenLoop`), reset on `onConnected`. */
  initialReconnectDelayMs: 5_000,
  maxReconnectDelayMs: 60_000,
  /**
   * How long reconnections may keep failing with no frame in between before one alerts, longer than
   * a redeploy of OpenCTI. Counted in time, not attempts: one attempt fails at once or after 90 s.
   */
  unreachableAlertMs: 10 * 60_000,
} as const;

// Every event re-arms the idle debounce, so a busy stream would never write its position without
// this ceiling on how many events one flush window may carry.
const FORCED_FLUSH_EVENT_COUNT = 500;

// Event date within this of "now" means the live tail is reached (latched in `reachedLiveTailAt`).
const CATCHING_UP_THRESHOLD_MS = 10 * 60 * 1000;

const SYSTEM_ORIGIN = { type: 'system' } as const;

// One live SSE consumer per tenant with `enabled=true`.
const activeConsumers = new Map<string, AbortController>();

// A consumer's final flush runs after its signal aborts, and `stopConsumerForTenant` drops the map
// entry at once, so a session still owing the database a write is only reachable through here.
const consumerSessions = new Set<Promise<void>>();

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const getStixString = (obj: Record<string, unknown>, key: string): string | null => {
  const value = obj[key];
  return typeof value === 'string' ? value : null;
};

// OpenCTI event ids are `<epoch-ms>-<seq>`; `null` for an unparseable id rather than falling back to "now".
const parseEventTimestamp = (eventId: string): Date | null => {
  const ms = Number(eventId.split('-')[0]);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
};

const isCloseToLiveTail = (eventAt: Date, now: Date): boolean => now.getTime() - eventAt.getTime() <= CATCHING_UP_THRESHOLD_MS;

// Kept in step with the three positions `buildStreamUrl` opens the stream from.
const describeStreamStart = (cursor: string | null, reachedLiveTail: boolean): string => {
  if (cursor) {
    return `OpenCTI stream resuming after event ${cursor}`;
  }
  return reachedLiveTail ? 'OpenCTI stream starting at its live edge' : 'OpenCTI stream reading from its beginning';
};

// Payload is `{ data: {STIX data} }`, whatever the event type.
const extractStixObject = (eventData: unknown): Record<string, unknown> | null => {
  if (!isRecord(eventData)) {
    return null;
  }
  const inner = eventData['data'];
  return isRecord(inner) ? inner : null;
};

// A merge event carries the survivor in `data` and every absorbed object, complete, in
// `context.sources`. Listing them there is how OpenCTI says they are gone: no delete event ever
// follows for them.
const extractMergedSources = (eventData: unknown): Array<Record<string, unknown>> => {
  if (!isRecord(eventData)) {
    return [];
  }
  const context = eventData['context'];
  if (!isRecord(context)) {
    return [];
  }
  const sources = context['sources'];
  return Array.isArray(sources) ? sources.filter(isRecord) : [];
};

// A threat's STIX id is derived from its name, so a rename regenerates it and the stream
// carries one `update` under the new id with no delete for the old one. `context.reverse_patch`, the
// patch back to the previous object, is the only place the retired id is ever stated.
const extractRetiredStixId = (eventData: unknown, survivorId: string): string | null => {
  if (!isRecord(eventData)) {
    return null;
  }
  const context = eventData['context'];
  if (!isRecord(context)) {
    return null;
  }
  const reversePatch = context['reverse_patch'];
  if (!Array.isArray(reversePatch)) {
    return null;
  }
  for (const operation of reversePatch) {
    if (!isRecord(operation) || operation['op'] !== 'replace' || operation['path'] !== '/id') {
      continue;
    }
    const retiredId = getStixString(operation, 'value');
    if (retiredId && retiredId !== survivorId) {
      return retiredId;
    }
  }
  return null;
};

/**
 * Runs one tenant's Live Stream until `signal` aborts, mirroring what each event states and
 * persisting its position. Rebuilding the records the mirror describes belongs to the
 * `opencti-mirror-rebuild` job, which reacts to the marks these writes leave: the receive path
 * resolves no graph and holds nothing a crash could lose.
 */
const consumeTenantStream = async (
  tenantId: string, signal: AbortSignal, onConnected: () => void, onFrame: () => void,
): Promise<void> => {
  const openctiConfig = config().connectors?.opencti?.[tenantId];
  if (!openctiConfig) {
    logTrace('OpenCTI connector not configured for this tenant, skipping', { tenantId });
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    return;
  }

  const systemServices = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(SYSTEM_ORIGIN);
  const settings = await systemServices.openctiConnector.getSettings(tenantId);
  if (!settings?.enabled || !settings.streamId || !settings.serviceAccountId) {
    return;
  }

  const serviceAccount = await systemServices.serviceAccounts.getServiceAccount(settings.serviceAccountId);
  if (!serviceAccount?.active) {
    // Otherwise security policy would silently deny every read/write below instead of stopping.
    logTrace('OpenCTI service account inactive, not consuming', { tenantId, serviceAccountId: settings.serviceAccountId });
    return;
  }

  const origin = { type: 'connector' as const, serviceAccountId: settings.serviceAccountId, tenantId };
  const services = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(origin);

  // The tenant's marking definitions follow OpenCTI's (G2, slice 3b), written as the system: a
  // connector holds no security capability, and the tenant is named on every row. A failed read
  // keeps what the tenant holds; the stream's marking objects keep them in step afterwards.
  const syncMarkings = async (markings: Array<SyncedMarkingDefinition>): Promise<void> => {
    const { synced, skipped } = await systemServices.markingDefinitions.syncMarkingDefinitions(tenantId, markings);
    if (skipped > 0) {
      logTrace('OpenCTI marking definitions skipped: no STIX id, type or definition', { tenantId, synced, skipped });
    }
  };
  try {
    await syncMarkings(await fetchOpenCtiMarkingDefinitions(openctiConfig.url, openctiConfig.token));
  } catch (err) {
    logWarnFromError(err, 'OpenCTI marking definitions sync failed', { tenantId });
  }

  /**
   * Retires an id the stream says another one now stands for: a merge's absorbed object, or the id
   * a rename left behind, the survivor being the one the new name regenerated. The superseded
   * object's relationships keep their own ids and emit no event, so the mirror is the only place
   * they can move.
   *
   * The survivor is upserted before this runs, and never after: the cursor advances whether these
   * writes succeed or not, so a failure between them has to leave the two actors the stream used to
   * show rather than edges pointing at a survivor with no row.
   */
  const supersedeStreamObject = async (retiredId: string, survivorId: string): Promise<void> => {
    if (survivorId && survivorId !== retiredId) {
      await services.openctiConnector.repointStreamObjectRefs(tenantId, retiredId, survivorId);
    }
    await services.openctiConnector.deleteStreamObject(tenantId, retiredId);
  };

  // Everything taken off the stream since the last flush, kept or dropped alike.
  let eventsSinceFlush = 0;
  // Objects taken off the stream since this consumer started, kept or dropped alike, and how many of
  // them have reached the database.
  let totalRead = 0;
  let persistedRead = 0;
  let lastEventId: string | null = settings.cursor;
  let lastEventAt: Date | null = settings.lastEventAt;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  // Serializes flushes so an older cursor can't persist after a newer one.
  let flushChain: Promise<void> = Promise.resolve();

  const generation = settings.streamGeneration;

  /** Whether the position reached the database, which is what lets the caller retire its read count. */
  const persistCursor = async (cursor: string | null, cursorAt: Date | null, readCount: number): Promise<boolean> => {
    if (!cursor || !cursorAt) {
      // No trustworthy date yet — don't guess with "now", it would falsely trip `reachedLiveTailAt`.
      return false;
    }
    const reachedLiveTailAt = isCloseToLiveTail(cursorAt, new Date()) ? new Date() : null;
    const persisted = await services.openctiConnector.updateCursor(tenantId, cursor, cursorAt, reachedLiveTailAt, readCount, generation);
    if (!persisted) {
      return false;
    }
    // The latch is a coalesce, so it holds this call's own candidate only when this write is the one
    // that set it: a consumer being replaced and its successor can both be flushing behind the edge.
    if (reachedLiveTailAt && persisted.reachedLiveTailAt?.getTime() === reachedLiveTailAt.getTime()) {
      // The persisted total, which a reset or a configure zeroes, so it spans every reconnection of the replay.
      const { objectsRead } = persisted;
      logTrace(`OpenCTI stream caught up with its live edge after reading ${objectsRead} ${objectsRead === 1 ? 'object' : 'objects'}`, { tenantId });
    }
    return true;
  };

  const doFlush = async (
    cursorSnapshot: string | null, cursorAtSnapshot: Date | null, readSnapshot: number,
  ): Promise<void> => {
    // The count belongs to the position it is written beside, so it is the watermark taken when this
    // flush was queued, never what has been read since. Flushes run in queue order, which is what makes
    // the difference against the last persisted watermark disjoint between two of them.
    if (await persistCursor(cursorSnapshot, cursorAtSnapshot, readSnapshot - persistedRead)) {
      persistedRead = readSnapshot;
    }
  };

  /** Queues behind any earlier flush. Its write is also the doorbell that wakes the rebuild job. */
  const flush = (): Promise<void> => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = undefined;
    }
    eventsSinceFlush = 0;
    const cursorSnapshot = lastEventId;
    const cursorAtSnapshot = lastEventAt;
    const readSnapshot = totalRead;

    const run = flushChain.then(() => doFlush(cursorSnapshot, cursorAtSnapshot, readSnapshot));
    flushChain = run.catch(() => undefined);
    return run;
  };

  const scheduleIdleFlush = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      flush().catch((err) => logFromError(err, 'OpenCTI stream idle flush failed', { tenantId }));
    }, STREAM_TIMING.idleDebounceMs);
  };

  logTrace(describeStreamStart(settings.cursor, settings.reachedLiveTailAt !== null), { tenantId, streamId: settings.streamId });
  try {
    for await (const event of consumeOpenCtiStream({
      url: openctiConfig.url,
      token: openctiConfig.token,
      streamId: settings.streamId,
      lastEventId: settings.cursor,
      needsRecover: !settings.reachedLiveTailAt,
      signal,
    })) {
      if (event.event === 'connected') {
        // No `id:` on this frame — nothing to advance the cursor to.
        onConnected();
        logTrace('OpenCTI stream connected', { tenantId, streamId: settings.streamId });
        continue;
      }

      // Not on `connected`, which proves no more than an accepted socket: a proxy holding the line
      // open sends one and nothing after it.
      if (event.event === 'heartbeat') {
        onFrame();
        continue;
      }

      lastEventId = event.id;
      totalRead += 1;
      eventsSinceFlush += 1;
      // Monotonic high-water mark; `eventAt` is `null` for an unparseable id and is skipped.
      const eventAt = parseEventTimestamp(event.id);
      if (eventAt && (!lastEventAt || eventAt > lastEventAt)) {
        lastEventAt = eventAt;
      }

      const rawStixObject = extractStixObject(event.data);
      // Sanitised whole and once, before anything is read out of it: `type`, `relationship_type`
      // and `identity_class` gate relevance by exact match, and the strings taken from here land in
      // `text` columns, which Postgres refuses U+0000 in just as it does in `jsonb`.
      const sanitised = rawStixObject === null ? null : sanitizeStixNullBytes(rawStixObject);
      const stixObject = sanitised?.data ?? null;
      const stixId = stixObject ? String(stixObject['id'] ?? '') : '';
      if (sanitised && (sanitised.changedStrings > 0 || sanitised.droppedKeys > 0)) {
        logTrace('OpenCTI stream object sanitised before mirroring', {
          tenantId, stixId, changedStrings: sanitised.changedStrings, droppedKeys: sanitised.droppedKeys,
        });
      }
      // A report is kept only while it cites a threat, so an update that drops its last one leaves a
      // mirrored row the stream no longer sends: it goes the way of a deleted report, under the id a
      // rename in the same update left behind too, since that is the id the mirror holds.
      const droppedReport = stixObject?.['type'] === 'report' && event.event === 'update' && !isRelevantStixObject(stixObject);
      const streamMarking = stixObject ? parseStreamMarking(stixObject) : null;
      if (stixObject && stixId && droppedReport) {
        await services.openctiConnector.deleteStreamObject(tenantId, stixId);
        const retiredId = extractRetiredStixId(event.data, stixId);
        if (retiredId) {
          await services.openctiConnector.deleteStreamObject(tenantId, retiredId);
        }
      } else if (streamMarking !== null) {
        // A marking OpenCTI deletes stays here: rows and clearances may still name it.
        if (event.event !== 'delete') {
          await syncMarkings([streamMarking]).catch((err) => logFromError(err, 'OpenCTI stream marking sync failed', { tenantId, stixId }));
        }
      } else if (stixObject && stixId && isRelevantStixObject(stixObject)) {
        if (event.event === 'delete') {
          await services.openctiConnector.deleteStreamObject(tenantId, stixId);
        } else {
          await services.openctiConnector.upsertStreamObject(tenantId, stixId, String(stixObject['type']), trimRelevantStixObject(stixObject));
          const retiredId = event.event === 'update' ? extractRetiredStixId(event.data, stixId) : null;
          if (retiredId) {
            await supersedeStreamObject(retiredId, stixId);
          }
        }
      }

      if (event.event === 'merge') {
        for (const absorbed of extractMergedSources(event.data)) {
          const absorbedId = getStixString(absorbed, 'id') ?? '';
          if (!absorbedId || !isRelevantStixObject(absorbed)) {
            continue;
          }
          await supersedeStreamObject(absorbedId, stixId);
        }
      }

      if (eventsSinceFlush >= FORCED_FLUSH_EVENT_COUNT) {
        await flush();
      } else {
        scheduleIdleFlush();
      }
      // Only once the event is written: one that fails on every replay is no healthy stream.
      onFrame();
    }
  } finally {
    await flush().catch((err) => logFromError(err, 'OpenCTI stream final flush failed', { tenantId }));
  }
};

const runConsumerLoop = async (tenantId: string, signal: AbortSignal): Promise<void> => {
  let currentReconnectDelayMs: number = STREAM_TIMING.initialReconnectDelayMs;
  const onConnected = (): void => {
    currentReconnectDelayMs = STREAM_TIMING.initialReconnectDelayMs;
  };
  // When the first failure since the stream last delivered a frame happened.
  let unreachableSince: Date | null = null;
  const onFrame = (): void => {
    unreachableSince = null;
  };
  const logReconnection = (err: unknown): void => {
    unreachableSince ??= new Date();
    const data = { tenantId, delayMs: currentReconnectDelayMs, unreachableSince: unreachableSince.toISOString() };
    if (Date.now() - unreachableSince.getTime() >= STREAM_TIMING.unreachableAlertMs) {
      logFromError(err, 'OpenCTI stream unreachable, reconnecting', data);
    } else {
      logWarnFromError(err, 'OpenCTI stream connection error, reconnecting', data);
    }
  };

  while (!signal.aborted) {
    try {
      await consumeTenantStream(tenantId, signal, onConnected, onFrame);
      // The SSE client returns when the server ends the response, which a stream never does on its
      // own: one closed over and over is as unreachable as one refused.
      if (!signal.aborted) {
        logReconnection(newError('OpenCTI stream closed by the server'));
      }
    } catch (err) {
      if (!signal.aborted) {
        // An invalid/disabled token never recovers on its own — persist the disable via `authFailedAt`.
        if (err instanceof OpenCtiAuthError) {
          logFromError(err, 'OpenCTI stream auth failed, disabling connector', { tenantId });
          await createServices([...allServiceDefinitions], dbEngine.db).withOrigin(SYSTEM_ORIGIN).openctiConnector.markAuthFailed(tenantId)
            .catch((disableErr: unknown) => logFromError(disableErr, 'Failed to persist auto-disable after OpenCTI auth failure', { tenantId }));
          return;
        }
        // The SSE client's own fatal error (not job-system-related) — reconnecting won't help.
        if (err instanceof OpenCtiStreamFatalError) {
          logFromError(err, 'OpenCTI stream unrecoverable, disabling consumer', { tenantId });
          return;
        }
        logReconnection(err);
      }
    }
    if (signal.aborted) {
      return;
    }
    await sleep(currentReconnectDelayMs, signal);
    currentReconnectDelayMs = Math.min(currentReconnectDelayMs * 2, STREAM_TIMING.maxReconnectDelayMs);
  }
};

const startConsumerForTenant = (tenantId: string, engineSignal: AbortSignal): void => {
  const controller = new AbortController();
  activeConsumers.set(tenantId, controller);
  const combinedSignal = AbortSignal.any([engineSignal, controller.signal]);
  // The scope spans the reconnect loop, not one connection: the auth-failure and reconnect lines are
  // written by the loop, and a session that never ends is what the line-count retention bounds.
  const scopeId = uuidv7();
  const session = runInExecutionScope(
    { scopeId, scopeKind: STREAM_LOG_SCOPE_KIND, tenantId, jobId: null, retention: 'rolling' },
    // Caught inside the scope: a handler attached to the returned promise runs outside it, and the
    // line naming the crash is the one this tab is opened for.
    () => runConsumerLoop(tenantId, combinedSignal)
      .catch((err: unknown) => logFromError(err, 'OpenCTI consumer loop crashed', { tenantId })),
  )
    .finally(() => {
      void endLogScope(scopeId);
      if (activeConsumers.get(tenantId) === controller) {
        activeConsumers.delete(tenantId);
      }
    });
  consumerSessions.add(session);
  void session.finally(() => consumerSessions.delete(session));
  logTrace('OpenCTI stream consumer started', { tenantId });
};

/**
 * Resolves once every running consumer has ended, final flush included. The worker never waits on
 * it, its process being on its way down either way; a caller whose database outlives the consumer
 * has to.
 */
export const whenAllConsumersStopped = async (): Promise<void> => {
  while (consumerSessions.size > 0) {
    await Promise.allSettled([...consumerSessions]);
  }
};

const stopConsumerForTenant = (tenantId: string): void => {
  const controller = activeConsumers.get(tenantId);
  if (controller) {
    controller.abort();
    activeConsumers.delete(tenantId);
    logTrace('OpenCTI stream consumer stopped', { tenantId });
  }
};

/** Re-reads a tenant's config and starts/stops/restarts its consumer to match. */
const reconcileTenant = async (tenantId: string, engineSignal: AbortSignal): Promise<void> => {
  const systemServices = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(SYSTEM_ORIGIN);
  const settings = await systemServices.openctiConnector.getSettings(tenantId);
  // Writes under a `connector` origin are silently dropped while the account is inactive.
  const serviceAccount = settings?.serviceAccountId
    ? await systemServices.serviceAccounts.getServiceAccount(settings.serviceAccountId)
    : null;
  const shouldRun = !!(settings?.enabled && settings.streamId && serviceAccount?.active);

  stopConsumerForTenant(tenantId);
  if (shouldRun && !engineSignal.aborted) {
    startConsumerForTenant(tenantId, engineSignal);
  }
};

/** Reconciles every tenant's consumer against the full enabled set — called on boot and after
  * each LISTEN reconnect (a dropped NOTIFY could otherwise leave a stale consumer). */
const reconcileAllTenants = async (engineSignal: AbortSignal): Promise<void> => {
  const systemServices = createServices([...allServiceDefinitions], dbEngine.db).withOrigin(SYSTEM_ORIGIN);
  const enabledSettings = await systemServices.openctiConnector.findAllEnabled();
  const enabledTenantIds = new Set(enabledSettings.map((settings) => settings.tenantId));

  for (const tenantId of [...activeConsumers.keys()]) {
    if (!enabledTenantIds.has(tenantId)) {
      stopConsumerForTenant(tenantId);
    }
  }

  for (const settings of enabledSettings) {
    if (!activeConsumers.has(settings.tenantId)) {
      startConsumerForTenant(settings.tenantId, engineSignal);
    }
  }
};

/** Starts every tenant's enabled OpenCTI Live Stream consumer and stays reconciled to
  * `opencti_config_changed` NOTIFYs for the lifetime of `signal` (worker process only). */
export const startAll = (signal: AbortSignal): void => {
  signal.addEventListener('abort', () => {
    for (const tenantId of [...activeConsumers.keys()]) {
      stopConsumerForTenant(tenantId);
    }
  }, { once: true });

  startPgListenLoop<string>({
    channel: 'opencti_config_changed',
    signal,
    parse: (payload) => payload,
    onNotify: (tenantId) => {
      reconcileTenant(tenantId, signal).catch((err) => logFromError(err, 'OpenCTI reconcile failed', { tenantId }));
    },
    onListening: () => {
      reconcileAllTenants(signal).catch((err) => logFromError(err, 'OpenCTI initial load failed'));
    },
    logger,
  }).catch((err) => logFromError(err, 'opencti_config_changed LISTEN loop stopped unexpectedly'));
};
