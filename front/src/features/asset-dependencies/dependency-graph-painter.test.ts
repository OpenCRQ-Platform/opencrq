import dynamicIconImports from 'lucide-react/dynamicIconImports';
import { describe, expect, it } from 'vitest';
import { GLYPHS } from './dependency-graph-painter';

const isLucideName = (name: string): name is keyof typeof dynamicIconImports => name in dynamicIconImports;

const lucidePrimitives = async (name: string): Promise<Array<Record<string, number | string>>> => {
  if (!isLucideName(name)) {
    throw new Error(`lucide-react has no icon named ${name}`);
  }
  const { __iconData } = await dynamicIconImports[name]();
  return __iconData.node.map(([shape, attributes]) => {
    const primitive: Record<string, number | string> = { shape };
    for (const [attribute, value] of Object.entries(attributes)) {
      if (attribute !== 'key' && attribute !== 'ry') {
        primitive[attribute] = shape === 'path' ? String(value) : Number(value);
      }
    }
    if (shape === 'rect') {
      primitive.rx ??= 0;
    }
    return primitive;
  });
};

const canonical = (primitives: Array<object>): Array<string> =>
  primitives.map((primitive) => JSON.stringify(primitive, Object.keys(primitive).sort())).sort();

describe('GLYPHS', () => {
  it.each(Object.entries(GLYPHS))('draws %s exactly as lucide-react does', async (name, ours) => {
    expect(canonical(ours)).toEqual(canonical(await lucidePrimitives(name)));
  });
});
