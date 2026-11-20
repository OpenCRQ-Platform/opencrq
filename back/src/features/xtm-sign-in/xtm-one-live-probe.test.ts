import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isXtmOneAnswering, lastXtmOneAnswer, resetXtmOneAnswering } from './xtm-one-live-probe';

const XTM_ONE = 'http://localhost:4605';
const DISCOVERY = `${XTM_ONE}/.well-known/openid-configuration`;

const fetchMock = vi.fn<typeof fetch>();

const answer = (status: number): Response => new Response('{}', { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  resetXtmOneAnswering();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-07T14:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isXtmOneAnswering', () => {
  it('answers yes when XTM One serves its discovery document', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));

    await expect(isXtmOneAnswering(XTM_ONE)).resolves.toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([DISCOVERY]);
  });

  it('answers no when XTM One does not answer within two seconds', async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation timed out.', 'TimeoutError')));
    }));

    const answering = isXtmOneAnswering(XTM_ONE);
    timeout.abort();

    await expect(answering).resolves.toBe(false);
    expect(timeoutSpy).toHaveBeenCalledWith(2_000);
  });

  it('answers no when XTM One answers with an error', async () => {
    fetchMock.mockResolvedValueOnce(answer(503));

    await expect(isXtmOneAnswering(XTM_ONE)).resolves.toBe(false);
  });

  it('answers no when XTM One cannot be reached', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(isXtmOneAnswering(XTM_ONE)).resolves.toBe(false);
  });

  it('keeps an answer for fifteen seconds', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));
    await isXtmOneAnswering(XTM_ONE);

    vi.setSystemTime(Date.now() + 14_000);
    fetchMock.mockResolvedValueOnce(answer(503));

    await expect(isXtmOneAnswering(XTM_ONE)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again once the answer is fifteen seconds old', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));
    await isXtmOneAnswering(XTM_ONE);

    vi.setSystemTime(Date.now() + 15_000);
    fetchMock.mockResolvedValueOnce(answer(503));

    await expect(isXtmOneAnswering(XTM_ONE)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes one call for the requests that arrive while it is asking', async () => {
    let respond: (response: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
      respond = resolve;
    }));

    const answers = Promise.all([isXtmOneAnswering(XTM_ONE), isXtmOneAnswering(XTM_ONE), isXtmOneAnswering(XTM_ONE)]);
    respond(answer(200));

    await expect(answers).resolves.toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again for another XTM One', async () => {
    fetchMock.mockResolvedValueOnce(answer(200)).mockResolvedValueOnce(answer(503));
    await isXtmOneAnswering(XTM_ONE);

    await expect(isXtmOneAnswering('http://xtm-one:4000')).resolves.toBe(false);
  });
});

describe('lastXtmOneAnswer', () => {
  it('waits for XTM One only when it never answered', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));

    await expect(lastXtmOneAnswer(XTM_ONE)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('gives a stale answer at once, and asks XTM One again behind it', async () => {
    fetchMock.mockResolvedValueOnce(answer(200));
    await lastXtmOneAnswer(XTM_ONE);
    vi.setSystemTime(new Date('2026-11-07T14:00:16Z'));
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));

    await expect(lastXtmOneAnswer(XTM_ONE)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
