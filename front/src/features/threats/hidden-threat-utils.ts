/** What the not-found route of a threat carries, to tell a threat the reader may not read from an absent one. */
export interface ThreatNotFoundData {
  hidden: boolean,
}

/** Whether the threat is hidden from the reader; it only refines a "not found", so a failed lookup says it is not. */
export const threatNotFoundData = async (isHidden: () => Promise<boolean>): Promise<ThreatNotFoundData> => {
  try {
    return { hidden: await isHidden() };
  } catch {
    return { hidden: false };
  }
};

/** Whether the data a not-found route received says the threat exists but is hidden from the reader. */
export const isHiddenThreat = (data: unknown): boolean => (
  typeof data === 'object' && data !== null && 'hidden' in data && data.hidden === true
);
