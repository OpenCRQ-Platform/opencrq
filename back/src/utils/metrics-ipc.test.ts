import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogError = vi.fn();
const mockLogFromError = vi.fn();

vi.mock('./logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logError: mockLogError, logFromError: mockLogFromError }),
}));

const { onMetricsCollect, onMetricsCollected, sendMetricsCollect, sendMetricsSnapshot } = await import('./metrics-ipc');

describe('onMetricsCollect', () => {
  beforeEach(() => {
    mockLogFromError.mockClear();
  });

  it('ignores a heartbeat-shaped message', () => {
    const collect = vi.fn();
    onMetricsCollect(collect)({ type: 'heartbeat', time: Date.now(), status: 'RUNNING' });
    expect(collect).not.toHaveBeenCalled();
  });

  it('ignores a metrics-collected-shaped message (the parent-side shape)', () => {
    const collect = vi.fn();
    onMetricsCollect(collect)({ type: 'metrics-collected', roundId: 'round-1', text: '' });
    expect(collect).not.toHaveBeenCalled();
  });

  it('invokes the collect callback for a well-formed metrics-collect message', () => {
    const collect = vi.fn().mockResolvedValue(undefined);
    onMetricsCollect(collect)({ type: 'metrics-collect', roundId: 'round-1' });
    expect(collect).toHaveBeenCalledWith('round-1');
  });

  it('logs, and does not throw, when the collect callback rejects', async () => {
    const collect = vi.fn().mockRejectedValue(new Error('boom'));
    expect(() => onMetricsCollect(collect)({ type: 'metrics-collect', roundId: 'round-1' })).not.toThrow();
    await vi.waitFor(() => expect(mockLogFromError).toHaveBeenCalledWith(expect.any(Error), expect.any(String), { roundId: 'round-1' }));
  });
});

describe('onMetricsCollected', () => {
  it('ignores a heartbeat-shaped message', () => {
    const cb = vi.fn();
    onMetricsCollected(cb)({ type: 'heartbeat', time: Date.now(), status: 'RUNNING' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('ignores a metrics-collect-shaped message (the child-side shape)', () => {
    const cb = vi.fn();
    onMetricsCollected(cb)({ type: 'metrics-collect', roundId: 'round-1' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('invokes the callback for a well-formed metrics-collected message', () => {
    const cb = vi.fn();
    onMetricsCollected(cb)({ type: 'metrics-collected', roundId: 'round-1', text: 'some text', oversized: false });
    expect(cb).toHaveBeenCalledWith('round-1', 'some text', false);
  });

  it('ignores a metrics-collected message that carries no oversized flag', () => {
    const cb = vi.fn();
    onMetricsCollected(cb)({ type: 'metrics-collected', roundId: 'round-1', text: 'some text' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('absorbs a throw from the reply handler, which would otherwise surface as an uncaught exception on the emitter', () => {
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });

    expect(() => onMetricsCollected(throwing)({ type: 'metrics-collected', roundId: 'round-1', text: '', oversized: false })).not.toThrow();
    expect(mockLogFromError).toHaveBeenCalledWith(expect.any(Error), expect.any(String), { roundId: 'round-1' });
  });
});

describe('sendMetricsCollect', () => {
  it('does not call .send and does not throw against a disconnected child', () => {
    const send = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal ChildProcess stub, only `connected`/`send` are exercised
    const child = { connected: false, send } as unknown as ChildProcess;
    expect(() => sendMetricsCollect(child, 'round-1')).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns false against a disconnected child', () => {
    const send = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal ChildProcess stub, only `connected`/`send` are exercised
    const child = { connected: false, send } as unknown as ChildProcess;
    expect(sendMetricsCollect(child, 'round-1')).toBe(false);
  });

  it('sends metrics-collect against a connected child, and returns true', () => {
    const send = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal ChildProcess stub, only `connected`/`send` are exercised
    const child = { connected: true, send } as unknown as ChildProcess;
    expect(sendMetricsCollect(child, 'round-1')).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: 'metrics-collect', roundId: 'round-1' });
  });

  it('logs, does not throw, and returns false, when send throws synchronously', () => {
    const send = vi.fn(() => {
      throw new Error('channel closed');
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal ChildProcess stub, only `connected`/`send` are exercised
    const child = { connected: true, send } as unknown as ChildProcess;
    let result: boolean | undefined;
    expect(() => {
      result = sendMetricsCollect(child, 'round-1'); 
    }).not.toThrow();
    expect(result).toBe(false);
    expect(mockLogFromError).toHaveBeenCalledWith(expect.any(Error), expect.any(String), { roundId: 'round-1' });
  });
});

describe('sendMetricsSnapshot', () => {
  const originalSend = process.send;

  afterEach(() => {
    process.send = originalSend;
  });

  it('logs, and does not throw, when process.send throws synchronously', () => {
    process.send = vi.fn(() => {
      throw new Error('channel closed');
    });
    expect(() => sendMetricsSnapshot('round-1', 'text', 1_024)).not.toThrow();
    expect(mockLogFromError).toHaveBeenCalledWith(expect.any(Error), expect.any(String), { roundId: 'round-1' });
  });

  it('does not throw when process.send is undefined', () => {
    process.send = undefined;
    expect(() => sendMetricsSnapshot('round-1', 'text', 1_024)).not.toThrow();
  });

  it('refuses a document above the limit at the sending end, flagging it rather than putting it on the channel', () => {
    const send = vi.fn();
    process.send = send;

    sendMetricsSnapshot('round-1', 'a'.repeat(64), 10);

    expect(send).toHaveBeenCalledWith({ type: 'metrics-collected', roundId: 'round-1', text: '', oversized: true });
  });
});
