import { describe, expect, it, vi } from 'vitest';
import { fetchOpenCtiMarkingDefinitions, MARKING_DEFINITIONS_QUERY, parseMarkingsPage, parseStreamMarking } from './opencti-marking-sync';

const OCTI_EXTENSION = 'extension-definition--ea279b3e-5c71-4632-ac08-831c66a786ba';
const TLP_RED = 'marking-definition--5e57c739-391a-4eb3-b6be-7d15ca92d5ed';
const PAP_RED = 'marking-definition--ef6c4b7c-5b2a-5a3b-8a39-3b1a2e5ff0d1';

const node = (standardId: string, definitionType: string, definition: string, order: number, color: string | null = null) => ({
  node: { standard_id: standardId, definition_type: definitionType, definition, x_opencti_order: order, x_opencti_color: color },
});

const page = (edges: Array<unknown>, endCursor: string | null, hasNextPage: boolean) =>
  ({ data: { markingDefinitions: { edges, pageInfo: { endCursor, hasNextPage } } } });

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

describe('parseMarkingsPage', () => {
  it('should read each marking with its STIX id, type, definition, order and colour', () => {
    expect(parseMarkingsPage(page([node(TLP_RED, 'TLP', 'TLP:RED', 4, '#c62828')], null, false))).toEqual({
      markings: [{ stixId: TLP_RED, definitionType: 'TLP', definition: 'TLP:RED', color: '#c62828', order: 4 }],
      endCursor: null,
      hasNextPage: false,
    });
  });

  it('should skip a node without its id, type or definition, and keep a rank OpenCTI did not give as null', () => {
    const parsed = parseMarkingsPage(page([
      { node: { definition_type: 'TLP', definition: 'TLP:RED' } },
      { node: { standard_id: PAP_RED, definition_type: 'PAP', definition: 'PAP:RED', x_opencti_order: 'high' } },
    ], null, false));
    expect(parsed?.markings).toEqual([{ stixId: PAP_RED, definitionType: 'PAP', definition: 'PAP:RED', color: null, order: null }]);
  });

  it.each([
    ['absent', undefined],
    ['a numeric string', '5'],
    ['a fraction', 2.5],
    ['null', null],
  ])('should read a rank that is %s as null', (_label, order) => {
    const parsed = parseMarkingsPage(page([
      { node: { standard_id: PAP_RED, definition_type: 'PAP', definition: 'PAP:RED', x_opencti_order: order } },
    ], null, false));
    expect(parsed?.markings[0].order).toBeNull();
  });

  it('should answer null for an answer that is not a marking connection', () => {
    expect(parseMarkingsPage({ errors: [{ message: 'ForbiddenAccess' }] })).toBeNull();
    expect(parseMarkingsPage({ data: { markingDefinitions: null } })).toBeNull();
  });
});

describe('parseStreamMarking', () => {
  it('should read a stream marking-definition object, its order and colour from the OpenCTI extension', () => {
    expect(parseStreamMarking({
      id: PAP_RED, type: 'marking-definition', name: 'PAP:RED', definition_type: 'PAP',
      extensions: { [OCTI_EXTENSION]: { order: 4, color: '#E53935' } },
    })).toEqual({ stixId: PAP_RED, definitionType: 'PAP', definition: 'PAP:RED', color: '#E53935', order: 4 });
  });

  it.each([
    ['absent', {}],
    ['a numeric string', { order: '5' }],
    ['a fraction', { order: 2.5 }],
  ])('should read a stream marking whose rank is %s as null', (_label, extension) => {
    expect(parseStreamMarking({
      id: PAP_RED, type: 'marking-definition', name: 'PAP:RED', definition_type: 'PAP',
      extensions: { [OCTI_EXTENSION]: extension },
    })?.order).toBeNull();
  });

  it('should read a stream marking with no OpenCTI extension as unranked', () => {
    expect(parseStreamMarking({ id: PAP_RED, type: 'marking-definition', name: 'PAP:RED', definition_type: 'PAP' })?.order).toBeNull();
  });

  it('should answer null for another type or an incomplete marking', () => {
    expect(parseStreamMarking({ id: 'intrusion-set--1', type: 'intrusion-set', name: 'Group A' })).toBeNull();
    expect(parseStreamMarking({ id: PAP_RED, type: 'marking-definition', name: 'PAP:RED' })).toBeNull();
  });
});

describe('fetchOpenCtiMarkingDefinitions', () => {
  it('should read every page with the connector token', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(page([node(TLP_RED, 'TLP', 'TLP:RED', 4)], 'cursor-1', true)))
      .mockResolvedValueOnce(jsonResponse(page([node(PAP_RED, 'PAP', 'PAP:RED', 4)], 'cursor-2', false)));

    const markings = await fetchOpenCtiMarkingDefinitions('https://opencti.example/', 'tok', fetchImpl);

    expect(markings.map((marking) => marking.stixId)).toEqual([TLP_RED, PAP_RED]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://opencti.example/graphql', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      body: JSON.stringify({ query: MARKING_DEFINITIONS_QUERY, variables: { first: 500, after: 'cursor-1' } }),
    }));
  });

  it('should throw on a refusal or a malformed answer, so nothing is synced in part', async () => {
    await expect(fetchOpenCtiMarkingDefinitions('https://opencti.example', 'tok', vi.fn().mockResolvedValue(jsonResponse({}, 403))))
      .rejects.toThrow('OpenCTI marking definitions read failed');
    await expect(fetchOpenCtiMarkingDefinitions('https://opencti.example', 'tok', vi.fn().mockResolvedValue(jsonResponse({ data: {} }))))
      .rejects.toThrow('unexpected shape');
  });
});
