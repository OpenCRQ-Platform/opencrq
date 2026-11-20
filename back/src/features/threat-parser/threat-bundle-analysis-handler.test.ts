import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AppModule from '@app/module';
import type { JobContext } from '@app/module';
import { fromError, newError } from '@app/utils';
import type { ThreatBundlePayload } from './stored-bundle';

const mockReadFile = vi.fn();
const mockIngestBundle = vi.fn();
const mockUpdateProgress = vi.fn();
const mockMarkAttributedChildren = vi.fn();

const mockWithOrigin = vi.fn().mockReturnValue({
  threatAnalyses: {
    ingestBundle: mockIngestBundle,
  },
  openctiConnector: {
    markAttributedChildren: mockMarkAttributedChildren,
  },
});

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logTrace: vi.fn(),
    logFromError: vi.fn(),
  }),
}));

vi.mock('@app/module', async () => ({
  ...await vi.importActual<typeof AppModule>('@app/module'),
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
}));

vi.mock('../../engines/db', () => ({
  dbEngine: { db: {} },
}));

// Minimal stand-in mirroring the real `FileNotFoundError` (see `services/file-storage/
// file-storage-operations.ts`): keeps this test independent of the real client/config chain
// while still exercising the same `instanceof` check the handler performs.
class FileNotFoundError extends Error {
  constructor(fileId: string) {
    super(`File not found {"fileId":"${fileId}"}`);
    this.name = 'FileNotFoundError';
  }
}

vi.mock('../../services/file-storage', () => ({
  fileStorageOperations: { readFile: mockReadFile },
  FileNotFoundError,
}));

const { threatBundleAnalysisHandler } = await import('./threat-bundle-analysis-handler');

const makeCtx = (overrides: Partial<JobContext<ThreatBundlePayload>> = {}): JobContext<ThreatBundlePayload> => ({
  jobId: 'job-threat-1',
  tenantId: 'tenant-abc',
  kind: 'threat-bundle-analysis',
  interactive: true,
  payload: { storedFileId: 'file-1', userId: 'user-123' },
  attempt: 1,
  state: null,
  signal: new AbortController().signal,
  updateProgress: mockUpdateProgress,
  saveStateSnapshot: vi.fn(),
  ...overrides,
});

const validBundle = { type: 'bundle', id: 'bundle--1', objects: [] };

describe('threatBundleAnalysisHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIngestBundle.mockResolvedValue({ created: 0, updated: 0, unchanged: 0 });
    mockMarkAttributedChildren.mockResolvedValue(0);
  });

  it('returns immediately without reading the file when signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await threatBundleAnalysisHandler(makeCtx({ signal: ctrl.signal }));

    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('parses the downloaded bundle and calls ingestBundle', async () => {
    mockReadFile.mockResolvedValueOnce({ stream: Readable.from([JSON.stringify(validBundle)]) });

    await threatBundleAnalysisHandler(makeCtx());

    expect(mockIngestBundle).toHaveBeenCalledOnce();
  });

  // The source kind is what the canonical ranking and the sources panel read to say which feed
  // stated what.
  it('attributes an uploaded bundle to the stix-import source and a connector run to the connector source', async () => {
    // A fresh stream per call: the handler drains it, so a single shared instance would reach the
    // second invocation already exhausted.
    mockReadFile.mockImplementation(() => Promise.resolve({ stream: Readable.from([JSON.stringify(validBundle)]) }));

    await threatBundleAnalysisHandler(makeCtx());
    expect(mockIngestBundle).toHaveBeenLastCalledWith(expect.anything(), 'tenant-abc', 'stix-import', expect.anything());

    await threatBundleAnalysisHandler(makeCtx({
      payload: { storedFileId: 'file-1', serviceAccountId: 'service-account-1' },
    }));
    expect(mockIngestBundle).toHaveBeenLastCalledWith(expect.anything(), 'tenant-abc', 'connector', expect.anything());
  });

  // `threat_analyses` is one row per tenant and STIX id, so a campaign the OpenCTI mirror holds under an
  // uploaded group reads the percentages the upload gives it.
  it('marks the mirror\'s campaigns attributed to the threats whose percentages the upload moved', async () => {
    mockReadFile.mockResolvedValueOnce({ stream: Readable.from([JSON.stringify(validBundle)]) });
    mockIngestBundle.mockImplementationOnce((_parsed, _tenantId, _kind, options: { onProbabilitiesChanged: (stixId: string) => void }) => {
      options.onProbabilitiesChanged('intrusion-set--a');
      options.onProbabilitiesChanged('intrusion-set--b');
      return Promise.resolve({ created: 0, updated: 2 });
    });

    await threatBundleAnalysisHandler(makeCtx());

    expect(mockMarkAttributedChildren).toHaveBeenCalledExactlyOnceWith('tenant-abc', ['intrusion-set--a', 'intrusion-set--b']);
  });

  it('marks the threats it moved before an ingestion that failed midway, and rethrows the failure', async () => {
    mockReadFile.mockResolvedValueOnce({ stream: Readable.from([JSON.stringify(validBundle)]) });
    const failure = new Error('database went away');
    mockIngestBundle.mockImplementationOnce((_parsed, _tenantId, _kind, options: { onProbabilitiesChanged: (stixId: string) => void }) => {
      options.onProbabilitiesChanged('intrusion-set--a');
      return Promise.reject(failure);
    });

    await expect(threatBundleAnalysisHandler(makeCtx())).rejects.toBe(failure);

    expect(mockMarkAttributedChildren).toHaveBeenCalledExactlyOnceWith('tenant-abc', ['intrusion-set--a']);
  });

  it('rethrows a FileNotFoundError from readFile as NonRetryableError', async () => {
    mockReadFile.mockRejectedValueOnce(new FileNotFoundError('file-1'));

    await expect(threatBundleAnalysisHandler(makeCtx())).rejects.toMatchObject({
      name: 'NonRetryableError',
      message: 'STIX bundle file not found in storage',
    });
  });

  it('leaves a "File storage is disabled" readFile error retryable', async () => {
    const disabledError = newError('File storage is disabled', {});
    mockReadFile.mockRejectedValueOnce(disabledError);

    await expect(threatBundleAnalysisHandler(makeCtx())).rejects.toBe(disabledError);
  });

  it('leaves a "File storage is unavailable" readFile error retryable', async () => {
    const unavailableError = fromError(new Error('S3 outage'), 'File storage is unavailable', { tenantId: 'tenant-abc' });
    mockReadFile.mockRejectedValueOnce(unavailableError);

    await expect(threatBundleAnalysisHandler(makeCtx())).rejects.toBe(unavailableError);
  });

  it('throws a NonRetryableError for invalid JSON without touching the readFile error path', async () => {
    mockReadFile.mockResolvedValueOnce({ stream: Readable.from(['not json']) });

    await expect(threatBundleAnalysisHandler(makeCtx())).rejects.toThrow('Invalid STIX bundle: not valid JSON');
  });
});
