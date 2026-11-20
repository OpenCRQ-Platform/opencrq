export type MitreLinkTarget =
  | { kind: 'technique', externalId: string }
  | { kind: 'tactic', externalId: string }
  | { kind: 'mitigation', externalId: string }
  | { kind: 'external', href: string };

const MITRE_CATALOGUE_URL = /^https?:\/\/attack\.mitre\.org\/(techniques|tactics|mitigations)\/([A-Za-z]+\d+)(?:\/(\d+))?\/?$/i;

/**
 * A link to a technique, tactic or mitigation the catalogue holds opens our own page for it.
 * ATT&CK addresses a sub-technique as `T1557/001` where its identifier is `T1557.001`.
 */
export const resolveMitreLink = (href: string): MitreLinkTarget => {
  const match = MITRE_CATALOGUE_URL.exec(href);
  if (match === null) {
    return { kind: 'external', href };
  }
  const [, section, id, subId] = match;
  const externalId = (subId === undefined ? id : `${id}.${subId}`).toUpperCase();
  switch (section.toLowerCase()) {
    case 'techniques':
      return { kind: 'technique', externalId };
    case 'tactics':
      return subId === undefined ? { kind: 'tactic', externalId } : { kind: 'external', href };
    default:
      return subId === undefined ? { kind: 'mitigation', externalId } : { kind: 'external', href };
  }
};

const HTML_ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': '\'' };

const decodeEntities = (value: string): string => value.replace(/&(?:lt|gt|amp|quot|#39);/g, (entity) => HTML_ENTITIES[entity]);

const toCodeSpan = (content: string): string => {
  const code = decodeEntities(content).replace(/\s+/g, ' ').trim();
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padding = code.startsWith('`') || code.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${code}${padding}${fence}`;
};

/**
 * ATT&CK writes its descriptions in markdown sprinkled with `<code>`, `<b>` and `<br>`. They become
 * their markdown forms, since a markdown renderer drops raw HTML along with what it wraps, and the
 * text inside `<code>` holds literal placeholders such as `<username>` that must survive.
 */
export const normalizeMitreMarkdown = (text: string): string => text
  .replace(/<code>([\s\S]*?)<\/code>/g, (_, content: string) => toCodeSpan(content))
  .replace(/<b>([\s\S]*?)<\/b>/g, '**$1**')
  .replace(/<br\s*\/?>\n?/g, '\\\n');

interface MarkdownNode {
  type: string,
  value?: string,
  children?: Array<MarkdownNode>,
  data?: Record<string, unknown>,
}

const CITATION = /\(Citation: ([^)]+)\)/g;
const BLOCK_PARENTS = new Set(['root', 'listItem', 'blockquote']);

const splitCitations = (value: string, numberOf: (source: string) => number): Array<MarkdownNode> => {
  const nodes: Array<MarkdownNode> = [];
  let cursor = 0;
  for (const match of value.matchAll(CITATION)) {
    if (match.index > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, match.index) });
    }
    const source = match[1].trim();
    nodes.push({
      type: 'citation',
      data: {
        hName: 'sup',
        hProperties: { title: source, className: ['mitre-citation'] },
        hChildren: [{ type: 'text', value: `[${numberOf(source)}]` }],
      },
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    nodes.push({ type: 'text', value: value.slice(cursor) });
  }
  return nodes;
};

/**
 * A remark plugin for ATT&CK descriptions. Raw HTML left after `normalizeMitreMarkdown` is a
 * literal such as `<username>`, kept as text. `(Citation: Source)` becomes a superscript `[n]`
 * naming its source, numbered by first appearance as attack.mitre.org numbers its references.
 */
export const remarkMitreDescription = () => (tree: MarkdownNode): void => {
  const numbers = new Map<string, number>();
  const numberOf = (source: string): number => {
    const known = numbers.get(source);
    if (known !== undefined) {
      return known;
    }
    const next = numbers.size + 1;
    numbers.set(source, next);
    return next;
  };

  const visit = (node: MarkdownNode): void => {
    if (node.children === undefined) {
      return;
    }
    node.children = node.children.flatMap((child): Array<MarkdownNode> => {
      if (child.type === 'html') {
        const text: MarkdownNode = { type: 'text', value: child.value ?? '' };
        return [BLOCK_PARENTS.has(node.type) ? { type: 'paragraph', children: [text] } : text];
      }
      if (child.type === 'text' && child.value !== undefined) {
        return splitCitations(child.value, numberOf);
      }
      visit(child);
      return [child];
    });
  };

  visit(tree);
};
