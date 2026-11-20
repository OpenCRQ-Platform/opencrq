export interface LossDriverRow {
  driverId: string,
  driver: string,
  amount: number,
}

export interface LossDriverShare extends LossDriverRow {
  share: number,
}

/**
 * Shares of the estimate total, drawn against the split's own total — never against the exposure
 * total above it, which is a different grandeur. The given order is preserved: the procedure
 * already ranks the drivers, and re-ranking here would let the two disagree.
 */
export const computeLossDriverShares = (rows: ReadonlyArray<LossDriverRow>): Array<LossDriverShare> => {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return rows.map((row) => ({ ...row, share: total > 0 ? row.amount / total : 0 }));
};
