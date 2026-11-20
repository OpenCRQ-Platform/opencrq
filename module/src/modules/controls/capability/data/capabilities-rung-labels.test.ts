import { describe, expect, it } from 'vitest';
import { controlCapabilitiesData, controlCapabilityStrengthRungLabelsData } from './capabilities.generated';

describe('the strength rung labels', () => {
  it.each(controlCapabilitiesData)('$externalId describes its four rungs, each within 600 characters', ({ id }) => {
    const labels = controlCapabilityStrengthRungLabelsData.filter((label) => label.capabilityId === id);
    expect(labels.map((label) => label.rung).sort()).toEqual(['L0', 'L1', 'L2', 'L3']);
    for (const { label } of labels) {
      expect(label.trim().length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(600);
    }
  });
});
