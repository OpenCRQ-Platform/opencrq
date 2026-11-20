export const filterByRiskScope = <TRow extends { organizationId: string }>(rows: Array<TRow>, riskScope: string): Array<TRow> => (
  riskScope === 'all' ? rows : rows.filter((row) => row.organizationId === riskScope)
);
