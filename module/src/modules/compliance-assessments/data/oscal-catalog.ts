import { newError } from '@app/utils';
import { v5 as uuidv5 } from 'uuid';
import { z } from 'zod';
import type { FrameworkNodeKind } from '../constants';
import { FRAMEWORK_NODE_KINDS } from '../constants';

const COMPLIANCE_CATALOG_NAMESPACE = '6f1d3c2a-8b4e-4f5a-9c7d-2e1b0a9f8c3d';

const OscalPropSchema = z.object({ name: z.string(), value: z.string() });
const OscalPartSchema = z.object({ name: z.string(), prose: z.string().optional() });

interface OscalNode {
  id: string,
  class?: string,
  title: string,
  props?: Array<z.infer<typeof OscalPropSchema>>,
  parts?: Array<z.infer<typeof OscalPartSchema>>,
  controls?: Array<OscalNode>,
}

const OscalNodeSchema: z.ZodType<OscalNode> = z.lazy(() => z.object({
  id: z.string(),
  class: z.string().optional(),
  title: z.string(),
  props: z.array(OscalPropSchema).optional(),
  parts: z.array(OscalPartSchema).optional(),
  controls: z.array(OscalNodeSchema).optional(),
}));

const OscalCatalogSchema = z.object({
  catalog: z.object({
    uuid: z.uuid(),
    metadata: z.object({ version: z.string() }),
    groups: z.array(OscalNodeSchema),
  }),
});

export interface CatalogFrameworkRow {
  id: string,
  key: string,
  title: string,
  version: string,
  oscalCatalogUuid: string,
}

export interface CatalogNodeRow {
  id: string,
  frameworkId: string,
  parentId: string | null,
  oscalId: string,
  code: string,
  title: string,
  statement: string | null,
  kind: FrameworkNodeKind,
  isRequirement: boolean,
  position: number,
}

export interface ParsedCatalog {
  framework: CatalogFrameworkRow,
  nodes: Array<CatalogNodeRow>,
}

const prop = (node: OscalNode, name: string) => node.props?.find((p) => p.name === name)?.value;

const isWithdrawn = (node: OscalNode) => prop(node, 'status') === 'withdrawn';

const toKind = (node: OscalNode): FrameworkNodeKind => {
  const kind = FRAMEWORK_NODE_KINDS.find((candidate) => candidate === node.class);
  if (!kind) {
    throw newError('An OSCAL node has an unsupported class', { oscalId: node.id, oscalClass: node.class ?? null });
  }
  return kind;
};

// NIST labels a group "GOVERN (GV)" and a control "GV.OC-01": the code is the parenthesised tail
// when there is one.
const toCode = (node: OscalNode) => {
  const label = prop(node, 'label') ?? node.id;
  return /\(([^()]+)\)$/.exec(label)?.[1] ?? label;
};

const toStatement = (node: OscalNode) =>
  node.parts?.find((part) => part.name === 'statement' || part.name === 'overview')?.prose ?? null;

/** The ids derive from the framework key and the OSCAL id, so a reload lands on the rows it wrote before. */
export const parseOscalCatalog = ({ key, title }: { key: string, title: string }, raw: unknown): ParsedCatalog => {
  const { catalog } = OscalCatalogSchema.parse(raw);
  const frameworkId = uuidv5(key, COMPLIANCE_CATALOG_NAMESPACE);
  const nodes: Array<CatalogNodeRow> = [];

  const visit = (node: OscalNode, parentId: string | null, isGroup: boolean) => {
    if (isWithdrawn(node)) {
      return;
    }
    const id = uuidv5(`${key}:${node.id}`, COMPLIANCE_CATALOG_NAMESPACE);
    const code = toCode(node);
    const statement = toStatement(node);
    const activeChildren = (node.controls ?? []).filter((child) => !isWithdrawn(child));
    nodes.push({
      id,
      frameworkId,
      parentId,
      oscalId: node.id,
      code,
      title: node.title === code && statement !== null ? statement : node.title,
      statement,
      kind: toKind(node),
      isRequirement: !isGroup && activeChildren.length === 0,
      position: nodes.length,
    });
    for (const child of activeChildren) {
      visit(child, id, false);
    }
  };
  for (const group of catalog.groups) {
    visit(group, null, true);
  }

  return {
    framework: {
      id: frameworkId,
      key,
      title,
      version: catalog.metadata.version,
      oscalCatalogUuid: catalog.uuid,
    },
    nodes,
  };
};
