/**
 * Identifiers of the tenant capabilities, declared once so the catalog, the security policies and
 * the frontend can designate one without copying a UUID literal.
 *
 * This file carries UUID literals and nothing else: it is re-exported through `modules/ids.ts` into
 * the browser bundle, so it must never import anything that reaches the database.
 */

export const Capability_ManageSecurity = '6e8014f5-6f48-442d-8e47-a5d8f7f45411';
