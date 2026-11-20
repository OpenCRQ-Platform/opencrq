import { describe, expect, it } from 'vitest';
import nistCsf20Catalog from './nist-csf-2.0-catalog.json';
import { parseOscalCatalog } from './oscal-catalog';

const parse = () => parseOscalCatalog({ key: 'nist-csf-2.0', title: 'NIST CSF 2.0' }, nistCsf20Catalog);

describe('parseOscalCatalog on NIST CSF 2.0', () => {
  it('keeps the 6 functions, 22 categories and 106 subcategories, and no withdrawn entry', () => {
    const { nodes } = parse();
    const count = (kind: string) => nodes.filter((node) => node.kind === kind).length;
    expect(count('function')).toBe(6);
    expect(count('category')).toBe(22);
    expect(count('subcategory')).toBe(106);
    expect(nodes.some((node) => node.oscalId === 'ID.BE')).toBe(false);
  });

  it('answers on the subcategories alone', () => {
    const { nodes } = parse();
    expect(nodes.filter((node) => node.isRequirement).every((node) => node.kind === 'subcategory')).toBe(true);
    expect(nodes.filter((node) => node.isRequirement)).toHaveLength(106);
  });

  it('reads codes and NIST\'s own text', () => {
    const { nodes } = parse();
    const byId = new Map(nodes.map((node) => [node.oscalId, node]));
    expect(byId.get('GV')).toMatchObject({ code: 'GV', title: 'GOVERN', parentId: null });
    expect(byId.get('PR.AA')).toMatchObject({ code: 'PR.AA', title: 'Identity Management, Authentication, and Access Control' });
    expect(byId.get('PR.AA-03')).toMatchObject({
      code: 'PR.AA-03',
      title: 'Users, services, and hardware are authenticated',
      parentId: byId.get('PR.AA')?.id,
    });
  });

  it('lists every parent before its children and derives the same ids on every load', () => {
    const first = parse();
    const seen = new Set<string>();
    for (const node of first.nodes) {
      if (node.parentId !== null) {
        expect(seen.has(node.parentId)).toBe(true);
      }
      seen.add(node.id);
    }
    expect(parse()).toEqual(first);
  });
});
