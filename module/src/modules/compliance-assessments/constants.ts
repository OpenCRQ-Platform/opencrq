export const COMPLIANCE_ASSESSMENT_STATUSES = ['draft', 'published'] as const;
export type ComplianceAssessmentStatus = typeof COMPLIANCE_ASSESSMENT_STATUSES[number];

export const MATURITY_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type MaturityLevel = typeof MATURITY_LEVELS[number];

export const FRAMEWORK_NODE_KINDS = ['function', 'category', 'subcategory'] as const;
export type FrameworkNodeKind = typeof FRAMEWORK_NODE_KINDS[number];

/** A level answered on a linked requirement reads as the control's strength (capability) or its deployment extent (coverage). */
export const CONTROL_LINK_AXES = ['capability', 'coverage'] as const;
export type ControlLinkAxis = typeof CONTROL_LINK_AXES[number];
