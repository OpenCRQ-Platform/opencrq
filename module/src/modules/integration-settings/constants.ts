export const INTEGRATION_SOURCES = ['first', 'nist', 'cisa', 'microsoft_graph', 'openaev', 'drata'] as const;
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number];

export const isIntegrationSource = (source: string): source is IntegrationSource =>
  (INTEGRATION_SOURCES as ReadonlyArray<string>).includes(source);
