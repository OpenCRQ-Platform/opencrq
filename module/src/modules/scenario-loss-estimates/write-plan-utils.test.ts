import { describe, expect, it } from 'vitest';
import type { ExistingEstimateRow } from './write-plan-utils';
import { isStaleWrite, planBackfillWrite, planManualWrite, planRecomputeWrite, planStaleQuestionnaireDeletes } from './write-plan-utils';

const existingRow = (overrides: Partial<ExistingEstimateRow> = {}): ExistingEstimateRow => ({
  id: 'existing-id',
  lossDriverId: 'driver-1',
  minValue: 100,
  likelyValue: 200,
  maxValue: 400,
  provenance: 'manual',
  modelVersion: null,
  lowConfidence: false,
  isPosture: false,
  ...overrides,
});

describe('planManualWrite', () => {
  it('skips a first-ever tombstone: nothing to clear', () => {
    const step = planManualWrite({ lossDriverId: 'driver-1', action: 'clear' }, undefined, () => 'new-id');
    expect(step).toEqual({ kind: 'skip' });
  });

  it('deletes an existing row on a tombstone', () => {
    const step = planManualWrite({ lossDriverId: 'driver-1', action: 'clear' }, existingRow(), () => 'new-id');
    expect(step).toEqual({ kind: 'delete', lossDriverId: 'driver-1' });
  });

  it('skips an unchanged triplet, leaving stored provenance and model_version untouched', () => {
    const step = planManualWrite(
      { lossDriverId: 'driver-1', action: 'set', minValue: 100, likelyValue: 200, maxValue: 400 },
      existingRow({ provenance: 'questionnaire', modelVersion: 'v1' }),
      () => 'new-id',
    );
    expect(step).toEqual({ kind: 'skip' });
  });

  it('becomes manual with no model_version on a changed triplet, keeping the existing id', () => {
    const step = planManualWrite(
      { lossDriverId: 'driver-1', action: 'set', minValue: 150, likelyValue: 200, maxValue: 400 },
      existingRow({ id: 'kept-id', provenance: 'questionnaire', modelVersion: 'v1' }),
      () => 'new-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'kept-id',
      lossDriverId: 'driver-1',
      minValue: 150,
      likelyValue: 200,
      maxValue: 400,
      provenance: 'manual',
      modelVersion: null,
      lowConfidence: false,
      isPosture: false,
    });
  });

  it('mints a fresh id on a first-ever write', () => {
    const step = planManualWrite(
      { lossDriverId: 'driver-1', action: 'set', minValue: 1, likelyValue: 2, maxValue: 3 },
      undefined,
      () => 'minted-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'minted-id',
      lossDriverId: 'driver-1',
      minValue: 1,
      likelyValue: 2,
      maxValue: 3,
      provenance: 'manual',
      modelVersion: null,
      lowConfidence: false,
      isPosture: false,
    });
  });

  it('treats a null-vs-value triplet as changed', () => {
    const step = planManualWrite(
      { lossDriverId: 'driver-1', action: 'set', minValue: null, likelyValue: 200, maxValue: 400 },
      existingRow({ minValue: 100 }),
      () => 'new-id',
    );
    expect(step.kind).toBe('upsert');
  });

  it('clears the posture flag when a manual edit changes a former posture row', () => {
    const step = planManualWrite(
      { lossDriverId: 'driver-1', action: 'set', minValue: 0, likelyValue: 5000, maxValue: 10000 },
      existingRow({ provenance: 'questionnaire', minValue: 0, likelyValue: 0, maxValue: 0, isPosture: true }),
      () => 'new-id',
    );
    expect(step.kind).toBe('upsert');
    expect(step.kind === 'upsert' && step.isPosture).toBe(false);
  });
});

describe('isStaleWrite', () => {
  const at = (iso: string, rowCount = 3) => ({ maxUpdatedAt: new Date(iso), rowCount });
  const empty = { maxUpdatedAt: null, rowCount: 0 };

  it('matches when neither side holds a row (no row has ever existed)', () => {
    expect(isStaleWrite(empty, empty)).toBe(false);
  });

  it('matches on an identical fingerprint', () => {
    expect(isStaleWrite(at('2026-01-01T00:00:00Z'), at('2026-01-01T00:00:00Z'))).toBe(false);
  });

  it('is stale when the client read an older state', () => {
    expect(isStaleWrite(at('2026-01-01T00:00:00Z'), at('2026-01-02T00:00:00Z'))).toBe(true);
  });

  it('is stale when the client read a state before any row existed', () => {
    expect(isStaleWrite(empty, at('2026-01-02T00:00:00Z'))).toBe(true);
  });

  it('is stale when the client believed rows existed but none do', () => {
    expect(isStaleWrite(at('2026-01-01T00:00:00Z'), empty)).toBe(true);
  });

  it('is stale when a row was deleted without moving the newest timestamp', () => {
    // The deletion a maximum cannot see: same newest row, one fewer row beside it.
    expect(isStaleWrite(at('2026-01-02T00:00:00Z', 4), at('2026-01-02T00:00:00Z', 3))).toBe(true);
  });
});

describe('planRecomputeWrite', () => {
  it('never touches a manual row', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 999, likelyValue: 999, maxValue: 999, lowConfidence: false, isPosture: false },
      existingRow({ provenance: 'manual' }),
      'v1',
      false,
      () => 'new-id',
    );
    expect(step).toEqual({ kind: 'skip' });
  });

  it('upserts over an existing questionnaire row, keeping its id', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: true, isPosture: false },
      existingRow({ id: 'kept-id', provenance: 'questionnaire', modelVersion: 'v0' }),
      'v1',
      false,
      () => 'new-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'kept-id',
      lossDriverId: 'driver-1',
      minValue: 10,
      likelyValue: 20,
      maxValue: 40,
      provenance: 'questionnaire',
      modelVersion: 'v1',
      lowConfidence: true,
      isPosture: false,
    });
  });

  it('mints a fresh id for a driver with no row at all', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: true, isPosture: false },
      undefined,
      'v1',
      false,
      () => 'minted-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'minted-id',
      lossDriverId: 'driver-1',
      minValue: 10,
      likelyValue: 20,
      maxValue: 40,
      provenance: 'questionnaire',
      modelVersion: 'v1',
      lowConfidence: true,
      isPosture: false,
    });
  });

  it('skips an unchanged questionnaire row at the same model version', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: false, isPosture: false },
      existingRow({ provenance: 'questionnaire', modelVersion: 'v1', minValue: 10, likelyValue: 20, maxValue: 40 }),
      'v1',
      false,
      () => 'new-id',
    );
    expect(step).toEqual({ kind: 'skip' });
  });

  it('still upserts a questionnaire row when the derived value actually changed', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 99, likelyValue: 20, maxValue: 40, lowConfidence: true, isPosture: false },
      existingRow({ id: 'kept-id', provenance: 'questionnaire', modelVersion: 'v1', minValue: 10, likelyValue: 20, maxValue: 40 }),
      'v1',
      false,
      () => 'new-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'kept-id',
      lossDriverId: 'driver-1',
      minValue: 99,
      likelyValue: 20,
      maxValue: 40,
      provenance: 'questionnaire',
      modelVersion: 'v1',
      lowConfidence: true,
      isPosture: false,
    });
  });

  it('still upserts a questionnaire row whose values match but the model version bumped', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: false, isPosture: false },
      existingRow({ id: 'kept-id', provenance: 'questionnaire', modelVersion: 'v1', minValue: 10, likelyValue: 20, maxValue: 40 }),
      'v2',
      false,
      () => 'new-id',
    );
    expect(step.kind).toBe('upsert');
  });

  it('still upserts a questionnaire row whose values match but the posture flag changed', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 0, likelyValue: 0, maxValue: 0, lowConfidence: false, isPosture: true },
      existingRow({ id: 'kept-id', provenance: 'questionnaire', modelVersion: 'v1', minValue: 0, likelyValue: 0, maxValue: 0, isPosture: false }),
      'v1',
      false,
      () => 'new-id',
    );
    expect(step.kind).toBe('upsert');
    expect(step.kind === 'upsert' && step.isPosture).toBe(true);
  });
});

describe('planRecomputeWrite with overwriteManual: true (revert)', () => {
  it('overwrites a manual row: the one caller allowed to', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: true, isPosture: false },
      existingRow({ id: 'kept-id', provenance: 'manual', modelVersion: null }),
      'v1',
      true,
      () => 'new-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'kept-id',
      lossDriverId: 'driver-1',
      minValue: 10,
      likelyValue: 20,
      maxValue: 40,
      provenance: 'questionnaire',
      modelVersion: 'v1',
      lowConfidence: true,
      isPosture: false,
    });
  });

  it('mints a fresh id when no row exists yet', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: false, isPosture: false },
      undefined,
      'v1',
      true,
      () => 'minted-id',
    );
    expect(step.kind).toBe('upsert');
    expect(step.kind === 'upsert' && step.id).toBe('minted-id');
  });

  it('skips a row already computed and unchanged at the target model version', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: false, isPosture: false },
      existingRow({ provenance: 'questionnaire', modelVersion: 'v1', minValue: 10, likelyValue: 20, maxValue: 40 }),
      'v1',
      true,
      () => 'new-id',
    );
    expect(step).toEqual({ kind: 'skip' });
  });

  it('still upserts when provenance is manual even if the values already match', () => {
    const step = planRecomputeWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: true, isPosture: false },
      existingRow({ id: 'kept-id', provenance: 'manual', modelVersion: null, minValue: 10, likelyValue: 20, maxValue: 40 }),
      'v1',
      true,
      () => 'new-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'kept-id',
      lossDriverId: 'driver-1',
      minValue: 10,
      likelyValue: 20,
      maxValue: 40,
      provenance: 'questionnaire',
      modelVersion: 'v1',
      lowConfidence: true,
      isPosture: false,
    });
  });
});

describe('planBackfillWrite', () => {
  it('mints a fresh row for a driver with no row at all', () => {
    const step = planBackfillWrite(
      { lossDriverId: 'driver-1', minValue: 10, likelyValue: 20, maxValue: 40, lowConfidence: true, isPosture: false },
      undefined,
      'v1',
      () => 'minted-id',
    );
    expect(step).toEqual({
      kind: 'upsert',
      id: 'minted-id',
      lossDriverId: 'driver-1',
      minValue: 10,
      likelyValue: 20,
      maxValue: 40,
      provenance: 'questionnaire',
      modelVersion: 'v1',
      lowConfidence: true,
      isPosture: false,
    });
  });

  it('never touches an existing questionnaire row, even at an older model version', () => {
    const step = planBackfillWrite(
      { lossDriverId: 'driver-1', minValue: 999, likelyValue: 999, maxValue: 999, lowConfidence: false, isPosture: false },
      existingRow({ provenance: 'questionnaire', modelVersion: 'v0', minValue: 1, likelyValue: 2, maxValue: 3 }),
      'v1',
      () => 'new-id',
    );
    expect(step).toEqual({ kind: 'skip' });
  });

  it('never touches an existing manual row', () => {
    const step = planBackfillWrite(
      { lossDriverId: 'driver-1', minValue: 999, likelyValue: 999, maxValue: 999, lowConfidence: false, isPosture: false },
      existingRow({ provenance: 'manual' }),
      'v1',
      () => 'new-id',
    );
    expect(step).toEqual({ kind: 'skip' });
  });
});

describe('planStaleQuestionnaireDeletes', () => {
  it('deletes a questionnaire row no longer emitted', () => {
    const rows = [existingRow({ lossDriverId: 'driver-1', provenance: 'questionnaire' })];
    expect(planStaleQuestionnaireDeletes(rows, new Set())).toEqual(['driver-1']);
  });

  it('never lists a manual row, emitted or not', () => {
    const rows = [existingRow({ lossDriverId: 'driver-1', provenance: 'manual' })];
    expect(planStaleQuestionnaireDeletes(rows, new Set())).toEqual([]);
  });

  it('keeps a questionnaire row still emitted', () => {
    const rows = [existingRow({ lossDriverId: 'driver-1', provenance: 'questionnaire' })];
    expect(planStaleQuestionnaireDeletes(rows, new Set(['driver-1']))).toEqual([]);
  });
});
