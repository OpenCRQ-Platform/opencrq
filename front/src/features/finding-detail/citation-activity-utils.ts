export interface CitationEvent {
  state: 'applicable' | 'inactive',
  stateChangedAt: Date | string,
}

export interface MonthlyCitationCell {
  /** First day of the month the cell stands for, in the viewer's timezone. */
  month: Date,
  count: number,
}

export interface CitationActivity {
  cells: Array<MonthlyCitationCell>,
  /** Tallest cell, the value the bars are drawn against. Zero when nothing falls in the window. */
  peak: number,
  /** Every dated citation, including the ones older than the drawn window. */
  total: number,
  latestAt: Date | null,
}

const MONTHS_DRAWN = 12;

/**
 * The dated citations of one CVE, bucketed per month.
 *
 * Only the opening of a citation window is counted: the closing event states that an actor stopped
 * targeting the flaw, which would read as activity if it were tallied the same way.
 *
 * `total` and `latestAt` deliberately cover every event, not just the drawn window, so a flaw whose
 * whole citation history predates the window can say so instead of drawing an empty strip.
 *
 * @param events citation windows, in any order
 */
export const buildCitationActivity = (events: Array<CitationEvent>, now: Date): CitationActivity => {
  const opened = events
    .filter((event) => event.state === 'applicable')
    .map((event) => new Date(event.stateChangedAt))
    .sort((a, b) => a.getTime() - b.getTime());

  const windowStart = new Date(now.getFullYear(), now.getMonth() - (MONTHS_DRAWN - 1), 1);
  const cells: Array<MonthlyCitationCell> = [];
  for (let offset = 0; offset < MONTHS_DRAWN; offset++) {
    const month = new Date(windowStart.getFullYear(), windowStart.getMonth() + offset, 1);
    const nextMonth = new Date(windowStart.getFullYear(), windowStart.getMonth() + offset + 1, 1);
    cells.push({
      month,
      count: opened.filter((at) => at >= month && at < nextMonth).length,
    });
  }

  return {
    cells,
    peak: cells.reduce((highest, cell) => Math.max(highest, cell.count), 0),
    total: opened.length,
    latestAt: opened.at(-1) ?? null,
  };
};
