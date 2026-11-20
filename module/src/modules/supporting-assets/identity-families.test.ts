import { describe, expect, it } from 'vitest';
import { identityFamilyOf } from './identity-families';
import { isFamilyMatchable } from './matchers/registry';

describe('identityFamilyOf', () => {
  it('maps machine-shaped categories to the machine family', () => {
    expect(identityFamilyOf('host')).toBe('machine');
    expect(identityFamilyOf('container_workload')).toBe('machine');
    expect(identityFamilyOf('cloud_resource')).toBe('machine');
    expect(identityFamilyOf('mobile_device')).toBe('machine');
    expect(identityFamilyOf('network_device')).toBe('machine');
    expect(identityFamilyOf('iot_ot_device')).toBe('machine');
  });
  it('maps identity and application categories to their own families', () => {
    expect(identityFamilyOf('identity')).toBe('identity');
    expect(identityFamilyOf('web_application')).toBe('application');
    expect(identityFamilyOf('saas_application')).toBe('application');
  });
  it('maps ai_target to its own family, distinct from application', () => {
    expect(identityFamilyOf('ai_target')).toBe('ai_target');
  });
  it('maps security_platform to its own family, never to machine', () => {
    expect(identityFamilyOf('security_platform')).toBe('security_platform');
  });
  it('maps the to-classify bucket to unclassified', () => {
    expect(identityFamilyOf('generic_asset')).toBe('unclassified');
  });
});

describe('isFamilyMatchable', () => {
  it('is true for the families that have a matcher, false for the ones still waiting for a connector', () => {
    expect(isFamilyMatchable('machine')).toBe(true);
    expect(isFamilyMatchable('ai_target')).toBe(true);
    expect(isFamilyMatchable('identity')).toBe(true);
    expect(isFamilyMatchable('application')).toBe(false);
    expect(isFamilyMatchable('security_platform')).toBe(false);
    expect(isFamilyMatchable('unclassified')).toBe(false);
  });
});
