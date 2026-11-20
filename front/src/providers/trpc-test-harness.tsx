import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import { render } from '@testing-library/react';
import type { TRPCClient } from '@trpc/client';
import { createTRPCClient, TRPCClientError } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { FunctionComponent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { getRequestTenantId } from '../lib/tenant-accessor';
import { tenantStampLink } from '../lib/tenant-batch-link';
import { TRPCProvider } from '../lib/trpc';

/** An answer the fake server fails with a `TRPCClientError`, instead of returning it. */
export const FAILED = Symbol();

/** An answer that never arrives: the call stays pending for the whole test. */
export const NEVER = Symbol();

const LISTENERS = Symbol();

/** What `createTrpcTestStream` returns: an answer for a subscription, and the way to push to it. */
export interface TrpcTestStream {
  [LISTENERS]: Set<(data: unknown) => void>,
  /** Sends `data` to every open subscription answered by this stream. */
  push: (data: unknown) => void,
}

/** An answer for a subscription path: it starts when subscribed, stays open, and emits what the test pushes. */
export const createTrpcTestStream = (): TrpcTestStream => {
  const listeners = new Set<(data: unknown) => void>();
  return { [LISTENERS]: listeners, push: (data) => listeners.forEach((listener) => listener(data)) };
};

const isTestStream = (answer: unknown): answer is TrpcTestStream => typeof answer === 'object' && answer !== null && LISTENERS in answer;

/**
 * What the fake server answers a procedure with, by path (`'jobs.listRuns'`): a value, a function of
 * the call's input, `FAILED`, `NEVER`, a promise delivered when it settles, or, for a subscription,
 * a `createTrpcTestStream()`. A function that throws
 * fails the call with the thrown error. A path with no entry answers `null`. The record is read at each
 * call, so a test may change an answer between two calls.
 */
export type TrpcAnswers = Record<string, unknown>;

export interface TrpcCall {
  path: string,
  input: unknown,
  type: string,
  /** The tenant the operation was stamped with, `null` outside any tenant. */
  tenantId: string | null,
}

/** A `QueryClient` that never retries, so a failed answer settles at once. */
export const createTestQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * A tRPC client whose link answers from `answers` instead of the network. It keeps the real client's
 * first link, which stamps the request tenant, so `calls[].tenantId` is the one the server would see.
 */
export const createTrpcTestClient = (answers: TrpcAnswers = {}) => {
  const calls: Array<TrpcCall> = [];
  const trpcClient = createTRPCClient<TRPCRouter>({
    links: [
      tenantStampLink(getRequestTenantId),
      () => ({ op }) => observable((observer) => {
        const { tenantId } = op.context;
        calls.push({ path: op.path, input: op.input, type: op.type, tenantId: typeof tenantId === 'string' ? tenantId : null });
        const deliver = (data: unknown) => {
          observer.next({ result: { type: 'data', data } });
          observer.complete();
        };
        const fail = (cause: unknown) => {
          observer.error(TRPCClientError.from(cause instanceof Error ? cause : new Error(`${op.path} failed`)));
        };
        const settle = (answer: unknown) => {
          if (answer === NEVER) {
            return;
          }
          if (answer === FAILED) {
            fail(new Error(`${op.path} failed`));
            return;
          }
          if (answer instanceof Promise) {
            void answer.then(deliver, fail);
            return;
          }
          deliver(answer ?? null);
        };
        const answer = answers[op.path];
        if (isTestStream(answer)) {
          const listener = (data: unknown) => observer.next({ result: { type: 'data', data } });
          answer[LISTENERS].add(listener);
          observer.next({ result: { type: 'started' } });
          return () => {
            answer[LISTENERS].delete(listener);
          };
        }
        if (typeof answer !== 'function') {
          settle(answer);
          return undefined;
        }
        try {
          settle(answer(op.input));
        } catch (error) {
          fail(error);
        }
        return undefined;
      }),
    ],
  });
  return { trpcClient, calls };
};

interface TrpcTestProvidersProps {
  trpcClient: TRPCClient<TRPCRouter>,
  queryClient?: QueryClient,
  children: ReactNode,
}

/** Mounts the client under the tRPC provider, on one `QueryClient` without retries unless one is given. */
export const TrpcTestProviders: FunctionComponent<TrpcTestProvidersProps> = ({ trpcClient, queryClient, children }) => {
  const [defaultQueryClient] = useState(createTestQueryClient);
  const client = queryClient ?? defaultQueryClient;
  return (
    <QueryClientProvider client={client}>
      <TRPCProvider trpcClient={trpcClient} queryClient={client}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
};

interface RenderWithTrpcOptions {
  answers?: TrpcAnswers,
  queryClient?: QueryClient,
}

/** `render` of `ui` under `TrpcTestProviders` and `I18nProvider`, with the calls the fake server saw. */
export const renderWithTrpc = (
  ui: ReactElement,
  { answers = {}, queryClient = createTestQueryClient() }: RenderWithTrpcOptions = {},
): RenderResult & { calls: Array<TrpcCall>, queryClient: QueryClient } => {
  const { trpcClient, calls } = createTrpcTestClient(answers);
  const wrap = (element: ReactNode) => (
    <TrpcTestProviders trpcClient={trpcClient} queryClient={queryClient}>
      <I18nProvider i18n={i18n}>{element}</I18nProvider>
    </TrpcTestProviders>
  );
  const result = render(wrap(ui));
  return {
    ...result,
    rerender: (element) => result.rerender(wrap(element)),
    calls,
    queryClient,
  };
};
