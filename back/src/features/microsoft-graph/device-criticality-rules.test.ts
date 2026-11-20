import { describe, expect, it } from 'vitest';
import { deviceCriticality, parseDeviceRoles, unratedDeviceRoles } from './device-criticality-rules';

describe('parseDeviceRoles', () => {
  it('reads the role names of the JSON object map Advanced Hunting returns', () => {
    expect(parseDeviceRoles('{"DomainController":{"Name":"DomainController","SystemDefinedConfidence":"Low","UserDefinedConfidence":"NotDefined"}}'))
      .toEqual(['DomainController']);
  });

  it('reads no role from an empty map, a missing value or one that is not JSON', () => {
    expect(parseDeviceRoles('{}')).toEqual([]);
    expect(parseDeviceRoles(undefined)).toEqual([]);
    expect(parseDeviceRoles('not json')).toEqual([]);
    expect(parseDeviceRoles('["DomainController"]')).toEqual([]);
  });
});

describe('deviceCriticality', () => {
  it.each([
    ['DomainController', 'very_high', 'domain_controller'],
    ['ActiveDirectoryCertificateServicesServer', 'very_high', 'certificate_services'],
    ['ADFSServer', 'very_high', 'federation_services'],
    ['AADConnectServer', 'very_high', 'entra_connect'],
    ['HyperVHost', 'high', 'hypervisor'],
    ['BackupServer', 'high', 'backup'],
  ] as const)('rates a %s at %s with rule %s', (role, criticality, rule) => {
    expect(deviceCriticality([role], '')).toEqual({ criticality, rule });
  });

  it('matches the whole role name whatever its case or separators, never a word inside another role', () => {
    expect(deviceCriticality(['domain-controller'], '')).toEqual({ criticality: 'very_high', rule: 'domain_controller' });
    expect(deviceCriticality(['Hyper-V Server'], '')).toEqual({ criticality: 'high', rule: 'hypervisor' });
    expect(deviceCriticality(['BackupAdminDevice', 'AdfsAdminDevice', 'DomainControllerAdminDevice'], '')).toEqual({ criticality: 'unknown', rule: null });
  });

  it('names the first rule of the catalogue when two yield the same band', () => {
    expect(deviceCriticality(['ActiveDirectoryCertificateServicesServer', 'DomainController'], ''))
      .toEqual({ criticality: 'very_high', rule: 'domain_controller' });
  });

  it.each([
    ['VeryHigh', 'very_high', 'asset_value_very_high'],
    ['High', 'high', 'asset_value_high'],
    ['Low', 'low', 'asset_value_low'],
  ] as const)('states the declared value %s as %s', (assetValue, criticality, rule) => {
    expect(deviceCriticality([], assetValue)).toEqual({ criticality, rule });
  });

  it('states nothing for Defender\'s default value, an empty one, or a role outside the six', () => {
    expect(deviceCriticality([], 'Normal')).toEqual({ criticality: 'unknown', rule: null });
    expect(deviceCriticality([], '')).toEqual({ criticality: 'unknown', rule: null });
    expect(deviceCriticality(['Dns', 'SecurityOperationsAdminDevice'], 'constructor')).toEqual({ criticality: 'unknown', rule: null });
  });

  it('keeps the more severe of a role and a declared value', () => {
    expect(deviceCriticality(['BackupServer'], 'VeryHigh')).toEqual({ criticality: 'very_high', rule: 'asset_value_very_high' });
    expect(deviceCriticality(['DomainController'], 'Low')).toEqual({ criticality: 'very_high', rule: 'domain_controller' });
  });
});

describe('unratedDeviceRoles', () => {
  it('lists each role name no rule rates once, sorted, and leaves out the rated ones', () => {
    expect(unratedDeviceRoles(['SecurityOperationsAdminDevice', 'DomainController', 'Dns', 'SecurityOperationsAdminDevice']))
      .toEqual(['Dns', 'SecurityOperationsAdminDevice']);
    expect(unratedDeviceRoles([])).toEqual([]);
  });
});
