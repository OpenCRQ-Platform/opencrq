import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedLogLine } from './log-capture';
import { runInExecutionScope } from './execution-scope';
import { captureLine, describeError, endLogScope, flushLogCapture, installLogCapture, uninstallLogCapture } from './log-capture';

const scope = {
  scopeId: 'job-1',
  scopeKind: 'drata-sync',
  tenantId: 'tenant-a',
  jobId: 'job-1',
  retention: 'on-scope-end' as const,
};

const streamScope = {
  scopeId: 'session-1',
  scopeKind: 'opencti-stream',
  tenantId: 'tenant-a',
  jobId: null,
  retention: 'rolling' as const,
};

let written: Array<CapturedLogLine> = [];

const install = (writer = async (lines: ReadonlyArray<CapturedLogLine>): Promise<void> => {
  written.push(...lines);
  return Promise.resolve();
}): void => installLogCapture(writer);

beforeEach(() => {
  written = [];
});

afterEach(() => {
  uninstallLogCapture();
  vi.restoreAllMocks();
});

describe('log capture', () => {
  it('attributes a line to the scope it was written in', async () => {
    install();

    await runInExecutionScope(scope, async () => {
      captureLine({ level: 'trace', message: 'Starting Drata sync' });
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      tenantId: 'tenant-a',
      jobId: 'job-1',
      scopeId: 'job-1',
      scopeKind: 'drata-sync',
      level: 'trace',
      message: 'Starting Drata sync',
      detail: null,
    });
  });

  it('drops a line written outside any scope', async () => {
    install();

    captureLine({ level: 'error', message: 'Boot failed' });
    await flushLogCapture();

    expect(written).toEqual([]);
  });

  it('drops every line while no capture is installed', async () => {
    await runInExecutionScope(scope, async () => {
      captureLine({ level: 'trace', message: 'orphan' });
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written).toEqual([]);
  });

  it('keeps the error text beside the line that reported it', async () => {
    install();

    await runInExecutionScope(scope, async () => {
      captureLine({ level: 'error', message: 'Drata sync failed', error: new TypeError('429 Too Many Requests') });
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written[0].detail).toBe('TypeError: 429 Too Many Requests');
  });

  it('stops capturing a scope that writes without bound, and says so once', async () => {
    install();

    await runInExecutionScope(scope, async () => {
      for (let i = 0; i < 2_010; i += 1) {
        captureLine({ level: 'trace', message: `line ${i}` });
      }
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written).toHaveLength(2_001);
    expect(written.at(-1)?.message).toBe('Log capture stopped here: this run wrote too many lines');
  });

  it('keeps capturing a rolling scope past the ceiling, since its store trims on every write', async () => {
    install();

    await runInExecutionScope(streamScope, async () => {
      for (let i = 0; i < 2_010; i += 1) {
        captureLine({ level: 'trace', message: `line ${i}` });
      }
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written).toHaveLength(2_010);
    expect(written.at(-1)?.message).toBe('line 2009');
  });

  it('masks a credential a third party echoed back into an error body', async () => {
    install();

    await runInExecutionScope(scope, async () => {
      captureLine({
        level: 'error',
        message: 'Drata sync failed',
        error: new Error('Drata auth error (401): {"apiKey":"drt_live_9f3ab2c7","hint":"rotate it"}'),
      });
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written[0].detail).toBe('Drata auth error (401): {"apiKey":"[redacted]","hint":"rotate it"}');
  });

  it('masks a bearer token before the header name swallows it', async () => {
    install();

    await runInExecutionScope(scope, async () => {
      captureLine({ level: 'error', message: 'Rejected Authorization: Bearer abc123def456ghi' });
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written[0].message).toBe('Rejected Authorization: Bearer [redacted]');
  });

  it('masks a basic credential and a key carrying a prefix, which a word boundary alone misses', async () => {
    install();

    await runInExecutionScope(scope, async () => {
      captureLine({ level: 'error', message: 'Rejected Authorization: Basic dXNlcjpwYXNzd29yZA==' });
      captureLine({ level: 'error', message: 'Token endpoint answered {"access_token":"AbCdEf123456","refresh_token":"ZyXwVu987654","expires_in":3600}' });
      captureLine({ level: 'error', message: 'Header AccessToken=verysecretvalue1234 rejected' });
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written.map((line) => line.message)).toEqual([
      'Rejected Authorization: Basic [redacted]',
      'Token endpoint answered {"access_token":"[redacted]","refresh_token":"[redacted]","expires_in":3600}',
      'Header AccessToken=[redacted] rejected',
    ]);
  });

  it('captures again for a scope id reused after its scope ended', async () => {
    install();

    await runInExecutionScope(scope, async () => {
      for (let i = 0; i < 2_010; i += 1) {
        captureLine({ level: 'trace', message: `line ${i}` });
      }
      return Promise.resolve();
    });
    await endLogScope(scope.scopeId);
    written = [];

    await runInExecutionScope(scope, async () => {
      captureLine({ level: 'trace', message: 'a later run' });
      return Promise.resolve();
    });
    await flushLogCapture();

    expect(written.map((line) => line.message)).toEqual(['a later run']);
  });

  it('reports a failed write on the console, never through the logger it serves', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    install(() => Promise.reject(new Error('database is down')));

    await runInExecutionScope(scope, async () => {
      captureLine({ level: 'trace', message: 'a line nobody will read' });
      return Promise.resolve();
    });

    await expect(flushLogCapture()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0][0]).toContain('database is down');
  });

  it('writes one batch for the lines of two concurrent scopes', async () => {
    const batches: Array<number> = [];
    install(async (lines) => {
      batches.push(lines.length);
      written.push(...lines);
      return Promise.resolve();
    });

    await Promise.all([
      runInExecutionScope(scope, async () => {
        captureLine({ level: 'trace', message: 'from a' });
        return Promise.resolve();
      }),
      runInExecutionScope({ ...scope, scopeId: 'job-2', jobId: 'job-2', tenantId: 'tenant-b' }, async () => {
        captureLine({ level: 'trace', message: 'from b' });
        return Promise.resolve();
      }),
    ]);
    await flushLogCapture();

    expect(batches).toEqual([2]);
    expect(written.map((line) => line.tenantId)).toEqual(['tenant-a', 'tenant-b']);
  });
});

describe('describeError', () => {
  it('names the error and its message', () => {
    expect(describeError(new TypeError('boom'))).toBe('TypeError: boom');
  });

  it('drops the bare Error name, which says nothing', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('follows the cause chain', () => {
    const error = new Error('outer', { cause: new TypeError('inner') });

    expect(describeError(error)).toBe('outer | caused by: TypeError: inner');
  });

  it('renders what was thrown when it is not an error', () => {
    expect(describeError('a string')).toBe('a string');
  });
});
