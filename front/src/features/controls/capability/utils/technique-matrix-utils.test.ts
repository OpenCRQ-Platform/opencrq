import { describe, expect, it } from 'vitest';
import type { CapabilityEdge } from '../types/capability';
import {
  activeFunctions,
  aggregateByTechnique,
  coveredTechniquesForFunction,
} from './technique-matrix-utils';

const edge = (
  techniqueId: string,
  fn: CapabilityEdge['function'],
  state: CapabilityEdge['state'] = 'recommended',
): CapabilityEdge => ({
  techniqueId,
  techniqueExternalId: `T${techniqueId}`,
  techniqueName: `Technique ${techniqueId}`,
  function: fn,
  source: state === 'added' ? 'tenant' : 'catalogue',
  state,
  tactics: [],
});

describe('aggregateByTechnique', () => {
  it('returns one entry per technique', () => {
    const result = aggregateByTechnique([edge('1', 'prevent'), edge('2', 'detect')]);
    expect(result).toHaveLength(2);
    expect(result.map((technique) => technique.techniqueId)).toEqual(['1', '2']);
  });

  it('groups the functions of the same technique into one entry', () => {
    const result = aggregateByTechnique([edge('1', 'prevent'), edge('1', 'detect')]);
    expect(result).toHaveLength(1);
    expect(result[0].edges.map((entry) => entry.function)).toEqual(['prevent', 'detect']);
  });

  it('carries the technique metadata of the first edge seen', () => {
    const result = aggregateByTechnique([edge('1', 'prevent')]);
    expect(result[0].techniqueExternalId).toBe('T1');
    expect(result[0].techniqueName).toBe('Technique 1');
  });

  it('returns an empty list for no edges', () => {
    expect(aggregateByTechnique([])).toEqual([]);
  });
});

describe('activeFunctions', () => {
  it('returns the only function when there is one', () => {
    const [technique] = aggregateByTechnique([edge('1', 'detect')]);
    expect(activeFunctions(technique)).toEqual(['detect']);
  });

  it('returns both functions in canonical catalogue order', () => {
    const [technique] = aggregateByTechnique([edge('1', 'detect'), edge('1', 'prevent')]);
    expect(activeFunctions(technique)).toEqual(['prevent', 'detect']);
  });

  it('drops a function the tenant removed', () => {
    const [technique] = aggregateByTechnique([edge('1', 'prevent', 'removed'), edge('1', 'detect')]);
    expect(activeFunctions(technique)).toEqual(['detect']);
  });

  it('keeps a function the tenant added', () => {
    const [technique] = aggregateByTechnique([edge('1', 'detect', 'added')]);
    expect(activeFunctions(technique)).toEqual(['detect']);
  });
});

describe('coveredTechniquesForFunction', () => {
  it('keeps only the edges of the asked function', () => {
    const edges = [edge('1', 'prevent'), edge('2', 'detect')];
    expect(coveredTechniquesForFunction(edges, 'prevent').map((entry) => entry.techniqueId)).toEqual(['1']);
    expect(coveredTechniquesForFunction(edges, 'detect').map((entry) => entry.techniqueId)).toEqual(['2']);
  });

  it('drops a technique the tenant removed on that function only', () => {
    const edges = [edge('1', 'prevent', 'removed'), edge('1', 'detect')];
    expect(coveredTechniquesForFunction(edges, 'prevent')).toEqual([]);
    expect(coveredTechniquesForFunction(edges, 'detect').map((entry) => entry.techniqueId)).toEqual(['1']);
  });

  it('keeps a technique the tenant added on that function', () => {
    expect(coveredTechniquesForFunction([edge('1', 'detect', 'added')], 'detect')).toHaveLength(1);
  });

  it('returns nothing when the function covers nothing', () => {
    expect(coveredTechniquesForFunction([edge('1', 'prevent')], 'detect')).toEqual([]);
  });
});
