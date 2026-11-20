import { CONNECTOR_SOURCES } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import {
  connectorControls,
  connectorSlug,
  connectorSourceFromSlug,
  middleTabKey,
  runControl,
} from './connector-route-utils';

describe('connectorSlug', () => {
  it('round-trips every connector source', () => {
    for (const source of CONNECTOR_SOURCES) {
      expect(connectorSourceFromSlug(connectorSlug(source))).toBe(source);
    }
  });

  it('keeps the addresses the product already publishes', () => {
    expect(connectorSlug('microsoft_graph')).toBe('microsoft-graph');
    expect(connectorSlug('drata')).toBe('drata');
  });

  it('resolves an unknown slug to null', () => {
    expect(connectorSourceFromSlug('nope')).toBeNull();
    expect(connectorSourceFromSlug('microsoft_graph')).toBeNull();
  });
});

describe('middleTabKey', () => {
  it('gives a run history to a connector that runs', () => {
    expect(middleTabKey('scheduled_pull')).toBe('works');
  });

  it('gives the stream its own state instead', () => {
    expect(middleTabKey('live_stream')).toBe('stream');
  });
});

describe('runControl', () => {
  const viewer = { userId: 'user-1', hasManageSecurity: false, hasPlatformAccess: false };
  const ownRun = { triggeredBy: 'user' as const, triggeredById: 'user-1', askedByOthers: false };
  const othersRun = { triggeredBy: 'user' as const, triggeredById: 'user-2', askedByOthers: false };
  const scheduledRun = { triggeredBy: 'scheduler' as const, triggeredById: null, askedByOthers: false };

  it('offers nothing when there is no run', () => {
    expect(runControl(null, { ...viewer, hasManageSecurity: true }, 'cancel')).toBe('denied');
    expect(runControl(null, { ...viewer, hasManageSecurity: true }, 'retry')).toBe('denied');
  });

  it('lets a security manager control someone else\'s run and a scheduled one', () => {
    const manager = { ...viewer, hasManageSecurity: true };
    expect(runControl(othersRun, manager, 'cancel')).toBe('allowed');
    expect(runControl(scheduledRun, manager, 'retry')).toBe('allowed');
  });

  it('lets platform access alone control someone else\'s run', () => {
    const platform = { ...viewer, hasPlatformAccess: true };
    expect(runControl(othersRun, platform, 'cancel')).toBe('allowed');
    expect(runControl(scheduledRun, platform, 'retry')).toBe('allowed');
  });

  it('lets a viewer without jobs access control their own run', () => {
    expect(runControl(ownRun, viewer, 'cancel')).toBe('allowed');
    expect(runControl(ownRun, viewer, 'retry')).toBe('allowed');
  });

  it('withholds another user\'s run from a viewer without jobs access', () => {
    expect(runControl(othersRun, viewer, 'cancel')).toBe('denied');
    expect(runControl(othersRun, viewer, 'retry')).toBe('denied');
  });

  it('withholds a scheduled run from a viewer without jobs access', () => {
    expect(runControl(scheduledRun, viewer, 'cancel')).toBe('denied');
    expect(runControl(scheduledRun, viewer, 'retry')).toBe('denied');
  });

  it('does not take a connector run for the viewer\'s own, whatever its id', () => {
    const connectorRun = { triggeredBy: 'connector' as const, triggeredById: 'user-1', askedByOthers: false };
    expect(runControl(connectorRun, viewer, 'cancel')).toBe('denied');
  });

  it('marks the cancel of an own run another asker folded into as shared, but not its retry', () => {
    const shared = { ...ownRun, askedByOthers: true };
    expect(runControl(shared, viewer, 'cancel')).toBe('shared');
    expect(runControl(shared, viewer, 'retry')).toBe('allowed');
  });

  it('lets a security manager cancel a run others asked for', () => {
    expect(runControl({ ...ownRun, askedByOthers: true }, { ...viewer, hasManageSecurity: true }, 'cancel'))
      .toBe('allowed');
  });
});

describe('connectorControls', () => {
  const ownRun = { triggeredBy: 'user' as const, triggeredById: 'user-1', askedByOthers: false };
  const othersRun = { triggeredBy: 'user' as const, triggeredById: 'user-2', askedByOthers: false };
  const configured = {
    hasJob: true,
    isStream: false,
    streamEnabled: false,
    platformConfigured: true,
    tenantConfigured: true,
    hasActiveRun: false,
    lastRunFailed: false,
    hasManageSecurity: true,
    hasPlatformAccess: false,
    userId: 'user-1',
    activeRun: ownRun,
    lastRun: ownRun,
  };
  const member = { ...configured, hasManageSecurity: false };

  const stream = { ...configured, hasJob: false, isStream: true, streamEnabled: true };

  it('offers a sync on a configured idle connector, and nothing to interrupt', () => {
    expect(connectorControls(configured)).toMatchObject({
      canSync: true,
      showCancel: false,
      showRetry: false,
    });
  });

  it('offers cancel and withholds sync while a run is in flight', () => {
    expect(connectorControls({ ...configured, hasActiveRun: true })).toMatchObject({
      canSync: false,
      showCancel: true,
      showRetry: false,
    });
  });

  it('offers retry once the last run failed', () => {
    expect(connectorControls({ ...configured, lastRunFailed: true })).toMatchObject({
      showCancel: false,
      showRetry: true,
    });
  });

  it('withholds retry while a new run is already in flight', () => {
    expect(connectorControls({ ...configured, hasActiveRun: true, lastRunFailed: true }))
      .toMatchObject({ showCancel: true, showRetry: false });
  });

  it('withholds cancel from a viewer without access on someone else\'s active run', () => {
    expect(connectorControls({ ...member, hasActiveRun: true, activeRun: othersRun }))
      .toMatchObject({ showCancel: false });
  });

  it('offers cancel on someone else\'s active run to platform access alone', () => {
    expect(connectorControls({ ...member, hasPlatformAccess: true, hasActiveRun: true, activeRun: othersRun }))
      .toMatchObject({ showCancel: true });
  });

  it('offers cancel on their own active run to a viewer without access', () => {
    expect(connectorControls({ ...member, hasActiveRun: true })).toMatchObject({ showCancel: true });
  });

  it('judges cancel on the active run, not on the last one', () => {
    expect(connectorControls({ ...member, hasActiveRun: true, activeRun: othersRun, lastRun: ownRun }))
      .toMatchObject({ showCancel: false });
  });

  it('withholds cancel from a viewer without access on an own run others folded into', () => {
    expect(connectorControls({
      ...member,
      hasActiveRun: true,
      activeRun: { ...ownRun, askedByOthers: true },
    })).toMatchObject({ showCancel: false, cancelHeldByOthers: true });
  });

  it('does not offer the disabled cancel on someone else\'s active run', () => {
    expect(connectorControls({ ...member, hasActiveRun: true, activeRun: { ...othersRun, askedByOthers: true } }))
      .toMatchObject({ showCancel: false, cancelHeldByOthers: false });
  });

  it('withholds retry from a viewer without access on someone else\'s failed run', () => {
    expect(connectorControls({ ...member, lastRunFailed: true, lastRun: othersRun }))
      .toMatchObject({ showRetry: false });
  });

  it('judges retry on the last run, not on the active one', () => {
    expect(connectorControls({ ...member, lastRunFailed: true, lastRun: othersRun, activeRun: ownRun }))
      .toMatchObject({ showRetry: false });
  });

  it('offers retry on their own failed run to a viewer without access, even if others folded into it', () => {
    expect(connectorControls({
      ...member,
      lastRunFailed: true,
      lastRun: { ...ownRun, askedByOthers: true },
    })).toMatchObject({ showRetry: true });
  });

  it('withholds sync and reset from a connector that is neither a job nor a stream', () => {
    expect(connectorControls({ ...configured, hasJob: false })).toMatchObject({
      canSync: false,
      showReset: false,
      showReconnect: false,
    });
  });

  it('offers reconnect and reset on a configured, enabled stream, and never a sync', () => {
    expect(connectorControls(stream)).toMatchObject({
      canSync: false,
      showReconnect: true,
      showReset: true,
    });
  });

  it('withholds reconnect from a stream that is switched off, but still offers reset', () => {
    expect(connectorControls({ ...stream, streamEnabled: false })).toMatchObject({
      showReconnect: false,
      showReset: true,
    });
  });

  it('offers a stream nothing to cancel or retry, it having no runs', () => {
    expect(connectorControls(stream)).toMatchObject({ showCancel: false, showRetry: false });
  });

  it('withholds every stream control until a Live Stream is bound', () => {
    expect(connectorControls({ ...stream, tenantConfigured: false })).toMatchObject({
      showReconnect: false,
      showReset: false,
    });
  });

  it('withholds sync from a connector no service account is bound to', () => {
    expect(connectorControls({ ...configured, tenantConfigured: false })).toMatchObject({
      canSync: false,
      showReset: false,
    });
  });

  it('withholds sync when the deployment carries no credentials', () => {
    expect(connectorControls({ ...configured, platformConfigured: false }))
      .toMatchObject({ canSync: false, showReset: false });
  });

  it('withholds both stream controls from a member who cannot manage security', () => {
    expect(connectorControls({ ...stream, hasManageSecurity: false })).toMatchObject({
      showReconnect: false,
      showReset: false,
    });
  });

  it('withholds a job connector its reset from a member who cannot manage security', () => {
    expect(connectorControls({ ...configured, hasManageSecurity: false })).toMatchObject({
      showReset: false,
    });
  });

  it('offers a job connector its reset to a member who can manage security', () => {
    expect(connectorControls(configured)).toMatchObject({ showReset: true });
  });

  it('offers configure to a member who can manage security', () => {
    expect(connectorControls(configured)).toMatchObject({ showConfigure: true });
  });

  it('withholds configure from a member who cannot manage security', () => {
    expect(connectorControls({ ...configured, hasManageSecurity: false })).toMatchObject({
      showConfigure: false,
    });
  });

  it('offers configure on a connector that is not configured yet, which is what it is for', () => {
    expect(connectorControls({ ...configured, tenantConfigured: false })).toMatchObject({
      showConfigure: true,
    });
  });
});
