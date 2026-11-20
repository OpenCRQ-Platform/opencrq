import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

export type ServedProcedure = { path: string, type: string, input: JsonSchema | null };

const toolProceduresSchema = z.record(z.string(), z.array(z.string()));

const toolInputKeysSchema = z.record(z.string(), z.array(z.object({
  procedures: z.array(z.string()),
  fields: z.array(z.string()),
  conditional: z.array(z.string()),
  closed: z.boolean(),
})));

// XTM One's own pin of the router's procedures, which holds the type each of its calls is sent as.
const pinnedProceduresSchema = z.object({ procedures: z.array(z.object({ path: z.string(), type: z.string() })) });

export const parseToolProcedures = (json: unknown) => toolProceduresSchema.parse(json);

export const parsePinnedProcedures = (json: unknown) => pinnedProceduresSchema.parse(json).procedures;

export const parseToolInputKeys = (json: unknown) => toolInputKeysSchema.parse(json);

type ToolProcedures = ReturnType<typeof parseToolProcedures>;
type ToolInputKeys = ReturnType<typeof parseToolInputKeys>;
type PinnedProcedures = ReturnType<typeof parsePinnedProcedures>;

// What the walk reads of a schema once unions, intersections and references are flattened away.
type Leaf = { type?: Array<string>, properties?: Record<string, JsonSchema>, required?: Array<string>, items?: JsonSchema, additionalProperties?: unknown };

const MAX_DEPTH = 32;
const MAX_LEAVES = 256;
const STRUCTURE = ['type', 'properties', 'required', 'items', 'additionalProperties'];

const isRecord = (value: unknown): value is JsonSchema => typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecord = (value: unknown) => (isRecord(value) ? value : null);

const resolveRef = (ref: unknown, root: JsonSchema) => {
  const prefix = '#/$defs/';
  if (typeof ref !== 'string' || !ref.startsWith(prefix)) {
    return null;
  }
  return asRecord(asRecord(root['$defs'])?.[ref.slice(prefix.length)]);
};

const mergeLeaves = (left: Leaf, right: Leaf): Leaf => {
  const merged: Leaf = { ...left };
  if (right.type) {
    merged.type = left.type ? left.type.filter((kind) => right.type?.includes(kind)) : right.type;
  }
  if (right.properties) {
    const properties = { ...left.properties };
    for (const [name, schema] of Object.entries(right.properties)) {
      properties[name] = name in properties ? { allOf: [properties[name], schema] } : schema;
    }
    merged.properties = properties;
  }
  if (right.required) {
    merged.required = [...left.required ?? [], ...right.required];
  }
  if (right.items) {
    merged.items = left.items ? { allOf: [left.items, right.items] } : right.items;
  }
  if (right.additionalProperties !== undefined && right.additionalProperties !== false && (left.additionalProperties === undefined || left.additionalProperties === false)) {
    merged.additionalProperties = right.additionalProperties;
  }
  return merged;
};

const ownLeaf = (schema: JsonSchema): Leaf => {
  const leaf: Leaf = {};
  if (typeof schema['type'] === 'string') {
    leaf.type = [schema['type']];
  } else if (Array.isArray(schema['type'])) {
    leaf.type = schema['type'].filter((kind): kind is string => typeof kind === 'string');
  }
  const properties = asRecord(schema['properties']);
  if (properties) {
    leaf.properties = Object.fromEntries(Object.entries(properties).filter((entry): entry is [string, JsonSchema] => isRecord(entry[1])));
  }
  if (Array.isArray(schema['required'])) {
    leaf.required = schema['required'].filter((name): name is string => typeof name === 'string');
  }
  const items = asRecord(schema['items']);
  if (items) {
    leaf.items = items;
  }
  if ('additionalProperties' in schema) {
    leaf.additionalProperties = schema['additionalProperties'];
  }
  return leaf;
};

/**
 * The alternatives a schema comes down to, each free of `anyOf`, `oneOf`, `allOf` and `$ref`.
 * `null` when it cannot be read: the callers let such a subtree pass rather than guess.
 */
const leavesOf = (schema: unknown, root: JsonSchema, depth = 0): Array<Leaf> | null => {
  const node = asRecord(schema);
  if (depth > MAX_DEPTH || !node) {
    return null;
  }
  const conjuncts: Array<Array<Leaf>> = [];
  const own = ownLeaf(node);
  if (Object.keys(own).length > 0) {
    conjuncts.push([own]);
  }
  for (const keyword of ['anyOf', 'oneOf']) {
    const branches = node[keyword];
    if (Array.isArray(branches)) {
      const union: Array<Leaf> = [];
      for (const branch of branches) {
        const leaves = leavesOf(branch, root, depth + 1);
        if (!leaves) {
          return null;
        }
        union.push(...leaves);
      }
      conjuncts.push(union);
    }
  }
  if (Array.isArray(node['allOf'])) {
    for (const member of node['allOf']) {
      const leaves = leavesOf(member, root, depth + 1);
      if (!leaves) {
        return null;
      }
      conjuncts.push(leaves);
    }
  }
  if ('$ref' in node) {
    const leaves = leavesOf(resolveRef(node['$ref'], root), root, depth + 1);
    if (!leaves) {
      return null;
    }
    conjuncts.push(leaves);
  }
  let combined: Array<Leaf> = [{}];
  for (const union of conjuncts) {
    combined = combined.flatMap((leaf) => union.map((alternative) => mergeLeaves(leaf, alternative)));
    if (combined.length > MAX_LEAVES) {
      return null;
    }
  }
  return combined;
};

// An absent `additionalProperties` is closed: Zod emits none for an object and strips the extra keys.
const isOpen = (leaf: Leaf) => (leaf.additionalProperties !== undefined && leaf.additionalProperties !== false)
  || !STRUCTURE.some((keyword) => keyword in leaf);

const ITEMS = '[]';
const ANY_KEY = '*';

// `a.b`, `list[].key`, `map.*.key`
const segmentsOf = (path: string) => path.split('.').flatMap((segment) => {
  const name = segment.replace(/(\[\])+$/, '');
  return [name, ...Array.from<string>({ length: (segment.length - name.length) / ITEMS.length }).fill(ITEMS)];
});

const accepts = (schema: unknown, root: JsonSchema, segments: Array<string>, depth = 0): boolean => {
  const [head, ...rest] = segments;
  if (head === undefined) {
    return true;
  }
  const leaves = leavesOf(schema, root);
  if (!leaves || depth > MAX_DEPTH) {
    return true;
  }
  return leaves.some((leaf) => {
    if (head === ITEMS) {
      // No `items` leaves the elements unconstrained, as `z.unknown()` does.
      return (!leaf.type || leaf.type.includes('array')) && accepts(leaf.items, root, rest, depth + 1);
    }
    if (leaf.type && !leaf.type.includes('object')) {
      return false;
    }
    const known = head === ANY_KEY ? undefined : leaf.properties?.[head];
    if (known) {
      return accepts(known, root, rest, depth + 1);
    }
    if (!isOpen(leaf)) {
      return false;
    }
    return accepts(asRecord(leaf.additionalProperties) ?? {}, root, rest, depth + 1);
  });
};

// A union is satisfied by its closest branch, so the required fields a call lacks are the fewest any branch lacks.
// The call sends an object, so only a branch an object can match counts: the `null` of a `.nullable()` input does not.
const lackedRequired = (schema: unknown, sent: Set<string>) => {
  const root = asRecord(schema);
  const leaves = root ? leavesOf(root, root)?.filter((leaf) => !leaf.type || leaf.type.includes('object')) : null;
  if (!leaves || leaves.length === 0) {
    return [];
  }
  const lacking = leaves.map((leaf) => (leaf.required ?? []).filter((name) => !sent.has(name)));
  return lacking.every((names) => names.length > 0) ? lacking.reduce((fewest, names) => (names.length < fewest.length ? names : fewest)) : [];
};

export type ContractBreak = { tool: string, procedure: string, kind: 'missing-procedure' | 'unsendable-procedure' | 'changed-type' | 'unknown-field' | 'required-field', field?: string, message: string };

const ADVICE = 'Keep the old name or field, deprecated and ignored, until XTM One stops sending it, or coordinate the change with XTM One. A deliberate break moves the pin in this pull request (yarn xtm-one-contract --ref <commit>).';

/**
 * Holds what XTM One's OpenCRQ tools send against the procedures a router serves.
 *
 * XTM One chooses the HTTP method of each call and holds it to the type it pinned for the procedure,
 * so a served type must be one GET or POST can call (not a subscription) and the one it pinned.
 */
export const findContractBreaks = (served: Array<ServedProcedure>, toolProcedures: ToolProcedures, toolInputKeys: ToolInputKeys, pinnedProcedures: PinnedProcedures) => {
  const byPath = new Map(served.map((procedure) => [procedure.path, procedure]));
  const pinnedTypes = new Map(pinnedProcedures.map(({ path, type }) => [path, type]));
  const breaks: Array<ContractBreak> = [];
  const add = (tool: string, procedure: string, kind: ContractBreak['kind'], description: string, field?: string) => {
    breaks.push({ tool, procedure, kind, field, message: `XTM One tool ${tool}: ${description}. ${ADVICE}` });
  };

  for (const [tool, procedures] of Object.entries(toolProcedures)) {
    for (const procedure of procedures) {
      const found = byPath.get(procedure);
      const pinned = pinnedTypes.get(procedure);
      if (!found) {
        add(tool, procedure, 'missing-procedure', `procedure ${procedure} is no longer served`);
      } else if (found.type !== 'query' && found.type !== 'mutation') {
        add(tool, procedure, 'unsendable-procedure', `procedure ${procedure} is now a ${found.type}, which XTM One cannot call with GET or POST`);
      } else if (pinned !== undefined && pinned !== found.type) {
        add(tool, procedure, 'changed-type', `procedure ${procedure} is now a ${found.type}, while XTM One sends it as a ${pinned}`);
      }
    }
  }

  for (const [tool, calls] of Object.entries(toolInputKeys)) {
    for (const call of calls) {
      // A missing procedure was reported above.
      const procedures = call.procedures.flatMap((path) => byPath.get(path) ?? []);
      const rejects = ({ input }: ServedProcedure, field: string) => !input || !accepts(input, input, segmentsOf(field));
      for (const field of call.fields.filter((name) => !call.conditional.includes(name))) {
        for (const procedure of procedures.filter((candidate) => rejects(candidate, field))) {
          add(tool, procedure.path, 'unknown-field', `procedure ${procedure.path} no longer accepts the field ${field}, which Zod would drop without a word`, field);
        }
      }
      for (const field of call.conditional) {
        if (procedures.length > 0 && procedures.every((procedure) => rejects(procedure, field))) {
          add(tool, call.procedures.join(', '), 'unknown-field', `none of ${call.procedures.join(', ')} accepts the field ${field} it sends under a condition`, field);
        }
      }
      if (call.closed) {
        // XTM One sends every field of a call to each procedure the call can go to, so a conditional field is unsent for all of them.
        const sent = new Set(call.fields.filter((field) => !call.conditional.includes(field)).map((field) => segmentsOf(field)[0] ?? field));
        for (const procedure of procedures) {
          for (const field of lackedRequired(procedure.input, sent)) {
            add(tool, procedure.path, 'required-field', `procedure ${procedure.path} now requires the field ${field}, which this call never sends`, field);
          }
        }
      }
    }
  }
  return breaks;
};
