import { describe, expect, it, vi } from 'vitest';
import type { AttackPathGraph } from './openaev-types';
import { mergeAttackPathHops, syncAttackPaths, toAttackPathHops } from './openaev-attack-path-phase';

vi.mock('../../utils/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    logFromError: vi.fn(),
    logTrace: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  }),
}));

const asset = (id: string, ref: string, status: string | null) => ({ id, type: 'ASSET', ref, status });
const injector = (id: string) => ({ id, type: 'INJECTOR', ref: null, status: null });
const edge = (from: string, to: string) => ({ edgeSourceId: from, edgeTargetId: to });

/** Internet -> controller A -> tenant database B, the hop into B not prevented. */
const chain = (bStatus: string | null): AttackPathGraph => ({
  attackPathNodes: [injector('inj'), asset('n-a', 'oaev-a', 'RED'), asset('n-b', 'oaev-b', bStatus)],
  attackPathEdges: [edge('inj', 'n-a'), edge('n-a', 'n-b')],
});

const inventory = new Map([['oaev-a', 'crq-a'], ['oaev-b', 'crq-b']]);

describe('toAttackPathHops', () => {
  it('records B reachable from A, proven when the execution into B got through, with its simulation', () => {
    expect(toAttackPathHops(chain('RED'), 'sim-1', inventory)).toEqual([
      { fromAssetId: 'crq-b', toAssetId: 'crq-a', source: 'openaev_attack_path_proven', evidenceRef: 'sim-1' },
    ]);
  });

  it('counts a detected but not prevented hop as proven', () => {
    expect(toAttackPathHops(chain('ORANGE'), 'sim-1', inventory)[0].source).toBe('openaev_attack_path_proven');
  });

  it('keeps a hop with no verdict yet as inferred', () => {
    expect(toAttackPathHops(chain(null), 'sim-1', inventory)[0].source).toBe('openaev_attack_path_inferred');
  });

  it('leaves out a prevented hop: it is no way in', () => {
    expect(toAttackPathHops(chain('GREEN'), 'sim-1', inventory)).toEqual([]);
  });

  it('leaves out the injector edge and an end the inventory does not hold', () => {
    expect(toAttackPathHops(chain('RED'), 'sim-1', new Map([['oaev-a', 'crq-a']]))).toEqual([]);
  });

  it('leaves out a hop between two OpenAEV assets folded onto one OpenCRQ asset', () => {
    expect(toAttackPathHops(chain('RED'), 'sim-1', new Map([['oaev-a', 'crq-a'], ['oaev-b', 'crq-a']]))).toEqual([]);
  });

  it('reads a graph without nodes or edges as no hop', () => {
    expect(toAttackPathHops({ attackPathNodes: null, attackPathEdges: null }, 'sim-1', inventory)).toEqual([]);
  });
});

describe('mergeAttackPathHops', () => {
  const hop = (source: 'openaev_attack_path_proven' | 'openaev_attack_path_inferred', evidenceRef: string) =>
    ({ fromAssetId: 'crq-b', toAssetId: 'crq-a', source, evidenceRef });

  it('keeps the proven hop over an inferred one, whatever the order', () => {
    expect(mergeAttackPathHops([hop('openaev_attack_path_proven', 's1'), hop('openaev_attack_path_inferred', 's2')]))
      .toEqual([hop('openaev_attack_path_proven', 's1')]);
    expect(mergeAttackPathHops([hop('openaev_attack_path_inferred', 's1'), hop('openaev_attack_path_proven', 's2')]))
      .toEqual([hop('openaev_attack_path_proven', 's2')]);
  });
});

describe('syncAttackPaths', () => {
  const observedAt = new Date('2026-11-21T12:00:00Z');

  it('writes the hops of every simulation and retires nothing', async () => {
    const reconcile = vi.fn().mockResolvedValue({ written: 1, removed: 0 });
    const client = {
      listAttackPathSimulations: vi.fn().mockResolvedValue([{ simulationId: 'sim-1' }]),
      getAttackPathGraph: vi.fn().mockResolvedValue(chain('RED')),
    };
    const result = await syncAttackPaths({
      client,
      svc: { supportingAssets: { reconcileConnectorRelations: reconcile } },
      connectorId: 'connector',
      openaevTenantIds: ['t1'],
      assetIdMapByTenant: new Map([['t1', inventory]]),
      observedAt,
    });
    expect(client.getAttackPathGraph).toHaveBeenCalledWith('t1', 'sim-1');
    expect(reconcile).toHaveBeenCalledWith({
      connectorId: 'connector',
      kind: 'reachable_from',
      observedAt,
      relations: [{ fromAssetId: 'crq-b', toAssetId: 'crq-a', source: 'openaev_attack_path_proven', evidenceRef: 'sim-1' }],
      retiredIds: [],
    });
    expect(result).toEqual({ simulations: 1, skipped: 0, written: 1, removed: 0 });
  });

  it('skips a tenant or a simulation whose read fails and writes nothing when no hop is left', async () => {
    const reconcile = vi.fn();
    const client = {
      listAttackPathSimulations: vi.fn()
        .mockRejectedValueOnce(new Error('down'))
        .mockResolvedValueOnce([{ simulationId: 'sim-2' }]),
      getAttackPathGraph: vi.fn().mockRejectedValue(new Error('gone')),
    };
    const result = await syncAttackPaths({
      client,
      svc: { supportingAssets: { reconcileConnectorRelations: reconcile } },
      connectorId: 'connector',
      openaevTenantIds: ['t1', 't2'],
      assetIdMapByTenant: new Map(),
      observedAt,
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(result).toEqual({ simulations: 0, skipped: 1, written: 0, removed: 0 });
  });
});
