const SESSION_DURATION_MS = 1000 * 60 * 60 * 24;

/**
 * A session opened through XTM One lasts an hour: renewing it goes through XTM One again, which
 * refuses a disabled account and sends the claims anew, so XTM One's word reaches OpenCRQ within the
 * hour until a back-channel can end a session.
 */
export const XTM_SESSION_DURATION_MS = 1000 * 60 * 60;

/**
 * A session, as every sign-in path opens it: 24 hours unless told otherwise, counted by the
 * injected telemetry hook, which can never break the sign-in.
 */
export const openSession = async (
  auth: { createSession: (userId: string, expiresAt: Date) => Promise<string> },
  userId: string,
  onSessionCreated?: () => void,
  durationMs: number = SESSION_DURATION_MS,
): Promise<{ sessionId: string, expiresAt: Date }> => {
  const expiresAt = new Date(Date.now() + durationMs);
  const sessionId = await auth.createSession(userId, expiresAt);
  try {
    onSessionCreated?.();
  } catch {
    // Telemetry must never break auth: a throwing hook is ignored.
  }
  return { sessionId, expiresAt };
};
