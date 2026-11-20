import type { DrizzleDB } from '@app/module';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRegisterFile = vi.fn();
const mockGetFile = vi.fn();

const mockWithOrigin = vi.fn().mockReturnValue({
  fileStorage: {
    registerFile: mockRegisterFile,
    getFile: mockGetFile,
  },
});

vi.mock('@app/module', () => ({
  fileStorageService: {},
  createServices: vi.fn().mockReturnValue({ withOrigin: mockWithOrigin }),
}));

const mockPutObject = vi.fn();
const mockGetObject = vi.fn();
const mockDeleteObject = vi.fn();

vi.mock('../../clients/file-storage', () => ({
  fileStorageClient: {
    putObject: mockPutObject,
    getObject: mockGetObject,
    deleteObject: mockDeleteObject,
  },
}));

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logTrace: vi.fn(),
    logFromError: vi.fn(),
  }),
}));

const { fileStorageOperations, FileNotFoundError } = await import('./file-storage-operations');
const { StructuredError } = await import('@app/utils');

const TENANT_ID = 'tenant-abc';
const USER_ID = 'user-123';
const FILE_ID = 'file-uuid-1';
const STORAGE_KEY = 'stored-key-uuid';

const CLIENT_ORIGIN = { type: 'client' as const, userId: USER_ID, tenantId: TENANT_ID };

const makeStream = (): Readable => Readable.from(['hello world']);

const makeFileRecord = (overrides: Record<string, unknown> = {}) => ({
  id: FILE_ID,
  tenantId: TENANT_ID,
  storageKey: STORAGE_KEY,
  originalName: 'bundle.json',
  mimeType: 'application/json',
  sizeBytes: 11,
  ...overrides,
});

const makeRegisterResult = (overrides: Record<string, unknown> = {}) => ({
  id: FILE_ID,
  tenantId: TENANT_ID,
  storageKey: STORAGE_KEY,
  originalName: 'bundle.json',
  mimeType: 'application/json',
  sizeBytes: 11,
  ...overrides,
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock; empty object satisfies DrizzleDB interface in practice
const db = {} as DrizzleDB;

describe('fileStorageOperations.writeFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPutObject.mockResolvedValue(undefined);
    mockRegisterFile.mockResolvedValue(makeRegisterResult());
  });

  it('uploads to the storage backend via putObject, then registers the metadata in DB', async () => {
    const input = { stream: makeStream(), sizeBytes: 11, originalName: 'bundle.json', mimeType: 'application/json' };

    const result = await fileStorageOperations.writeFile(db, CLIENT_ORIGIN, input);

    expect(mockPutObject).toHaveBeenCalledOnce();
    const [objectKey, , , contentLength] = mockPutObject.mock.calls[0];
    expect(objectKey).toMatch(new RegExp(`^${TENANT_ID}/`));
    expect(contentLength).toBe(11);
    expect(mockRegisterFile).toHaveBeenCalledOnce();
    expect(result.id).toBe(FILE_ID);
  });

  it('counts bytes and omits contentLength when sizeBytes is not provided', async () => {
    mockPutObject.mockImplementation(async (_key: string, body: Readable) => {
      for await (const _chunk of body) {
        // drain only
      }
    });
    const input = { stream: makeStream(), originalName: 'bundle.json', mimeType: 'application/json' };

    await fileStorageOperations.writeFile(db, CLIENT_ORIGIN, input);

    const [, , , contentLength] = mockPutObject.mock.calls[0];
    expect(contentLength).toBeUndefined();
    expect(mockRegisterFile).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ sizeBytes: 11 }));
  });

  it('wraps and rethrows when the DB insert fails, and cleans up the orphaned upload', async () => {
    mockRegisterFile.mockRejectedValue(new Error('DB error'));
    mockDeleteObject.mockResolvedValue(undefined);
    const input = { stream: makeStream(), sizeBytes: 11, originalName: 'bundle.json', mimeType: 'application/json' };

    await expect(fileStorageOperations.writeFile(db, CLIENT_ORIGIN, input)).rejects.toThrow('File storage is unavailable');
    const [objectKey] = mockPutObject.mock.calls[0];
    expect(mockDeleteObject).toHaveBeenCalledWith(objectKey);
  });

  it('still wraps and rethrows the original DB error when the cleanup delete itself fails', async () => {
    mockRegisterFile.mockRejectedValue(new Error('DB error'));
    mockDeleteObject.mockRejectedValue(new Error('storage delete failed'));
    const input = { stream: makeStream(), sizeBytes: 11, originalName: 'bundle.json', mimeType: 'application/json' };

    await expect(fileStorageOperations.writeFile(db, CLIENT_ORIGIN, input)).rejects.toThrow('File storage is unavailable');
  });

  it('propagates a disabled-client StructuredError as-is, without wrapping', async () => {
    mockPutObject.mockRejectedValue(new StructuredError('File storage is disabled', { data: {} }));
    const input = { stream: makeStream(), sizeBytes: 11, originalName: 'bundle.json', mimeType: 'application/json' };

    await expect(fileStorageOperations.writeFile(db, CLIENT_ORIGIN, input)).rejects.toThrow('File storage is disabled');
    expect(mockRegisterFile).not.toHaveBeenCalled();
  });

  it('wraps an unexpected putObject error as "File storage is unavailable"', async () => {
    mockPutObject.mockRejectedValue(new Error('storage outage'));
    const input = { stream: makeStream(), sizeBytes: 11, originalName: 'bundle.json', mimeType: 'application/json' };

    await expect(fileStorageOperations.writeFile(db, CLIENT_ORIGIN, input)).rejects.toThrow('File storage is unavailable');
  });
});

describe('fileStorageOperations.readFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetObject.mockResolvedValue(new Readable());
  });

  it('looks up the file then calls getObject with the tenant-scoped object key', async () => {
    const file = makeFileRecord();
    const stream = new Readable();
    mockGetFile.mockResolvedValue(file);
    mockGetObject.mockResolvedValue(stream);

    const result = await fileStorageOperations.readFile(db, CLIENT_ORIGIN, FILE_ID);

    expect(mockGetObject).toHaveBeenCalledWith(`${TENANT_ID}/${file.storageKey}`);
    expect(result.stream).toBe(stream);
    expect(result.originalName).toBe(file.originalName);
    expect(result.mimeType).toBe(file.mimeType);
  });

  it('throws a FileNotFoundError without calling getObject when the DB lookup misses', async () => {
    mockGetFile.mockResolvedValue(undefined);

    await expect(fileStorageOperations.readFile(db, CLIENT_ORIGIN, FILE_ID)).rejects.toBeInstanceOf(FileNotFoundError);
    expect(mockGetObject).not.toHaveBeenCalled();
  });

  it('wraps an unexpected getObject error as "File storage is unavailable"', async () => {
    mockGetFile.mockResolvedValue(makeFileRecord());
    mockGetObject.mockRejectedValue(new Error('storage outage'));

    await expect(fileStorageOperations.readFile(db, CLIENT_ORIGIN, FILE_ID)).rejects.toThrow('File storage is unavailable');
  });
});
