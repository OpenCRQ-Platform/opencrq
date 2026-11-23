import { describe, expect, it } from 'vitest';
import type { DependencyRule, DependencyRuleConditionLabels } from './dependency-rules-utils';
import { conditionsDraftOf, conditionSummaries, hasAnyCondition, isReadableRegex, toConditionsInput } from './dependency-rules-utils';

const rule = (overrides: Partial<DependencyRule> = {}): DependencyRule => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'SaaS hosts',
  primaryAssetId: '00000000-0000-4000-8000-000000000002',
  primaryAssetName: 'Customer platform',
  roles: ['processes'],
  enabled: true,
  categoryId: null,
  subcategoryId: null,
  namePattern: null,
  namePatternKind: null,
  tagId: null,
  tagName: null,
  source: null,
  linkCount: 0,
  ...overrides,
});

const labels: DependencyRuleConditionLabels = {
  category: (category) => `category ${category}`,
  subcategory: (subcategory) => `subcategory ${subcategory}`,
  source: (source) => `source ${source}`,
  glob: (pattern) => `glob ${pattern}`,
  regex: (pattern) => `regex ${pattern}`,
  tag: (name) => `tag ${name}`,
};

describe('toConditionsInput', () => {
  it('sends no pattern and no kind for a blank pattern', () => {
    const input = toConditionsInput({ ...conditionsDraftOf(null), namePattern: '   ', categoryId: 'host' });
    expect(input).toEqual({ categoryId: 'host', subcategoryId: null, namePattern: null, namePatternKind: null, tagId: null, source: null });
  });

  it('trims the pattern and keeps its kind', () => {
    const input = toConditionsInput({ ...conditionsDraftOf(null), namePattern: ' *.example.io ', namePatternKind: 'glob' });
    expect(input.namePattern).toBe('*.example.io');
    expect(input.namePatternKind).toBe('glob');
  });
});

describe('hasAnyCondition', () => {
  it('is false for the empty draft and for a blank pattern alone', () => {
    expect(hasAnyCondition(conditionsDraftOf(null))).toBe(false);
    expect(hasAnyCondition({ ...conditionsDraftOf(null), namePattern: ' ' })).toBe(false);
  });

  it.each([
    { categoryId: 'host' as const },
    { subcategoryId: 'server' as const },
    { namePattern: 'web-*' },
    { tagId: '00000000-0000-4000-8000-000000000003' },
    { source: 'openaev' as const },
  ])('is true with %o', (condition) => {
    expect(hasAnyCondition({ ...conditionsDraftOf(null), ...condition })).toBe(true);
  });
});

describe('isReadableRegex', () => {
  it('accepts a balanced expression and refuses an unbalanced one', () => {
    expect(isReadableRegex('^web-[0-9]+$')).toBe(true);
    expect(isReadableRegex('^web-[0-9+$')).toBe(false);
    expect(isReadableRegex('(ci|cd')).toBe(false);
  });
});

describe('conditionsDraftOf', () => {
  it('reads an existing rule back into the editor', () => {
    const draft = conditionsDraftOf(rule({ namePattern: '^ci-', namePatternKind: 'regex', source: 'drata' }));
    expect(draft).toEqual({ categoryId: null, subcategoryId: null, namePattern: '^ci-', namePatternKind: 'regex', tagId: null, source: 'drata' });
  });

  it('starts a new rule on a glob', () => {
    expect(conditionsDraftOf(null).namePatternKind).toBe('glob');
  });
});

describe('conditionSummaries', () => {
  it('lists every condition in editor order, the tag by name', () => {
    const summaries = conditionSummaries(rule({
      categoryId: 'host',
      subcategoryId: 'server',
      namePattern: '*.example.io',
      namePatternKind: 'glob',
      tagId: '00000000-0000-4000-8000-000000000003',
      tagName: 'production',
      source: 'openaev',
    }), labels);
    expect(summaries).toEqual(['category host', 'subcategory server', 'glob *.example.io', 'tag production', 'source openaev']);
  });

  it('shows a regex as a regex', () => {
    expect(conditionSummaries(rule({ namePattern: '^ci-', namePatternKind: 'regex' }), labels)).toEqual(['regex ^ci-']);
  });
});
