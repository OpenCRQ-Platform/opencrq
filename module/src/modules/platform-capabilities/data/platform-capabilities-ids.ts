/**
 * Identifiers of the platform capabilities, declared once so the catalog, the services and the
 * frontend can designate one without copying a UUID literal.
 *
 * This file carries UUID literals and nothing else: it is re-exported through `modules/ids.ts` into
 * the browser bundle, so it must never import anything that reaches the database.
 */

export const PlatformCapability_CreateTenants = '05194e11-45cd-475e-b961-192ff8adcb66';
export const PlatformCapability_ManageUsers = 'ff8a89e0-c05c-429e-acbb-93c9fb9d018a';
export const PlatformCapability_PlatformAccess = '4bdaf17e-97cd-4a28-abb9-f590f2eb2037';
