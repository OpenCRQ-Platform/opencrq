import type { DrizzleDB } from '@app/module';
import type { XtmOneSettings } from './xtm-one-config';
import type { XtmOneUserIdentity } from './xtm-one-jwt';
import { platformVersion } from '../../utils/platform-version';
import { issueXtmOneJwt } from './xtm-one-jwt';
import { ensureSigningKey } from './xtm-one-keys';

/** The headers naming this platform on every call to XTM One, beside the user's token. */
export const platformIdentityHeaders = (settings: XtmOneSettings): Record<string, string> => ({
  'X-Platform-Product': 'opencrq',
  'X-Platform-URL': settings.platformUrl,
  'X-Platform-Version': platformVersion(),
});

/**
 * Build the authenticated headers for a proxied XTM One call on behalf of
 * an OpenCRQ user (fresh short-lived JWT per request, host identification
 * via `X-Platform-*` - see the OpenCTI/OpenAEV chatbot proxies).
 */
export const buildXtmOneHeaders = async (
  settings: XtmOneSettings,
  db: DrizzleDB,
  user: XtmOneUserIdentity,
): Promise<Record<string, string>> => {
  const material = await ensureSigningKey(db);
  const jwt = await issueXtmOneJwt(material, settings, user);
  return { 'Authorization': `Bearer ${jwt}`, ...platformIdentityHeaders(settings) };
};
