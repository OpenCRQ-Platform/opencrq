import type { EventOrigin } from '@app/module';
import { uuidv7 } from 'uuidv7';
import type { FastifyInstance } from 'fastify';
import type { TestServices } from '../setup/test-context';

/**
 * Creates a service account with a Bearer token and returns a tRPC test client
 * that authenticates as that service account (via Authorization header).
 * Exercises the real auth middleware, unlike post-auth injection.
 */
export const createServiceAccountClient = async (
  server: FastifyInstance,
  services: TestServices,
  adminOrigin: EventOrigin,
) => {
  const serviceAccountId = uuidv7();
  await services.withOrigin(adminOrigin).serviceAccounts.createServiceAccount({
    id: serviceAccountId,
    name: `test-sa-${serviceAccountId.substring(0, 8)}`,
    description: null,
  });

  const { plainToken } = await services.withOrigin(adminOrigin)
    .serviceAccountTokens.generateToken({
      serviceAccountId,
      name: 'integration-test-token',
      expiresAt: null,
    });

  const query = async (path: string, input?: unknown) => {
    const url = input
      ? `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      : `/trpc/${path}`;

    const res = await server.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${plainToken}`,
      },
    });

    return {
      status: res.statusCode,
      json: JSON.parse(res.body),
    };
  };

  const mutation = async (path: string, input?: unknown) => {
    const res = await server.inject({
      method: 'POST',
      url: `/trpc/${path}`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${plainToken}`,
      },
      body: input !== undefined ? JSON.stringify(input) : undefined,
    });

    return {
      status: res.statusCode,
      json: JSON.parse(res.body),
    };
  };

  return {
    query,
    mutation,
    serviceAccountId,
    plainToken,
  };
};
