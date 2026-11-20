import { i18n } from '@lingui/core';
import type { AssetObservationProperties } from '@app/module/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { manualPropertyFieldLabels } from './asset-manual-attribute-vocabulary';

const EMPTY_MACHINE: AssetObservationProperties = {
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
};

describe('manualPropertyFieldLabels', () => {
  beforeAll(() => {
    i18n.load('en', {});
    i18n.activate('en');
  });

  it('names nothing without a manual block', () => {
    expect(manualPropertyFieldLabels(null)).toEqual([]);
  });

  it('names only the AI target fields a person filled', () => {
    expect(manualPropertyFieldLabels({
      family: 'ai_target',
      provider: null,
      endpointUrl: null,
      normalizedEndpointUrl: 'chatbot.example.com/v1',
      model: 'gpt-4o-mini',
      modality: 'text',
      systemPrompt: null,
    })).toEqual(['Modality', 'Model']);
  });

  it('counts an empty address list as unset, and a false end of life as set', () => {
    expect(manualPropertyFieldLabels({ ...EMPTY_MACHINE, macAddresses: ['aabbccddeeff'], isEol: false })).toEqual(['MAC addresses', 'End of life']);
  });

  it('names the vendor and model of a machine a person filled', () => {
    expect(manualPropertyFieldLabels({ ...EMPTY_MACHINE, vendor: 'Dell', model: 'R740' })).toEqual(['Vendor', 'Model']);
  });

  it('names the operating system and OS version of a machine a person filled', () => {
    expect(manualPropertyFieldLabels({ ...EMPTY_MACHINE, operatingSystem: 'Ubuntu', osVersion: '24.04' })).toEqual(['Operating system', 'OS version']);
  });

  it('never names a connector identifier', () => {
    expect(manualPropertyFieldLabels({ ...EMPTY_MACHINE, hardwareUuid: 'uuid', cloudRegion: 'eu-west-1' })).toEqual(['Region']);
  });
});
