import { t } from '@lingui/core/macro';
import type { CvssSeverityLevel } from '@app/module/client';
import { getCvssSeverityLevel } from '@app/module/client';

export type { CvssSeverityLevel };
export { getCvssSeverityLevel };

export type CvssSeverityChipTone = 'critical' | 'high' | 'medium' | 'low' | 'neutral';

export const CVSS_SEVERITY_TONES: Record<CvssSeverityLevel, CvssSeverityChipTone> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  none: 'neutral',
};

export const getCvssSeverityLabel = (level: CvssSeverityLevel): string => {
  const labels: Record<CvssSeverityLevel, string> = {
    critical: t`Critical`,
    high: t`High`,
    medium: t`Medium`,
    low: t`Low`,
    none: t`None`,
  };
  return labels[level];
};

export const getCvssSeverity = (score: number | null): { level: CvssSeverityLevel, label: string, tone: CvssSeverityChipTone } | null => {
  const level = getCvssSeverityLevel(score);
  if (level === null) {
    return null;
  }
  return { level, label: getCvssSeverityLabel(level), tone: CVSS_SEVERITY_TONES[level] };
};
