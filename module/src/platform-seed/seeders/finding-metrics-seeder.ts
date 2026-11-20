import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { SeverityBand } from '../../modules/finding-score/bands';
import type { UniqueFindingFigures } from '../../modules/finding-score/score-journal';
import { createPrng, deriveSeed } from '../../modules/crq-indicators/engine/prng';
import { BAND_METRIC_KEYS, utcDayOf } from '../../modules/finding-score/metrics';
import { cve } from '../../modules/cve/schema';
import { findingMetricDaily, findingScoreHistory, uniqueFindingScoreHistory } from '../../modules/finding-score/schema';
import { resolveSeverityBand, SEVERITY_BANDS, truncateScore } from '../../modules/finding-score/bands';
import { uniqueFindingsOwingAJournalLine } from '../../modules/finding-score/score-journal';
import { computeUniqueScore } from '../../modules/finding-score/unique-score';
import { assetEvidence, assetEvidenceHistory } from '../../modules/supporting-assets/schema';
import { findingScoreEarlierHistoryId, findingScoreHistoryId, Tenant_Acme, uniqueFindingScoreHistoryId } from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

/** The frame every card draws, and therefore the past this seed has to cover for one to be visible. */
const FRAME_DAYS = 30;

/**
 * A finding's own page draws up to twelve months of its journal, so a finding live before the frame
 * gets one reading a week back to the day it was last not applicable, or this far at most.
 */
const EARLIER_WEEKS = 48;
const WEEK_MS = 7 * 86_400_000;

const clampScore = (value: number): number => Math.min(Math.max(value, 0), 100);

/**
 * A finding's displayed score across the frame, and the journal lines the movements would have left.
 *
 * The walk is a random one seeded off the finding's own id, so the demo is the same on every
 * machine and on every reseed. A finding contributes nothing before the day it was created: the
 * void on the left of a plot is what says the estate grew.
 */
const walkFinding = (
  evidenceId: string,
  liveOnDay: ReadonlyArray<boolean>,
): { scoreByDay: Array<number | null>, movements: Array<{ dayIndex: number, score: number }> } => {
  const prng = createPrng(deriveSeed(evidenceId, 'platform-seed-lifeline'));
  const scoreByDay: Array<number | null> = [];
  const movements: Array<{ dayIndex: number, score: number }> = [];
  let score = 5 + prng() * 90;
  let journaled: number | null = null;

  for (let dayIndex = 0; dayIndex < liveOnDay.length; dayIndex++) {
    if (!liveOnDay[dayIndex]) {
      scoreByDay.push(null);
      continue;
    }
    score = clampScore(score + (prng() - 0.45) * 7);
    scoreByDay.push(score);
    const moved = journaled === null
      || truncateScore(journaled) !== truncateScore(score)
      || resolveSeverityBand(journaled) !== resolveSeverityBand(score);
    if (moved) {
      movements.push({ dayIndex, score });
      journaled = score;
    }
  }
  return { scoreByDay, movements };
};

/**
 * The weekly readings before the frame, oldest first, walked back from the score the frame opens on,
 * and the date the frame's opening line moves back to when the weeks before it held its score.
 * Seeded apart from the frame's walk, which the cards' daily figures come from, so neither moves the other.
 */
const walkBeforeFrame = (
  evidenceId: string,
  frameOpening: { at: number, score: number },
  isLive: (instant: number) => boolean,
): { readings: Array<{ at: number, score: number }>, openingAt: number } => {
  const prng = createPrng(deriveSeed(evidenceId, 'platform-seed-score-journal'));
  const newestFirst = [{ ...frameOpening }];
  let score = frameOpening.score;
  for (let week = 1; week <= EARLIER_WEEKS; week++) {
    const at = frameOpening.at - week * WEEK_MS;
    if (!isLive(at)) {
      break;
    }
    score = clampScore(score - (prng() - 0.4) * 9);
    const newer = newestFirst[newestFirst.length - 1];
    // A week the displayed score held is no line of its own: the line after it started earlier.
    if (truncateScore(score) === truncateScore(newer.score)) {
      newer.at = at;
      continue;
    }
    newestFirst.push({ at, score });
  }
  const [opening, ...earlier] = newestFirst;
  return { readings: earlier.toReversed(), openingAt: opening.at };
};

/**
 * Scores from the given number of days ago instead of a walk, so two seeded runs a week apart list
 * one CVE appearing at Critical and one moving into High.
 */
const PINNED_SCORES = new Map<string, ReadonlyArray<{ daysAgo: number, score: number }>>([
  ['CVE-2023-20198', [{ daysAgo: FRAME_DAYS, score: 94 }]],
  ['CVE-2024-3400', [{ daysAgo: FRAME_DAYS, score: 62 }, { daysAgo: 4, score: 81 }]],
]);

const pinnedWalk = (
  steps: ReadonlyArray<{ daysAgo: number, score: number }>,
  liveOnDay: ReadonlyArray<boolean>,
): ReturnType<typeof walkFinding> => {
  const scoreByDay: Array<number | null> = [];
  const movements: Array<{ dayIndex: number, score: number }> = [];
  let journaled: number | null = null;
  liveOnDay.forEach((live, dayIndex) => {
    const daysAgo = liveOnDay.length - 1 - dayIndex;
    const score = steps.findLast((step) => step.daysAgo >= daysAgo)?.score ?? null;
    scoreByDay.push(live ? score : null);
    if (live && score !== null && score !== journaled) {
      movements.push({ dayIndex, score });
      journaled = score;
    }
  });
  return { scoreByDay, movements };
};

/**
 * The tenant's CVE unique findings journal, replayed day by day from the walked scores as the
 * recompute would have written it, so a past run reads them as they stood.
 */
const replayTenantUniqueFindings = (
  findings: ReadonlyArray<{ cveRowId: string, supportingAssetId: string }>,
  scoresByFinding: ReadonlyArray<ReadonlyArray<number | null>>,
  dayEnds: ReadonlyArray<number>,
  now: Date,
): Array<typeof uniqueFindingScoreHistory.$inferInsert> => {
  const members = Map.groupBy(findings.map((finding, index) => ({ ...finding, scoreByDay: scoresByFinding[index] })), (member) => member.cveRowId);
  const lines: Array<typeof uniqueFindingScoreHistory.$inferInsert> = [];
  let stored = new Map<string, UniqueFindingFigures>();
  dayEnds.forEach((dayEnd, dayIndex) => {
    const incoming = [...members].flatMap(([cveRowId, group]) => {
      const live = group.flatMap((member) => (member.scoreByDay[dayIndex] === null ? [] : [{ ...member, score: member.scoreByDay[dayIndex] }]));
      const score = computeUniqueScore(live.map((member) => member.score));
      return score === null ? [] : [{
        cveRowId,
        score,
        band: resolveSeverityBand(truncateScore(score)),
        worstScore: Math.max(...live.map((member) => member.score)),
        affectedAssetCount: new Set(live.map((member) => member.supportingAssetId)).size,
      }];
    });
    const present = new Set(incoming.map((group) => group.cveRowId));
    const changedAt = new Date(Math.min(dayEnd, now.getTime()));
    const line = (values: Omit<typeof uniqueFindingScoreHistory.$inferInsert, 'id' | 'tenantId' | 'changedAt'>) =>
      lines.push({ id: uniqueFindingScoreHistoryId(lines.length), tenantId: Tenant_Acme, changedAt, ...values });
    for (const group of uniqueFindingsOwingAJournalLine(incoming, stored, (row) => row.cveRowId)) {
      line({ cveId: group.cveRowId, score: group.score, band: group.band, worstScore: group.worstScore, affectedAssetCount: group.affectedAssetCount });
    }
    for (const cveRowId of stored.keys()) {
      if (!present.has(cveRowId)) {
        line({ cveId: cveRowId, score: null });
      }
    }
    stored = new Map(incoming.map((group) => [group.cveRowId, group]));
  });
  return lines;
};

registerPlatformSeed('finding-metrics', async ({ db, now }) => {
  // Midnight opening the oldest day of the frame, so day 0 is the first point a card draws.
  const frameStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (FRAME_DAYS - 1));
  const dayEnds = Array.from({ length: FRAME_DAYS }, (_, index) => frameStart + (index + 1) * 86_400_000 - 1);

  const findings = await db
    .select({ id: assetEvidence.id, cveId: cve.cveId, cveRowId: cve.id, supportingAssetId: assetEvidence.supportingAssetId })
    .from(assetEvidence)
    .innerJoin(cve, eq(cve.id, assetEvidence.cveId))
    .where(and(eq(assetEvidence.tenantId, Tenant_Acme), isNotNull(assetEvidence.cveId)))
    .orderBy(assetEvidence.id);
  if (findings.length === 0) {
    return;
  }

  const history = await db
    .select({
      assetEvidenceId: assetEvidenceHistory.assetEvidenceId,
      state: assetEvidenceHistory.state,
      stateChangedAt: assetEvidenceHistory.stateChangedAt,
    })
    .from(assetEvidenceHistory)
    .where(and(eq(assetEvidenceHistory.tenantId, Tenant_Acme), inArray(assetEvidenceHistory.assetEvidenceId, findings.map((finding) => finding.id))));

  const historyByFinding = new Map<string, Array<{ state: string, at: number }>>();
  for (const row of history) {
    const entries = historyByFinding.get(row.assetEvidenceId) ?? [];
    entries.push({ state: row.state, at: row.stateChangedAt.getTime() });
    historyByFinding.set(row.assetEvidenceId, entries);
  }
  for (const entries of historyByFinding.values()) {
    entries.sort((a, b) => a.at - b.at);
  }

  /** Applicable on a day means the last decision taken by its end left it applicable. */
  const isLiveAt = (evidenceId: string, instant: number): boolean => {
    const entries = historyByFinding.get(evidenceId) ?? [];
    const last = entries.filter((entry) => entry.at <= instant).at(-1);
    return last?.state === 'applicable';
  };

  const journalRows: Array<typeof findingScoreHistory.$inferInsert> = [];
  const countsByDay = dayEnds.map(() => new Map<SeverityBand, number>());
  const scoresByFinding: Array<Array<number | null>> = [];

  findings.forEach((finding, findingIndex) => {
    const liveOnDay = dayEnds.map((dayEnd) => isLiveAt(finding.id, dayEnd));
    const pinned = PINNED_SCORES.get(finding.cveId);
    const { scoreByDay, movements } = pinned === undefined ? walkFinding(finding.id, liveOnDay) : pinnedWalk(pinned, liveOnDay);
    scoresByFinding.push(scoreByDay);

    const opening = movements.at(0);
    let openingAt: number | null = null;
    if (opening?.dayIndex === 0) {
      const earlier = walkBeforeFrame(finding.id, { at: dayEnds[0], score: opening.score }, (instant) => isLiveAt(finding.id, instant));
      openingAt = earlier.openingAt;
      earlier.readings.forEach(({ at, score }, weekIndex) => {
        journalRows.push({
          id: findingScoreEarlierHistoryId(findingIndex, weekIndex),
          assetEvidenceId: finding.id,
          tenantId: Tenant_Acme,
          score,
          band: resolveSeverityBand(score),
          changedAt: new Date(at),
        });
      });
    }

    movements.forEach(({ dayIndex, score }) => {
      journalRows.push({
        id: findingScoreHistoryId(findingIndex, dayIndex),
        assetEvidenceId: finding.id,
        tenantId: Tenant_Acme,
        score,
        band: resolveSeverityBand(score),
        // At the end of the day that counted it, capped at now: the line follows the state it was
        // counted under, and a real recompute run later today still writes the latest line.
        changedAt: new Date(dayIndex === 0 && openingAt !== null ? openingAt : Math.min(dayEnds[dayIndex], now.getTime())),
      });
    });

    scoreByDay.forEach((score, dayIndex) => {
      if (score === null) {
        return;
      }
      const band = resolveSeverityBand(score);
      const counts = countsByDay[dayIndex];
      counts.set(band, (counts.get(band) ?? 0) + 1);
    });
  });

  await db.insert(findingScoreHistory).values(journalRows);
  await db.insert(uniqueFindingScoreHistory).values(replayTenantUniqueFindings(findings, scoresByFinding, dayEnds, now));
  await db.insert(findingMetricDaily).values(dayEnds.flatMap((dayEnd, dayIndex) => SEVERITY_BANDS.map((band) => ({
    tenantId: Tenant_Acme,
    day: utcDayOf(new Date(dayEnd)),
    metric: BAND_METRIC_KEYS[band],
    value: countsByDay[dayIndex].get(band) ?? 0,
  }))));
});
