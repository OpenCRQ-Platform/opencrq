import type { QueryKey } from '@tanstack/react-query';
import { matchQuery, QueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import { describe, expect, it } from 'vitest';
import { planDoorbellInvalidations } from './event-stream-utils';
import { createTrpcTestClient } from './trpc-test-harness';

const ORGANIZATION_INPUT = { id: '019e0000-0000-7000-8000-0000000000b1' };

const setup = () => {
  const queryClient = new QueryClient();
  const trpc = createTRPCOptionsProxy<TRPCRouter>({ client: createTrpcTestClient().trpcClient, queryClient });
  const queryOf = (queryKey: QueryKey) => queryClient.getQueryCache().build(queryClient, { queryKey });
  return { trpc, queryOf };
};

describe('tRPC query keys', () => {
  describe('query key shape', () => {
    it('should key a procedure without input as its path and a query type', () => {
      const { trpc } = setup();

      expect(trpc.authStatus.queryOptions().queryKey).toEqual([['authStatus'], { type: 'query' }]);
    });

    it('should key a procedure with input as its path, its input and a query type', () => {
      const { trpc } = setup();

      expect(trpc.organizations.getOrganization.queryOptions(ORGANIZATION_INPUT).queryKey)
        .toEqual([['organizations', 'getOrganization'], { input: ORGANIZATION_INPUT, type: 'query' }]);
    });

    it('should key a procedure of a merged router as its split path and a query type', () => {
      const { trpc } = setup();

      expect(trpc.xtmOne.getSettings.queryOptions().queryKey).toEqual([['xtmOne', 'getSettings'], { type: 'query' }]);
    });
  });

  describe('against the doorbell prefix', () => {
    const doorbellPrefix = (procedure: string) => {
      const [invalidation] = planDoorbellInvalidations({ procedures: [procedure], all: false }, false);
      if (invalidation?.queryKey === undefined) {
        throw new Error('a doorbell naming a procedure plans a key prefix');
      }
      return { queryKey: invalidation.queryKey };
    };

    it('should match the query built for the procedure it names, whatever its input', () => {
      const { trpc, queryOf } = setup();
      const withInput = queryOf(trpc.organizations.getOrganization.queryOptions(ORGANIZATION_INPUT).queryKey);
      const otherInput = queryOf(trpc.organizations.getOrganization.queryOptions({ id: 'another' }).queryKey);
      const withoutInput = queryOf(trpc.authStatus.queryOptions().queryKey);

      expect(matchQuery(doorbellPrefix('organizations.getOrganization'), withInput)).toBe(true);
      expect(matchQuery(doorbellPrefix('organizations.getOrganization'), otherInput)).toBe(true);
      expect(matchQuery(doorbellPrefix('authStatus'), withoutInput)).toBe(true);
    });

    it('should not match the query of another procedure, even one whose name starts the same', () => {
      const { trpc, queryOf } = setup();
      const organizations = queryOf(trpc.organizations.getOrganizations.queryOptions().queryKey);
      const authStatus = queryOf(trpc.authStatus.queryOptions().queryKey);

      expect(matchQuery(doorbellPrefix('organizations.getOrganization'), organizations)).toBe(false);
      expect(matchQuery(doorbellPrefix('organizations.getOrganization'), authStatus)).toBe(false);
    });
  });

  describe('pathKey', () => {
    it('should start with the split procedure path', () => {
      const { trpc } = setup();

      expect(trpc.authStatus.pathKey()[0]).toEqual(['authStatus']);
      expect(trpc.organizations.getOrganization.pathKey()[0]).toEqual(['organizations', 'getOrganization']);
      expect(trpc.xtmOne.getSettings.pathKey()[0]).toEqual(['xtmOne', 'getSettings']);
    });
  });
});
