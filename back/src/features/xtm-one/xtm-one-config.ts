import { config } from '../../config';

/**
 * Resolved XTM One connection settings (deployment-level, like OpenCTI's
 * `xtm.xtm_one_url` / OpenAEV's `openaev.xtm.one.url` - no admin UI).
 */
export interface XtmOneSettings {
  /** XTM One base URL, no trailing slash. */
  url: string,
  /** Shared platform registration token (bearer for /register). */
  token: string,
  /** Public base URL of THIS OpenCRQ instance, no trailing slash. */
  platformUrl: string,
}

// The schema already trims and requires non-blank values; only the trailing slash (JWT
// issuer/audience, JWKS endpoints) is left to strip here.
const stripTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

export const getXtmOneSettings = (): XtmOneSettings | null => {
  const raw = config().xtm_one;
  if (!raw) {
    return null;
  }
  return {
    url: stripTrailingSlashes(raw.url),
    token: raw.token,
    platformUrl: stripTrailingSlashes(raw.platform_url),
  };
};
