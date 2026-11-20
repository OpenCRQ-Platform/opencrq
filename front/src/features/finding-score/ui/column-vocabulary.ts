import { t } from '@lingui/core/macro';

export type ColumnAccent = 'reachability' | 'threat' | 'controls' | 'potentialImpact';

/**
 * The question each panel answers, drawn under its name and never reworded per finding.
 *
 * Three of them are asked so the answer grows with exposure. The controls panel is the one that
 * runs the other way: it is read as the defence left standing, so its question asks what holds.
 */
export const columnQuestion = (accent: ColumnAccent): string => {
  switch (accent) {
    case 'reachability': return t`can it be got at`;
    case 'threat': return t`is anyone doing it`;
    case 'controls': return t`what they hold back`;
    case 'potentialImpact': return t`what breaks if it works`;
  }
};

export const exposureLabel = (exposure: string): string => {
  switch (exposure) {
    case 'internet_facing': return t`internet facing`;
    case 'internal': return t`internal`;
    default: return t`unknown`;
  }
};

export const criticalityLabel = (criticality: string): string => {
  switch (criticality) {
    case 'very_high': return t`very high`;
    case 'high': return t`high`;
    case 'medium': return t`medium`;
    case 'low': return t`low`;
    default: return t`not set`;
  }
};

export const columnTitle = (accent: ColumnAccent): string => {
  switch (accent) {
    case 'reachability': return t`Reachability`;
    case 'threat': return t`Threat intelligence`;
    case 'controls': return t`Controls`;
    case 'potentialImpact': return t`Potential impact`;
  }
};

/**
 * True when a published vector is CVSS 4.0, which reassigned two letters the earlier versions used.
 *
 * `S` is Scope in 3.x and Safety in 4.0, and the two carry different values, so a reader given the
 * 3.x wording on a 4.0 vector is told about a metric that vector does not contain.
 */
const isCvss4 = (vector: string | null): boolean => vector?.startsWith('CVSS:4.') === true;

/**
 * A CVSS 2.0 vector's privileges are its Authentication metric, which the score's terms carry under
 * the 3.x name `PR`.
 */
const isCvss2 = (vector: string | null): boolean => vector?.trim().startsWith('AV:') === true;

/** A CVSS metric letter, said in words, so a reader never has to know the vector grammar. */
export const cvssMetricLabel = (metric: string, vector: string | null = null): string => {
  switch (metric) {
    case 'AV': return t`Attack vector`;
    case 'AC': return t`Attack complexity`;
    case 'AT': return t`Attack requirements`;
    case 'PR': return isCvss2(vector) ? t`Authentication` : t`Privileges`;
    case 'Au': return t`Authentication`;
    case 'UI': return t`User interaction`;
    case 'S': return isCvss4(vector) ? t`Safety` : t`Scope`;
    case 'C': case 'VC': return t`Confidentiality`;
    case 'I': case 'VI': return t`Integrity`;
    case 'A': case 'VA': return t`Availability`;
    default: return metric;
  }
};

export const cvssValueLabel = (metric: string, value: string, vector: string | null = null): string => {
  if (metric === 'AV') {
    switch (value) {
      case 'N': return t`network`;
      case 'A': return t`adjacent network`;
      case 'L': return t`local`;
      default: return t`physical`;
    }
  }
  if (metric === 'Au' || (metric === 'PR' && isCvss2(vector))) {
    switch (value) {
      case 'N': return t`none needed`;
      case 'S': return t`single`;
      default: return t`multiple`;
    }
  }
  if (metric === 'PR') {
    switch (value) {
      case 'N': return t`none needed`;
      case 'L': return t`low`;
      default: return t`high`;
    }
  }
  if (metric === 'UI') {
    return value === 'N' ? t`none needed` : t`required`;
  }
  if (metric === 'S') {
    if (isCvss4(vector)) {
      return value === 'P' ? t`present` : t`negligible`;
    }
    return value === 'C' ? t`changed` : t`unchanged`;
  }
  if (metric === 'AT') {
    return value === 'P' ? t`present` : t`none`;
  }
  if (isCvss2(vector)) {
    switch (value) {
      case 'C': return t`complete`;
      case 'P': return t`partial`;
      case 'M': return t`medium`;
    }
  }
  switch (value) {
    case 'H': return t`high`;
    case 'L': return t`low`;
    case 'N': return t`none`;
    default: return value;
  }
};
