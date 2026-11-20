/**
 * Whether a connector still stands behind the verdict its provenance row carries, whichever it is:
 * comparing its sync clock to the mark left by the run that walked that asset under that scope
 * turns silence into an answer, without any arbitrary window.
 */
export const isSourceStillReporting = (source: {
  connectorId: string | null,
  sourceReportedAt: Date,
  enumerationReportedAt: Date | null,
}): boolean => {
  // No connector left to ever refresh the row, so its verdict would outlive every sync.
  if (source.connectorId === null) {
    return false;
  }
  // Nothing ever walked this asset under this scope, so nothing can be read into the silence.
  if (source.enumerationReportedAt === null) {
    return true;
  }
  return source.sourceReportedAt.getTime() >= source.enumerationReportedAt.getTime();
};

/**
 * When a source last said where it stands: the observation it carries, or the later run over its
 * asset that left it out. A source with no observation time is dated by the sync that sent it,
 * as the history dates the same observation.
 */
export const sourceVerdictAt = (source: {
  sourceReportedAt: Date,
  evaluatedAt: Date | null,
  enumerationReportedAt: Date | null,
}): Date => {
  const observedAt = source.evaluatedAt ?? source.sourceReportedAt;
  const retiredAt = source.enumerationReportedAt !== null && source.sourceReportedAt.getTime() < source.enumerationReportedAt.getTime()
    ? source.enumerationReportedAt
    : null;
  return retiredAt !== null && retiredAt.getTime() > observedAt.getTime() ? retiredAt : observedAt;
};
