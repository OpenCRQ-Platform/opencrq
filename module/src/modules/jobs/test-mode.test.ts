import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInlineEnqueueWrapper, enableInlineMode, isInlineMode } from './test-mode';

afterEach(() => {
  enableInlineMode(false);
});

describe('inline mode toggle', () => {
  it('is disabled by default', () => {
    expect(isInlineMode()).toBe(false);
  });

  it('reflects enable / disable calls', () => {
    enableInlineMode(true);
    expect(isInlineMode()).toBe(true);
    enableInlineMode(false);
    expect(isInlineMode()).toBe(false);
  });
});

describe('createInlineEnqueueWrapper', () => {
  it('delegates to underlying enqueueJob when inline mode is off', async () => {
    enableInlineMode(false);
    const enqueueJob = vi.fn().mockResolvedValue({ jobId: 'real-id', alreadyExisted: false });
    const wrapped = createInlineEnqueueWrapper({
      getHandler: () => undefined,
      enqueueJob,
    });

    const result = await wrapped({ kind: 'k', tenantId: 't', payload: {} });

    expect(enqueueJob).toHaveBeenCalledWith({ kind: 'k', tenantId: 't', payload: {} });
    expect(result).toEqual({ jobId: 'real-id', alreadyExisted: false });
  });

  it('runs the handler synchronously when inline mode is on', async () => {
    enableInlineMode(true);
    const handler = vi.fn().mockResolvedValue(undefined);
    const enqueueJob = vi.fn();
    const wrapped = createInlineEnqueueWrapper({
      getHandler: () => handler,
      enqueueJob,
    });

    const result = await wrapped({ kind: 'k', tenantId: 't', payload: { x: 1 } });

    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0][0];
    expect(ctx.kind).toBe('k');
    expect(ctx.tenantId).toBe('t');
    expect(ctx.payload).toEqual({ x: 1 });
    expect(ctx.attempt).toBe(1);
    expect(ctx.state).toBeNull();
    expect(typeof ctx.jobId).toBe('string');
    expect(ctx.signal).toBeInstanceOf(AbortSignal);
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(result.alreadyExisted).toBe(false);
  });

  it('throws when inline mode is on but no handler is registered', async () => {
    enableInlineMode(true);
    const wrapped = createInlineEnqueueWrapper({
      getHandler: () => undefined,
      enqueueJob: vi.fn(),
    });

    await expect(
      wrapped({ kind: 'missing', tenantId: 't', payload: {} }),
    ).rejects.toThrow();
  });

  it('handler can call updateProgress and saveStateSnapshot without throwing', async () => {
    enableInlineMode(true);
    const handler = vi.fn(async (ctx) => {
      await ctx.updateProgress({ processedTotal: 5 });
      await ctx.saveStateSnapshot({ cursor: 'abc' });
    });
    const wrapped = createInlineEnqueueWrapper({
      getHandler: () => handler,
      enqueueJob: vi.fn(),
    });

    await wrapped({ kind: 'k', tenantId: 't', payload: {} });

    expect(handler).toHaveBeenCalled();
  });

  it('propagates handler errors', async () => {
    enableInlineMode(true);
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapped = createInlineEnqueueWrapper({
      getHandler: () => handler,
      enqueueJob: vi.fn(),
    });

    await expect(wrapped({ kind: 'k', tenantId: 't', payload: {} })).rejects.toThrow('boom');
  });
});
