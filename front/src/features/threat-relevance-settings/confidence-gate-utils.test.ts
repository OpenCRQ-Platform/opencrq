import { i18n } from '@lingui/core';
import { CONFIDENCE_GATE_LEVELS, THREAT_RELEVANCE_DEFAULTS } from '@app/module/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildThreatRelevanceSettingsFormSchema } from './components/threat-relevance-settings-schema';
import { confidenceGateLevelLabel } from './confidence-gate-utils';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

describe('confidenceGateLevelLabel', () => {
  it('should label every level the select offers', () => {
    expect(CONFIDENCE_GATE_LEVELS.map(confidenceGateLevelLabel)).toEqual([
      'confirmed (100)',
      'confirmed by other sources (80)',
      'probably true (60)',
      'possibly true (40)',
      'doubtful (20)',
      'improbable (0)',
    ]);
  });

  // The labels come straight from the OpenCTI confidence scale a claim is stated on, so an analyst
  // reads the setting in the same words as the data it filters.
  it('should carry the numeric level alongside the wording', () => {
    for (const level of CONFIDENCE_GATE_LEVELS) {
      expect(confidenceGateLevelLabel(level)).toContain(`(${level})`);
    }
  });

  it('should fall back to the bare number for a value off the six-level ladder', () => {
    expect(confidenceGateLevelLabel(50)).toBe('50');
  });
});

describe('the confidence gate form field', () => {
  const parse = (confidenceGate: unknown) => buildThreatRelevanceSettingsFormSchema()
    .safeParse({ ...THREAT_RELEVANCE_DEFAULTS, confidenceGate });

  it('should accept every level the select offers, and nothing else', () => {
    for (const level of CONFIDENCE_GATE_LEVELS) {
      expect(parse(level).success).toBe(true);
    }
    for (const offLadder of [50, 30, 99, -20, 120]) {
      expect(parse(offLadder).success).toBe(false);
    }
  });

  it('should default to the level the platform ships', () => {
    expect(THREAT_RELEVANCE_DEFAULTS.confidenceGate).toBe(60);
    expect(CONFIDENCE_GATE_LEVELS).toContain(THREAT_RELEVANCE_DEFAULTS.confidenceGate);
  });
});
