import { describe, expect, it } from 'vitest';
import { TACTIC_WALK_RULES } from './attack-walk';
import { tacticDepth, tacticPrerequisiteCost } from './walk-depth';

const IMPACT = 'TA0040';
const EXFILTRATION = 'TA0010';

describe('tacticPrerequisiteCost', () => {
  it('costs initial access nothing, and each fact its cheapest route', () => {
    expect(tacticPrerequisiteCost('TA0001')).toBe(0);
    // Credential access, privilege escalation and discovery all sit one foothold away.
    expect(tacticPrerequisiteCost('TA0006')).toBe(1);
    expect(tacticPrerequisiteCost('TA0004')).toBe(1);
    expect(tacticPrerequisiteCost('TA0007')).toBe(1);
    // Lateral movement demands foothold, credentials and knowledge at once.
    expect(tacticPrerequisiteCost('TA0008')).toBe(3);
    // Impact adds deep access on top of those three, exfiltration the gathered data on top again.
    expect(tacticPrerequisiteCost(IMPACT)).toBe(4);
    expect(tacticPrerequisiteCost(EXFILTRATION)).toBe(5);
  });

  it('answers zero for anything the walk table does not carry', () => {
    expect(tacticPrerequisiteCost('TA0043')).toBe(0);
  });
});

describe('tacticDepth', () => {
  it('puts the door at 0 and the objective at 1, for either terminal', () => {
    for (const terminal of [IMPACT, EXFILTRATION]) {
      expect(tacticDepth('TA0001', terminal), terminal).toBe(0);
      expect(tacticDepth(terminal, terminal), terminal).toBe(1);
    }
  });

  it('grades the impact chain strictly deeper at every step', () => {
    const chain = ['TA0001', 'TA0006', 'TA0008', IMPACT];
    const depths = chain.map((tactic) => tacticDepth(tactic, IMPACT));
    expect(depths).toEqual([0, 0.25, 0.75, 1]);
  });

  it('grades the exfiltration chain strictly deeper at every step', () => {
    const chain = ['TA0001', 'TA0006', 'TA0008', 'TA0009', EXFILTRATION];
    const depths = chain.map((tactic) => tacticDepth(tactic, EXFILTRATION));
    expect(depths).toEqual([0, 0.2, 0.6, 0.8, 1]);
  });

  it('holds every tactic inside [0, 1], impact in an exfiltration scenario included', () => {
    for (const terminal of [IMPACT, EXFILTRATION]) {
      for (const rule of TACTIC_WALK_RULES) {
        const depth = tacticDepth(rule.tacticExternalId, terminal);
        expect(depth, `${rule.tacticExternalId} in ${terminal}`).toBeGreaterThanOrEqual(0);
        expect(depth, `${rule.tacticExternalId} in ${terminal}`).toBeLessThanOrEqual(1);
      }
    }
    expect(tacticDepth(IMPACT, EXFILTRATION)).toBe(0.8);
  });
});
