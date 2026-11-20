import { describe, expect, it } from 'vitest';
import type { DataChangedSignal } from './data-changed-hub';
import { createDataChangedHub, EVERY_TABLE } from './data-changed-hub';

// Drain an async iterable into `sink` in the background; resolves when the iterable ends
// (i.e. when its signal aborts, which surfaces as an AbortError we swallow).
const drain = (iterable: AsyncIterable<DataChangedSignal>, sink: Array<DataChangedSignal>): Promise<void> => (async () => {
  try {
    for await (const event of iterable) {
      sink.push(event);
    }
  } catch {
    // AbortError on signal abort: the normal way a subscription ends.
  }
})();

const WINDOW_MS = 100;
const JOB_WINDOW_MS = 500;
const newHub = () => createDataChangedHub({ windowMs: WINDOW_MS, jobWindowMs: JOB_WINDOW_MS });

// Long enough for the user throttle window to flush.
const afterThrottleWindow = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 150); 
});
// Long enough for the job throttle window to flush.
const afterJobWindow = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 600); 
});
const microtask = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 10); 
});

describe('createDataChangedHub', () => {
  it('caps reservations per key and frees them on release', () => {
    const hub = newHub();
    expect(hub.reserve('user-1', 2)).toBe(true);
    expect(hub.reserve('user-1', 2)).toBe(true);
    expect(hub.reserve('user-1', 2)).toBe(false);
    expect(hub.reserve('user-2', 2)).toBe(true);
    hub.release('user-1');
    expect(hub.reserve('user-1', 2)).toBe(true);
    hub.closeAll();
  });

  it('reports the distinct watched session ids and drops one when its last watcher unwatches', () => {
    const hub = newHub();
    expect(hub.watchedSessionIds()).toEqual([]);
    const unwatch1a = hub.watchSession('session-1', () => undefined);
    const unwatch1b = hub.watchSession('session-1', () => undefined);
    const unwatch2 = hub.watchSession('session-2', () => undefined);
    expect([...hub.watchedSessionIds()].sort()).toEqual(['session-1', 'session-2']);
    unwatch1a();
    expect([...hub.watchedSessionIds()].sort()).toEqual(['session-1', 'session-2']);
    unwatch1b();
    expect(hub.watchedSessionIds()).toEqual(['session-2']);
    unwatch2();
    expect(hub.watchedSessionIds()).toEqual([]);
    hub.closeAll();
  });

  it('routes tenant events only to matching subscribers and global events to all', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seenByT1: Array<DataChangedSignal> = [];
    const seenByT2: Array<DataChangedSignal> = [];
    const t1 = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seenByT1);
    const t2 = drain(hub.subscribe({ tenantIds: ['tenant-2'], signal: controller.signal }), seenByT2);
    await microtask();

    hub.publish('tenant-1', null, null, 'organizations');
    await afterThrottleWindow();
    hub.publish(null, null, null, 'countries');
    await afterThrottleWindow();

    controller.abort();
    await Promise.all([t1, t2]);

    expect(seenByT1.map((e) => e.tenantId)).toEqual(['tenant-1', null]);
    expect(seenByT2.map((e) => e.tenantId)).toEqual([null]);
    hub.closeAll();
  });

  it('fires every watcher for a revoked session and leaves other sessions untouched', () => {
    const hub = newHub();
    let aborted1 = 0;
    let aborted1b = 0;
    let aborted2 = 0;
    hub.watchSession('session-1', () => {
      aborted1 += 1; 
    });
    hub.watchSession('session-1', () => {
      aborted1b += 1; 
    });
    hub.watchSession('session-2', () => {
      aborted2 += 1; 
    });

    hub.notifySessionRevoked('session-1');

    expect(aborted1).toBe(1);
    expect(aborted1b).toBe(1);
    expect(aborted2).toBe(0);
    // Revoking an unknown session is a harmless no-op (its stream lives on another instance).
    expect(() => hub.notifySessionRevoked('does-not-exist')).not.toThrow();
    hub.closeAll();
  });

  it('stops firing a watcher after unwatch', () => {
    const hub = newHub();
    let aborted = 0;
    const unwatch = hub.watchSession('session-1', () => {
      aborted += 1; 
    });
    unwatch();
    hub.notifySessionRevoked('session-1');
    expect(aborted).toBe(0);
    hub.closeAll();
  });

  it('tolerates a watcher that unwatches itself during revoke', () => {
    const hub = newHub();
    let aborted = 0;
    // Mirrors the real router: the abort handler runs the stream's finally → unwatch(),
    // mutating the watcher set mid-iteration. The snapshot in notifySessionRevoked must absorb this.
    const unwatch = hub.watchSession('session-1', () => {
      aborted += 1; unwatch(); 
    });
    hub.notifySessionRevoked('session-1');
    expect(aborted).toBe(1);
    // The set was cleaned up, so a second revoke does nothing.
    hub.notifySessionRevoked('session-1');
    expect(aborted).toBe(1);
    hub.closeAll();
  });

  it('throttles a burst of publishes for the same scope into one signal', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', null, null, 'organizations');
    hub.publish('tenant-1', null, null, 'organizations');
    hub.publish('tenant-1', null, null, 'organizations');
    await afterThrottleWindow();

    controller.abort();
    await sub;

    expect(seen).toHaveLength(1);
    hub.closeAll();
  });

  it('rings once for a job burst spanning several user windows', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    // What a full-estate recompute looks like: writes landing continuously, well past the window
    // a user's own edit would ring in.
    hub.publish('tenant-1', 'finding-score-recompute', false, 'finding_scores');
    await afterThrottleWindow();
    hub.publish('tenant-1', 'finding-score-recompute', false, 'finding_scores');
    await afterThrottleWindow();
    expect(seen).toHaveLength(0);

    await afterJobWindow();
    expect(seen).toHaveLength(1);

    controller.abort();
    await sub;
    hub.closeAll();
  });

  it('rings a user write while a job window is still pending', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', 'finding-score-recompute', false, 'finding_scores');
    hub.publish('tenant-1', null, null, 'organizations');
    await afterThrottleWindow();
    expect(seen).toHaveLength(1);

    await afterJobWindow();
    expect(seen).toHaveLength(2);

    controller.abort();
    await sub;
    hub.closeAll();
  });

  it('names every table written during a window, once each', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', null, null, 'organizations');
    hub.publish('tenant-1', null, null, 'assets');
    hub.publish('tenant-1', null, null, 'organizations');
    await afterThrottleWindow();

    controller.abort();
    await sub;

    expect(seen).toEqual([{ tenantId: 'tenant-1', tables: ['assets', 'organizations'] }]);
    hub.closeAll();
  });

  it('collapses a window that holds the every-table sentinel to the sentinel alone', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    // A reconnect: nobody can name what was missed, so the tables named beside it say nothing more.
    hub.publish(null, null, null, 'countries');
    hub.publish(null, null, null, EVERY_TABLE);
    hub.publish(null, null, null, 'currencies');
    await afterThrottleWindow();

    controller.abort();
    await sub;

    expect(seen).toEqual([{ tenantId: null, tables: [EVERY_TABLE] }]);
    hub.closeAll();
  });

  it('keeps the tables of a job window apart from those of the user window', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', 'finding-score-recompute', false, 'finding_scores');
    hub.publish('tenant-1', null, null, 'organizations');
    await afterThrottleWindow();
    expect(seen.map((e) => e.tables)).toEqual([['organizations']]);

    await afterJobWindow();
    expect(seen.map((e) => e.tables)).toEqual([['organizations'], ['finding_scores']]);

    controller.abort();
    await sub;
    hub.closeAll();
  });

  it('rings a job run on the fast window when its trigger is interactive', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', 'tef-recompute', true, 'tef_estimates');
    await afterThrottleWindow();

    expect(seen).toHaveLength(1);
    controller.abort();
    await sub;
    hub.closeAll();
  });

  it('keeps a batch run of one kind from holding an interactive run of another kind behind its window', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', 'finding-score-recompute', false, 'finding_scores');
    hub.publish('tenant-1', 'tef-recompute', true, 'tef_estimates');
    await afterThrottleWindow();

    expect(seen).toHaveLength(1);
    expect(seen[0].tables).toEqual(['tef_estimates']);

    await afterJobWindow();
    expect(seen).toHaveLength(2);
    expect(seen[1].tables).toEqual(['finding_scores']);

    controller.abort();
    await sub;
    hub.closeAll();
  });

  // A night runs several sweeps at once. Splitting them by kind on top of the window would ring
  // once per kind, each costing every open tab its whole tRPC cache — the cost the coarse window
  // exists to bound.
  it('rings once for several kinds sweeping at the same time', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', 'finding-score-recompute', false, 'finding_scores');
    hub.publish('tenant-1', 'threat-activity-recompute', false, 'threat_analyses');
    hub.publish('tenant-1', 'financial-estimates-recompute', false, 'scenario_loss_estimates');
    await afterJobWindow();

    expect(seen).toHaveLength(1);
    expect(seen[0].tables).toEqual(['finding_scores', 'scenario_loss_estimates', 'threat_analyses']);

    controller.abort();
    await sub;
    hub.closeAll();
  });

  it('keeps an interactive run of a kind from holding a batch run of the same kind behind its window', async () => {
    const hub = newHub();
    const controller = new AbortController();
    const seen: Array<DataChangedSignal> = [];
    const sub = drain(hub.subscribe({ tenantIds: ['tenant-1'], signal: controller.signal }), seen);
    await microtask();

    hub.publish('tenant-1', 'tef-recompute', false, 'tef_estimates');
    hub.publish('tenant-1', 'tef-recompute', true, 'tef_estimates');
    await afterThrottleWindow();

    expect(seen).toHaveLength(1);

    await afterJobWindow();
    expect(seen).toHaveLength(2);

    controller.abort();
    await sub;
    hub.closeAll();
  });
});
