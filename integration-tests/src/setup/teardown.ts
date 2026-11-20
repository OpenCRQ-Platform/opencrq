import { afterAll } from 'vitest';
import { closeDb } from './db';
import { closeTestServer } from './test-server';

afterAll(async () => {
  await closeTestServer();
  await closeDb();
});
