/** @vitest-environment jsdom */
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from '@tanstack/react-router';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SecurityScope } from './security-scope-utils';
import { createTestQueryClient, createTrpcTestClient, NEVER, TrpcTestProviders } from '../../../providers/trpc-test-harness';
import { useRevalidateOnLostManageSecurity } from './use-revalidate-on-lost-manage-security';

afterEach(() => {
  cleanup();
});

const CAPABILITY_PATH = 'capabilities.hasManageSecurity';

/** `'pending'` is a link that never answers, so the query stays without data. */
type Answer = boolean | 'pending';

const setup = (initial: { canAccessTenant: boolean, answer: Answer, securityScope?: SecurityScope }) => {
  let answer = initial.answer;
  const queryClient = createTestQueryClient();
  const { trpcClient, calls } = createTrpcTestClient({
    [CAPABILITY_PATH]: () => (answer === 'pending' ? NEVER : answer),
  });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory({ initialEntries: ['/'] }) });
  const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue(undefined);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <RouterContextProvider router={router}>
      <TrpcTestProviders trpcClient={trpcClient} queryClient={queryClient}>{children}</TrpcTestProviders>
    </RouterContextProvider>
  );
  const rendered = renderHook(() => useRevalidateOnLostManageSecurity(initial.canAccessTenant, initial.securityScope ?? 'tenant'), { wrapper });

  const capabilityData = () => queryClient.getQueryCache().getAll().at(0)?.state.data;
  const answerFromNowOn = async (next: boolean) => {
    answer = next;
    // eslint-disable-next-line no-restricted-syntax -- the fake link stands in for the doorbell, which is what refreshes the capability in the app
    await queryClient.invalidateQueries();
  };
  const capabilityRequests = () => calls.filter((call) => call.path === CAPABILITY_PATH).length;

  return { ...rendered, invalidate, capabilityData, answerFromNowOn, capabilityRequests };
};

describe('useRevalidateOnLostManageSecurity', () => {
  it('should leave the router alone while the capability is held', async () => {
    const { invalidate, capabilityData } = setup({ canAccessTenant: true, answer: true });

    await waitFor(() => expect(capabilityData()).toBe(true));

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('should invalidate the router once when the capability turns from held to lost', async () => {
    const { invalidate, capabilityData, answerFromNowOn, rerender } = setup({ canAccessTenant: true, answer: true });
    await waitFor(() => expect(capabilityData()).toBe(true));

    await answerFromNowOn(false);
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    rerender();

    expect(capabilityData()).toBe(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('should not ask for the capability, nor invalidate, when the reader has no tenant access', async () => {
    const { invalidate, capabilityRequests } = setup({ canAccessTenant: false, answer: false });

    // A request, had one been sent, is issued within a tick of the first render.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(capabilityRequests()).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('should not ask for the capability, nor invalidate, on the platform scope', async () => {
    const { invalidate, capabilityRequests } = setup({ canAccessTenant: true, answer: false, securityScope: 'platform' });

    // A request, had one been sent, is issued within a tick of the first render.
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(capabilityRequests()).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('should wait for an answer before invalidating anything', async () => {
    const { invalidate, capabilityRequests } = setup({ canAccessTenant: true, answer: 'pending' });

    await waitFor(() => expect(capabilityRequests()).toBe(1));

    expect(invalidate).not.toHaveBeenCalled();
  });
});
