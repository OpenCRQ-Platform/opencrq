import { describe, expect, it } from 'vitest';
import { planOutcomeCounterRecompute } from './recompute-plan';

const analysis = (stixId: string) => ({ id: `id-${stixId}`, stixId });
const file = (id: string, uploadedAt: string) => ({ id, uploadedAt: new Date(uploadedAt) });

describe('planOutcomeCounterRecompute', () => {
  it('should send a stale threat the mirror holds to the mirror, and ask for no bundle file', () => {
    const plan = planOutcomeCounterRecompute({
      stale: [analysis('intrusion-set--a')],
      mirrorStixIds: new Set(['intrusion-set--a']),
      bundleFiles: [file('f1', '2026-01-01T00:00:00Z')],
    });

    expect(plan).toEqual({ mirrorStixIds: ['intrusion-set--a'], fileStixIds: [], bundleFileIdsInOrder: [] });
  });

  it('should ask for the bundle files, oldest upload first, for a stale threat not in the mirror', () => {
    const plan = planOutcomeCounterRecompute({
      stale: [analysis('campaign--b')],
      mirrorStixIds: new Set(),
      bundleFiles: [file('f2', '2026-03-01T00:00:00Z'), file('f1', '2026-01-01T00:00:00Z'), file('f3', '2026-02-01T00:00:00Z')],
    });

    expect(plan).toEqual({ mirrorStixIds: [], fileStixIds: ['campaign--b'], bundleFileIdsInOrder: ['f1', 'f3', 'f2'] });
  });

  it('should break a tie between two uploads of the same instant by file id', () => {
    const plan = planOutcomeCounterRecompute({
      stale: [analysis('campaign--b')],
      mirrorStixIds: new Set(),
      bundleFiles: [file('f-b', '2026-01-01T00:00:00Z'), file('f-a', '2026-01-01T00:00:00Z')],
    });

    expect(plan.bundleFileIdsInOrder).toEqual(['f-a', 'f-b']);
  });

  it('should split a mix between the mirror and the files, so a file never rescores a mirrored threat', () => {
    const plan = planOutcomeCounterRecompute({
      stale: [analysis('intrusion-set--a'), analysis('campaign--b'), { id: 'other-id', stixId: 'intrusion-set--a' }],
      mirrorStixIds: new Set(['intrusion-set--a', 'threat-actor--never-stale']),
      bundleFiles: [file('f1', '2026-01-01T00:00:00Z')],
    });

    expect(plan).toEqual({ mirrorStixIds: ['intrusion-set--a'], fileStixIds: ['campaign--b'], bundleFileIdsInOrder: ['f1'] });
  });

  it('should plan nothing when nothing is stale', () => {
    const plan = planOutcomeCounterRecompute({
      stale: [],
      mirrorStixIds: new Set(['intrusion-set--a']),
      bundleFiles: [file('f1', '2026-01-01T00:00:00Z')],
    });

    expect(plan).toEqual({ mirrorStixIds: [], fileStixIds: [], bundleFileIdsInOrder: [] });
  });
});
