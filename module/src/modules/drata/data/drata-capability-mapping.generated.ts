// Generated reference data. Edit the generator, never this file.

export interface DrataCapabilityEvidenceProvenance {
  readonly generatedAt: string,
  /** Every pair was judged and attested by independent panels from the control's own catalogue text. */
  readonly judgmentPromptVersion: string,
  readonly attestationPromptVersion: string,
  readonly judgmentModel: string,
  readonly controlsFetchedAt: string,
  readonly dcfControlCount: number,
  readonly capabilityCount: number,
}

export const DRATA_CAPABILITY_EVIDENCE_PROVENANCE: DrataCapabilityEvidenceProvenance = {
  generatedAt: '2026-11-02',
  judgmentPromptVersion: '1',
  attestationPromptVersion: '1',
  judgmentModel: 'claude-opus-5-5',
  controlsFetchedAt: '2026-10-29',
  dcfControlCount: 472,
  capabilityCount: 51,
};

/**
 * The DCF controls whose readiness evidences each control capability, each pair carrying what a
 * ready verdict attests on both assessment axes: `levels`, the strength levels whose mechanism
 * it attests (L1 the base mechanism, L2 and L3 what each adds), and `reach`, whether it claims
 * the capability's whole coverage unit (`org_wide`) or a named slice of it (`slice`), absent
 * when it names neither. A pair attesting no level is no evidence and is left out. Keyed on the
 * capability catalogue's external ids; an empty list is a judged verdict, not a gap.
 */
export const DRATA_DCF_CAPABILITY_EVIDENCE = {
  'ADH': [],
  'AIGW': [],
  'APM': [],
  'APPH': [
    { code: 'DCF-338', levels: ['L1'] },
    { code: 'DCF-339', levels: ['L1'] },
    { code: 'DCF-340', levels: ['L1'] },
    { code: 'DCF-676', levels: ['L1'] },
    { code: 'DCF-58', levels: ['L3'], reach: 'slice' },
  ],
  'BKP': [
    { code: 'DCF-98', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-382', levels: ['L1', 'L3'] },
  ],
  'CLDH': [
    { code: 'DCF-75', levels: ['L1'], reach: 'org_wide' },
  ],
  'CNAPP': [
    { code: 'DCF-89', levels: ['L1'], reach: 'org_wide' },
  ],
  'CPS': [],
  'CWPP': [],
  'DAM': [],
  'DDOS': [],
  'DECEP': [],
  'DLP': [
    { code: 'DCF-150', levels: ['L1'], reach: 'slice' },
  ],
  'DSPM': [],
  'EDR': [
    { code: 'DCF-50', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-291', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-293', levels: ['L1'] },
    { code: 'DCF-294', levels: ['L1'] },
    { code: 'DCF-522', levels: ['L1'] },
    { code: 'DCF-903', levels: ['L1'] },
  ],
  'FIM': [
    { code: 'DCF-151', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-478', levels: ['L1'] },
    { code: 'DCF-650', levels: ['L1'] },
  ],
  'FRAUD': [],
  'IDP': [
    { code: 'DCF-58', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-67', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-354', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-355', levels: ['L1'], reach: 'slice' },
  ],
  'IDV': [],
  'IGA': [
    { code: 'DCF-43', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-70', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-335', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-11', levels: ['L2'], reach: 'org_wide' },
    { code: 'DCF-524', levels: ['L2'], reach: 'slice' },
    { code: 'DCF-894', levels: ['L2'], reach: 'slice' },
  ],
  'IPS': [],
  'ITDR': [],
  'ITIM': [
    { code: 'DCF-81', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-82', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-83', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-84', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-86', levels: ['L1'], reach: 'slice' },
  ],
  'KMS': [
    { code: 'DCF-52', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-54', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-98', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-149', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-265', levels: ['L1'], reach: 'org_wide' },
  ],
  'MDR': [],
  'MSEG': [],
  'NAC': [],
  'NDH': [],
  'NDR': [],
  'NGFW': [
    { code: 'DCF-73', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-85', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-206', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-214', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-218', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-748', levels: ['L2'], reach: 'org_wide' },
  ],
  'OSH': [
    { code: 'DCF-12', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-240', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-244', levels: ['L1'], reach: 'org_wide' },
  ],
  'PAM': [],
  'PATCH': [
    { code: 'DCF-51', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-152', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-297', levels: ['L1'] },
    { code: 'DCF-677', levels: ['L1'], reach: 'org_wide' },
  ],
  'PKI': [],
  'PWM': [
    { code: 'DCF-49', levels: ['L1'], reach: 'slice' },
  ],
  'RASP': [],
  'SAASH': [],
  'SAT': [
    { code: 'DCF-36', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-503', levels: ['L1'], reach: 'org_wide' },
    { code: 'DCF-681', levels: ['L2'] },
  ],
  'SCA': [
    { code: 'DCF-784', levels: ['L1'], reach: 'org_wide' },
  ],
  'SEB': [],
  'SEG': [
    { code: 'DCF-687', levels: ['L1'], reach: 'org_wide' },
  ],
  'SIEM': [
    { code: 'DCF-80', levels: ['L1'] },
    { code: 'DCF-87', levels: ['L1'], reach: 'slice' },
    { code: 'DCF-560', levels: ['L1', 'L3'], reach: 'org_wide' },
    { code: 'DCF-698', levels: ['L1'], reach: 'org_wide' },
  ],
  'SOC': [
    { code: 'DCF-28', levels: ['L1'] },
  ],
  'SSDLC': [
    { code: 'DCF-5', levels: ['L1'], reach: 'org_wide' },
  ],
  'SSPM': [],
  'SWG': [
    { code: 'DCF-780', levels: ['L1'] },
  ],
  'TLS': [
    { code: 'DCF-55', levels: ['L2'], reach: 'org_wide' },
  ],
  'UEM': [
    { code: 'DCF-574', levels: ['L1'], reach: 'org_wide' },
  ],
  'WAF': [
    { code: 'DCF-88', levels: ['L1'], reach: 'org_wide' },
  ],
  'WIFI': [],
  'ZTNA': [
    { code: 'DCF-355', levels: ['L1'], reach: 'org_wide' },
  ],
} as const;
