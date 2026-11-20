export const scopePath = (tenantId: string, organizationId: string | undefined, surface: string): string => [
  '',
  tenantId,
  ...(organizationId === undefined ? [] : [organizationId]),
  ...(surface === '' ? [] : [surface]),
].join('/');
