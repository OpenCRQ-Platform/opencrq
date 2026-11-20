/** @vitest-environment jsdom */
import { i18n } from '@lingui/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AssetObservationProperties } from '@app/module/client';
import { AssetPropertyCards } from './asset-property-cards';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

afterEach(() => {
  cleanup();
});

type MachineProperties = AssetObservationProperties & { family: 'machine' };

const machineProperties = (overrides: Partial<Omit<MachineProperties, 'family'>> = {}): MachineProperties => ({
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

type IdentityProperties = AssetObservationProperties & { family: 'identity' };

const identityProperties = (overrides: Partial<Omit<IdentityProperties, 'family'>> = {}): IdentityProperties => ({
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

describe('AssetPropertyCards', () => {
  it('shows no property card for an asset with no family block', () => {
    render(<AssetPropertyCards properties={null} manualProperties={null} />);
    expect(screen.queryByText('Network')).toBeNull();
    expect(screen.queryByText('Machine')).toBeNull();
    expect(screen.queryByText('AI target connection')).toBeNull();
    expect(screen.queryByText('Cloud')).toBeNull();
  });

  it('draws an identity\'s block on the Identity card, never on the machine one', () => {
    render(<AssetPropertyCards properties={identityProperties({ accountDomain: 'corp', accountName: 'jdoe' })} manualProperties={null} />);
    expect(screen.getByText('Identity')).toBeTruthy();
    expect(screen.getByText('jdoe')).toBeTruthy();
    expect(screen.queryByText('Network')).toBeNull();
    expect(screen.queryByText('Hostname')).toBeNull();
  });

  it('draws no Identity card for a block with nothing to show', () => {
    render(<AssetPropertyCards properties={identityProperties({ directoryObjectId: 'obj-1' })} manualProperties={null} />);
    expect(screen.queryByText('Identity')).toBeNull();
  });

  it('marks the identity field a person typed, not the one the directory reported', () => {
    const merged = identityProperties({ userPrincipalName: 'jdoe@corp.example', department: 'Finance' });
    const manual = identityProperties({ department: 'Finance' });
    render(<AssetPropertyCards properties={merged} manualProperties={manual} />);

    expect(screen.getAllByLabelText('Set by user')).toHaveLength(1);
    expect(screen.getByText('Department').closest('p')?.querySelector('[aria-label="Set by user"]')).not.toBeNull();
    expect(screen.getByText('User principal name').closest('p')?.querySelector('[aria-label="Set by user"]')).toBeNull();
  });

  it('shows the Network card for an asset whose only block is manual', () => {
    const manual = machineProperties({ hostname: 'my-host' });
    render(<AssetPropertyCards properties={manual} manualProperties={manual} />);
    expect(screen.getByText('Network')).toBeTruthy();
    expect(screen.getByText('my-host')).toBeTruthy();
  });

  it('marks only the field the manual block itself carries, not one merged in from a connector', () => {
    const merged = machineProperties({ hostname: 'my-host', platform: 'windows' });
    const manual = machineProperties({ hostname: 'my-host' });
    render(<AssetPropertyCards properties={merged} manualProperties={manual} />);

    expect(screen.getAllByLabelText('Set by user')).toHaveLength(1);
    const hostnameField = screen.getByText('Hostname').closest('p');
    expect(hostnameField?.querySelector('[aria-label="Set by user"]')).not.toBeNull();
    const platformField = screen.getByText('Platform').closest('p');
    expect(platformField?.querySelector('[aria-label="Set by user"]')).toBeNull();
  });

  it('shows the vendor and model, marking the ones a person typed', () => {
    const merged = machineProperties({ vendor: 'Dell', model: 'PowerEdge R740' });
    const manual = machineProperties({ model: 'PowerEdge R740' });
    render(<AssetPropertyCards properties={merged} manualProperties={manual} />);

    expect(screen.getByText('Dell')).toBeTruthy();
    expect(screen.getByText('PowerEdge R740')).toBeTruthy();
    expect(screen.getByText('Model').closest('p')?.querySelector('[aria-label="Set by user"]')).not.toBeNull();
    expect(screen.getByText('Vendor').closest('p')?.querySelector('[aria-label="Set by user"]')).toBeNull();
  });

  it('splits a machine block into a Network card then a Machine card, each in its own order', () => {
    const { container } = render(<AssetPropertyCards properties={machineProperties()} manualProperties={null} />);

    const text = container.textContent ?? '';
    const labels = [
      'Network', 'Hostname', 'Seen IP', 'IP addresses', 'MAC addresses',
      'Machine', 'Platform', 'Architecture', 'Operating system', 'OS version', 'Vendor', 'Model', 'End of life',
    ];
    const positions = labels.map((label) => text.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('shows the operating system and its version, marking the ones a person typed', () => {
    const merged = machineProperties({ operatingSystem: 'Windows 11 25H2', osVersion: '10.0.26200.9711' });
    const manual = machineProperties({ osVersion: '10.0.26200.9711' });
    render(<AssetPropertyCards properties={merged} manualProperties={manual} />);

    expect(screen.getByText('Windows 11 25H2')).toBeTruthy();
    expect(screen.getByText('10.0.26200.9711')).toBeTruthy();
    expect(screen.getByText('OS version').closest('p')?.querySelector('[aria-label="Set by user"]')).not.toBeNull();
    expect(screen.getByText('Operating system').closest('p')?.querySelector('[aria-label="Set by user"]')).toBeNull();
  });

  it('abbreviates a long IPv6 address, still giving the whole one to assistive technology and the keyboard', () => {
    const whole = '2a01:cb1d:9271:f300:7b7b:3d50:14e4:f97a';
    render(<AssetPropertyCards properties={machineProperties({ ipAddresses: ['192.168.1.23', whole] })} manualProperties={null} />);

    expect(screen.getByText('192.168.1.23')).toBeTruthy();
    expect(screen.getByText('2a01:cb1d:…:14e4:f97a').getAttribute('aria-hidden')).toBe('true');
    const address = screen.getByText(whole).closest('p');
    expect(address?.getAttribute('tabindex')).toBe('0');
  });

  it('shows the Cloud card once a manual cloud provider is set, marked as set by user', () => {
    const properties = machineProperties({ cloudProvider: 'aws' });
    render(<AssetPropertyCards properties={properties} manualProperties={properties} />);

    expect(screen.getByText('Cloud')).toBeTruthy();
    const cloudProviderField = screen.getByText('Cloud provider').closest('p');
    expect(cloudProviderField?.querySelector('[aria-label="Set by user"]')).not.toBeNull();
  });

  it('shows the Cloud card for a region set without any cloud provider', () => {
    const properties = machineProperties({ cloudRegion: 'eu-west-3' });
    render(<AssetPropertyCards properties={properties} manualProperties={properties} />);

    expect(screen.getByText('Cloud')).toBeTruthy();
    expect(screen.getByText('eu-west-3')).toBeTruthy();
  });
});
