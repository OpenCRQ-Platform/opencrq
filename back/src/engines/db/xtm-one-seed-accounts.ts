import type { XtmOneSeedAccounts, XtmOneSeedDirectory } from '@app/module';
import { newError } from '@app/utils';
import { z } from 'zod';

// Every call runs under the database initialization lock, which the other processes wait on.
const REQUEST_TIMEOUT_MS = 5_000;
const DETAIL_MAX_LENGTH = 300;

const loginAnswer = z.object({ access_token: z.string().nullish() });
const createdUser = z.object({ id: z.string() });
const listedUsers = z.array(z.object({ id: z.string(), email: z.string() }));

interface XtmOneAdministrator {
  url: string,
  email: string,
  password: string,
}

interface SeedDirectoryOptions {
  /**
   * Sets the seed's password on an account it reuses, so a reseed with another password signs in
   * with it. Development only: elsewhere the account may be a real person's.
   */
  resetPasswordOnReuse?: boolean,
  requestTimeoutMs?: number,
}

/** Only a string `detail` is quoted: a validation error's list echoes the body sent, password included. */
const refusal = async (action: string, response: Response): Promise<Error> => {
  let detail = '';
  try {
    const answer = z.object({ detail: z.string() }).safeParse(await response.json());
    detail = answer.success ? `: ${answer.data.detail.slice(0, DETAIL_MAX_LENGTH)}` : '';
  } catch {
    // No JSON body: the status says enough.
  }
  return newError(`${action} failed, XTM One answered HTTP ${response.status}${detail}`);
};

/**
 * The platform seed's way into XTM One: signs in once as its administrator, creates each seeded user
 * as a local account, and on a conflict takes the id of the account that already holds the email.
 * The administrator's list rather than the directory, which leaves out the caller and inactive users.
 */
export const createXtmOneSeedDirectory = (
  { url, email, password }: XtmOneAdministrator,
  { resetPasswordOnReuse = false, requestTimeoutMs = REQUEST_TIMEOUT_MS }: SeedDirectoryOptions = {},
): XtmOneSeedDirectory => {
  const base = url.replace(/\/+$/, '');
  const call = async (path: string, init: RequestInit) => {
    try {
      return await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(requestTimeoutMs) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw newError(`XTM One at ${base} did not answer within ${requestTimeoutMs} ms`);
      }
      throw error;
    }
  };

  const signIn = async (): Promise<string> => {
    const response = await call('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw await refusal(`Signing in to XTM One as ${email}`, response);
    }
    const { access_token: token } = loginAnswer.parse(await response.json());
    if (!token) {
      throw newError(`Signing in to XTM One as ${email} asks for a second factor, which the seed cannot give`);
    }
    return token;
  };

  let session: Promise<string> | null = null;
  const headers = async () => {
    session ??= signIn();
    return { 'Authorization': `Bearer ${await session}`, 'Content-Type': 'application/json' };
  };

  const listUsers = async () => {
    const listed = await call('/api/v1/users', { method: 'GET', headers: await headers() });
    if (!listed.ok) {
      throw await refusal('Listing the users of XTM One', listed);
    }
    return listedUsers.parse(await listed.json());
  };

  const provision: XtmOneSeedAccounts = async (account) => {
    const created = await call('/api/v1/users', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        email: account.email,
        full_name: account.fullName,
        password: account.password,
        role: account.role,
        account_type: 'local',
      }),
    });
    if (created.ok) {
      return createdUser.parse(await created.json()).id;
    }
    if (created.status !== 409) {
      throw await refusal(`Creating ${account.email} in XTM One`, created);
    }
    const wanted = account.email.toLowerCase();
    const existing = (await listUsers()).find((user) => user.email.toLowerCase() === wanted);
    if (!existing) {
      throw newError(`XTM One says ${account.email} exists but does not list it`);
    }
    // Never the administrator the seed signs in as: its password is the one the stack keeps for it.
    if (resetPasswordOnReuse && wanted !== email.toLowerCase()) {
      const reset = await call(`/api/v1/users/${encodeURIComponent(existing.id)}/password`, {
        method: 'PUT',
        headers: await headers(),
        body: JSON.stringify({ new_password: account.password }),
      });
      if (!reset.ok) {
        throw await refusal(`Setting the password of ${account.email} in XTM One`, reset);
      }
    }
    return existing.id;
  };

  return {
    provision,
    knownIds: async () => new Set((await listUsers()).map(({ id }) => id)),
  };
};

/**
 * The seed's XTM One from the configuration, `null` without an XTM One administrator: the seed then
 * creates its users with their password alone, as it did before them, which an instance seeded
 * without a stack of its own still relies on. An administrator with no XTM One to sign in to fails
 * the first call, rather than the boot of a platform whose seed has long run.
 */
export const xtmOneSeedDirectoryFromConfig = (
  xtmOne: { url: string } | undefined,
  administrator: { email: string, password: string } | undefined,
  options?: SeedDirectoryOptions,
): XtmOneSeedDirectory | null => {
  if (!administrator) {
    return null;
  }
  if (!xtmOne) {
    const missing = () => Promise.reject(newError('The platform seed signs in to XTM One as platform_seed.xtm_one_admin, and no xtm_one block names one'));
    return { provision: missing, knownIds: missing };
  }
  return createXtmOneSeedDirectory({ url: xtmOne.url, ...administrator }, options);
};
