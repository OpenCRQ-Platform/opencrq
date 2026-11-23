import { describe, expect, it } from 'vitest';
import { globToRegex, hasCondition, namePatternRegex, pairKey, wantedRuleLinks } from './rule-matching';

const NO_CONDITION = { categoryId: null, subcategoryId: null, namePattern: null, namePatternKind: null, tagId: null, source: null };

describe('globToRegex', () => {
  it('anchors the glob so it matches a whole name', () => {
    expect(globToRegex('*.example.io')).toBe('^.*\\.example\\.io$');
  });

  it('reads ? as one character', () => {
    expect(globToRegex('web-?')).toBe('^web-.$');
  });

  it('escapes every other regular expression character', () => {
    expect(globToRegex('a+b(c)[d]{e}|f^g$h\\i')).toBe('^a\\+b\\(c\\)\\[d\\]\\{e\\}\\|f\\^g\\$h\\\\i$');
  });
});

describe('namePatternRegex', () => {
  it('passes a regular expression through as written', () => {
    expect(namePatternRegex('^db-[0-9]+', 'regex')).toBe('^db-[0-9]+');
  });

  it('is null for a rule without a pattern', () => {
    expect(namePatternRegex(null, null)).toBeNull();
  });
});

describe('hasCondition', () => {
  it('refuses a rule that would match every asset', () => {
    expect(hasCondition(NO_CONDITION)).toBe(false);
  });

  it('accepts any single condition', () => {
    expect(hasCondition({ ...NO_CONDITION, categoryId: 'host' })).toBe(true);
    expect(hasCondition({ ...NO_CONDITION, tagId: 'tag' })).toBe(true);
    expect(hasCondition({ ...NO_CONDITION, source: 'openaev' })).toBe(true);
  });
});

describe('wantedRuleLinks', () => {
  const candidate = (ruleName: string, supportingAssetId: string, primaryAssetId = 'p1') =>
    ({ ruleId: `rule-${ruleName}`, ruleName, supportingAssetId, primaryAssetId, roles: ['stores'] });

  it('keeps one link per pair, from the first rule by name', () => {
    const wanted = wantedRuleLinks([candidate('b', 's1'), candidate('a', 's1')], new Set(), new Set());

    expect(wanted).toEqual([candidate('a', 's1')]);
  });

  it('never takes a pair a person linked', () => {
    expect(wantedRuleLinks([candidate('a', 's1')], new Set([pairKey('s1', 'p1')]), new Set())).toEqual([]);
  });

  it('never takes a pair a person unlinked', () => {
    expect(wantedRuleLinks([candidate('a', 's1')], new Set(), new Set([pairKey('s1', 'p1')]))).toEqual([]);
  });

  it('links the same asset to two primary assets from two rules', () => {
    const wanted = wantedRuleLinks([candidate('a', 's1', 'p1'), candidate('b', 's1', 'p2')], new Set(), new Set());

    expect(wanted).toHaveLength(2);
  });
});
