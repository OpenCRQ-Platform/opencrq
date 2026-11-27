import type { AccessNoticeAnswer, AccessNoticeRequest } from '@app/module';
import { z } from 'zod';
import type { XtmOneSettings } from './xtm-one-config';
import { createLogger } from '../../utils/logger';

const { logWarn } = createLogger({ feature: 'xtm-one' });

const DIRECTORY_PATH = '/api/v1/users/directory';
const ACCESS_NOTICES_PATH = '/api/v1/platform/access-notices';
const TIMEOUT_MS = 10_000;

export const DIRECTORY_QUERY_MIN_LENGTH = 2;
/** XTM One's own limit on a directory query (`q`), shorter than an email can be. */
const DIRECTORY_QUERY_MAX_LENGTH = 100;
export const DIRECTORY_LIMIT = 20;

export interface DirectoryPerson {
  id: string,
  fullName: string,
  email: string,
}

const directorySchema = z.array(z.object({
  id: z.string().min(1),
  full_name: z.string().nullable().optional(),
  email: z.string(),
  is_active: z.boolean().optional(),
}));

/**
 * The active XTM One users matching `query`, as the user `headers` authenticate sees XTM One's
 * directory (which leaves that user out). Empty when XTM One cannot answer, and for a query longer
 * than XTM One accepts: the typed email is still offered.
 */
export const searchXtmOneDirectory = async (
  settings: XtmOneSettings,
  headers: Record<string, string>,
  query: string,
): Promise<Array<DirectoryPerson>> => {
  if (query.length > DIRECTORY_QUERY_MAX_LENGTH) {
    return [];
  }
  const params = new URLSearchParams({ q: query, limit: String(DIRECTORY_LIMIT) });
  try {
    const response = await fetch(`${settings.url}${DIRECTORY_PATH}?${params.toString()}`, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      logWarn('XTM One directory search refused', { status: response.status });
      return [];
    }
    const people = directorySchema.safeParse(await response.json());
    if (!people.success) {
      logWarn('XTM One directory answer cannot be read');
      return [];
    }
    return people.data
      .filter((person) => person.is_active !== false)
      .map((person) => ({ id: person.id, fullName: person.full_name?.trim() ?? '', email: person.email }));
  } catch {
    logWarn('XTM One directory search failed');
    return [];
  }
};

const noticeAnswerSchema = z.object({
  outcome: z.enum(['notified', 'invited']),
  email_sent: z.boolean(),
  user_id: z.string().min(1).nullable().optional(),
  // Only on an invitation XTM One could not email. Unreadable, it is dropped rather than losing the answer.
  link: z.url({ protocol: /^https?$/ }).nullable().optional().catch(null),
});

/** Asks XTM One to tell one person they were given access, as the user `headers` authenticate. The email is never logged. */
export const sendXtmOneAccessNotice = async (
  settings: XtmOneSettings,
  headers: Record<string, string>,
  request: AccessNoticeRequest,
): Promise<AccessNoticeAnswer> => {
  try {
    const response = await fetch(`${settings.url}${ACCESS_NOTICES_PATH}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_email: request.email, scope_name: request.scopeName, path: request.path }),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 403) {
      return { outcome: 'refused' };
    }
    if (response.status === 404) {
      return { outcome: 'not-found' };
    }
    if (response.status === 409) {
      return { outcome: 'invitation-pending' };
    }
    if (!response.ok) {
      logWarn('XTM One access notice not sent', { status: response.status });
      return { outcome: 'not-sent' };
    }
    const answer = noticeAnswerSchema.safeParse(await response.json());
    if (!answer.success) {
      logWarn('XTM One access notice answer cannot be read');
      return { outcome: 'not-sent' };
    }
    const { outcome, email_sent: emailSent, user_id: xtmUserId, link } = answer.data;
    if (outcome === 'invited') {
      return { outcome, emailSent, link: link ?? null };
    }
    return xtmUserId ? { outcome, xtmUserId, emailSent } : { outcome: 'not-sent' };
  } catch {
    logWarn('XTM One access notice failed');
    return { outcome: 'not-sent' };
  }
};
