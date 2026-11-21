import { describe, expect, it, vi } from 'vitest';
import { createReaderMarkingsResolver, parseAllowedMarkings, parseReaderScope, READER_MARKINGS_QUERY } from './reader-markings';

const CONNECTION = { url: 'https://opencti.example/', token: 'connector-token' };
const SIGN = () => Promise.resolve('reader-jwt');
const NO_SIGN = () => Promise.resolve(null);

const body = (markings: Array<string>) => ({
  data: {
    me: {
      id: 'octi-user',
      individual_id: 'octi-individual',
      allowed_marking: markings.map((standard_id) => ({ standard_id })),
      objectOrganization: { edges: [{ node: { id: 'org-b' } }, { node: { id: 'org-a' } }] },
      groups: { edges: [{ node: { id: 'group-1' } }] },
      capabilities: [{ name: 'KNOWLEDGE' }],
    },
    settings: { platform_organization: { id: 'org-platform' } },
  },
});
const answer = (markings: Array<string>) => new Response(JSON.stringify(body(markings)), { status: 200 });

describe('parseAllowedMarkings', () => {
  it('should read the standard ids, deduplicated and sorted', () => {
    expect(parseAllowedMarkings({ data: { me: { allowed_marking: [{ standard_id: 'b' }, { standard_id: 'a' }, { standard_id: 'b' }] } } }))
      .toEqual(['a', 'b']);
  });

  it('should answer null on any other shape', () => {
    expect(parseAllowedMarkings({ errors: [{ message: 'forbidden' }] })).toBeNull();
    expect(parseAllowedMarkings({ data: { me: null } })).toBeNull();
  });
});

describe('parseReaderScope', () => {
  it('should read the markings and who the reader is in OpenCTI', () => {
    expect(parseReaderScope(body(['m-1']))).toEqual({
      markings: ['m-1'],
      access: {
        userId: 'octi-user',
        individualId: 'octi-individual',
        organizationIds: ['org-a', 'org-b'],
        groupIds: ['group-1'],
        bypass: false,
        platformOrganizationId: 'org-platform',
      },
    });
  });

  it('should read the BYPASS capability and a platform with no platform organization', () => {
    const bypass = body([]);
    bypass.data.me.capabilities = [{ name: 'BYPASS' }];
    const scope = parseReaderScope({ data: { ...bypass.data, settings: { platform_organization: null } } });

    expect(scope?.access.bypass).toBe(true);
    expect(scope?.access.platformOrganizationId).toBeNull();
  });

  it('should answer null when the identity is read in part', () => {
    const noSettings = { data: { me: body([]).data.me } };
    const noId = { data: { ...body([]).data, me: { ...body([]).data.me, id: undefined } } };

    expect(parseReaderScope(noSettings)).toBeNull();
    expect(parseReaderScope(noId)).toBeNull();
    expect(parseReaderScope({ errors: [{ message: 'forbidden' }] })).toBeNull();
  });
});

describe('createReaderMarkingsResolver', () => {
  it('should ask OpenCTI as the reader, never with the connector token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer(['m-1']));
    const resolver = createReaderMarkingsResolver(fetchImpl);

    expect((await resolver.resolve('t-1', 'u-1', CONNECTION, SIGN))?.markings).toEqual(['m-1']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://opencti.example/graphql');
    expect(init.headers.Authorization).toBe('Bearer reader-jwt');
    expect(JSON.parse(init.body)).toEqual({ query: READER_MARKINGS_QUERY });
  });

  it('should not narrow a tenant with no OpenCTI connection', async () => {
    const unused = vi.fn();

    expect(await createReaderMarkingsResolver(unused).resolve('t-1', 'u-1', undefined, SIGN)).toBeUndefined();
    expect(unused).not.toHaveBeenCalled();
  });

  it('should fail closed without an identity, on a refusal or an error', async () => {
    const refused = createReaderMarkingsResolver(vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    const broken = createReaderMarkingsResolver(vi.fn().mockRejectedValue(new Error('timeout')));
    const unused = vi.fn();

    expect(await createReaderMarkingsResolver(unused).resolve('t-1', 'u-1', CONNECTION, NO_SIGN)).toBeNull();
    expect(unused).not.toHaveBeenCalled();
    expect(await refused.resolve('t-1', 'u-1', CONNECTION, SIGN)).toBeNull();
    expect(await broken.resolve('t-1', 'u-1', CONNECTION, SIGN)).toBeNull();
  });

  it('should keep an answer per tenant and user until it expires', async () => {
    let clock = 0;
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(answer(['m-1'])));
    const resolver = createReaderMarkingsResolver(fetchImpl, () => clock, 1_000);

    await resolver.resolve('t-1', 'u-1', CONNECTION, SIGN);
    await resolver.resolve('t-1', 'u-1', CONNECTION, SIGN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await resolver.resolve('t-1', 'u-2', CONNECTION, SIGN);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    clock = 1_001;
    await resolver.resolve('t-1', 'u-1', CONNECTION, SIGN);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
