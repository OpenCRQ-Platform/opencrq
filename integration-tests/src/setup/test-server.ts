import type { FastifyInstance } from 'fastify';
import { createTestApp } from './create-test-app';
import { db } from './db';

let server: FastifyInstance | null = null;

export const getTestServer = async (): Promise<FastifyInstance> => {
  if (!server) {
    server = await createTestApp(db);
  }
  return server;
};

export const closeTestServer = async (): Promise<void> => {
  if (server) {
    await server.close();
    server = null;
  }
};
