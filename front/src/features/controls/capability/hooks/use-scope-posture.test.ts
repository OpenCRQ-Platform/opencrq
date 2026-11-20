/** @vitest-environment jsdom */
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrpcAnswers } from '../../../../providers/trpc-test-harness';
import type { ResolvedPosture } from '../types/capability';
import { createTestQueryClient, createTrpcTestClient, FAILED, TrpcTestProviders } from '../../../../providers/trpc-test-harness';
import { useScopePosture } from './use-scope-posture';

const { useParams } = vi.hoisted(() => ({ useParams: vi.fn() }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  useParams,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderScopePosture = (answers: TrpcAnswers) => {
  const queryClient = createTestQueryClient();
  const { trpcClient } = createTrpcTestClient(answers);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(TrpcTestProviders, { trpcClient, queryClient, children });
  return { ...renderHook(() => useScopePosture(), { wrapper }), queryClient };
};

const SCOPE_ID = '01a0afa3-30e2-79c3-8f4a-752e69431042';

const posture: ResolvedPosture = {
  capabilityId: 'capability-1',
  strengthRung: 'L3',
  coverageBucket: 'L1',
  strengthSource: 'scope',
  coverageSource: 'scope',
  comment: null,
  tenantStrengthRung: 'L1',
  tenantCoverageBucket: 'L3',
  scopeDeclaredAt: null,
};

describe('useScopePosture', () => {
  it('should keep awaiting the scope when its posture request failed', async () => {
    useParams.mockReturnValue({ organizationId: SCOPE_ID });

    const { result, queryClient } = renderScopePosture({ 'controlCapabilities.getResolvedControlPosture': FAILED });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(result.current.isAwaitingScope).toBe(true);
    expect(result.current.postures).toBeUndefined();
  });

  it('should stop awaiting once the scope posture arrived', async () => {
    useParams.mockReturnValue({ organizationId: SCOPE_ID });

    const { result } = renderScopePosture({ 'controlCapabilities.getResolvedControlPosture': [posture] });
    await waitFor(() => expect(result.current.isAwaitingScope).toBe(false));

    expect(result.current.postures).toEqual([posture]);
  });

  it('should await nothing outside any scope', () => {
    useParams.mockReturnValue({});

    const { result } = renderScopePosture({});

    expect(result.current.isAwaitingScope).toBe(false);
    expect(result.current.postures).toBeUndefined();
  });
});
