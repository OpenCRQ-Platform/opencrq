import { describe, expect, it } from 'vitest';
import type { CatalogueEdgeInput, EffectiveEdge, TechniqueOverrideInput } from './effective-coverage';
import { isScoredEdge, preferDirectEdges, resolveEffectiveEdges } from './effective-coverage';

const CAP = 'cap-mfa';
const T1078 = 't1078';
const T1110 = 't1110';
const T1621 = 't1621';

const catalogue = (techniqueId: string, fn: CatalogueEdgeInput['function']): CatalogueEdgeInput => ({
  capabilityId: CAP,
  techniqueId,
  function: fn,
});

const added = (techniqueId: string, fn: CatalogueEdgeInput['function']): TechniqueOverrideInput => ({
  capabilityId: CAP,
  techniqueId,
  kind: 'added',
  function: fn,
});

const removed = (techniqueId: string, fn: CatalogueEdgeInput['function']): TechniqueOverrideInput => ({
  capabilityId: CAP,
  techniqueId,
  kind: 'removed',
  function: fn,
});

describe('resolveEffectiveEdges', () => {
  it('returns the catalogue untouched when the tenant declared no override', () => {
    const edges = resolveEffectiveEdges([catalogue(T1078, 'prevent'), catalogue(T1110, 'detect')], []);
    expect(edges).toEqual([
      { capabilityId: CAP, techniqueId: T1078, function: 'prevent', source: 'catalogue', state: 'recommended' },
      { capabilityId: CAP, techniqueId: T1110, function: 'detect', source: 'catalogue', state: 'recommended' },
    ]);
  });

  it('flags an addition as tenant-sourced', () => {
    const edges = resolveEffectiveEdges([catalogue(T1078, 'prevent')], [added(T1621, 'detect')]);
    expect(edges).toContainEqual({
      capabilityId: CAP, techniqueId: T1621, function: 'detect', source: 'tenant', state: 'added',
    });
  });

  it('keeps a removed recommendation visible instead of dropping it', () => {
    const edges = resolveEffectiveEdges([catalogue(T1078, 'prevent'), catalogue(T1110, 'prevent')], [removed(T1078, 'prevent')]);
    expect(edges).toHaveLength(2);
    expect(edges.find((e) => e.techniqueId === T1078)).toEqual({
      capabilityId: CAP, techniqueId: T1078, function: 'prevent', source: 'catalogue', state: 'removed',
    });
    expect(edges.find((e) => e.techniqueId === T1110)?.state).toBe('recommended');
  });

  it('a removal suppresses the named function only, leaving the other one recommended', () => {
    const edges = resolveEffectiveEdges(
      [catalogue(T1078, 'prevent'), catalogue(T1078, 'detect')],
      [removed(T1078, 'prevent')],
    );
    expect(edges.find((e) => e.function === 'prevent')?.state).toBe('removed');
    expect(edges.find((e) => e.function === 'detect')?.state).toBe('recommended');
    expect(edges.filter(isScoredEdge).map((e) => e.function)).toEqual(['detect']);
  });

  it('removing both functions of a technique suppresses it entirely', () => {
    const edges = resolveEffectiveEdges(
      [catalogue(T1078, 'prevent'), catalogue(T1078, 'detect')],
      [removed(T1078, 'prevent'), removed(T1078, 'detect')],
    );
    expect(edges.every((e) => e.state === 'removed')).toBe(true);
    expect(edges.filter(isScoredEdge)).toHaveLength(0);
  });

  it('a removal on one function never touches an addition on the other', () => {
    const edges = resolveEffectiveEdges(
      [catalogue(T1078, 'prevent')],
      [removed(T1078, 'prevent'), added(T1078, 'detect')],
    );
    expect(edges.find((e) => e.function === 'prevent')?.state).toBe('removed');
    expect(edges.find((e) => e.function === 'detect')).toEqual({
      capabilityId: CAP, techniqueId: T1078, function: 'detect', source: 'tenant', state: 'added',
    });
  });

  it('scores everything the tenant has not removed', () => {
    const edges = resolveEffectiveEdges(
      [catalogue(T1078, 'prevent'), catalogue(T1110, 'prevent')],
      [removed(T1078, 'prevent'), added(T1621, 'prevent')],
    );
    expect(edges.filter(isScoredEdge).map((e) => e.techniqueId).sort()).toEqual([T1110, T1621]);
  });

  it('a catalogue update that starts recommending an added function dedupes to the catalogue', () => {
    // The addition was placed while the catalogue covered nothing on T1621; the catalogue now
    // recommends the same (technique, function), so a single row survives and it is catalogue-sourced.
    const edges = resolveEffectiveEdges([catalogue(T1621, 'detect')], [added(T1621, 'detect')]);
    expect(edges).toEqual([
      { capabilityId: CAP, techniqueId: T1621, function: 'detect', source: 'catalogue', state: 'recommended' },
    ]);
  });

  it('an addition on a function the catalogue does not recommend coexists with the catalogue one', () => {
    const edges = resolveEffectiveEdges([catalogue(T1621, 'detect')], [added(T1621, 'prevent')]);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => [e.function, e.source])).toEqual([['detect', 'catalogue'], ['prevent', 'tenant']]);
  });

  it('a removal that outlived its catalogue recommendation emits nothing', () => {
    expect(resolveEffectiveEdges([], [removed(T1078, 'prevent')])).toEqual([]);
  });

  it('a removal on a function the catalogue never recommended leaves the other function alone', () => {
    const edges = resolveEffectiveEdges([catalogue(T1078, 'prevent')], [removed(T1078, 'detect')]);
    expect(edges).toEqual([
      { capabilityId: CAP, techniqueId: T1078, function: 'prevent', source: 'catalogue', state: 'recommended' },
    ]);
  });

  it('resolves several controls independently', () => {
    const other = 'cap-waf';
    const edges = resolveEffectiveEdges(
      [catalogue(T1078, 'prevent'), { capabilityId: other, techniqueId: T1078, function: 'prevent' }],
      [removed(T1078, 'prevent')],
    );
    expect(edges.find((e) => e.capabilityId === CAP)?.state).toBe('removed');
    expect(edges.find((e) => e.capabilityId === other)?.state).toBe('recommended');
  });
});

const SUB = 't1078-004';

const effective = (
  capabilityId: string,
  techniqueId: string,
  fn: EffectiveEdge['function'],
): EffectiveEdge => ({ capabilityId, techniqueId, function: fn, source: 'catalogue', state: 'recommended' });

describe('preferDirectEdges', () => {
  it('drops the parent edge when the sub-technique carries the same control and function', () => {
    const edges = preferDirectEdges(
      [effective(CAP, T1078, 'prevent'), effective(CAP, SUB, 'prevent')],
      SUB,
    );
    expect(edges).toEqual([effective(CAP, SUB, 'prevent')]);
  });

  it('keeps a parent edge the sub-technique does not carry', () => {
    const edges = preferDirectEdges(
      [effective(CAP, T1078, 'detect'), effective(CAP, SUB, 'prevent')],
      SUB,
    );
    expect(edges).toEqual([effective(CAP, T1078, 'detect'), effective(CAP, SUB, 'prevent')]);
  });

  it('resolves each control on its own, so another control keeps its parent edge', () => {
    const other = 'cap-edr';
    const edges = preferDirectEdges(
      [effective(other, T1078, 'prevent'), effective(CAP, T1078, 'prevent'), effective(CAP, SUB, 'prevent')],
      SUB,
    );
    expect(edges).toEqual([effective(other, T1078, 'prevent'), effective(CAP, SUB, 'prevent')]);
  });

  it('leaves the edges of a parent technique alone', () => {
    const edges = preferDirectEdges([effective(CAP, T1078, 'prevent')], T1078);
    expect(edges).toEqual([effective(CAP, T1078, 'prevent')]);
  });

  it('keeps the parent edge the engine still scores when the tenant removed the direct one', () => {
    const removedDirect: EffectiveEdge = { ...effective(CAP, SUB, 'prevent'), state: 'removed' };
    const edges = preferDirectEdges([effective(CAP, T1078, 'prevent'), removedDirect], SUB);
    expect(edges).toEqual([effective(CAP, T1078, 'prevent')]);
  });

  it('reports the removal when the parent carries nothing to fall back on', () => {
    const removedDirect: EffectiveEdge = { ...effective(CAP, SUB, 'prevent'), state: 'removed' };
    expect(preferDirectEdges([removedDirect], SUB)).toEqual([removedDirect]);
  });

  it('reports the removal when the parent edge is removed too', () => {
    const removedDirect: EffectiveEdge = { ...effective(CAP, SUB, 'prevent'), state: 'removed' };
    const removedParent: EffectiveEdge = { ...effective(CAP, T1078, 'prevent'), state: 'removed' };
    expect(preferDirectEdges([removedParent, removedDirect], SUB)).toEqual([removedDirect]);
  });
});
