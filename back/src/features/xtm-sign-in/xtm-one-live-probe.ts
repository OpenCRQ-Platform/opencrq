const PROBE_TIMEOUT_MS = 2_000;
/** How long one answer stands: a burst of visitors makes one call, and a stopped XTM One shows within it. */
const PROBE_TTL_MS = 15_000;

let lastAnswer: { url: string, answeredAt: number, answering: boolean } | null = null;
let inFlight: { url: string, answer: Promise<boolean> } | null = null;

const probe = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(`${url}/.well-known/openid-configuration`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Whether XTM One answers its OpenID discovery now, asked right before a browser is sent to it. The
 * registration heartbeat cannot say: it keeps reporting XTM One reachable for its grace after XTM
 * One stopped, which would send a signed-out visitor to a server that does not respond.
 */
export const isXtmOneAnswering = (url: string): Promise<boolean> => {
  if (lastAnswer?.url === url && Date.now() - lastAnswer.answeredAt < PROBE_TTL_MS) {
    return Promise.resolve(lastAnswer.answering);
  }
  if (inFlight?.url === url) {
    return inFlight.answer;
  }
  const answer = probe(url)
    .then((answering) => {
      lastAnswer = { url, answeredAt: Date.now(), answering };
      return answering;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = { url, answer };
  return answer;
};

/** Test hook: forget the last answer. */
export const resetXtmOneAnswering = (): void => {
  lastAnswer = null;
  inFlight = null;
};

/**
 * What XTM One last answered, at once: past its 15 seconds the answer is still given, and asked again
 * behind it. Only the very first call waits for XTM One. For a status every page load reads, which a
 * hung XTM One would otherwise hold for the probe's timeout.
 */
export const lastXtmOneAnswer = (url: string): Promise<boolean> => {
  if (lastAnswer?.url !== url) {
    return isXtmOneAnswering(url);
  }
  void isXtmOneAnswering(url);
  return Promise.resolve(lastAnswer.answering);
};
