import { describe, expect, it } from 'vitest';
import type { AssetSourceOrigin } from './constants';
import type { AssetObservation, MachineAssetProperties } from './types';
import { resolveAssetAttributes, resolveDerivedName, resolveObservationProperties } from './attribute-resolution';

let seq = 0;
const observation = (overrides: Partial<AssetObservation> & { source: string | null }): AssetObservation => ({
  id: `obs-${seq++}`,
  connectorId: null,
  origin: 'connector',
  sourceAssetId: 'src-1',
  reportedName: null,
  reportedCategoryId: 'host',
  reportedSubcategoryId: null,
  reportedDescription: null,
  reportedExposure: 'unknown',
  reportedCriticality: 'unknown',
  externalReference: null,
  reportedUrl: null,
  reportedLinkedPerson: null,
  firstSeenAt: null,
  lastSeenAt: null,
  sourceLastActivityAt: new Date(0),
  ...overrides,
});

describe('resolveObservationProperties', () => {
  const withProperties = (source: string | null, sourceAssetId: string, properties: Partial<MachineAssetProperties>, origin: AssetSourceOrigin = 'connector') => ({
    ...observation({ source, sourceAssetId, origin }),
    properties: {
      family: 'machine' as const,
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
      ...properties,
    },
  });

  it('returns null when no source carries a block', () => {
    expect(resolveObservationProperties([observation({ source: 'openaev', sourceAssetId: 'ep-1' })])).toBeNull();
  });

  // Defender outranks OpenAEV and reports neither a seen IP nor an architecture: taking its block
  // whole would blank two fields OpenAEV did report.
  it('fills a field the winning source does not report from the next source that does', () => {
    const resolved = resolveObservationProperties([
      withProperties('microsoft_graph', 'mde-1', { hostname: 'srv-01' }),
      withProperties('openaev', 'ep-1', { hostname: 'srv-01.corp.local', seenIp: '10.0.0.9', arch: 'x86_64' }),
    ]);

    expect(resolved).toMatchObject({ hostname: 'srv-01', seenIp: '10.0.0.9', arch: 'x86_64' });
  });

  it('unions the address sets rather than keeping one source\'s', () => {
    const resolved = resolveObservationProperties([
      withProperties('microsoft_graph', 'mde-1', { ipAddresses: ['10.0.0.1'], macAddresses: ['aabbccddeeff'] }),
      withProperties('openaev', 'ep-1', { ipAddresses: ['10.0.0.1', '10.0.0.2'], macAddresses: [] }),
    ]);

    expect(resolved).toMatchObject({ ipAddresses: ['10.0.0.1', '10.0.0.2'], macAddresses: ['aabbccddeeff'] });
  });

  it('never merges across families', () => {
    const resolved = resolveObservationProperties([
      withProperties('microsoft_graph', 'mde-1', { hostname: 'srv-01' }),
      {
        ...observation({ source: 'openaev', sourceAssetId: 'ai-1' }),
        properties: { family: 'ai_target' as const, provider: null, endpointUrl: null, normalizedEndpointUrl: null, model: 'claude', modality: null, systemPrompt: null },
      },
    ]);

    expect(resolved).toMatchObject({ family: 'machine', hostname: 'srv-01' });
    expect(resolved).toMatchObject({ model: null });
  });

  it('a manual observation wins a field a higher-authority connector also reports', () => {
    const resolved = resolveObservationProperties([
      withProperties('microsoft_graph', 'mde-1', { hostname: 'srv-01' }),
      withProperties(null, 'manual-1', { hostname: 'my-server' }, 'user'),
    ]);

    expect(resolved).toMatchObject({ hostname: 'my-server' });
  });

  it('falls back to the connector for a field the manual observation leaves null', () => {
    const resolved = resolveObservationProperties([
      withProperties('microsoft_graph', 'mde-1', { hostname: 'srv-01', arch: 'x86_64' }),
      withProperties(null, 'manual-1', { hostname: 'my-server' }, 'user'),
    ]);

    expect(resolved).toMatchObject({ hostname: 'my-server', arch: 'x86_64' });
  });

  it('lets a hand-typed address set replace the connectors\' ones, and keeps theirs where none was typed', () => {
    const resolved = resolveObservationProperties([
      withProperties('microsoft_graph', 'mde-1', { ipAddresses: ['10.0.0.1'], macAddresses: ['aabbccddeeff'] }),
      withProperties('openaev', 'ep-1', { ipAddresses: ['10.0.0.3'], macAddresses: ['aabbccddee01'] }),
      withProperties(null, 'manual-1', { ipAddresses: ['10.0.0.2'] }, 'user'),
    ]);

    expect(resolved).toMatchObject({ ipAddresses: ['10.0.0.2'], macAddresses: ['aabbccddeeff', 'aabbccddee01'] });
  });
});

describe('resolveDerivedName', () => {
  const machineObservation = (origin: AssetSourceOrigin, source: string | null, sourceAssetId: string, properties: Partial<MachineAssetProperties>): AssetObservation => ({
    ...observation({ source, sourceAssetId, origin }),
    properties: {
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
      ...properties,
    },
  });

  it('is null when no observation carries a block', () => {
    expect(resolveDerivedName([observation({ source: 'openaev', sourceAssetId: 'ep-1' })])).toBeNull();
  });

  it('takes a hostname typed by hand before the address a connector reported', () => {
    const name = resolveDerivedName([
      machineObservation('connector', 'microsoft_graph', 'mde-1', { ipAddresses: ['10.0.0.1'] }),
      machineObservation('user', null, 'asset-1', { hostname: 'typed-by-hand' }),
    ]);

    expect(name).toBe('typed-by-hand');
  });

  it('falls back on the connector address when nothing was typed by hand', () => {
    expect(resolveDerivedName([machineObservation('connector', 'microsoft_graph', 'mde-1', { ipAddresses: ['10.0.0.1'] })])).toBe('10.0.0.1');
  });
});

describe('resolveAssetAttributes', () => {
  it('resolves name to the observation from the most recently reporting source', () => {
    const older = observation({ source: 'microsoft_graph', reportedName: 'old-name', sourceLastActivityAt: new Date('2026-01-01') });
    const newer = observation({ source: 'openaev', reportedName: 'new-name', sourceLastActivityAt: new Date('2026-06-01') });
    expect(resolveAssetAttributes([older, newer]).name).toBe('new-name');
  });

  it('resolves exposure and criticality to the most severe reported value', () => {
    const a = observation({ source: 'microsoft_graph', reportedExposure: 'internal', reportedCriticality: 'low' });
    const b = observation({ source: 'openaev', reportedExposure: 'internet_facing', reportedCriticality: 'high' });
    const resolved = resolveAssetAttributes([a, b]);
    expect(resolved.exposure).toBe('internet_facing');
    expect(resolved.criticality).toBe('high');
  });

  it('ranks very_high above high, so the source that saw the top band wins', () => {
    const a = observation({ source: 'microsoft_graph', reportedCriticality: 'high' });
    const b = observation({ source: 'openaev', reportedCriticality: 'very_high' });
    expect(resolveAssetAttributes([a, b]).criticality).toBe('very_high');
    expect(resolveAssetAttributes([b, a]).criticality).toBe('very_high');
  });

  it('takes the lift when it is more severe than every connector\'s reading, and not otherwise', () => {
    const reported = observation({ source: 'microsoft_graph', reportedCriticality: 'medium' });
    expect(resolveAssetAttributes([reported], [], 'high').criticality).toBe('high');
    expect(resolveAssetAttributes([observation({ source: 'microsoft_graph', reportedCriticality: 'very_high' })], [], 'high').criticality).toBe('very_high');
    expect(resolveAssetAttributes([observation({ source: 'microsoft_graph', reportedCriticality: 'unknown' })], [], null).criticality).toBe('unknown');
  });

  it('lets a band set by hand outrank the lift', () => {
    const reported = observation({ source: 'microsoft_graph', reportedCriticality: 'unknown' });
    expect(resolveAssetAttributes([reported], [{ attribute: 'criticality', value: 'low' }], 'high').criticality).toBe('low');
  });

  it('resolves category by source authority: microsoft_graph outranks openaev', () => {
    const graph = observation({ source: 'microsoft_graph', reportedCategoryId: 'host', sourceLastActivityAt: new Date('2026-01-01') });
    const openaev = observation({ source: 'openaev', reportedCategoryId: 'mobile_device', sourceLastActivityAt: new Date('2026-06-01') });
    expect(resolveAssetAttributes([graph, openaev]).categoryId).toBe('host');
  });

  it('breaks a category authority tie on which source reported most recently', () => {
    const older = observation({ source: 'openaev', reportedCategoryId: 'mobile_device', sourceLastActivityAt: new Date('2026-01-01') });
    const newer = observation({ source: 'openaev', reportedCategoryId: 'host', sourceLastActivityAt: new Date('2026-06-01') });
    expect(resolveAssetAttributes([older, newer]).categoryId).toBe('host');
  });

  it('resolves first/last seen to the earliest/latest across observations', () => {
    const a = observation({ source: 'microsoft_graph', firstSeenAt: new Date('2026-01-01'), lastSeenAt: new Date('2026-03-01') });
    const b = observation({ source: 'openaev', firstSeenAt: new Date('2025-12-01'), lastSeenAt: new Date('2026-06-01') });
    const resolved = resolveAssetAttributes([a, b]);
    expect(resolved.firstSeenAt).toEqual(new Date('2025-12-01'));
    expect(resolved.lastSeenAt).toEqual(new Date('2026-06-01'));
  });

  it('a manual value outranks every rule, on each of the five resolvable attributes', () => {
    const a = observation({
      source: 'microsoft_graph',
      reportedName: 'DESKTOP-7F3K2',
      reportedExposure: 'internal',
      reportedCategoryId: 'host',
      reportedCriticality: 'high',
      reportedDescription: 'Reported by the connector',
    });
    const resolved = resolveAssetAttributes([a], [
      { attribute: 'name', value: 'Payroll server' },
      { attribute: 'exposure', value: 'unknown' },
      { attribute: 'category', value: 'generic_asset' },
      { attribute: 'criticality', value: 'low' },
      { attribute: 'description', value: 'Runs the monthly payroll batch.' },
    ]);
    expect(resolved.name).toBe('Payroll server');
    expect(resolved.exposure).toBe('unknown');
    expect(resolved.categoryId).toBe('generic_asset');
    expect(resolved.criticality).toBe('low');
    expect(resolved.description).toBe('Runs the monthly payroll batch.');
  });

  it('leaves an attribute no manual value pins to its rule, the other three being pinned', () => {
    const older = observation({ source: 'openaev', reportedName: 'old-name', sourceLastActivityAt: new Date('2026-01-01') });
    const newer = observation({ source: 'openaev', reportedName: 'new-name', sourceLastActivityAt: new Date('2026-06-01') });
    const resolved = resolveAssetAttributes([older, newer], [
      { attribute: 'exposure', value: 'internet_facing' },
      { attribute: 'category', value: 'generic_asset' },
      { attribute: 'criticality', value: 'high' },
    ]);
    expect(resolved.name).toBe('new-name');
  });

  it('resolves name the same way whatever order same-instant observations are read in', () => {
    // Two source rows written by one transaction share `now()`: the winner must be the more
    // authoritative source, not whichever row came back first.
    const sameInstant = new Date('2026-06-01');
    const graph = observation({ source: 'microsoft_graph', sourceAssetId: 'device-1', reportedName: 'graph-name', sourceLastActivityAt: sameInstant });
    const openaev = observation({ source: 'openaev', sourceAssetId: 'ep-1', reportedName: 'openaev-name', sourceLastActivityAt: sameInstant });
    expect(resolveAssetAttributes([graph, openaev]).name).toBe('graph-name');
    expect(resolveAssetAttributes([openaev, graph]).name).toBe('graph-name');
  });

  it('resolves category the same way whatever order same-instant observations of one source are read in', () => {
    const sameInstant = new Date('2026-06-01');
    const first = observation({ source: 'openaev', sourceAssetId: 'ep-1', reportedCategoryId: 'host', sourceLastActivityAt: sameInstant });
    const second = observation({ source: 'openaev', sourceAssetId: 'ep-2', reportedCategoryId: 'mobile_device', sourceLastActivityAt: sameInstant });
    expect(resolveAssetAttributes([first, second]).categoryId).toBe('host');
    expect(resolveAssetAttributes([second, first]).categoryId).toBe('host');
  });

  it('resolves description and external reference to the most recently reported non-null value', () => {
    const older = observation({
      source: 'openaev', reportedDescription: 'old text', externalReference: 'CMDB-1', sourceLastActivityAt: new Date('2026-01-01'),
    });
    const newer = observation({
      source: 'openaev', reportedDescription: 'new text', externalReference: 'CMDB-2', sourceLastActivityAt: new Date('2026-06-01'),
    });
    const resolved = resolveAssetAttributes([older, newer]);
    expect(resolved.description).toBe('new text');
    expect(resolved.externalReference).toBe('CMDB-2');
  });

  it('skips a source reporting no description, rather than resolving the field to null', () => {
    const described = observation({ source: 'openaev', reportedDescription: 'the only text', sourceLastActivityAt: new Date('2026-01-01') });
    const silent = observation({ source: 'openaev', reportedDescription: null, sourceLastActivityAt: new Date('2026-06-01') });
    expect(resolveAssetAttributes([described, silent]).description).toBe('the only text');
  });

  it('takes the subcategory from the same observation the category was resolved from', () => {
    const graph = observation({
      source: 'microsoft_graph', reportedCategoryId: 'host', reportedSubcategoryId: 'server', sourceLastActivityAt: new Date('2026-01-01'),
    });
    const openaev = observation({
      source: 'openaev', reportedCategoryId: 'mobile_device', reportedSubcategoryId: 'smartphone', sourceLastActivityAt: new Date('2026-06-01'),
    });
    const resolved = resolveAssetAttributes([graph, openaev]);
    expect(resolved.categoryId).toBe('host');
    expect(resolved.subcategoryId).toBe('server');
  });

  it('drops a subcategory a hand-set category no longer contains, and keeps one it still does', () => {
    const a = observation({ source: 'openaev', reportedCategoryId: 'host', reportedSubcategoryId: 'server' });
    expect(resolveAssetAttributes([a], [{ attribute: 'category', value: 'identity' }]).subcategoryId).toBeNull();
    expect(resolveAssetAttributes([a], [{ attribute: 'category', value: 'host' }]).subcategoryId).toBe('server');
  });

  it('a manual subcategory outranks the one the winning source reports', () => {
    const a = observation({ source: 'openaev', reportedCategoryId: 'host', reportedSubcategoryId: 'server' });
    const resolved = resolveAssetAttributes([a], [{ attribute: 'subcategory', value: 'workstation' }]);
    expect(resolved.subcategoryId).toBe('workstation');
  });

  it('drops a hand-set subcategory that no longer belongs to the resolved category', () => {
    const a = observation({ source: 'openaev', reportedCategoryId: 'host', reportedSubcategoryId: 'server' });
    // 'router' belongs to 'network_device', not the resolved 'host' category.
    const resolved = resolveAssetAttributes([a], [{ attribute: 'subcategory', value: 'router' }]);
    expect(resolved.subcategoryId).toBeNull();
  });

  it('validates a hand-set subcategory against the category a hand-set pin resolved, not the connector\'s own', () => {
    const a = observation({ source: 'openaev', reportedCategoryId: 'network_device', reportedSubcategoryId: 'router' });
    const resolved = resolveAssetAttributes([a], [
      { attribute: 'category', value: 'host' },
      { attribute: 'subcategory', value: 'server' },
    ]);
    expect(resolved.categoryId).toBe('host');
    expect(resolved.subcategoryId).toBe('server');
  });

  it('a manual url outranks the one the most recently reporting source reports', () => {
    const older = observation({ source: 'microsoft_graph', reportedUrl: 'https://old.example.com', sourceLastActivityAt: new Date('2026-01-01') });
    const newer = observation({ source: 'openaev', reportedUrl: 'https://new.example.com', sourceLastActivityAt: new Date('2026-06-01') });
    const resolved = resolveAssetAttributes([older, newer], [{ attribute: 'url', value: 'https://hand-typed.example.com' }]);
    expect(resolved.url).toBe('https://hand-typed.example.com');
  });

  it('falls back to the most recently reported url when no manual value pins it', () => {
    const a = observation({ source: 'openaev', reportedUrl: 'https://reported.example.com' });
    expect(resolveAssetAttributes([a]).url).toBe('https://reported.example.com');
  });

  it('a manual linkedPerson outranks the one the most recently reporting source reports', () => {
    const older = observation({ source: 'microsoft_graph', reportedLinkedPerson: 'Old Person', sourceLastActivityAt: new Date('2026-01-01') });
    const newer = observation({ source: 'openaev', reportedLinkedPerson: 'New Person', sourceLastActivityAt: new Date('2026-06-01') });
    const resolved = resolveAssetAttributes([older, newer], [{ attribute: 'linkedPerson', value: 'Jane Doe' }]);
    expect(resolved.linkedPerson).toBe('Jane Doe');
  });

  it('falls back to the most recently reported linkedPerson when no manual value pins it', () => {
    const a = observation({ source: 'openaev', reportedLinkedPerson: 'Jane Doe' });
    expect(resolveAssetAttributes([a]).linkedPerson).toBe('Jane Doe');
  });

  it('throws when given no observations', () => {
    expect(() => resolveAssetAttributes([])).toThrow();
  });

  it('a manual observation changes no scalar attribute', () => {
    const connector = observation({
      source: 'microsoft_graph',
      reportedName: 'DESKTOP-7F3K2',
      reportedExposure: 'internal',
      reportedCategoryId: 'host',
      reportedCriticality: 'medium',
      reportedDescription: 'Reported by the connector',
    });
    const manual = observation({
      source: null,
      origin: 'user',
      reportedName: 'Typed by hand',
      reportedExposure: 'internet_facing',
      reportedCategoryId: 'generic_asset',
      reportedCriticality: 'high',
      reportedDescription: 'Typed description',
    });
    expect(resolveAssetAttributes([connector, manual])).toEqual(resolveAssetAttributes([connector]));
  });
});
