import { describe, expect, it } from 'vitest';
import type { AiTargetAssetProperties, IdentityAssetProperties, MachineAssetProperties } from './types';
import { deriveAssetName } from './derived-name';

const machine = (overrides: Partial<MachineAssetProperties>): MachineAssetProperties => ({
  family: 'machine',
  hostname: null,
  ipAddresses: [],
  macAddresses: [],
  seenIp: null,
  hardwareUuid: null,
  directoryDeviceId: null,
  cloudVmId: null,
  cloudResourceId: null,
  cloudProvider: null,
  cloudNativeType: null,
  cloudRegion: null,
  platform: null,
  arch: null,
  vendor: null,
  model: null,
  operatingSystem: null,
  osVersion: null,
  isEol: null,
  agentExternalReference: null,
  agentExecutorType: null,
  ...overrides,
});

const identity = (overrides: Partial<IdentityAssetProperties>): IdentityAssetProperties => ({
  family: 'identity',
  directoryObjectId: null,
  cloudSid: null,
  onPremSid: null,
  userPrincipalName: null,
  accountDomain: null,
  accountName: null,
  directoryType: null,
  identityProvider: null,
  department: null,
  jobTitle: null,
  isEnabled: null,
  assignedRoles: [],
  privilegedPimRoles: [],
  ...overrides,
});

const aiTarget = (overrides: Partial<AiTargetAssetProperties>): AiTargetAssetProperties => ({
  family: 'ai_target',
  provider: null,
  endpointUrl: null,
  normalizedEndpointUrl: null,
  model: null,
  modality: null,
  systemPrompt: null,
  ...overrides,
});

describe('deriveAssetName', () => {
  it('returns null when there are no properties', () => {
    expect(deriveAssetName(null)).toBeNull();
  });

  describe('machine family', () => {
    it.each<[string, Partial<MachineAssetProperties>, string | null]>([
      ['hostname over everything else', { hostname: 'srv-01', vendor: 'Cisco', model: 'MS220-48', seenIp: '10.0.0.1', ipAddresses: ['10.0.0.2'], macAddresses: ['901057c66a51'] }, 'srv-01'],
      ['vendor, model and seen IP', { vendor: 'Cisco', model: 'Meraki MS220-48', seenIp: '10.165.0.3' }, 'Cisco Meraki MS220-48 · 10.165.0.3'],
      ['vendor and address, no model', { vendor: 'Cisco', ipAddresses: ['10.165.0.3'] }, 'Cisco · 10.165.0.3'],
      ['model and address, no vendor', { model: 'MS220-48', ipAddresses: ['10.165.0.3'] }, 'MS220-48 · 10.165.0.3'],
      ['hardware label alone', { vendor: 'Cisco', model: 'Meraki MS220-48' }, 'Cisco Meraki MS220-48'],
      ['address alone', { ipAddresses: ['10.165.0.3'] }, '10.165.0.3'],
      ['MAC alone', { macAddresses: ['901057c66a51'] }, '90:10:57:c6:6a:51'],
      ['nothing usable', {}, null],
    ])('%s', (_label, properties, expected) => {
      expect(deriveAssetName(machine(properties))).toBe(expected);
    });

    it.each<[string, Partial<MachineAssetProperties>, string]>([
      ['model starting with the vendor', { vendor: 'Apple', model: 'AppleTV14,1 (J255AP)' }, 'AppleTV14,1 (J255AP)'],
      ['model starting with the vendor, other casing', { vendor: 'APPLE', model: 'appletv14,1' }, 'appletv14,1'],
      ['model not starting with the vendor', { vendor: 'Apple', model: 'TV14,1' }, 'Apple TV14,1'],
      ['vendor only inside the model', { vendor: 'Meraki', model: 'Cisco Meraki MS220' }, 'Meraki Cisco Meraki MS220'],
    ])('hardware label: %s', (_label, properties, expected) => {
      expect(deriveAssetName(machine(properties))).toBe(expected);
    });

    it.each<[string, Partial<MachineAssetProperties>, string]>([
      ['seenIp over listed addresses', { seenIp: '10.0.0.9', ipAddresses: ['10.0.0.1'], macAddresses: ['901057c66a51'] }, '10.0.0.9'],
      ['smallest IPv4, whatever the array order', { ipAddresses: ['10.0.0.3', '10.0.0.1', '10.0.0.2'] }, '10.0.0.1'],
      ['smallest IPv4, reversed array order', { ipAddresses: ['10.0.0.2', '10.0.0.1'] }, '10.0.0.1'],
      ['numeric rather than lexical IPv4 order', { ipAddresses: ['10.0.0.1', '9.1.1.1'] }, '9.1.1.1'],
      ['numeric order within an octet', { ipAddresses: ['192.168.1.100', '192.168.1.20'] }, '192.168.1.20'],
      ['IPv4 preferred over a lexically smaller IPv6', { ipAddresses: ['2001:db8::1', '192.168.0.1'] }, '192.168.0.1'],
      ['smallest IPv6 when no IPv4', { ipAddresses: ['fd00::2', '2001:db8::1'] }, '2001:db8::1'],
      ['smallest IPv6, reversed array order', { ipAddresses: ['2001:db8::1', 'fd00::2'] }, '2001:db8::1'],
      ['IP over MAC', { ipAddresses: ['10.0.0.1'], macAddresses: ['001122334455'] }, '10.0.0.1'],
      ['smallest MAC, formatted', { macAddresses: ['ffeeddccbbaa', '001122334455'] }, '00:11:22:33:44:55'],
      ['smallest MAC, reversed array order', { macAddresses: ['001122334455', 'ffeeddccbbaa'] }, '00:11:22:33:44:55'],
    ])('address: %s', (_label, properties, expected) => {
      expect(deriveAssetName(machine(properties))).toBe(expected);
    });

    it.each<[string, Partial<MachineAssetProperties>, string | null]>([
      ['blank hostname', { hostname: '   ', ipAddresses: ['10.0.0.1'] }, '10.0.0.1'],
      ['blank vendor', { vendor: ' ', model: 'MS220', seenIp: '10.0.0.1' }, 'MS220 · 10.0.0.1'],
      ['blank model', { vendor: 'Cisco', model: '  ', seenIp: '10.0.0.1' }, 'Cisco · 10.0.0.1'],
      ['blank seenIp', { seenIp: '', ipAddresses: ['10.0.0.1'] }, '10.0.0.1'],
      ['blank address entries', { ipAddresses: ['', '  ', '10.0.0.1'] }, '10.0.0.1'],
      ['only blanks', { hostname: ' ', vendor: ' ', model: '', seenIp: ' ', ipAddresses: [' '], macAddresses: [''] }, null],
      ['padded hostname trimmed', { hostname: '  srv-01 ' }, 'srv-01'],
      ['padded vendor and model trimmed', { vendor: ' Cisco ', model: ' MS220 ' }, 'Cisco MS220'],
    ])('blanks: %s', (_label, properties, expected) => {
      expect(deriveAssetName(machine(properties))).toBe(expected);
    });
  });

  describe('identity family', () => {
    it.each<[string, Partial<IdentityAssetProperties>, string | null]>([
      ['userPrincipalName over everything else', { userPrincipalName: 'a@corp.com', accountDomain: 'CORP', accountName: 'a', directoryObjectId: 'obj-1', cloudSid: 'S-1-12-1', onPremSid: 'S-1-5-21-1' }, 'a@corp.com'],
      ['domain and account name', { accountDomain: 'CORP', accountName: 'jdoe', directoryObjectId: 'obj-1' }, 'CORP\\jdoe'],
      ['account name alone', { accountName: 'jdoe', directoryObjectId: 'obj-1' }, 'jdoe'],
      ['domain without account name falls through', { accountDomain: 'CORP', directoryObjectId: 'obj-1' }, 'obj-1'],
      ['directoryObjectId', { directoryObjectId: 'obj-1', cloudSid: 'S-1-12-1', onPremSid: 'S-1-5-21-1' }, 'obj-1'],
      ['cloudSid', { cloudSid: 'S-1-12-1', onPremSid: 'S-1-5-21-1' }, 'S-1-12-1'],
      ['onPremSid', { onPremSid: 'S-1-5-21-1' }, 'S-1-5-21-1'],
      ['nothing usable', {}, null],
      ['blank userPrincipalName', { userPrincipalName: '  ', accountName: 'jdoe' }, 'jdoe'],
      ['blank domain', { accountDomain: ' ', accountName: 'jdoe' }, 'jdoe'],
      ['blank account name', { accountDomain: 'CORP', accountName: ' ', cloudSid: 'S-1-12-1' }, 'S-1-12-1'],
      ['only blanks', { userPrincipalName: ' ', accountName: '', directoryObjectId: ' ', cloudSid: '', onPremSid: ' ' }, null],
      ['padded parts trimmed', { accountDomain: ' CORP ', accountName: ' jdoe ' }, 'CORP\\jdoe'],
    ])('%s', (_label, properties, expected) => {
      expect(deriveAssetName(identity(properties))).toBe(expected);
    });
  });

  describe('ai_target family', () => {
    it.each<[string, Partial<AiTargetAssetProperties>, string | null]>([
      ['model over endpoint', { model: 'gpt-4o', endpointUrl: 'https://api.example.com/v1' }, 'gpt-4o'],
      ['endpoint url', { endpointUrl: 'https://api.example.com/v1' }, 'https://api.example.com/v1'],
      ['blank model', { model: '  ', endpointUrl: 'https://api.example.com/v1' }, 'https://api.example.com/v1'],
      ['padded model trimmed', { model: ' gpt-4o ' }, 'gpt-4o'],
      ['nothing usable', {}, null],
      ['only blanks', { model: ' ', endpointUrl: '' }, null],
    ])('%s', (_label, properties, expected) => {
      expect(deriveAssetName(aiTarget(properties))).toBe(expected);
    });
  });
});
