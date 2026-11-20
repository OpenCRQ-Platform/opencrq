/** The technique a phishing campaign plays, read on people rather than on an asset's flaws. */
export const PHISHING_TECHNIQUE = 'T1566';

/**
 * The share of a campaign's recipients who take a compromising action (credentials entered, macro
 * enabled) when the tenant declares no simulation rate, before any awareness training. Judgment: a
 * middle value chosen by OpenCRQ's calibration across click rates whose lures move it from 2 % to
 * 22 %, at the share of clicks that lead to such an action.
 */
export const DEFAULT_PHISHING_SUSCEPTIBILITY = 0.07;
