import { describe, expect, it, vi } from 'vitest';
import type { DescribedStream } from '../app-router/opencti/opencti-stream-filter-utils';
import type { ManagedStreamDeps } from './opencti-managed-stream';
import { describeStream } from '../app-router/opencti/opencti-stream-filter-utils';
import {
  CANONICAL_STREAM_FILTER_JSON,
  ensureManagedStream,
  findManagedStream,
  holdsStreamCapability,
  MANAGED_STREAM_NAME,
  managedStreamDescription,
  managedStreamVersion,
  openctiManagedStreamCalls,
} from './opencti-managed-stream';

const CONNECTION = { url: 'https://opencti.example/', token: 'tok' };

const stream = (id: string, description: string | null, filters: string | null): DescribedStream =>
  describeStream({ id, name: id, description, filters, stream_live: true });

const fakeDeps = (streams: Array<DescribedStream>, capabilities: Array<string> = ['KNOWLEDGE', 'TAXIIAPI_SETCOLLECTIONS']): ManagedStreamDeps => ({
  listStreams: vi.fn().mockResolvedValue(streams),
  readCapabilities: vi.fn().mockResolvedValue(capabilities),
  createStream: vi.fn().mockResolvedValue('created-id'),
  updateStream: vi.fn().mockResolvedValue(undefined),
});

describe('the canonical filter', () => {
  it('is judged to deliver every claim the parser reads', () => {
    expect(stream('s', null, CANONICAL_STREAM_FILTER_JSON).verdict).toBe('delivers');
  });

  it('admits reports and uses to a malware, which the model reads', () => {
    expect(CANONICAL_STREAM_FILTER_JSON).toContain('"Report"');
    expect(CANONICAL_STREAM_FILTER_JSON).toContain('"Malware"');
  });
});

describe('managedStreamVersion', () => {
  it('reads the marker of the description, and nothing from a stream OpenCRQ does not manage', () => {
    expect(managedStreamVersion(managedStreamDescription())).toBe(1);
    expect(managedStreamVersion('[opencrq-managed-stream:v0]')).toBe(0);
    expect(managedStreamVersion(`${MANAGED_STREAM_NAME}, by an admin`)).toBeNull();
    expect(managedStreamVersion(null)).toBeNull();
  });
});

describe('findManagedStream', () => {
  it('matches the marker, never the name alone', () => {
    const lookalike = describeStream({ id: 'a', name: MANAGED_STREAM_NAME, description: 'made by hand', filters: null });
    expect(findManagedStream([lookalike])).toBeNull();
  });

  it('prefers the newest marker when an older release left a duplicate', () => {
    const found = findManagedStream([stream('old', '[opencrq-managed-stream:v0]', null), stream('new', managedStreamDescription(), null)]);
    expect(found?.id).toBe('new');
  });
});

describe('holdsStreamCapability', () => {
  it('accepts the stream capability, its parent path and BYPASS', () => {
    expect(holdsStreamCapability(['TAXIIAPI_SETCOLLECTIONS'])).toBe(true);
    expect(holdsStreamCapability(['BYPASS'])).toBe(true);
    expect(holdsStreamCapability(['KNOWLEDGE', 'TAXIIAPI'])).toBe(false);
  });
});

describe('ensureManagedStream', () => {
  it('creates the stream with the canonical filter when none exists', async () => {
    const deps = fakeDeps([stream('other', 'an admin stream', null)]);
    await expect(ensureManagedStream(deps, CONNECTION)).resolves.toEqual({ kind: 'created', streamId: 'created-id' });
    expect(deps.createStream).toHaveBeenCalledWith(CONNECTION, {
      name: MANAGED_STREAM_NAME,
      description: managedStreamDescription(),
      filters: CANONICAL_STREAM_FILTER_JSON,
    });
  });

  it('reuses a current stream without asking for the capability, so a restart creates no duplicate', async () => {
    const deps = fakeDeps([stream('mine', managedStreamDescription(), CANONICAL_STREAM_FILTER_JSON)], []);
    await expect(ensureManagedStream(deps, CONNECTION)).resolves.toEqual({ kind: 'unchanged', streamId: 'mine' });
    expect(deps.readCapabilities).not.toHaveBeenCalled();
    expect(deps.createStream).not.toHaveBeenCalled();
    expect(deps.updateStream).not.toHaveBeenCalled();
  });

  it('updates a stream carrying an older canonical version', async () => {
    const deps = fakeDeps([stream('mine', '[opencrq-managed-stream:v0]', '{"mode":"or","filters":[],"filterGroups":[]}')]);
    await expect(ensureManagedStream(deps, CONNECTION)).resolves.toEqual({ kind: 'updated', streamId: 'mine' });
    expect(deps.updateStream).toHaveBeenCalledWith(CONNECTION, 'mine', { description: managedStreamDescription(), filters: CANONICAL_STREAM_FILTER_JSON });
  });

  it('restores the filter of a managed stream someone edited by hand', async () => {
    const deps = fakeDeps([stream('mine', managedStreamDescription(), '{"mode":"and","filters":[],"filterGroups":[]}')]);
    await expect(ensureManagedStream(deps, CONNECTION)).resolves.toEqual({ kind: 'updated', streamId: 'mine' });
  });

  it('writes nothing and names the capability when the token cannot manage streams', async () => {
    const deps = fakeDeps([], ['KNOWLEDGE']);
    await expect(ensureManagedStream(deps, CONNECTION)).resolves.toEqual({ kind: 'missing_capability', capability: 'TAXIIAPI_SETCOLLECTIONS' });
    expect(deps.createStream).not.toHaveBeenCalled();
  });
});

describe('openctiManagedStreamCalls', () => {
  const answer = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  const sentVariables = (fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): unknown => {
    const init = fetchImpl.mock.calls[0]?.[1];
    return JSON.parse(String(init?.body)) as unknown;
  };

  it('reads the capabilities of the token user', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer({ data: { me: { capabilities: [{ name: 'BYPASS' }] } } }));
    await expect(openctiManagedStreamCalls(fetchImpl).readCapabilities(CONNECTION)).resolves.toEqual(['BYPASS']);
    expect(fetchImpl).toHaveBeenCalledWith('https://opencti.example/graphql', expect.objectContaining({ method: 'POST' }));
  });

  it('creates a live, non-public stream and answers its id', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer({ data: { streamCollectionAdd: { id: 'new-id' } } }));
    const id = await openctiManagedStreamCalls(fetchImpl).createStream(CONNECTION, { name: 'n', description: 'd', filters: '{}' });
    expect(id).toBe('new-id');
    expect(sentVariables(fetchImpl)).toMatchObject({ variables: { input: { name: 'n', stream_live: true, stream_public: false } } });
  });

  it('patches the filter and the description', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(answer({ data: { streamCollectionEdit: { fieldPatch: { id: 's' } } } }));
    await openctiManagedStreamCalls(fetchImpl).updateStream(CONNECTION, 's', { description: 'd', filters: '{}' });
    expect(sentVariables(fetchImpl)).toMatchObject({
      variables: { id: 's', input: [{ key: 'filters', value: ['{}'] }, { key: 'description', value: ['d'] }] },
    });
  });

  it('throws on a GraphQL error, such as a refused mutation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer({ errors: [{ message: 'You are not allowed to do this.' }] }));
    await expect(openctiManagedStreamCalls(fetchImpl).createStream(CONNECTION, { name: 'n', description: 'd', filters: '{}' }))
      .rejects.toThrow('OpenCTI GraphQL answered an error');
  });

  it('throws on an HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('down', { status: 502 }));
    await expect(openctiManagedStreamCalls(fetchImpl).readCapabilities(CONNECTION)).rejects.toThrow('OpenCTI GraphQL call failed');
  });
});
