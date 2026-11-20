import type { Config } from 'drizzle-kit';

export default {
  schema: '../module/src/modules/schema.ts',
  out: '../module/src/db/migrations',
  dialect: 'postgresql',
} satisfies Config;
