import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateObjectStorageProvider = vi.fn();

let currentFileStorageConfig: Record<string, unknown> | undefined;

vi.mock('../../config', () => ({
  config: vi.fn(() => ({ file_storage: currentFileStorageConfig })),
}));

vi.mock('./object-storage-provider', () => ({
  createObjectStorageProvider: mockCreateObjectStorageProvider,
}));

const mockLogFromError = vi.fn();
const mockLogFromFatalError = vi.fn();

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    logTrace: vi.fn(),
    logFromError: mockLogFromError,
    logFromFatalError: mockLogFromFatalError,
  })),
}));

const CONFIGURED = {
  endpoint: 'http://localhost:9000',
  access_key: 'test-key',
  secret_key: 'test-secret',
  bucket: 'test-bucket',
  region: 'us-east-1',
};

const mockInitialize = vi.fn();
const mockPutObject = vi.fn();
const mockGetObject = vi.fn();
const mockDeleteObject = vi.fn();

const mockProvider = {
  initialize: mockInitialize,
  putObject: mockPutObject,
  getObject: mockGetObject,
  deleteObject: mockDeleteObject,
};

// Since `getProvider`/`ensureInitialized` are module-level memoized singletons, each scenario
// needs a fresh module instance — vi.resetModules() + a dynamic import, mirroring the technique
// used elsewhere in the repo for config-driven singletons.
const importFreshClient = async (fileStorageConfig: Record<string, unknown> | undefined) => {
  currentFileStorageConfig = fileStorageConfig;
  vi.resetModules();
  return import('./file-storage-client');
};

describe('fileStorageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateObjectStorageProvider.mockReturnValue(mockProvider);
    mockInitialize.mockResolvedValue(undefined);
    mockPutObject.mockResolvedValue(undefined);
    mockGetObject.mockResolvedValue(new Readable());
    mockDeleteObject.mockResolvedValue(undefined);
  });

  afterEach(() => {
    currentFileStorageConfig = undefined;
  });

  describe('disabled (no file_storage config)', () => {
    it('putObject throws "File storage is disabled" without building a provider', async () => {
      const { fileStorageClient } = await importFreshClient(undefined);

      await expect(fileStorageClient.putObject('key', Buffer.from('x'), 'text/plain')).rejects.toThrow('File storage is disabled');
      expect(mockCreateObjectStorageProvider).not.toHaveBeenCalled();
    });

    it('getObject throws "File storage is disabled" without building a provider', async () => {
      const { fileStorageClient } = await importFreshClient(undefined);

      await expect(fileStorageClient.getObject('key')).rejects.toThrow('File storage is disabled');
      expect(mockCreateObjectStorageProvider).not.toHaveBeenCalled();
    });

    it('checkStartupConfig is a no-op', async () => {
      const { fileStorageClient } = await importFreshClient(undefined);

      fileStorageClient.checkStartupConfig();
      await Promise.resolve();

      expect(mockLogFromFatalError).not.toHaveBeenCalled();
      expect(mockLogFromError).not.toHaveBeenCalled();
    });

    it('deleteObject silently no-ops without building a provider', async () => {
      const { fileStorageClient } = await importFreshClient(undefined);

      await fileStorageClient.deleteObject('key');

      expect(mockCreateObjectStorageProvider).not.toHaveBeenCalled();
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });
  });

  describe('configured + healthy', () => {
    it('initializes once (memoized) then delegates every putObject call to the provider', async () => {
      const { fileStorageClient } = await importFreshClient(CONFIGURED);

      await fileStorageClient.putObject('key-1', Buffer.from('x'), 'text/plain', 1);
      await fileStorageClient.putObject('key-2', Buffer.from('y'), 'text/plain', 1);

      expect(mockInitialize).toHaveBeenCalledOnce();
      expect(mockPutObject).toHaveBeenCalledTimes(2);
    });

    it('getObject delegates to the provider and returns its stream', async () => {
      const stream = new Readable();
      mockGetObject.mockResolvedValue(stream);
      const { fileStorageClient } = await importFreshClient(CONFIGURED);

      const result = await fileStorageClient.getObject('key');

      expect(result).toBe(stream);
    });

    it('deleteObject delegates to the provider', async () => {
      const { fileStorageClient } = await importFreshClient(CONFIGURED);

      await fileStorageClient.deleteObject('key');

      expect(mockDeleteObject).toHaveBeenCalledWith('key');
    });
  });

  describe('checkStartupConfig — config-looking init failure', () => {
    it('crashes via logFromFatalError, never logFromError', async () => {
      mockInitialize.mockRejectedValue(new Error('bucket not found'));
      const { fileStorageClient } = await importFreshClient(CONFIGURED);

      fileStorageClient.checkStartupConfig();
      await vi.waitFor(() => expect(mockLogFromFatalError).toHaveBeenCalledOnce());

      expect(mockLogFromError).not.toHaveBeenCalled();
    });
  });

  describe('checkStartupConfig — connectivity-looking init failure', () => {
    it('only logs via logFromError, never crashes', async () => {
      const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      mockInitialize.mockRejectedValue(err);
      const { fileStorageClient } = await importFreshClient(CONFIGURED);

      fileStorageClient.checkStartupConfig();
      await vi.waitFor(() => expect(mockLogFromError).toHaveBeenCalledOnce());

      expect(mockLogFromFatalError).not.toHaveBeenCalled();
    });

    it('resets the cached init promise so the next real call retries naturally', async () => {
      const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      mockInitialize.mockRejectedValueOnce(err);
      const { fileStorageClient } = await importFreshClient(CONFIGURED);

      fileStorageClient.checkStartupConfig();
      await vi.waitFor(() => expect(mockLogFromError).toHaveBeenCalledOnce());

      mockInitialize.mockResolvedValueOnce(undefined);
      await fileStorageClient.putObject('key', Buffer.from('x'), 'text/plain', 1);

      expect(mockInitialize).toHaveBeenCalledTimes(2);
      expect(mockPutObject).toHaveBeenCalledOnce();
    });
  });
});
