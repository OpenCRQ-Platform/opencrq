import type { EventOrigin, InsertPathDecision } from '@app/module';
import {
  createProtectedDB, defineSecurityPolicies, isJsonPayloadSafe, JSON_PAYLOAD_SAFE_TYPES, schema,
} from '@app/module';
import { getTableColumns, is, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import {
  bigint, boolean, date, doublePrecision, integer, pgTable, PgTable, real, smallint, text,
  timestamp, uuid, varchar,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../setup/db';

/**
 * One column per type the payload path accepts, so a value of every such type is written and read
 * back through both paths and compared. The exhaustiveness assertion below is what keeps this in
 * step: a type added to the allowlist fails the suite until it is given a column and edge values
 * here. It is the whole reason the real tables need not be rewritten batch by batch, the schema
 * using only these types on this path.
 */
const typeMatrix = pgTable('_test_payload_types', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  colUuid: uuid('col_uuid'),
  colText: text('col_text'),
  colVarchar: varchar('col_varchar', { length: 32 }),
  colBoolean: boolean('col_boolean'),
  colSmallint: smallint('col_smallint'),
  colInteger: integer('col_integer'),
  colBigint: bigint('col_bigint', { mode: 'number' }),
  colReal: real('col_real'),
  colDouble: doublePrecision('col_double'),
  colDate: date('col_date', { mode: 'date' }),
  colTimestamp: timestamp('col_timestamp', { mode: 'date' }),
  colTimestamptz: timestamp('col_timestamptz', { withTimezone: true, mode: 'date' }),
  colDefaulted: text('col_defaulted').notNull().default('from the database'),
});

const TENANT_A = uuidv7();
const USER_A = uuidv7();
const originA: EventOrigin = { type: 'client', userId: USER_A, tenantId: TENANT_A };

defineSecurityPolicies(typeMatrix, {
  read: (origin, table) => (origin.type === 'client' ? sql`${table.tenantId} = ${origin.tenantId}` : undefined),
  update: (origin, table) => (origin.type === 'client' ? sql`${table.tenantId} = ${origin.tenantId}` : undefined),
  create: (origin, values) => (origin.type === 'client'
    ? sql`${values.tenantId}::text = ${origin.tenantId}::text`
    : undefined),
});

/**
 * Every column optional, which no table of the schema is today: each supplies its own id, so a row
 * always names at least that column. It is what a batch naming no column at all needs to exist.
 */
const allDefaulted = pgTable('_test_payload_defaults', {
  id: uuid('id').primaryKey().defaultRandom(),
  colText: text('col_text').notNull().default('from the database'),
});

defineSecurityPolicies(allDefaulted, {
  read: () => undefined,
  update: () => undefined,
  create: () => undefined,
});

const PATHS = [
  { name: 'values', jsonPayloadMinRows: Number.MAX_SAFE_INTEGER },
  { name: 'jsonb payload', jsonPayloadMinRows: 1 },
] as const;

let decisions: Array<InsertPathDecision> = [];

const writerOn = (path: (typeof PATHS)[number]) =>
  createProtectedDB(db, (callback) => db.transaction(callback), originA, {
    jsonPayloadMinRows: path.jsonPayloadMinRows,
    onInsertPath: (decision) => decisions.push(decision),
  });

/** The path an arm claims to test is asserted, so a silent fallback cannot pass as a comparison. */
const expectPathTaken = (path: (typeof PATHS)[number]) => {
  const taken = decisions.map((decision) => (decision.path === 'json-payload' ? 'jsonb payload' : 'values'));
  expect(new Set(taken), `arm "${path.name}" did not take its own path`).toEqual(new Set([path.name]));
};

const readAll = () => db.select().from(typeMatrix).orderBy(typeMatrix.id);

const readCode = (value: unknown): string | undefined =>
  (typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
    ? value.code
    : undefined);

const pgErrorCode = (error: unknown): string => {
  const direct = readCode(error);
  if (direct !== undefined) {
    return direct;
  }
  const cause = typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined;
  return readCode(cause) ?? 'no code';
};

/**
 * Writes the same rows through one path and hands back what the database then holds, so two arms
 * can be compared value by value rather than assertion by assertion.
 */
const writeAndRead = async (path: (typeof PATHS)[number], rows: Array<typeof typeMatrix.$inferInsert>) => {
  await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
  decisions = [];
  await writerOn(path).insert(typeMatrix).values(rows);
  expectPathTaken(path);
  return readAll();
};

beforeAll(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _test_payload_types (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      col_uuid UUID,
      col_text TEXT,
      col_varchar VARCHAR(32),
      col_boolean BOOLEAN,
      col_smallint SMALLINT,
      col_integer INTEGER,
      col_bigint BIGINT,
      col_real REAL,
      col_double DOUBLE PRECISION,
      col_date DATE,
      col_timestamp TIMESTAMP,
      col_timestamptz TIMESTAMP WITH TIME ZONE,
      col_defaulted TEXT NOT NULL DEFAULT 'from the database',
      UNIQUE (col_uuid, col_integer, col_varchar)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _test_payload_defaults (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      col_text TEXT NOT NULL DEFAULT 'from the database'
    )
  `);
});

afterAll(async () => {
  await db.execute(sql`DROP TABLE IF EXISTS _test_payload_types`);
  await db.execute(sql`DROP TABLE IF EXISTS _test_payload_defaults`);
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
  decisions = [];
});

describe('ProtectedDB json payload path', () => {
  describe('type coverage', () => {
    it('fixtures every type the payload path accepts', () => {
      const fixtured = new Set(
        Object.values(getTableColumns(typeMatrix))
          .map((column: PgColumn) => column.getSQLType())
          .map((type) => (type.startsWith('varchar(') ? 'varchar' : type)),
      );
      // `varchar` is accepted by a prefix rule rather than by the set, so it is named here too:
      // scanning the set alone would let the one type it does not list lose its edge values.
      const accepted = [...JSON_PAYLOAD_SAFE_TYPES, 'varchar'];
      const missing = accepted.filter((type) => !fixtured.has(type));
      expect(missing, 'a type was added to the payload allowlist without a column and edge values here').toEqual([]);
    });

    it('holds the schema to the types someone has decided about', () => {
      const used = new Set<string>();
      for (const value of Object.values(schema)) {
        if (!is(value, PgTable)) {
          continue;
        }
        for (const column of Object.values<PgColumn>(getTableColumns(value))) {
          const type = column.getSQLType();
          used.add(type.startsWith('varchar(') ? 'varchar' : type);
        }
      }
      // A type absent from both lists is one nobody has ruled on: it either belongs in the
      // allowlist, with edge values above, or it must stay out and keep falling back.
      const undecided = [...used].filter((type) => !isJsonPayloadSafe(type) && !KNOWN_INELIGIBLE.has(type));
      expect(undecided.sort(), 'a column type reached the schema without a decision on the payload path').toEqual([]);
    });
  });

  describe('value fidelity', () => {
    it('reads back what it wrote, identically on both paths', async () => {
      const ids = [uuidv7(), uuidv7(), uuidv7()];
      const rows: Array<typeof typeMatrix.$inferInsert> = [
        {
          id: ids[0],
          tenantId: TENANT_A,
          colUuid: null,
          colText: null,
          colVarchar: null,
          colBoolean: null,
          colSmallint: null,
          colInteger: null,
          colBigint: null,
          colReal: null,
          colDouble: null,
          colDate: null,
          colTimestamp: null,
          colTimestamptz: null,
          colDefaulted: 'explicit',
        },
        {
          id: ids[1],
          tenantId: TENANT_A,
          colUuid: uuidv7(),
          colText: 'quote " backslash \\ newline \n emoji 🐛 accents éàü',
          colVarchar: '',
          colBoolean: false,
          colSmallint: -32768,
          colInteger: -2147483648,
          colBigint: Number.MAX_SAFE_INTEGER,
          colReal: 0.5,
          colDouble: -0.1234567890123,
          colDate: new Date(Date.UTC(1970, 0, 1)),
          colTimestamp: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
          colTimestamptz: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
          colDefaulted: '',
        },
        {
          id: ids[2],
          tenantId: TENANT_A,
          colUuid: uuidv7(),
          colText: '',
          colVarchar: 'x'.repeat(32),
          colBoolean: true,
          colSmallint: 32767,
          colInteger: 2147483647,
          colBigint: -Number.MAX_SAFE_INTEGER,
          colReal: -0.5,
          colDouble: 1.7976931348623157e308,
          colDate: new Date(Date.UTC(2999, 11, 31)),
          colTimestamp: new Date(Date.UTC(2999, 11, 31, 23, 59, 59, 999)),
          colTimestamptz: new Date(Date.UTC(2999, 11, 31, 23, 59, 59, 999)),
          colDefaulted: 'kept',
        },
      ];

      const throughValues = await writeAndRead(PATHS[0], rows);
      const throughPayload = await writeAndRead(PATHS[1], rows);

      expect(throughPayload).toEqual(throughValues);
      expect(throughPayload).toHaveLength(3);
    });

    it('keeps a value JSON would alter on the bound-parameter path', async () => {
      // JSON writes NaN and either infinity as null and flattens -0, where a bound parameter
      // reaches Postgres as the float those spellings name.
      const rows = Array.from({ length: 2 }, (): typeof typeMatrix.$inferInsert => ({
        id: uuidv7(),
        tenantId: TENANT_A,
        colDouble: Number.NaN,
        colReal: Number.POSITIVE_INFINITY,
      }));

      decisions = [];
      await writerOn(PATHS[1]).insert(typeMatrix).values(rows);

      expect(decisions).toEqual([{ path: 'values', reason: 'unrepresentable-value' }]);
      const stored = await readAll();
      expect(stored).toHaveLength(2);
      expect(stored[0]?.colDouble).toBeNaN();
      expect(stored[0]?.colReal).toBe(Number.POSITIVE_INFINITY);
    });

    it('lets the database apply a default both paths omit', async () => {
      const row = { id: uuidv7(), tenantId: TENANT_A };

      const throughValues = await writeAndRead(PATHS[0], [row]);
      const throughPayload = await writeAndRead(PATHS[1], [row]);

      expect(throughValues[0]?.colDefaulted).toBe('from the database');
      expect(throughPayload).toEqual(throughValues);
    });
  });

  describe('conflict set on a column whose mapping is not the identity', () => {
    // Every other set assertion in the suite writes a string to a text column, where the column's
    // mapping is the identity and a value it would refuse cannot show.
    it('nulls a timestamp through a conflict set, identically on both paths', async () => {
      const id = uuidv7();
      const seeded = new Date(Date.UTC(2020, 4, 17, 8, 30));
      const clear = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        decisions = [];
        await writerOn(path).insert(typeMatrix).values([{ id, tenantId: TENANT_A, colTimestamptz: seeded }]);
        await writerOn(path)
          .insert(typeMatrix)
          .values([{ id, tenantId: TENANT_A, colTimestamptz: seeded }])
          .onConflictDoUpdate({ target: typeMatrix.id, set: { colTimestamptz: null } });
        expectPathTaken(path);
        return readAll();
      };

      const throughValues = await clear(PATHS[0]);
      const throughPayload = await clear(PATHS[1]);

      expect(throughValues[0]?.colTimestamptz).toBeNull();
      expect(throughPayload).toEqual(throughValues);
    });

    it('falls back when a column refuses to map a value, and both paths then answer alike', async () => {
      // An invalid Date is what a column mapping a timestamp throws on, and the type system admits
      // it, so it is the reachable form of "the column refuses this value".
      const attempt = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        decisions = [];
        try {
          await writerOn(path)
            .insert(typeMatrix)
            .values([{ id: uuidv7(), tenantId: TENANT_A, colTimestamptz: new Date('not a date') }]);
        } catch (error) {
          return error instanceof Error ? error.constructor.name : 'unknown';
        }
        return 'no error';
      };

      const throughValues = await attempt(PATHS[0]);
      const throughPayload = await attempt(PATHS[1]);

      expect(decisions).toEqual([{ path: 'values', reason: 'unrepresentable-value' }]);
      expect(throughPayload).toBe(throughValues);
    });
  });

  describe('conflict set the payload path cannot render', () => {
    // The branch is only reached by a set Drizzle itself rejects, so what it owes is the same
    // refusal as the bound-parameter path rather than a working insert.
    it('hands a set it cannot render back, and both paths refuse it alike', async () => {
      const refuse = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        decisions = [];
        try {
          await writerOn(path)
            .insert(typeMatrix)
            .values([{ id: uuidv7(), tenantId: TENANT_A, colText: 'a' }])
            .onConflictDoUpdate({ target: typeMatrix.id, set: { colText: undefined } });
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
        return 'no error';
      };

      expect(await refuse(PATHS[0])).toBe('No values to set');
      expect(decisions).toEqual([{ path: 'values', reason: 'below-threshold' }]);

      expect(await refuse(PATHS[1])).toBe('No values to set');
      expect(decisions).toEqual([{ path: 'values', reason: 'unsupported-conflict-set' }]);
    });
  });

  describe('conflict inside one batch', () => {
    it('refuses to update the same row twice, identically on both paths', async () => {
      const id = uuidv7();
      const collide = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        try {
          await writerOn(path)
            .insert(typeMatrix)
            .values([
              { id, tenantId: TENANT_A, colText: 'first' },
              { id, tenantId: TENANT_A, colText: 'second' },
            ])
            .onConflictDoUpdate({ target: typeMatrix.id, set: { colText: sql`excluded.col_text` } });
        } catch (error) {
          // Drizzle wraps the driver error, so the SQLSTATE is what compares across the two paths.
          return pgErrorCode(error);
        }
        return 'no error';
      };

      // 21000, cardinality_violation: ON CONFLICT DO UPDATE cannot affect one row twice.
      expect(await collide(PATHS[0])).toBe('21000');
      expect(await collide(PATHS[1])).toBe('21000');
    });
  });

  describe('a batch that names no column', () => {
    it('falls back, and both paths take every default', async () => {
      const write = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_defaults`);
        decisions = [];
        await writerOn(path).insert(allDefaulted).values([{}, {}]);
        return db.select().from(allDefaulted);
      };

      const throughValues = await write(PATHS[0]);
      const throughPayload = await write(PATHS[1]);

      expect(decisions).toEqual([{ path: 'values', reason: 'no-columns' }]);
      expect(throughValues).toHaveLength(2);
      expect(throughPayload.map((row) => row.colText)).toEqual(throughValues.map((row) => row.colText));
    });
  });

  describe('what returning() hands back', () => {
    // The payload path decodes its own rows rather than letting Drizzle do it, so a type it decodes
    // wrongly is still stored correctly and shows only here. Reselecting the table would miss it.
    it('returns what the bound-parameter path returns, for every accepted type', async () => {
      const populated: Array<typeof typeMatrix.$inferInsert> = [
        {
          id: uuidv7(),
          tenantId: TENANT_A,
          colUuid: null,
          colText: null,
          colVarchar: null,
          colBoolean: null,
          colSmallint: null,
          colInteger: null,
          colBigint: null,
          colReal: null,
          colDouble: null,
          colDate: null,
          colTimestamp: null,
          colTimestamptz: null,
        },
        {
          id: uuidv7(),
          tenantId: TENANT_A,
          colUuid: uuidv7(),
          colText: 'text',
          colVarchar: 'varchar',
          colBoolean: true,
          colSmallint: 32767,
          colInteger: 2147483647,
          colBigint: Number.MAX_SAFE_INTEGER,
          colReal: 0.5,
          colDouble: -0.1234567890123,
          colDate: new Date(Date.UTC(2024, 6, 9)),
          colTimestamp: new Date(Date.UTC(2024, 6, 9, 12, 34, 56, 789)),
          colTimestamptz: new Date(Date.UTC(2024, 6, 9, 12, 34, 56, 789)),
        },
      ];

      const returned = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        decisions = [];
        const rows = await writerOn(path).insert(typeMatrix).values(populated).returning();
        expectPathTaken(path);
        return [...rows].sort((left, right) => left.id.localeCompare(right.id));
      };

      const throughValues = await returned(PATHS[0]);
      const throughPayload = await returned(PATHS[1]);

      expect(throughPayload).toEqual(throughValues);
      // A date decoded as its raw string rather than through the column would still compare equal
      // between two arms that both got it wrong, so the shape is asserted rather than only parity.
      expect(throughValues[1]?.colDate).toBeInstanceOf(Date);
      expect(throughValues[1]?.colTimestamp).toBeInstanceOf(Date);
      expect(throughValues[1]?.colDefaulted).toBe('from the database');
    });
  });

  describe('strings the jsonb parser refuses', () => {
    // `JSON.stringify` renders both of these as the one kind of escape the jsonb parser rejects,
    // so a batch carrying either has to go back to bound parameters: on this path an unpaired
    // surrogate would fail a whole batch Postgres accepts, and a NUL would fail it under a
    // different SQLSTATE. They are built by code point, no source file surviving them verbatim.
    const surrogate = String.fromCharCode(0xD800);
    const replacement = String.fromCharCode(0xFFFD);
    const nul = String.fromCharCode(0);

    it('falls back on an unpaired surrogate, and stores what bound parameters store', async () => {
      const write = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        decisions = [];
        await writerOn(path)
          .insert(typeMatrix)
          .values([{ id: uuidv7(), tenantId: TENANT_A, colText: `before${surrogate}after` }]);
        return readAll();
      };

      const throughValues = await write(PATHS[0]);
      const throughPayload = await write(PATHS[1]);

      expect(decisions).toEqual([{ path: 'values', reason: 'unrepresentable-value' }]);
      expect(throughValues[0]?.colText).toBe(`before${replacement}after`);
      expect(throughPayload[0]?.colText).toBe(throughValues[0]?.colText);
    });

    it('falls back on a NUL, and both paths refuse it under the same SQLSTATE', async () => {
      const attempt = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        decisions = [];
        try {
          await writerOn(path)
            .insert(typeMatrix)
            .values([{ id: uuidv7(), tenantId: TENANT_A, colText: `before${nul}after` }]);
        } catch (error) {
          return pgErrorCode(error);
        }
        return 'no error';
      };

      // 22021, the encoding error a NUL is as a bound parameter, rather than the jsonb parser's
      // 22P05 on the escape.
      expect(await attempt(PATHS[0])).toBe('22021');
      expect(await attempt(PATHS[1])).toBe('22021');
      expect(decisions).toEqual([{ path: 'values', reason: 'unrepresentable-value' }]);
    });
  });

  describe('the shape the large batch callers use', () => {
    // The batch upserts that cross the row threshold in production chunk by 1000 and combine a
    // composite conflict target, a set built from SQL over both the stored row and `excluded`, and
    // returning(). Their own tests stay under the threshold, so nothing else brings the
    // combination onto this path.
    it('upserts on a composite target with a computed set, identically on both paths', async () => {
      const [keptId, movedId, freshId] = [uuidv7(), uuidv7(), uuidv7()];
      const older = new Date(Date.UTC(2020, 0, 1));
      const newer = new Date(Date.UTC(2024, 6, 9, 12));
      const keyed = (id: string, seq: number, seenAt: Date) => ({
        id,
        tenantId: TENANT_A,
        colUuid: TENANT_A,
        colInteger: seq,
        colVarchar: 'key',
        colTimestamptz: seenAt,
      });

      const upsert = async (path: (typeof PATHS)[number]) => {
        await db.execute(sql`TRUNCATE TABLE _test_payload_types`);
        decisions = [];
        await writerOn(path).insert(typeMatrix).values([keyed(keptId, 1, newer), keyed(movedId, 2, older)]);
        const returned = await writerOn(path)
          .insert(typeMatrix)
          .values([keyed(uuidv7(), 1, older), keyed(uuidv7(), 2, newer), keyed(freshId, 3, newer)])
          .onConflictDoUpdate({
            target: [typeMatrix.colUuid, typeMatrix.colInteger, typeMatrix.colVarchar],
            set: { colTimestamptz: sql`GREATEST(${typeMatrix.colTimestamptz}, excluded.col_timestamptz)` },
          })
          .returning();
        expectPathTaken(path);
        const ordered = [...returned].sort((left, right) => (left.colInteger ?? 0) - (right.colInteger ?? 0));
        return { returned: ordered, stored: await readAll() };
      };

      const throughValues = await upsert(PATHS[0]);
      const throughPayload = await upsert(PATHS[1]);

      // GREATEST holds the row already carrying the later timestamp and moves the other forward,
      // and a conflicting row keeps the id it was stored under rather than the one attempted.
      expect(throughValues.returned.map((row) => row.colTimestamptz)).toEqual([newer, newer, newer]);
      expect(throughValues.returned.map((row) => row.id)).toEqual([keptId, movedId, freshId]);
      expect(throughPayload).toEqual(throughValues);
    });
  });
});

/** Types the schema uses that must keep falling back, each carrying a value JSON cannot round-trip. */
const KNOWN_INELIGIBLE = new Set(['jsonb', 'json', 'numeric', 'text[]', 'uuid[]', 'double precision[]']);
