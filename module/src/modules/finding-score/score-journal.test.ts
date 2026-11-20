import { describe, expect, it } from 'vitest';
import type { ScoreBanding, UniqueFindingFigures } from './score-journal';
import { posturesOwingAJournalLine, rowsOwingAJournalLine, uniqueFindingsOwingAJournalLine } from './score-journal';

const stored = (entries: Record<string, ScoreBanding>): Map<string, ScoreBanding> => new Map(Object.entries(entries));

describe('rowsOwingAJournalLine', () => {
  it('should journal a finding whose displayed score moved', () => {
    const rows = rowsOwingAJournalLine(
      [{ assetEvidenceId: 'a', score: 73, band: 'high' as const }],
      stored({ a: { score: 72, band: 'high' } }),
    );
    expect(rows.map((row) => row.assetEvidenceId)).toEqual(['a']);
  });

  it('should journal nothing when only the fractional part moved', () => {
    const rows = rowsOwingAJournalLine(
      [{ assetEvidenceId: 'a', score: 72.9, band: 'high' as const }],
      stored({ a: { score: 72.1, band: 'high' } }),
    );
    expect(rows).toEqual([]);
  });

  it('should journal a band change the displayed score cannot show', () => {
    const rows = rowsOwingAJournalLine(
      [{ assetEvidenceId: 'a', score: 70, band: 'high' as const }],
      stored({ a: { score: 70, band: 'medium' } }),
    );
    expect(rows.map((row) => row.assetEvidenceId)).toEqual(['a']);
  });

  it('should journal a finding scored for the first time', () => {
    const rows = rowsOwingAJournalLine([{ assetEvidenceId: 'a', score: 12, band: 'low' as const }], stored({}));
    expect(rows.map((row) => row.assetEvidenceId)).toEqual(['a']);
  });

  it('should journal a null line when a finding loses its score to a missing vector', () => {
    const rows = rowsOwingAJournalLine(
      [{ assetEvidenceId: 'a', score: null, band: null }],
      stored({ a: { score: 65, band: 'medium' } }),
    );
    expect(rows).toEqual([{ assetEvidenceId: 'a', score: null, band: null }]);
  });

  it('should journal a pending finding once it gets its first score', () => {
    const rows = rowsOwingAJournalLine(
      [{ assetEvidenceId: 'a', score: 31, band: 'low' as const }],
      stored({ a: { score: null, band: null } }),
    );
    expect(rows.map((row) => row.assetEvidenceId)).toEqual(['a']);
  });

  it('should journal nothing for a finding pending from the start, nor while it stays pending', () => {
    expect(rowsOwingAJournalLine([{ assetEvidenceId: 'a', score: null, band: null }], stored({}))).toEqual([]);
    expect(rowsOwingAJournalLine(
      [{ assetEvidenceId: 'a', score: null, band: null }],
      stored({ a: { score: null, band: null } }),
    )).toEqual([]);
  });

  it('should keep the incoming row rather than the stored one', () => {
    const [row] = rowsOwingAJournalLine(
      [{ assetEvidenceId: 'a', score: 91, band: 'critical' as const }],
      stored({ a: { score: 50, band: 'medium' } }),
    );
    expect(row).toEqual({ assetEvidenceId: 'a', score: 91, band: 'critical' });
  });
});

describe('posturesOwingAJournalLine', () => {
  it('should journal every posture on a first run', () => {
    const rows = posturesOwingAJournalLine(
      [{ supportingAssetId: 'a', score: 55 }, { supportingAssetId: 'b', score: 80 }],
      new Map(),
    );
    expect(rows.map((row) => row.supportingAssetId)).toEqual(['a', 'b']);
  });

  it('should journal nothing when no posture moved', () => {
    const rows = posturesOwingAJournalLine(
      [{ supportingAssetId: 'a', score: 55 }, { supportingAssetId: 'b', score: 80 }],
      new Map([['a', 55], ['b', 80]]),
    );
    expect(rows).toEqual([]);
  });

  it('should journal only the asset whose posture moved, with its new score', () => {
    const rows = posturesOwingAJournalLine(
      [{ supportingAssetId: 'a', score: 64 }, { supportingAssetId: 'b', score: 80 }],
      new Map([['a', 55], ['b', 80]]),
    );
    expect(rows).toEqual([{ supportingAssetId: 'a', score: 64 }]);
  });
});

describe('uniqueFindingsOwingAJournalLine', () => {
  const owed = (incoming: Array<UniqueFindingFigures & { cveId: string }>, entries: Record<string, UniqueFindingFigures>) =>
    uniqueFindingsOwingAJournalLine(incoming, new Map(Object.entries(entries)), (row) => row.cveId).map((row) => row.cveId);

  it('should journal a group whose asset count moved while its displayed score held', () => {
    expect(owed(
      [{ cveId: 'a', score: 81.2, band: 'high', affectedAssetCount: 4 }],
      { a: { score: 81.7, band: 'high', affectedAssetCount: 3 } },
    )).toEqual(['a']);
  });

  it('should journal nothing for a group whose figures held', () => {
    expect(owed(
      [{ cveId: 'a', score: 81.2, band: 'high', affectedAssetCount: 3 }],
      { a: { score: 81.7, band: 'high', affectedAssetCount: 3 } },
    )).toEqual([]);
  });

  it('should journal an unscored group on its first run, and once it gets a score', () => {
    expect(owed([{ cveId: 'a', score: null, band: null, affectedAssetCount: 2 }], {})).toEqual(['a']);
    expect(owed(
      [{ cveId: 'a', score: 40, band: 'medium', affectedAssetCount: 2 }],
      { a: { score: null, band: null, affectedAssetCount: 2 } },
    )).toEqual(['a']);
  });
});
