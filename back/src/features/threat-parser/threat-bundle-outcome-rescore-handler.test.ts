import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AppModule from '@app/module';
import type { JobContext } from '@app/module';
import { NonRetryableError } from '@app/module';
import { newError } from '@app/utils';
import type * as StoredBundle from './stored-bundle';
import type { ThreatBundleOutcomeRescorePayload } from './threat-bundle-outcome-rescore-handler';

const { mockReadStoredBundle, mockIngestBundle, mockMarkAttributedChildren, mockWithOrigin, mockLogWarn } = vi.hoisted(() => {
  const ingestBundle = vi.fn<(
    entries: Array<{ threat: { name: string } }>,
    tenantId: string,
    sourceKind: string,
    options: { onProbabilitiesChanged?: (stixId: string) => void },
  ) => Promise<unknown>>();
  const markAttributedChildren = vi.fn();
  return {
    mockReadStoredBundle: vi.fn(),
    mockLogWarn: vi.fn(),
    mockIngestBundle: ingestBundle,
    mockMarkAttributedChildren: markAttributedChildren,
    mockWithOrigin: vi.fn().mockReturnValue({ threatAnalyses: { ingestBundle }, openctiConnector: { markAttributedChildren } }),
  };
});

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({ logTrace: vi.fn(), logFromError: vi.fn(), logWarn: mockLogWarn }),
}));

vi.mock('@app/module', async () => ({
  ...await vi.importActual<typeof AppModule>('@app/module'),
  allServiceDefinitions: [],
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
}));

vi.mock('../../engines/db', () => ({ dbEngine: { db: {} } }));

vi.mock('../../services/file-storage', () => ({ fileStorageOperations: {}, FileNotFoundError: class extends Error {} }));

vi.mock('./stored-bundle', async () => ({
  ...await vi.importActual<typeof StoredBundle>('./stored-bundle'),
  readStoredBundle: mockReadStoredBundle,
}));

const { threatBundleOutcomeRescoreHandler } = await import('./threat-bundle-outcome-rescore-handler');

const threat = (stixId: string, name: string) => ({ threat: { stixId, name } });

const makeCtx = (payload: ThreatBundleOutcomeRescorePayload, signal = new AbortController().signal): JobContext<ThreatBundleOutcomeRescorePayload> => ({
  jobId: 'job-rescore-1',
  tenantId: 'tenant-abc',
  kind: 'threat-bundle-outcome-rescore',
  interactive: false,
  payload,
  attempt: 1,
  state: null,
  signal,
  updateProgress: vi.fn(),
  saveStateSnapshot: vi.fn(),
});

const ingestedNames = (): Array<Array<string>> =>
  mockIngestBundle.mock.calls.map(([entries]) => entries.map((entry) => entry.threat.name));

describe('threatBundleOutcomeRescoreHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIngestBundle.mockResolvedValue({ created: 0, updated: 0, unchanged: 0, skipped: 0 });
  });

  it('rescores a threat several files carry once, from the latest upload, and only the threats asked for', async () => {
    mockReadStoredBundle.mockImplementation((file: { storedFileId: string }) => Promise.resolve(file.storedFileId === 'old'
      ? [threat('intrusion-set--a', 'A from old'), threat('intrusion-set--mirrored', 'Mirrored')]
      : [threat('intrusion-set--a', 'A from new')]));

    await threatBundleOutcomeRescoreHandler(makeCtx({
      files: [{ storedFileId: 'old', userId: 'user-1' }, { storedFileId: 'new', userId: 'user-1' }],
      stixIds: ['intrusion-set--a'],
    }));

    expect(ingestedNames()).toEqual([['A from new']]);
    expect(mockIngestBundle).toHaveBeenCalledWith(expect.anything(), 'tenant-abc', 'stix-import', expect.objectContaining({ rescoreOnly: true }));
  });

  it('rescores each threat under the author of the file it was taken from', async () => {
    mockReadStoredBundle.mockImplementation((file: { storedFileId: string }) => Promise.resolve(file.storedFileId === 'uploaded'
      ? [threat('intrusion-set--a', 'A')]
      : [threat('intrusion-set--b', 'B')]));

    await threatBundleOutcomeRescoreHandler(makeCtx({
      files: [{ storedFileId: 'uploaded', userId: 'user-1' }, { storedFileId: 'pushed', serviceAccountId: 'sa-1' }],
      stixIds: ['intrusion-set--a', 'intrusion-set--b'],
    }));

    expect(mockWithOrigin).toHaveBeenCalledWith({ type: 'client', userId: 'user-1', tenantId: 'tenant-abc' });
    expect(mockWithOrigin).toHaveBeenCalledWith({ type: 'connector', serviceAccountId: 'sa-1', tenantId: 'tenant-abc' });
    expect(mockIngestBundle).toHaveBeenCalledWith(expect.anything(), 'tenant-abc', 'connector', expect.objectContaining({ rescoreOnly: true }));
    expect(ingestedNames()).toEqual([['A'], ['B']]);
  });

  it('marks for rebuild the mirror campaigns under the threats whose percentages moved, even when the rescore fails midway', async () => {
    mockReadStoredBundle.mockResolvedValueOnce([threat('intrusion-set--a', 'A'), threat('intrusion-set--b', 'B')]);
    const failure = newError('Database went away', {});
    mockIngestBundle.mockImplementationOnce((_entries, _tenantId, _sourceKind, options) => {
      options.onProbabilitiesChanged?.('intrusion-set--a');
      return Promise.reject(failure);
    });

    await expect(threatBundleOutcomeRescoreHandler(makeCtx({
      files: [{ storedFileId: 'f1', userId: 'user-1' }],
      stixIds: ['intrusion-set--a', 'intrusion-set--b'],
    }))).rejects.toBe(failure);

    expect(mockMarkAttributedChildren).toHaveBeenCalledWith('tenant-abc', ['intrusion-set--a']);
  });

  it('warns about the threats no stored file carries, and only those', async () => {
    mockReadStoredBundle.mockResolvedValueOnce([threat('intrusion-set--a', 'A')]);

    await threatBundleOutcomeRescoreHandler(makeCtx({
      files: [{ storedFileId: 'f1', userId: 'user-1' }],
      stixIds: ['intrusion-set--a', 'intrusion-set--gone'],
    }));

    expect(mockLogWarn).toHaveBeenCalledOnce();
    expect(mockLogWarn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ count: 1, stixIds: ['intrusion-set--gone'] }));
    expect(ingestedNames()).toEqual([['A']]);
  });

  it('skips a file that is gone and still rescores what the others carry', async () => {
    mockReadStoredBundle.mockImplementation((file: { storedFileId: string }) => file.storedFileId === 'gone'
      ? Promise.reject(new NonRetryableError('STIX bundle file not found in storage'))
      : Promise.resolve([threat('intrusion-set--a', 'A')]));

    await threatBundleOutcomeRescoreHandler(makeCtx({
      files: [{ storedFileId: 'gone', userId: 'user-1' }, { storedFileId: 'kept', userId: 'user-1' }],
      stixIds: ['intrusion-set--a'],
    }));

    expect(ingestedNames()).toEqual([['A']]);
  });

  it('rethrows a storage error a retry can fix, before writing anything', async () => {
    const unavailable = newError('File storage is unavailable', {});
    mockReadStoredBundle.mockRejectedValueOnce(unavailable);

    await expect(threatBundleOutcomeRescoreHandler(makeCtx({
      files: [{ storedFileId: 'f1', userId: 'user-1' }],
      stixIds: ['intrusion-set--a'],
    }))).rejects.toBe(unavailable);
    expect(mockIngestBundle).not.toHaveBeenCalled();
  });

  it('writes nothing once aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await threatBundleOutcomeRescoreHandler(makeCtx({ files: [{ storedFileId: 'f1', userId: 'user-1' }], stixIds: ['intrusion-set--a'] }, controller.signal));

    expect(mockReadStoredBundle).not.toHaveBeenCalled();
    expect(mockIngestBundle).not.toHaveBeenCalled();
  });
});
