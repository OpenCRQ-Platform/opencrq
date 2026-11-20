import { describe, expect, it } from 'vitest';
import type { EvidenceStateChange, JournaledPostureLine } from './posture-cause';
import { explainPostureHistory } from './posture-cause';

const at = (hour: number): Date => new Date(Date.UTC(2026, 6, 1, hour));

const line = (hour: number, score: number | null, worst?: { id: string, exploitability: number, applicable?: number }): JournaledPostureLine => ({
  at: at(hour),
  score,
  worstEvidenceId: worst?.id ?? null,
  worstName: worst === undefined ? null : `CVE-${worst.id}`,
  worstExploitability: worst?.exploitability ?? null,
  critical: worst === undefined ? null : 0,
  high: worst === undefined ? null : 0,
  medium: worst === undefined ? null : worst.applicable ?? 1,
  low: worst === undefined ? null : 0,
});

const changes = (lines: Array<JournaledPostureLine>, states: Array<EvidenceStateChange> = [], ledByLineInForce = false) =>
  explainPostureHistory(lines, states, ledByLineInForce).map((explained) => explained.cause?.change ?? null);

describe('explainPostureHistory', () => {
  it('should call the first line of an asset its first posture', () => {
    expect(changes([line(1, 55, { id: 'a', exploitability: 44 })])).toEqual([{ kind: 'first' }]);
  });

  it('should give no change to a line in force whose predecessor was not read', () => {
    expect(changes([line(1, 55, { id: 'a', exploitability: 44 })], [], true)).toEqual([null]);
  });

  it('should name the move when the same worst finding became more or less exploitable', () => {
    expect(changes([
      line(1, 62, { id: 'a', exploitability: 37 }),
      line(2, 61, { id: 'a', exploitability: 38 }),
    ])[1]).toEqual({ kind: 'exploitability', from: 37 });
  });

  it('should read a new worst finding when the previous one is still applicable', () => {
    const states: Array<EvidenceStateChange> = [{ evidenceId: 'a', state: 'applicable', at: at(0) }];
    expect(changes([
      line(1, 58, { id: 'a', exploitability: 41 }),
      line(2, 54, { id: 'b', exploitability: 45 }),
    ], states)[1]).toEqual({ kind: 'newWorst' });
  });

  it('should read a resolution when the previous worst finding left the applicable state by the new line', () => {
    const states: Array<EvidenceStateChange> = [
      { evidenceId: 'a', state: 'applicable', at: at(0) },
      { evidenceId: 'a', state: 'dismissed', at: at(2) },
    ];
    expect(changes([
      line(1, 61, { id: 'a', exploitability: 38 }),
      line(2, 64, { id: 'b', exploitability: 35 }),
    ], states)[1]).toEqual({ kind: 'resolved', resolvedName: 'CVE-a' });
  });

  it('should not read a resolution that came after the new line', () => {
    const states: Array<EvidenceStateChange> = [
      { evidenceId: 'a', state: 'applicable', at: at(0) },
      { evidenceId: 'a', state: 'dismissed', at: at(3) },
    ];
    expect(changes([
      line(1, 61, { id: 'a', exploitability: 38 }),
      line(2, 64, { id: 'b', exploitability: 35 }),
    ], states)[1]).toEqual({ kind: 'newWorst' });
  });

  it('should count the applicable findings when only the tail moved', () => {
    expect(changes([
      line(1, 60, { id: 'a', exploitability: 39, applicable: 1 }),
      line(2, 59, { id: 'a', exploitability: 39, applicable: 3 }),
    ])[1]).toEqual({ kind: 'tail', fromApplicable: 1, toApplicable: 3 });
  });

  it('should call a posture after a lost one regained', () => {
    expect(changes([
      line(1, 60, { id: 'a', exploitability: 39 }),
      line(2, null),
      line(3, 55, { id: 'b', exploitability: 44 }),
    ])).toEqual([{ kind: 'first' }, null, { kind: 'regained' }]);
  });

  it('should give a lost posture and a line older than causes no cause', () => {
    const explained = explainPostureHistory([line(1, 60), line(2, null)], [], false);
    expect(explained.map((entry) => entry.cause)).toEqual([null, null]);
  });

  it('should state the worst finding alone after a line with no recorded cause', () => {
    expect(changes([line(1, 60), line(2, 58, { id: 'a', exploitability: 41 })])[1]).toEqual({ kind: 'worst' });
  });

  it('should keep the figures but no change once the worst finding is gone', () => {
    const [explained] = explainPostureHistory([{ ...line(1, 55, { id: 'a', exploitability: 44 }), worstEvidenceId: null, worstName: null }], [], false);
    expect(explained.cause).toEqual({
      worstFinding: null,
      worstExploitability: 44,
      countsByBand: { critical: 0, high: 0, medium: 1, low: 0 },
      change: null,
    });
  });
});
