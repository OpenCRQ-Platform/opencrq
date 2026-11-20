import { appRouter } from '@app/back/src/features/app-router/app-router-router';
import { publicProcedure } from '@app/back/src/trpc';
import { z } from 'zod';
import type { createTrpcTestClient } from './trpc-client';
import { db } from '../setup/db';

const procedureDef = (procedure: unknown) => {
  if (typeof procedure !== 'function') {
    throw new TypeError('A tRPC procedure is expected to be a function');
  }
  const { type, output } = z.object({ type: z.string(), output: z.unknown().optional() }).parse(Reflect.get(procedure, '_def'));
  return { type, hasOutput: output !== undefined };
};

/**
 * Every procedure the app router serves under `prefix`, read from the router itself, so a test
 * enumerating them covers a procedure added later. The router's static type hides `_def`, the only
 * place its flat procedure map lives.
 */
export const proceduresOf = (prefix: string) => {
  const { procedures } = z.object({ procedures: z.record(z.string(), z.unknown()) }).parse(Reflect.get(appRouter({ publicProcedure }, db), '_def'));
  return Object.entries(procedures)
    .filter(([path]) => path.startsWith(`${prefix}.`))
    .map(([path, procedure]) => ({ path, ...procedureDef(procedure) }));
};

export const callWithoutInput = (client: ReturnType<typeof createTrpcTestClient>, procedure: { path: string, type: string }, tenantId: string) => (
  procedure.type === 'query'
    ? client.query(procedure.path, undefined, { tenantId })
    : client.mutation(procedure.path, undefined, { tenantId })
);
