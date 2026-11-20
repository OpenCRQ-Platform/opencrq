import { newError, StructuredError } from '@app/utils';
import type { XtmOneSettings } from './xtm-one-config';

/**
 * XTM One's identity, as opposed to the URL this platform reaches it on.
 *
 * In Docker or Kubernetes `xtm_one.url` is an internal address
 * (`http://xtm-one:4000`) while XTM One signs its tokens with, expects on the
 * tokens sent to it, and serves its web app on its public `BASE_URL`: the
 * issuer it publishes at `/xtm/auth/metadata`. An XTM One that predates the
 * document is known by the configured URL alone.
 *
 * Kept free of config/logger imports so it stays unit-testable.
 */

const IDENTITY_TTL_MS = 60 * 60_000;
const RETRY_AFTER_MS = 60_000;
const METADATA_TIMEOUT_MS = 10_000;

/**
 * `url` as one spelling: lower-case scheme and host, no default port, no
 * trailing slash. `undefined` for anything but an http(s) URL: user info, a
 * query or a fragment would make two different identities compare equal.
 */
export const canonicalXtmOneUrl = (url: string | undefined | null): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return undefined;
    }
    return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return undefined;
  }
};

interface Identity {
  issuer: string | undefined,
  expiresAt: number,
}

// Keyed by the configured URL: the settings are read per call.
const identities = new Map<string, Identity>();
const inFlight = new Map<string, Promise<string | undefined>>();

/** A 404 from the metadata document: XTM One publishes no identity. */
class IdentityNotPublished extends StructuredError {
  override readonly name: string = 'IdentityNotPublished';

  constructor() {
    super('XTM One publishes no identity', { data: {} });
  }
}

const readPublishedIssuer = async (url: string): Promise<string> => {
  const response = await fetch(`${url}/xtm/auth/metadata`, {
    headers: { Accept: 'application/json' },
    // Only the configured URL may answer: a redirect is a failed read, never
    // another origin supplying XTM One's identity.
    redirect: 'manual',
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
  if (response.status === 404) {
    throw new IdentityNotPublished();
  }
  if (!response.ok) {
    throw newError('XTM One metadata unavailable', { status: response.status });
  }
  const document: unknown = await response.json();
  const published = typeof document === 'object' && document !== null
    ? (document as { issuer?: unknown }).issuer
    : undefined;
  const issuer = typeof published === 'string' ? canonicalXtmOneUrl(published) : undefined;
  if (!issuer) {
    // Only a 404 says XTM One publishes no identity: a document without one is a failed read.
    throw newError('XTM One metadata names no usable issuer');
  }
  return issuer;
};

const refresh = async (url: string): Promise<string | undefined> => {
  const previous = identities.get(url)?.issuer;
  try {
    const issuer = await readPublishedIssuer(url);
    identities.set(url, { issuer, expiresAt: Date.now() + IDENTITY_TTL_MS });
    return issuer;
  } catch (error) {
    // A 404 drops the published identity: XTM One's tokens carry the
    // configured URL again. Any other failure is transient and keeps the last
    // identity it published, asked again soon.
    const issuer = error instanceof IdentityNotPublished ? undefined : previous;
    identities.set(url, { issuer, expiresAt: Date.now() + RETRY_AFTER_MS });
    return issuer;
  }
};

/** The issuer XTM One publishes, `undefined` when it publishes none or has never answered. */
export const getXtmOnePublishedIssuer = async (settings: XtmOneSettings): Promise<string | undefined> => {
  const current = identities.get(settings.url);
  if (current && current.expiresAt > Date.now()) {
    return current.issuer;
  }
  let pending = inFlight.get(settings.url);
  if (!pending) {
    pending = refresh(settings.url).finally(() => inFlight.delete(settings.url));
    inFlight.set(settings.url, pending);
  }
  // Past its expiry the last answer is served while it is read again: only
  // the first call ever waits for XTM One.
  return current ? current.issuer : pending;
};

/**
 * XTM One's identity: the audience of the tokens sent to it and the URL a
 * browser opens it on. Its published issuer, else the configured URL.
 */
export const resolveXtmOneIdentity = async (settings: XtmOneSettings): Promise<string> => (
  await getXtmOnePublishedIssuer(settings)
) ?? settings.url;

/** Whether `issuer` names XTM One: its configured URL or the issuer it publishes. */
export const isXtmOneIssuer = async (settings: XtmOneSettings, issuer: string): Promise<boolean> => {
  const candidate = canonicalXtmOneUrl(issuer);
  const configured = canonicalXtmOneUrl(settings.url);
  if (!candidate || !configured) {
    return false;
  }
  return candidate === configured || candidate === await getXtmOnePublishedIssuer(settings);
};

/** Test hook: forget every identity read so far. */
export const resetXtmOneIdentities = (): void => {
  identities.clear();
  inFlight.clear();
};
