import { describe, expect, it } from 'vitest';
import type { AssetObservationProperties } from '@app/module/client';
import {
  assetPropertiesFormValuesFrom,
  buildManualAssetProperties,
  emptyAssetPropertiesFormValues,
  formatAddressList,
  isSubcategoryValidFor,
  parseAddressList,
  showsPersonField,
  showsUrlField,
  subcategoriesFor,
} from './asset-properties-form-utils';

describe('parseAddressList', () => {
  it('should return an empty list for an empty string', () => {
    expect(parseAddressList('')).toEqual([]);
  });

  it('should return an empty list for a blank string', () => {
    expect(parseAddressList('   ')).toEqual([]);
  });

  it('should parse a single value', () => {
    expect(parseAddressList('10.0.0.1')).toEqual(['10.0.0.1']);
  });

  it('should trim surrounding whitespace around each entry', () => {
    expect(parseAddressList(' 10.0.0.1 , 10.0.0.2 ')).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('should collapse multiple consecutive separators and drop the blanks they leave', () => {
    expect(parseAddressList('10.0.0.1,, 10.0.0.2 ,,,10.0.0.3')).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });

  it('should leave an already-clean input unchanged', () => {
    expect(parseAddressList('10.0.0.1, 10.0.0.2, 10.0.0.3')).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3']);
  });
});

describe('formatAddressList', () => {
  it('should return an empty string for an empty list', () => {
    expect(formatAddressList([])).toBe('');
  });

  it('should return an empty string for null', () => {
    expect(formatAddressList(null)).toBe('');
  });

  it('should return an empty string for undefined', () => {
    expect(formatAddressList(undefined)).toBe('');
  });

  it('should format a single value', () => {
    expect(formatAddressList(['10.0.0.1'])).toBe('10.0.0.1');
  });

  it('should join multiple values with a comma and a space', () => {
    expect(formatAddressList(['10.0.0.1', '10.0.0.2', '10.0.0.3'])).toBe('10.0.0.1, 10.0.0.2, 10.0.0.3');
  });

  it('should round-trip through parseAddressList', () => {
    const values = ['aa:bb:cc:dd:ee:ff', '11:22:33:44:55:66'];
    expect(parseAddressList(formatAddressList(values))).toEqual(values);
  });
});

describe('subcategoriesFor', () => {
  it('should return only the subcategories belonging to the given category', () => {
    expect(subcategoriesFor('host')).toEqual(['server', 'workstation', 'laptop', 'virtual_machine', 'hypervisor', 'mainframe', 'thin_client']);
  });

  it('should not mix subcategories from another category', () => {
    expect(subcategoriesFor('identity')).not.toContain('server');
  });

  it('should return an empty list for a category with no subcategory', () => {
    expect(subcategoriesFor('generic_asset')).toEqual([]);
  });
});

describe('isSubcategoryValidFor', () => {
  it('should accept null regardless of the category', () => {
    expect(isSubcategoryValidFor('host', null)).toBe(true);
  });

  it('should accept a subcategory that belongs to the category', () => {
    expect(isSubcategoryValidFor('host', 'server')).toBe(true);
  });

  it('should reject a subcategory that belongs to another category', () => {
    expect(isSubcategoryValidFor('identity', 'server')).toBe(false);
  });
});

describe('showsUrlField', () => {
  it('should show on web_application', () => {
    expect(showsUrlField('web_application', null)).toBe(true);
  });

  it('should show on saas_application', () => {
    expect(showsUrlField('saas_application', null)).toBe(true);
  });

  it('should not show on an unrelated category with no existing value', () => {
    expect(showsUrlField('host', null)).toBe(false);
  });

  it('should show on an unrelated category when the asset already carries a URL', () => {
    expect(showsUrlField('host', 'https://example.com')).toBe(true);
  });
});

describe('showsPersonField', () => {
  it('should show on identity', () => {
    expect(showsPersonField('identity', null)).toBe(true);
  });

  it('should not show on an unrelated category with no existing value', () => {
    expect(showsPersonField('host', null)).toBe(false);
  });

  it('should show on an unrelated category when the asset already carries a linked person', () => {
    expect(showsPersonField('host', 'Jane Doe')).toBe(true);
  });
});

const previousMachineProperties: AssetObservationProperties = {
  family: 'machine',
  hostname: 'server1',
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

const previousAiTargetProperties: AssetObservationProperties = {
  family: 'ai_target',
  provider: 'openai_compatible',
  endpointUrl: 'https://api.acme.test/v1/chat',
  normalizedEndpointUrl: 'https://api.acme.test/v1/chat',
  model: 'gpt-4o',
  modality: null,
  systemPrompt: null,
};

const previousIdentityProperties: AssetObservationProperties = {
  family: 'identity',
  directoryObjectId: 'd48b511b-87fd-4830-83a3-5a49fa0596c4',
  cloudSid: null,
  onPremSid: null,
  userPrincipalName: 'jdoe@corp.example',
  accountDomain: null,
  accountName: null,
  directoryType: 'User',
  identityProvider: 'entra',
  department: 'Finance',
  jobTitle: null,
  isEnabled: true,
  assignedRoles: ['Global Administrator', 'Security Reader'],
  privilegedPimRoles: [],
};

describe('buildManualAssetProperties', () => {
  it('should send nothing for a bare category change when the asset has no manual block at all', () => {
    const result = buildManualAssetProperties('ai_target', emptyAssetPropertiesFormValues, undefined, []);

    expect(result).toBeUndefined();
  });

  it('should send nothing when the category is untouched and no field of its own family was touched', () => {
    const result = buildManualAssetProperties('host', emptyAssetPropertiesFormValues, undefined, [previousMachineProperties]);

    expect(result).toBeUndefined();
  });

  it('should send nothing for a bare switch away from a manual block of another family, so the backend keeps it', () => {
    const result = buildManualAssetProperties('ai_target', emptyAssetPropertiesFormValues, undefined, [previousMachineProperties]);

    expect(result).toBeUndefined();
  });

  it('should send a dirty field even without any family change', () => {
    const result = buildManualAssetProperties(
      'host',
      { ...emptyAssetPropertiesFormValues, hostname: 'new-host' },
      { hostname: true },
      [],
    );

    expect(result).toMatchObject({ family: 'machine', hostname: 'new-host' });
  });

  it('should fall back on the kept block of the category family for an untouched field, never on the other family', () => {
    const result = buildManualAssetProperties(
      'ai_target',
      { ...emptyAssetPropertiesFormValues, model: 'gpt-5' },
      { model: true },
      [previousMachineProperties, previousAiTargetProperties],
    );

    expect(result).toEqual({
      family: 'ai_target',
      provider: 'openai_compatible',
      modality: null,
      model: 'gpt-5',
      endpointUrl: 'https://api.acme.test/v1/chat',
      systemPrompt: null,
    });
  });
});

describe('buildManualAssetProperties — machine vendor and model', () => {
  it('should send the typed vendor and model, keeping the previous manual block for the rest', () => {
    const result = buildManualAssetProperties(
      'host',
      { ...emptyAssetPropertiesFormValues, machineVendor: 'Dell', machineModel: 'PowerEdge R740' },
      { machineVendor: true, machineModel: true },
      [previousMachineProperties],
    );

    expect(result).toMatchObject({ family: 'machine', hostname: 'server1', vendor: 'Dell', model: 'PowerEdge R740' });
  });

  it('should keep the previous manual vendor and model for a field left untouched', () => {
    const result = buildManualAssetProperties(
      'host',
      { ...emptyAssetPropertiesFormValues, hostname: 'new-host' },
      { hostname: true },
      [{ ...previousMachineProperties, vendor: 'Dell', model: 'R740' }],
    );

    expect(result).toMatchObject({ hostname: 'new-host', vendor: 'Dell', model: 'R740' });
  });

  it('should not read the AI target model into the machine block', () => {
    const result = buildManualAssetProperties(
      'host',
      { ...emptyAssetPropertiesFormValues, model: 'gpt-5', machineVendor: 'Dell' },
      { model: true, machineVendor: true },
      [previousAiTargetProperties],
    );

    expect(result).toMatchObject({ family: 'machine', vendor: 'Dell', model: null });
  });

  it('should not read the machine model into the AI target block', () => {
    const result = buildManualAssetProperties(
      'ai_target',
      { ...emptyAssetPropertiesFormValues, machineModel: 'R740', provider: 'openai_compatible' },
      { machineModel: true, provider: true },
      [previousAiTargetProperties],
    );

    expect(result).toMatchObject({ family: 'ai_target', model: 'gpt-4o' });
  });
});

describe('buildManualAssetProperties: operating system', () => {
  it('should send the typed operating system and version, keeping the previous manual block for the rest', () => {
    const result = buildManualAssetProperties(
      'host',
      { ...emptyAssetPropertiesFormValues, operatingSystem: 'Windows 11 25H2', osVersion: '10.0.26200.9711' },
      { operatingSystem: true, osVersion: true },
      [{ ...previousMachineProperties, vendor: 'Dell' }],
    );

    expect(result).toMatchObject({ family: 'machine', hostname: 'server1', vendor: 'Dell', operatingSystem: 'Windows 11 25H2', osVersion: '10.0.26200.9711' });
  });

  it('should keep the previous manual operating system when only another field is touched', () => {
    const result = buildManualAssetProperties(
      'host',
      { ...emptyAssetPropertiesFormValues, operatingSystem: 'Ubuntu', hostname: 'new-host' },
      { hostname: true },
      [{ ...previousMachineProperties, operatingSystem: 'Debian', osVersion: '13.0' }],
    );

    expect(result).toMatchObject({ hostname: 'new-host', operatingSystem: 'Debian', osVersion: '13.0' });
  });
});

describe('buildManualAssetProperties — identity', () => {
  it('should send the typed roles as a list and keep the untouched fields of the previous manual block', () => {
    const result = buildManualAssetProperties(
      'identity',
      { ...emptyAssetPropertiesFormValues, assignedRolesText: 'Global Administrator, Exchange Administrator' },
      { assignedRolesText: true },
      [previousIdentityProperties],
    );

    expect(result).toEqual({
      family: 'identity',
      userPrincipalName: 'jdoe@corp.example',
      accountName: null,
      accountDomain: null,
      identityProvider: 'entra',
      department: 'Finance',
      jobTitle: null,
      isEnabled: true,
      assignedRoles: ['Global Administrator', 'Exchange Administrator'],
      privilegedPimRoles: [],
    });
  });

  it('should send nothing when no identity field was touched', () => {
    expect(buildManualAssetProperties('identity', emptyAssetPropertiesFormValues, { hostname: true }, [])).toBeUndefined();
  });

  it('should send no block for a family nobody types one for', () => {
    expect(buildManualAssetProperties('web_application', emptyAssetPropertiesFormValues, { department: true }, [])).toBeUndefined();
  });
});

describe('assetPropertiesFormValuesFrom', () => {
  it('should prefill an identity\'s fields, its roles as the comma-separated text the fields edit', () => {
    expect(assetPropertiesFormValuesFrom([previousIdentityProperties])).toMatchObject({
      userPrincipalName: 'jdoe@corp.example',
      identityProvider: 'entra',
      department: 'Finance',
      isEnabled: true,
      assignedRolesText: 'Global Administrator, Security Reader',
      privilegedPimRolesText: '',
    });
  });

  it('should prefill the fields of every family the asset keeps a block for', () => {
    const values = assetPropertiesFormValuesFrom([previousMachineProperties, previousAiTargetProperties]);

    expect(values).toMatchObject({ hostname: 'server1', provider: 'openai_compatible', model: 'gpt-4o' });
  });

  it('should prefill a machine\'s vendor and model apart from an AI target\'s model', () => {
    const values = assetPropertiesFormValuesFrom([
      { ...previousMachineProperties, vendor: 'Dell', model: 'R740' },
      previousAiTargetProperties,
    ]);

    expect(values).toMatchObject({ machineVendor: 'Dell', machineModel: 'R740', model: 'gpt-4o' });
  });

  it('should hold the address lists as the comma-separated text the fields edit', () => {
    const values = assetPropertiesFormValuesFrom([{ ...previousMachineProperties, ipAddresses: ['10.0.0.1', '10.0.0.2'], macAddresses: ['aabbccddeeff'] }]);

    expect(values).toMatchObject({ ipAddressesText: '10.0.0.1, 10.0.0.2', macAddressesText: 'aabbccddeeff' });
  });

  it('should leave every field empty for an asset without any block', () => {
    expect(assetPropertiesFormValuesFrom([])).toEqual(emptyAssetPropertiesFormValues);
  });
});
