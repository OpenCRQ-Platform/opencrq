import { NonRetryableError } from '@app/module';
import { fromError, newError } from '@app/utils';
import { z } from 'zod';

const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

export interface TokenResult {
  accessToken: string,
  expiresAt: number,
}

export const acquireToken = async (
  azureTenantId: string, clientId: string, clientSecret: string,
): Promise<TokenResult> => {
  const url = `https://login.microsoftonline.com/${azureTenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });
  const res = await fetch(url, { method: 'POST', body });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new NonRetryableError(`OAuth2 auth error (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw newError(`OAuth2 token error: ${res.status} — ${text.slice(0, 300)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw fromError(err, `OAuth2 returned non-JSON response: ${text.slice(0, 300)}`);
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw newError(`OAuth2 returned unexpected response: ${text.slice(0, 300)}`);
  }
  return { accessToken: parsed.data.access_token, expiresAt: Date.now() + (parsed.data.expires_in - 60) * 1000 };
};

export const isTokenExpired = (token: TokenResult): boolean => Date.now() >= token.expiresAt;
