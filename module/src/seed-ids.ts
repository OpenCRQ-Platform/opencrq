import { v5 as uuidv5 } from 'uuid';

/**
 * Stable identifier derived under a parent UUID, which acts as its own namespace.
 * `parentId` must be a unique UUID: that is what makes a hand-rolled namespace unnecessary.
 * Two shapes use it: `(tenantId, catalogId)` for a catalog entry provisioned per tenant, and
 * `(code, frameworkId)` for a requirement under its framework.
 */
export const deriveSeedId = (key: string, parentId: string): string => uuidv5(key, parentId);
