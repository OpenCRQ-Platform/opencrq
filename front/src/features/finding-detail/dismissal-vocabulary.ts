import { t } from '@lingui/core/macro';
import type { DismissalReasonCode, DismissalType, EvidenceHistoryOrigin } from '@app/module/client';
import { DISMISSAL_REASON_CODES_BY_TYPE } from '@app/module/client';
import { dismissalCause } from './finding-cause-utils';

/**
 * The two statements one dismissed state carries.
 *
 * Accepted risk is a real finding the organisation chooses to live with, reversible and due for
 * review. A false positive is a finding that is not true here, and what it asks for is an
 * ingestion fix, not a review date.
 */
export const dismissalTypeLabel = (type: DismissalType): string => {
  switch (type) {
    case 'risk_accepted': return t`Risk accepted`;
    case 'false_positive': return t`False positive`;
    default: return type;
  }
};

/** A CVE finding, reported by a scanner, or a technique finding, tested by an attack simulation. */
export type FlawKind = 'cve' | 'technique';

/** A dismissed finding as its latest history row wrote it: a sync's dismissal never reads as a person's decision. */
export const dismissedStateLabel = ({ kind, origin, dismissalType }: {
  kind: FlawKind,
  origin?: EvidenceHistoryOrigin | null,
  dismissalType?: DismissalType | null,
}): string => {
  const cause = dismissalCause(kind, origin);
  switch (cause) {
    case 'no_longer_reported': return t`No longer reported`;
    case 'not_exposed': return t`Not exposed`;
    case 'set_aside': return dismissalType == null ? t`Set aside` : dismissalTypeLabel(dismissalType);
    default: return cause satisfies never;
  }
};

/** The dismissed state as a state filter names it, every cause the listed kinds can carry at once. */
export const dismissedStateFilterLabel = (kind: FlawKind | 'both'): string => {
  switch (kind) {
    case 'cve': return t`Set aside or no longer reported`;
    case 'technique':
    case 'both': return t`Set aside, no longer reported or not exposed`;
    default: return kind satisfies never;
  }
};

export const dismissalReasonLabel = (code: DismissalReasonCode): string => {
  switch (code) {
    case 'wont_fix': return t`Won't fix`;
    case 'patch_unavailable': return t`Patch unavailable`;
    case 'downtime_not_permitted': return t`Downtime not permitted`;
    case 'application_incompatibility': return t`Application incompatibility`;
    case 'compensatory_control_applied': return t`Compensatory control applied`;
    case 'technical_debt_or_eol': return t`Technical debt or end of life`;
    case 'not_externally_exposed': return t`Not externally exposed`;
    case 'business_exception': return t`Business exception`;
    case 'vendor_dependency': return t`Vendor dependency`;
    case 'detection_error': return t`Detection error`;
    case 'not_applicable': return t`Not applicable`;
    case 'other': return t`Other`;
    default: return code;
  }
};

/** The codes a type accepts, already worded. A code only means anything under its own type. */
export const dismissalReasonOptions = (
  type: DismissalType,
): Array<{ value: DismissalReasonCode, label: string }> =>
  DISMISSAL_REASON_CODES_BY_TYPE[type].map((code) => ({ value: code, label: dismissalReasonLabel(code) }));
