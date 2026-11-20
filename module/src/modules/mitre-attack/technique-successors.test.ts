import { describe, expect, it } from 'vitest';
import { mitreTechniquesData } from './data';

describe('the vendored successors of revoked techniques', () => {
  // `techniqueSuccessorsOf` follows one hop, trusting the generator's chain resolution: a revoked
  // successor would hand the run a technique it drops.
  it('names only live techniques as successors', () => {
    const byId = new Map(mitreTechniquesData.map((technique) => [technique.id, technique]));
    const replaced = mitreTechniquesData.filter((technique) => technique.replacedByTechniqueId !== null);
    expect(replaced.length).toBeGreaterThan(0);
    for (const technique of replaced) {
      expect(byId.get(technique.replacedByTechniqueId!)?.revoked, technique.externalId).toBe(false);
    }
  });
});
