/**
 * The threat given to a flaw nothing is known about: no CISA listing, no EPSS above it, no cited
 * active threat. A stored threat above it means some signal lifted the flaw.
 */
export const SILENT_FLAW_THREAT = 0.05;
