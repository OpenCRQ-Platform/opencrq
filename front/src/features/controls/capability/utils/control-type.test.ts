import { describe, expect, it } from 'vitest';
import type { CapabilityEdge } from '../types/capability';
import { deriveControlType } from './control-type';

const edge = (
  fn: CapabilityEdge['function'],
  state: CapabilityEdge['state'] = 'recommended',
): CapabilityEdge => ({
  techniqueId: `${fn}-${state}`,
  techniqueExternalId: 'T1078',
  techniqueName: 'Valid Accounts',
  function: fn,
  source: state === 'added' ? 'tenant' : 'catalogue',
  state,
  tactics: [],
});

describe('deriveControlType', () => {
  it('is preventive when every covered edge prevents', () => {
    expect(deriveControlType([edge('prevent'), edge('prevent')])).toBe('preventive');
  });

  it('is detective when every covered edge detects', () => {
    expect(deriveControlType([edge('detect')])).toBe('detective');
  });

  it('is both when the control does both', () => {
    expect(deriveControlType([edge('prevent'), edge('detect')])).toBe('preventive-and-detective');
  });

  it('ignores a removed edge: the type follows the effective coverage', () => {
    expect(deriveControlType([edge('prevent'), edge('detect', 'removed')])).toBe('preventive');
  });

  it('counts a tenant addition like any other covered edge', () => {
    expect(deriveControlType([edge('prevent'), edge('detect', 'added')])).toBe('preventive-and-detective');
  });

  it('has no type when the control covers nothing', () => {
    expect(deriveControlType([])).toBeNull();
    expect(deriveControlType([edge('prevent', 'removed')])).toBeNull();
  });
});
