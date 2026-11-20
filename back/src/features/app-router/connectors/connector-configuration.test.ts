import { describe, expect, it } from 'vitest';
import type { ConnectorsCredentials, ConnectorSettingsRow } from './connector-configuration';
import { DEFAULT_THREATS_DATASET_URL, defaultThreatsFileUrl, defaultThreatsRunState, resolveConnectorConfigurations, resolveRunnableConnectors } from './connector-configuration';

const TENANT_ID = '00000000-0000-0000-0000-000000000010';
const OTHER_TENANT_ID = '00000000-0000-0000-0000-000000000020';

const bound = (source: ConnectorSettingsRow['source']): ConnectorSettingsRow =>
  ({ source, serviceAccountId: '00000000-0000-0000-0000-000000000001' });

const unbound = (source: ConnectorSettingsRow['source']): ConnectorSettingsRow =>
  ({ source, serviceAccountId: null });

const allCredentials: ConnectorsCredentials = {
  microsoft_graph: { [TENANT_ID]: { azure_tenant_id: 't', client_id: 'c', client_secret: 's' } },
  openaev: { [TENANT_ID]: { url: 'https://openaev.example' } },
  opencti: { [TENANT_ID]: { url: 'https://opencti.example' } },
  drata: { [TENANT_ID]: { url: 'https://public-api.drata.com', api_key: 'k', workspace_id: 1 } },
};

describe('resolveConnectorConfigurations', () => {
  it('covers every connector, including the stream one that has no integration_settings row', () => {
    const result = resolveConnectorConfigurations(allCredentials, TENANT_ID, [], null, null);
    expect(Object.keys(result).sort()).toEqual(
      ['cisa', 'default_threats', 'drata', 'first', 'microsoft_graph', 'nist', 'openaev', 'opencti'],
    );
  });

  it('holds the three public sources available with no deployment credential', () => {
    const result = resolveConnectorConfigurations(undefined, TENANT_ID, [], null, null);
    expect(result.first.platformConfigured).toBe(true);
    expect(result.nist.platformConfigured).toBe(true);
    expect(result.cisa.platformConfigured).toBe(true);
  });

  it('reads a connector unavailable when its deployment credential is missing', () => {
    const result = resolveConnectorConfigurations({}, TENANT_ID, [], null, null);
    expect(result.drata.platformConfigured).toBe(false);
    expect(result.microsoft_graph.platformConfigured).toBe(false);
    expect(result.openaev.platformConfigured).toBe(false);
    expect(result.opencti.platformConfigured).toBe(false);
  });

  it('reads a connector unavailable for a tenant that has no entry, even if another tenant is configured', () => {
    const result = resolveConnectorConfigurations(allCredentials, OTHER_TENANT_ID, [], null, null);
    expect(result.drata.platformConfigured).toBe(false);
    expect(result.microsoft_graph.platformConfigured).toBe(false);
    expect(result.openaev.platformConfigured).toBe(false);
    expect(result.opencti.platformConfigured).toBe(false);
  });

  it('reads a connector unavailable when there is no tenant to scope the lookup to', () => {
    const result = resolveConnectorConfigurations(allCredentials, undefined, [], null, null);
    expect(result.drata.platformConfigured).toBe(false);
    expect(result.openaev.platformConfigured).toBe(false);
  });

  it('binds a connector to the tenant only through a non-null service account', () => {
    const result = resolveConnectorConfigurations(allCredentials, TENANT_ID, [bound('drata'), unbound('openaev')], null, null);
    expect(result.drata.tenantConfigured).toBe(true);
    expect(result.openaev.tenantConfigured).toBe(false);
    expect(result.first.tenantConfigured).toBe(false);
  });

  it('binds the stream connector only when both its stream and its service account are set', () => {
    const withBoth = resolveConnectorConfigurations(allCredentials, TENANT_ID, [], {
      streamId: 'live-threats',
      serviceAccountId: '00000000-0000-0000-0000-000000000002',
    }, null);
    const withStreamOnly = resolveConnectorConfigurations(allCredentials, TENANT_ID, [], {
      streamId: 'live-threats',
      serviceAccountId: null,
    }, null);
    const withAccountOnly = resolveConnectorConfigurations(allCredentials, TENANT_ID, [], {
      streamId: null,
      serviceAccountId: '00000000-0000-0000-0000-000000000002',
    }, null);
    expect(withBoth.opencti.tenantConfigured).toBe(true);
    expect(withStreamOnly.opencti.tenantConfigured).toBe(false);
    expect(withAccountOnly.opencti.tenantConfigured).toBe(false);
  });

  it('takes the vendor url from the deployment for the two connectors that carry one', () => {
    const result = resolveConnectorConfigurations(allCredentials, TENANT_ID, [], null, null);
    expect(result.openaev.url).toBe('https://openaev.example');
    expect(result.opencti.url).toBe('https://opencti.example');
  });

  it('leaves the vendor url null when the deployment declares no url', () => {
    const result = resolveConnectorConfigurations({}, TENANT_ID, [], null, null);
    expect(result.openaev.url).toBeNull();
    expect(result.opencti.url).toBeNull();
  });

  it('keeps the fixed vendor urls of the connectors whose vendor is not deployment-specific', () => {
    const result = resolveConnectorConfigurations(undefined, TENANT_ID, [], null, null);
    expect(result.first.url).toBe('https://www.first.org/epss/');
    expect(result.nist.url).toBe('https://nvd.nist.gov/');
    expect(result.cisa.url).toBe('https://www.cisa.gov/known-exploited-vulnerabilities-catalog');
    expect(result.drata.url).toBe('https://app.drata.com/');
    expect(result.microsoft_graph.url).toBe('https://security.microsoft.com/');
  });
});

describe('Default Threats configuration', () => {
  it('reads OpenCRQ\'s dataset repository unless the platform sets another folder', () => {
    expect(defaultThreatsFileUrl(undefined)).toBe(`${DEFAULT_THREATS_DATASET_URL}default-threats-v1.json`);
    expect(defaultThreatsFileUrl({ default_threats: { dataset_url: 'https://mirror.example/data' } }))
      .toBe('https://mirror.example/data/default-threats-v1.json');
  });

  it('reads the connector unavailable on a platform that emptied the dataset URL', () => {
    const credentials = { default_threats: { dataset_url: '' } };
    expect(defaultThreatsFileUrl(credentials)).toBeNull();
    expect(resolveConnectorConfigurations(credentials, TENANT_ID, [], null, null).default_threats.platformConfigured).toBe(false);
  });

  it('carries the tenant\'s switch for Default Threats alone, on unless the tenant turned it off', () => {
    const switchedOff = resolveConnectorConfigurations(undefined, TENANT_ID, [], null, { enabled: false, loaded: true });
    const switchedOn = resolveConnectorConfigurations(undefined, TENANT_ID, [], null, { enabled: true, loaded: false });
    const noTenant = resolveConnectorConfigurations(undefined, undefined, [], null, null);

    expect(Object.entries(switchedOff).filter(([, configuration]) => !configuration.enabled).map(([source]) => source)).toEqual(['default_threats']);
    expect(Object.values(switchedOn).every((configuration) => configuration.enabled)).toBe(true);
    expect(Object.values(noTenant).every((configuration) => configuration.enabled)).toBe(true);
  });

  it('leaves a tenant nothing to configure', () => {
    expect(resolveConnectorConfigurations(undefined, TENANT_ID, [], null, null).default_threats)
      .toMatchObject({ platformConfigured: true, tenantConfigured: true });
  });
});

describe('defaultThreatsRunState', () => {
  it('reads a tenant as loaded once the dataset was recorded', () => {
    expect(defaultThreatsRunState({ enabled: true, loadedAt: null })).toEqual({ enabled: true, loaded: false });
    expect(defaultThreatsRunState({ enabled: false, loadedAt: new Date() })).toEqual({ enabled: false, loaded: true });
  });
});

describe('resolveRunnableConnectors', () => {
  const defaultThreatsOf = (state: { enabled: boolean, loaded: boolean }, credentials?: ConnectorsCredentials) =>
    resolveRunnableConnectors(credentials, TENANT_ID, [], state).find((connector) => connector.entry.source === 'default_threats');

  it('runs Default Threats with no service account while it is enabled', () => {
    expect(defaultThreatsOf({ enabled: true, loaded: true })).toMatchObject({ payload: {}, firstRunNow: false });
  });

  it('runs a tenant\'s first load at once rather than at the next slot', () => {
    expect(defaultThreatsOf({ enabled: true, loaded: false })).toMatchObject({ payload: {}, firstRunNow: true });
  });

  it('runs nothing for a tenant that switched it off, or on a platform that turned it off', () => {
    expect(defaultThreatsOf({ enabled: false, loaded: false })).toMatchObject({ payload: null, firstRunNow: false });
    expect(defaultThreatsOf({ enabled: true, loaded: false }, { default_threats: { dataset_url: '' } }))
      .toMatchObject({ payload: null, firstRunNow: false });
  });

  it('runs a connector backed by integration settings with its bound service account only', () => {
    const [first] = resolveRunnableConnectors(undefined, TENANT_ID, [bound('first')], { enabled: false, loaded: false });
    const [unboundFirst] = resolveRunnableConnectors(undefined, TENANT_ID, [unbound('first')], { enabled: false, loaded: false });
    expect(first.payload).toEqual({ serviceAccountId: '00000000-0000-0000-0000-000000000001' });
    expect(unboundFirst.payload).toBeNull();
  });
});
