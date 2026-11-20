import { describe, expect, it } from 'vitest';
import {
  ASSET_CATEGORY_VALUES,
  ASSET_SUBCATEGORY_VALUES,
  countedCriticality,
  DECLARED_CRITICALITY_VALUES,
  isLossBearingAssetCategory,
  SUBCATEGORY_TO_CATEGORY,
} from './constants';

describe('countedCriticality', () => {
  it('reads a declared criticality as it is, whatever the setting', () => {
    for (const setting of DECLARED_CRITICALITY_VALUES) {
      for (const band of DECLARED_CRITICALITY_VALUES) {
        expect(countedCriticality(band, setting)).toBe(band);
      }
    }
  });

  it('counts an unknown criticality as the setting names', () => {
    for (const setting of DECLARED_CRITICALITY_VALUES) {
      expect(countedCriticality('unknown', setting)).toBe(setting);
    }
  });
});

describe('the security_platform category', () => {
  const SECURITY_PLATFORM_SUBCATEGORIES = [
    'edr', 'xdr', 'siem', 'soar', 'ndr', 'ispm', 'email_security', 'llm_firewall', 'ai_gateway', 'vulnerability_scanner',
  ] as const;

  it('carries OpenAEV\'s ten SECURITY_PLATFORM subcategories, each bound to it', () => {
    expect(ASSET_CATEGORY_VALUES).toContain('security_platform');
    for (const subcategory of SECURITY_PLATFORM_SUBCATEGORIES) {
      expect(ASSET_SUBCATEGORY_VALUES).toContain(subcategory);
      expect(SUBCATEGORY_TO_CATEGORY[subcategory]).toBe('security_platform');
    }
    expect(ASSET_SUBCATEGORY_VALUES.filter((subcategory) => SUBCATEGORY_TO_CATEGORY[subcategory] === 'security_platform').toSorted())
      .toEqual([...SECURITY_PLATFORM_SUBCATEGORIES].toSorted());
  });

  it('is the one category the loss readers do not count as a target', () => {
    expect(ASSET_CATEGORY_VALUES.filter((category) => !isLossBearingAssetCategory(category))).toEqual(['security_platform']);
  });
});
