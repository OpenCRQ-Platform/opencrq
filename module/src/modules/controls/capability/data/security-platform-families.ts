import type { securityPlatformFamilies } from '../schema';

/**
 * The security-tooling families a control can be implemented by, mirroring OpenAEV's
 * `SECURITY_PLATFORM_TYPE` enum. `platformTypeKey` carries the enum literal exactly: ingested
 * platform instances are auto-mapped on that key, so it is stable and must never be reworded.
 * `name` is the display label and can be made friendlier at will.
 *
 * IDENTITY WARNING, read before editing any UUID below.
 * Each one was minted once and is written here permanently. Regenerating one is
 * indistinguishable from deleting a family and adding a different one: the reseed leaves the
 * old row behind and every control link and ingested platform resolved against it is orphaned.
 * Never regenerate an id, never move one onto another entry.
 */
export const SECURITY_PLATFORM_FAMILIES: Array<typeof securityPlatformFamilies.$inferInsert> = [
  { id: '07a08fb7-0840-416e-bf95-63b643bbb0f0', platformTypeKey: 'EDR', name: 'Endpoint Detection and Response (EDR)' },
  { id: '3cb37cc8-d245-4a0a-9f7e-23ff910c59b7', platformTypeKey: 'XDR', name: 'Extended Detection and Response (XDR)' },
  { id: 'ffdedcf9-4bd4-4e2d-9dbd-e53caeefa293', platformTypeKey: 'SIEM', name: 'Security Information and Event Management (SIEM)' },
  { id: '8ceeacef-091e-41ed-80fd-86a0ccf0a528', platformTypeKey: 'SOAR', name: 'Security Orchestration, Automation and Response (SOAR)' },
  { id: '8a79940e-53c7-4819-a14b-7a303b76dcbb', platformTypeKey: 'NDR', name: 'Network Detection and Response (NDR)' },
  { id: '38c52f22-4cd9-4399-a7a4-14fa514999c7', platformTypeKey: 'ISPM', name: 'Identity Security Posture Management (ISPM)' },
  { id: '08de4150-64f6-4b6e-ab2d-0fd956d86ad3', platformTypeKey: 'LLM_FIREWALL', name: 'LLM Firewall' },
  { id: 'cba551b0-f164-4a77-8b48-3ae1f9724d0e', platformTypeKey: 'AI_GATEWAY', name: 'AI Gateway' },
  { id: 'bd3cec75-530c-45f2-90b8-0c9e4772ddff', platformTypeKey: 'VULNERABILITY_SCANNER', name: 'Vulnerability Scanner' },
];

/**
 * Which controls each family implements, authored from catalogue judgment: this mapping has no
 * upstream source and is the one piece of this file that is a claim rather than a transcription.
 *
 * A family with no control and a control with no family are both valid. SOAR and vulnerability
 * scanning block and detect nothing, so the catalogue makes no control of them, and a control left
 * out (awareness training, encryption, network segmentation) simply receives no evidence from an
 * ingested platform.
 */
export const SECURITY_PLATFORM_FAMILY_CONTROLS: Record<string, Array<string>> = {
  EDR: ['EDR', 'OSH'],
  XDR: ['EDR', 'NDR', 'SEG'],
  SIEM: ['SIEM'],
  SOAR: [],
  NDR: ['NDR', 'IPS'],
  ISPM: ['IDP', 'IGA'],
  LLM_FIREWALL: ['AIGW'],
  AI_GATEWAY: ['AIGW'],
  VULNERABILITY_SCANNER: [],
};
