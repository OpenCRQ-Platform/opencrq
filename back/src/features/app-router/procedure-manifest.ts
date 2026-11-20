import { createHash } from 'node:crypto';
import type { AnyTRPCRouter } from '@trpc/server';
import { z } from 'zod';

const MANIFEST_FORMAT_VERSION = 1;

const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

const procedureDefSchema = z.object({
  type: z.enum(['query', 'mutation', 'subscription']),
  inputs: z.array(z.custom<z.core.$ZodType>((input) => input instanceof z.core.$ZodType)),
});

const procedureDefOf = (procedure: unknown) => {
  if (typeof procedure !== 'function') {
    throw new TypeError('A tRPC procedure is expected to be a function');
  }
  return procedureDefSchema.parse(Reflect.get(procedure, '_def'));
};

// No transformer is configured, so the wire is plain JSON: a date input arrives as an ISO string. Any
// other site without a JSON Schema throws, rather than becoming a `{}` a consumer's check lets anything through.
const toWireJsonSchema = (input: z.core.$ZodType) => {
  const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(input, {
    io: 'input',
    unrepresentable: ({ zodSchema }) => (zodSchema._zod.def.type === 'date' ? { type: 'string', format: 'date-time' } : 'throw'),
  });
  return jsonSchema;
};

// Intersected on the Zod side, so a part's `$defs` land at the root its `$ref`s point to.
const inputSchemaOf = (inputs: Array<z.core.$ZodType>) => (
  inputs.length === 0 ? null : toWireJsonSchema(inputs.reduce((merged, input) => z.intersection(merged, input)))
);

/**
 * The procedures a router serves, with the JSON Schema of the input each accepts, for an
 * integration that calls OpenCRQ by procedure name and has no access to its TypeScript types.
 */
export const describeProcedures = (router: AnyTRPCRouter) => ({
  formatVersion: MANIFEST_FORMAT_VERSION,
  jsonSchemaDialect: JSON_SCHEMA_DIALECT,
  procedures: Object.entries(router._def.procedures)
    .map(([path, procedure]) => {
      const { type, inputs } = procedureDefOf(procedure);
      try {
        return { path, type, input: inputSchemaOf(inputs) };
      } catch (error) {
        throw new TypeError(`${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    })
    .sort((a, b) => (a.path < b.path ? -1 : 1)),
});

export type ProcedureManifest = ReturnType<typeof describeProcedures>;

export type ServedProcedureManifest = ProcedureManifest & { fingerprint: string };

/** Compact JSON with every object's keys sorted, so equal values serialize to equal text whatever their key order. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
  return `{${entries.join(',')}}`;
};

/** SHA-256 hex of the manifest's canonical JSON: two processes running the same code agree on it. */
export const procedureManifestFingerprint = ({ formatVersion, jsonSchemaDialect, procedures }: ProcedureManifest): string =>
  createHash('sha256').update(canonicalJson({ formatVersion, jsonSchemaDialect, procedures })).digest('hex');

/**
 * The manifest of the router `getRouter` returns, described once per router: `null` until one is
 * published. Described lazily, so a process that never serves a manifest never pays for it.
 */
export const createServedProcedureManifest = (getRouter: () => AnyTRPCRouter | null): () => ServedProcedureManifest | null => {
  let memo: { router: AnyTRPCRouter, manifest: ServedProcedureManifest } | null = null;
  return () => {
    const router = getRouter();
    if (router === null) {
      return null;
    }
    if (memo?.router !== router) {
      const manifest = describeProcedures(router);
      memo = { router, manifest: { ...manifest, fingerprint: procedureManifestFingerprint(manifest) } };
    }
    return memo.manifest;
  };
};
