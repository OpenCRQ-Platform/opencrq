import { describe, expect, it } from 'vitest';
import { deriveConnectorState, deriveStreamConnection, deriveStreamConnectorState } from './status';

const jobBacked = (overrides: Partial<Parameters<typeof deriveConnectorState>[0]> = {}) => ({
  platformConfigured: true,
  tenantConfigured: true,
  enabled: true,
  hasActiveRun: false,
  lastTerminalRunStatus: 'succeeded' as const,
  ...overrides,
});

const stream = (overrides: Partial<Parameters<typeof deriveStreamConnectorState>[0]> = {}) => ({
  platformConfigured: true,
  tenantConfigured: true,
  authFailed: false,
  enabled: true,
  reachedLiveTail: true,
  ...overrides,
});

describe('deriveConnectorState', () => {
  it('reads unavailable when the deployment carries no credentials', () => {
    expect(deriveConnectorState(jobBacked({ platformConfigured: false }))).toBe('unavailable');
  });

  it('reads unavailable even when the tenant somehow holds a service account', () => {
    expect(deriveConnectorState(jobBacked({ platformConfigured: false, tenantConfigured: true, hasActiveRun: true })))
      .toBe('unavailable');
  });

  it('reads not configured when no service account is bound', () => {
    expect(deriveConnectorState(jobBacked({ tenantConfigured: false }))).toBe('not_configured');
  });

  it('reads not configured rather than never synced, the account coming first', () => {
    expect(deriveConnectorState(jobBacked({ tenantConfigured: false, lastTerminalRunStatus: null })))
      .toBe('not_configured');
  });

  it('reads never synced when switched off, whatever its last run', () => {
    expect(deriveConnectorState(jobBacked({ enabled: false, lastTerminalRunStatus: 'dlq' }))).toBe('never_synced');
    expect(deriveConnectorState(jobBacked({ enabled: false, hasActiveRun: true }))).toBe('never_synced');
  });

  it('reads unavailable rather than switched off, the platform coming first', () => {
    expect(deriveConnectorState(jobBacked({ platformConfigured: false, enabled: false }))).toBe('unavailable');
  });

  it('reads syncing while a run is queued or running', () => {
    expect(deriveConnectorState(jobBacked({ hasActiveRun: true }))).toBe('syncing');
  });

  it('reads syncing for a first run in flight, not never synced', () => {
    expect(deriveConnectorState(jobBacked({ hasActiveRun: true, lastTerminalRunStatus: null }))).toBe('syncing');
  });

  it('reads never synced once configured and nothing has ever finished', () => {
    expect(deriveConnectorState(jobBacked({ lastTerminalRunStatus: null }))).toBe('never_synced');
  });

  it('reads healthy when the last run succeeded', () => {
    expect(deriveConnectorState(jobBacked({ lastTerminalRunStatus: 'succeeded' }))).toBe('healthy');
  });

  it('reads healthy when the last run was cancelled, a cancellation not being a failure', () => {
    expect(deriveConnectorState(jobBacked({ lastTerminalRunStatus: 'cancelled' }))).toBe('healthy');
  });

  it('reads failing when the last run reached the dead-letter queue', () => {
    expect(deriveConnectorState(jobBacked({ lastTerminalRunStatus: 'dlq' }))).toBe('failing');
  });

  it('reads failing on a dlq run even when an earlier run had succeeded', () => {
    expect(deriveConnectorState(jobBacked({ lastTerminalRunStatus: 'dlq', hasActiveRun: false }))).toBe('failing');
  });
});

describe('deriveStreamConnectorState', () => {
  it('reads unavailable when the deployment carries no credentials', () => {
    expect(deriveStreamConnectorState(stream({ platformConfigured: false }))).toBe('unavailable');
  });

  it('reads not configured when no stream and service account are bound', () => {
    expect(deriveStreamConnectorState(stream({ tenantConfigured: false }))).toBe('not_configured');
  });

  it('reads failing on an authentication failure, whatever the stream has reached', () => {
    expect(deriveStreamConnectorState(stream({ authFailed: true, reachedLiveTail: true }))).toBe('failing');
  });

  it('reads never synced when the stream is configured but not enabled', () => {
    expect(deriveStreamConnectorState(stream({ enabled: false }))).toBe('never_synced');
  });

  it('reads syncing while an enabled stream has not reached the live tail', () => {
    expect(deriveStreamConnectorState(stream({ reachedLiveTail: false }))).toBe('syncing');
  });

  it('reads healthy once an enabled stream sits at the live tail', () => {
    expect(deriveStreamConnectorState(stream())).toBe('healthy');
  });
});

const connection = (overrides: Partial<Parameters<typeof deriveStreamConnection>[0]> = {}) => ({
  platformConfigured: true,
  tenantConfigured: true,
  authFailed: false,
  enabled: true,
  runtimeAnswering: true,
  serviceAccountActive: true,
  ...overrides,
});

describe('deriveStreamConnection', () => {
  it('reads not configured when the deployment carries no credentials', () => {
    expect(deriveStreamConnection(connection({ platformConfigured: false }))).toBe('not_configured');
  });

  it('reads not configured when no stream and service account are bound', () => {
    expect(deriveStreamConnection(connection({ tenantConfigured: false }))).toBe('not_configured');
  });

  it('reads the rejected token rather than the disable it forced', () => {
    expect(deriveStreamConnection(connection({ authFailed: true, enabled: false }))).toBe('auth_failed');
  });

  it('reads disabled when the stream is bound but switched off', () => {
    expect(deriveStreamConnection(connection({ enabled: false }))).toBe('disabled');
  });

  it('reads not running when nothing is answering that could run the consumer', () => {
    expect(deriveStreamConnection(connection({ runtimeAnswering: false }))).toBe('not_running');
  });

  it('says nothing about the runtime while the stream is switched off', () => {
    expect(deriveStreamConnection(connection({ enabled: false, runtimeAnswering: false }))).toBe('disabled');
  });

  it('reads not running when the bound service account has been deactivated', () => {
    expect(deriveStreamConnection(connection({ serviceAccountActive: false }))).toBe('not_running');
  });

  it('reads connected on a bound, enabled stream with a live runtime', () => {
    expect(deriveStreamConnection(connection())).toBe('connected');
  });
});
