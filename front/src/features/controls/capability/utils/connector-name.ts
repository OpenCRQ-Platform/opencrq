// eslint-disable-next-line lingui/no-unlocalized-strings -- a product name, the same in every locale
const CONNECTOR_NAMES: Readonly<Record<string, string>> = { openaev: 'OpenAEV' };

// Connector codes are lowercase machine names ('drata'); the UI shows them capitalized unless the product spells its name otherwise.
export const formatConnectorName = (connector: string): string => (
  CONNECTOR_NAMES[connector] ?? connector.charAt(0).toUpperCase() + connector.slice(1)
);
