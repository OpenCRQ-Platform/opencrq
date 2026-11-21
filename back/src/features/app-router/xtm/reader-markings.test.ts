import { describe, expect, it, vi } from 'vitest';
import { createReaderMarkingsResolver, parseAllowedMarkings, READER_MARKINGS_QUERY } from './reader-markings';

const CONNECTION = { url: 'https://opencti.example/', token: 'connector-token' };
const SIGN = () => Promise.resolve('reader-jwt');
const NO_SIGN = () => Promise.resolve(null);

const answer = (markings: Array<string>) => new Response(JSON.stringify({
  data: { me: { allowed_marking: markings.map((standard_id) => ({ standard_id })) } },
}), { status: 200 });

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

describe('createReaderMarkingsResolver', () => {
  it('should ask OpenCTI as the reader, never with the connector token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(answer(['m-1']));
    const resolver = createReaderMarkingsResolver(fetchImpl);

    expect(await resolver.resolve('t-1', 'u-1', CONNECTION, SIGN)).toEqual(['m-1']);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://opencti.example/graphql');
    expect(init.headers.Authorization).toBe('Bearer reader-jwt');
    expect(JSON.parse(init.body)).toEqual({ query: READER_MARKINGS_QUERY });
  });

  it('should fail closed without a connection, an identity, on a refusal or an error', async () => {
    const refused = createReaderMarkingsResolver(vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    const broken = createReaderMarkingsResolver(vi.fn().mockRejectedValue(new Error('timeout')));
    const unused = vi.fn();

    expect(await createReaderMarkingsResolver(unused).resolve('t-1', 'u-1', undefined, SIGN)).toBeNull();
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
