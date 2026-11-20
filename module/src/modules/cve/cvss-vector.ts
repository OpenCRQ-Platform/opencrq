/**
 * CVSS base vectors, read as three independent statements rather than as one number.
 *
 * The base score collapses access, complexity and impact into a single figure, which is exactly
 * what the finding score keeps apart: the same 9.8 can be a remote unauthenticated flaw on a
 * throwaway asset or a local flaw on the payroll database. Nothing here recomputes a base score,
 * and the three multipliers below are only ever read by the factors they belong to.
 */

/** Attack Vector, Privileges Required and User Interaction, per CVSS 3.1 section 7.1. */
const ATTACK_VECTOR = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 } as const;
const ATTACK_COMPLEXITY = { L: 0.77, H: 0.44 } as const;
const PRIVILEGES_REQUIRED_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 } as const;
const PRIVILEGES_REQUIRED_CHANGED = { N: 0.85, L: 0.68, H: 0.5 } as const;
/**
 * User Interaction, one table per version: 4.0 replaced 3.x's Required with passive and active,
 * which both mean a user has to act. The tables stay apart because they are also what accepts a
 * vector, and a merged one would take `UI:P` on a 3.1 vector and `UI:R` on a 4.0 one.
 */
const USER_INTERACTION_3X = { N: 0.85, R: 0.62 } as const;
const USER_INTERACTION_40 = { N: 0.85, P: 0.62, A: 0.62 } as const;
/** 4.0's Attack Requirements, as the factor they apply to `complexity`. Absent in 3.x, hence 1. */
const ATTACK_REQUIREMENTS = { N: 1, P: ATTACK_COMPLEXITY.H / ATTACK_COMPLEXITY.L } as const;
const IMPACT_WEIGHTS = { H: 0.56, L: 0.22, N: 0 } as const;

/** CVSS 2.0 letters, as the 3.1 letter whose weight they are read with. */
const V2_ATTACK_VECTOR = { N: 'N', A: 'A', L: 'L' } as const;
const V2_AUTHENTICATION = { N: 'N', S: 'L', M: 'H' } as const;
/** `AC:M` has no 3.1 counterpart, and Low is the reading that leaves the threat factor undampened. */
const V2_ACCESS_COMPLEXITY = { L: 'L', M: 'L', H: 'H' } as const;
const V2_IMPACT = { N: 'N', P: 'L', C: 'H' } as const;

/** The three access metrics at their most permissive, which is what normalises `access` to one. */
const MAX_ACCESS = ATTACK_VECTOR.N * PRIVILEGES_REQUIRED_UNCHANGED.N * USER_INTERACTION_3X.N;
/** All three impact metrics High, which is what normalises `impact` to one. */
const MAX_IMPACT = 1 - (1 - IMPACT_WEIGHTS.H) ** 3;

/**
 * Floor under a vector that claims no impact at all.
 *
 * CVSS scores such a vector at zero, but a zero would zero the finding score's impact, and with it
 * the score, and drop the finding off every surface. The precautionary direction the rest of the engine takes applies here
 * too: sink it, never erase it.
 */
export const CVSS_IMPACT_FLOOR = 0.05;

export interface CvssContributions {
  /** How reachable the flaw is once the asset has been reached, in (0, 1]. */
  access: number,
  /** How reliably the flaw can be exploited, in (0, 1]. Dampens the threat factor, never lifts it. */
  complexity: number,
  /** How much the flaw costs when it lands, in (0, 1]. */
  impact: number,
  /** The vector's own version, carried so a surface can say which one it read. */
  version: string,
}

type MetricMap = Map<string, string>;

const V2_VERSION = '2.0';

/** A 2.0 vector carries no `CVSS:` prefix, and one claiming `CVSS:2.x` matches no published format. */
const parseMetrics = (vector: string): { version: string, metrics: MetricMap } | null => {
  const parts = vector.trim().split('/');
  const [head, ...rest] = parts;
  const versionMatch = /^CVSS:(\d+\.\d+)$/.exec(head);
  const isVersion2 = versionMatch === null && head.startsWith('AV:');
  if ((versionMatch === null && !isVersion2) || versionMatch?.[1].startsWith('2.') === true) {
    return null;
  }
  const metrics: MetricMap = new Map();
  for (const part of isVersion2 ? parts : rest) {
    const segment = /^([A-Za-z]+):([A-Za-z]+)$/.exec(part);
    if (segment === null || metrics.has(segment[1])) {
      return null;
    }
    metrics.set(segment[1], segment[2]);
  }
  return { version: versionMatch?.[1] ?? V2_VERSION, metrics };
};

const lookup = <T extends Record<string, number>>(
  table: T,
  value: string | undefined,
  fallback: number,
): number => (value !== undefined && value in table ? table[value] : fallback);

/**
 * Whether the vector carries every metric the three contributions are drawn from, each with a value
 * its own table recognises.
 *
 * Every fallback below is the most permissive weight, which is the right reading of a metric a
 * version does not define but the wrong one for a vector that was truncated or mistyped: it would
 * score the string at the exact ceiling of the most dangerous vector publishable. A vector that
 * cannot be read is refused the same way an unsupported version is, and the factor falls back to
 * the exposure weight alone rather than to a maximum nothing vouches for.
 */
const hasBaseMetrics = (metrics: MetricMap, isVersion4: boolean): boolean => {
  const known = <T extends Record<string, number>>(table: T, metric: string): boolean => {
    const value = metrics.get(metric);
    return value !== undefined && value in table;
  };
  return known(ATTACK_VECTOR, 'AV')
    && known(ATTACK_COMPLEXITY, 'AC')
    && known(PRIVILEGES_REQUIRED_UNCHANGED, 'PR')
    && known(isVersion4 ? USER_INTERACTION_40 : USER_INTERACTION_3X, 'UI')
    && (!isVersion4 || known(ATTACK_REQUIREMENTS, 'AT'))
    && (isVersion4 ? ['VC', 'VI', 'VA'] : ['C', 'I', 'A']).every((metric) => known(IMPACT_WEIGHTS, metric));
};

interface BaseVectorReading {
  version: string,
  isVersion4: boolean,
  published: MetricMap,
  /** The metrics in the letters the weight tables are keyed on, which on 2.0 are 3.1's. */
  read: MetricMap,
  /** The letter a surface shows for each `read` metric, in the vector's own vocabulary. */
  shown: MetricMap,
}

/**
 * A 2.0 vector in 3.1 letters, or null when a base metric is missing or unknown. An absent user
 * interaction flag reads as no user needed.
 */
const readVersion2 = (
  published: MetricMap,
  userInteractionRequired: boolean | null,
): Pick<BaseVectorReading, 'read' | 'shown'> | null => {
  const read: MetricMap = new Map();
  const shown: MetricMap = new Map();
  const v2Metrics: Array<[string, string, Readonly<Record<string, string>>]> = [
    ['AV', 'AV', V2_ATTACK_VECTOR],
    ['AC', 'AC', V2_ACCESS_COMPLEXITY],
    ['Au', 'PR', V2_AUTHENTICATION],
    ['C', 'C', V2_IMPACT],
    ['I', 'I', V2_IMPACT],
    ['A', 'A', V2_IMPACT],
  ];
  for (const [v2Metric, metric, table] of v2Metrics) {
    const value = published.get(v2Metric);
    if (value === undefined || !(value in table)) {
      return null;
    }
    read.set(metric, table[value]);
    shown.set(metric, value);
  }
  const userInteraction = userInteractionRequired === true ? 'R' : 'N';
  read.set('UI', userInteraction);
  shown.set('UI', userInteraction);
  return { read, shown };
};

/**
 * The one reading every export below rests on, so none of them can accept a vector another refuses.
 *
 * CVSS 2.0, 3.x and 4.0 are read. 4.0's own scoring is a lookup table with no published per-metric
 * multipliers, so a 4.0 vector is weighted with the 3.1 coefficients, and a 2.0 one through the 3.1
 * letter each of its own maps to: approximations, and the reason `version` travels with the result.
 * 3.x and 4.0 reuse metric letters without reusing their values, so which table a letter is read
 * against is decided by the version and never shared between them: a merged table would take `UI:P`
 * on a 3.1 vector and `UI:R` on a 4.0 one. Every per-metric fallback is the most permissive weight,
 * which is why a vector missing a metric is refused before any table is read.
 */
const readBaseVector = (vector: string | null, userInteractionRequired: boolean | null): BaseVectorReading | null => {
  const parsed = vector === null ? null : parseMetrics(vector);
  if (parsed === null) {
    return null;
  }
  const { metrics: published, version } = parsed;
  if (version === V2_VERSION) {
    const version2 = readVersion2(published, userInteractionRequired);
    return version2 === null ? null : { version, isVersion4: false, published, ...version2 };
  }
  if (!(version.startsWith('3.') || version.startsWith('4.'))) {
    return null;
  }
  const isVersion4 = version.startsWith('4.');
  if (!hasBaseMetrics(published, isVersion4)) {
    return null;
  }
  return { version, isVersion4, published, read: published, shown: published };
};

/**
 * The three contributions a base vector makes, or null when the string is not a base vector this
 * engine reads. `userInteractionRequired` is ignored on any version but 2.0.
 */
export const parseCvssContributions = (
  vector: string | null,
  userInteractionRequired: boolean | null = null,
): CvssContributions | null => {
  const reading = readBaseVector(vector, userInteractionRequired);
  if (reading === null) {
    return null;
  }
  const { read: metrics, version, isVersion4 } = reading;

  // Scope belongs to 3.x alone: 4.0 dropped it and gave the letter to Safety, whose values would
  // never read as `C` anyway.
  const scopeChanged = !isVersion4 && metrics.get('S') === 'C';
  const privilegeTable = scopeChanged ? PRIVILEGES_REQUIRED_CHANGED : PRIVILEGES_REQUIRED_UNCHANGED;
  const userInteraction = isVersion4 ? USER_INTERACTION_40 : USER_INTERACTION_3X;
  const access = (
    lookup(ATTACK_VECTOR, metrics.get('AV'), ATTACK_VECTOR.N)
    * lookup(privilegeTable, metrics.get('PR'), privilegeTable.N)
    * lookup(userInteraction, metrics.get('UI'), userInteraction.N)
  ) / MAX_ACCESS;

  // 4.0 splits what 3.1 called complexity into AC and AT. Attack Requirements dampen the same way
  // a high complexity does, so the two multiply rather than one shadowing the other.
  const attackRequirements = isVersion4
    ? lookup(ATTACK_REQUIREMENTS, metrics.get('AT'), ATTACK_REQUIREMENTS.N)
    : ATTACK_REQUIREMENTS.N;
  const complexity = (lookup(ATTACK_COMPLEXITY, metrics.get('AC'), ATTACK_COMPLEXITY.L) / ATTACK_COMPLEXITY.L)
    * attackRequirements;

  // 4.0 renames the impact metrics to VC/VI/VA and adds SC/SI/SA for the subsequent system. Only
  // the vulnerable system's three are read: the subsequent system is another asset, and this
  // finding is scored on the asset it sits on.
  const [c, i, a] = isVersion4 ? ['VC', 'VI', 'VA'] : ['C', 'I', 'A'];
  const confidentiality = lookup(IMPACT_WEIGHTS, metrics.get(c), IMPACT_WEIGHTS.H);
  const integrity = lookup(IMPACT_WEIGHTS, metrics.get(i), IMPACT_WEIGHTS.H);
  const availability = lookup(IMPACT_WEIGHTS, metrics.get(a), IMPACT_WEIGHTS.H);
  const impact = (1 - (1 - confidentiality) * (1 - integrity) * (1 - availability)) / MAX_IMPACT;

  return {
    access: Math.min(Math.max(access, 0), 1),
    complexity: Math.min(Math.max(complexity, 0), 1),
    impact: Math.min(Math.max(impact, CVSS_IMPACT_FLOOR), 1),
    version,
  };
};

/** One metric of the published vector, as the weight it contributed. */
export interface CvssMetricTerm {
  /**
   * The letter the vector carried, so a surface can word it in the version's own vocabulary. On 2.0,
   * privileges carry the `Au` letter, and user interaction NVD's flag as `R` or `N`.
   */
  value: string,
  weight: number,
}

/**
 * The access contribution, term by term.
 *
 * `product` and `maxProduct` are both kept: a surface explaining the figure has to show what the
 * normalisation divides by, and recomputing it from the three weights would restate a constant the
 * engine owns.
 */
export interface CvssAccessTerms {
  attackVector: CvssMetricTerm,
  privilegesRequired: CvssMetricTerm,
  userInteraction: CvssMetricTerm,
  product: number,
  /** The same product for the most permissive vector publishable, which normalises `access` to one. */
  maxProduct: number,
}

/**
 * The impact contribution, term by term.
 *
 * The three metrics do not add up: `intact` is what the vector leaves standing, and the damage is
 * its complement, which is the only shape that explains why two High metrics do not read as 1.12.
 */
export interface CvssImpactTerms {
  confidentiality: CvssMetricTerm,
  integrity: CvssMetricTerm,
  availability: CvssMetricTerm,
  intact: number,
  damage: number,
  /** The same damage for a vector High on all three. */
  maxDamage: number,
  /** `CVSS_IMPACT_FLOOR` decided the contribution, so the arithmetic above is not what it rests on. */
  heldAtFloor: boolean,
}

export interface CvssTerms {
  access: CvssAccessTerms,
  impact: CvssImpactTerms,
}

/**
 * The weights behind `access` and `impact`, for a surface that has to show where they came from.
 *
 * Null exactly when `parseCvssContributions` refuses the vector, so the two can never disagree
 * about whether a vector was read. Complexity is absent on purpose: it is one table lookup, which
 * the metric letter and the figure already state between them.
 */
export const explainCvssContributions = (
  vector: string | null,
  userInteractionRequired: boolean | null = null,
): CvssTerms | null => {
  const reading = readBaseVector(vector, userInteractionRequired);
  if (reading === null) {
    return null;
  }
  const { read: metrics, shown, isVersion4 } = reading;
  const scopeChanged = !isVersion4 && metrics.get('S') === 'C';
  const privilegeTable = scopeChanged ? PRIVILEGES_REQUIRED_CHANGED : PRIVILEGES_REQUIRED_UNCHANGED;
  const userInteraction = isVersion4 ? USER_INTERACTION_40 : USER_INTERACTION_3X;
  const term = <T extends Record<string, number>>(table: T, metric: string, fallback: number): CvssMetricTerm => ({
    value: shown.get(metric) ?? '',
    weight: lookup(table, metrics.get(metric), fallback),
  });

  const attackVector = term(ATTACK_VECTOR, 'AV', ATTACK_VECTOR.N);
  const privilegesRequired = term(privilegeTable, 'PR', privilegeTable.N);
  const userInteractionTerm = term(userInteraction, 'UI', userInteraction.N);

  const [c, i, a] = isVersion4 ? ['VC', 'VI', 'VA'] : ['C', 'I', 'A'];
  const confidentiality = term(IMPACT_WEIGHTS, c, IMPACT_WEIGHTS.H);
  const integrity = term(IMPACT_WEIGHTS, i, IMPACT_WEIGHTS.H);
  const availability = term(IMPACT_WEIGHTS, a, IMPACT_WEIGHTS.H);
  const intact = (1 - confidentiality.weight) * (1 - integrity.weight) * (1 - availability.weight);

  return {
    access: {
      attackVector,
      privilegesRequired,
      userInteraction: userInteractionTerm,
      product: attackVector.weight * privilegesRequired.weight * userInteractionTerm.weight,
      maxProduct: MAX_ACCESS,
    },
    impact: {
      confidentiality,
      integrity,
      availability,
      intact,
      damage: 1 - intact,
      maxDamage: MAX_IMPACT,
      heldAtFloor: (1 - intact) / MAX_IMPACT < CVSS_IMPACT_FLOOR,
    },
  };
};

/**
 * Metric letters a surface can name, as the vector publishes them, in the order a reader expects.
 *
 * Empty on a vector the scoring parser refused. The panels draw these as the evidence behind the
 * figure, so naming a metric the score never read would put a reachability the arithmetic does not
 * contain in front of the reader.
 */
export const readCvssMetrics = (vector: string | null): Array<{ metric: string, value: string }> => {
  const reading = readBaseVector(vector, null);
  return reading === null ? [] : [...reading.published].map(([metric, value]) => ({ metric, value }));
};

/**
 * The access metrics in 3.x or 4.0 letters, a 2.0 vector's included. Null exactly when
 * `parseCvssContributions` refuses the vector.
 */
export const readCvssAccess = (
  vector: string | null,
  userInteractionRequired: boolean | null = null,
): { attackVector: string, privilegesRequired: string, userInteraction: string } | null => {
  const reading = readBaseVector(vector, userInteractionRequired);
  return reading === null ? null : {
    attackVector: reading.read.get('AV')!,
    privilegesRequired: reading.read.get('PR')!,
    userInteraction: reading.read.get('UI')!,
  };
};

/**
 * How much confidentiality or integrity a flaw gives, on 0 to 1, a High on either metric being 1.
 * Availability is left out: a flaw that only takes a service down gives no foothold.
 * Null exactly when `parseCvssContributions` refuses the vector.
 */
export const entryImpact = (vector: string | null): number | null => {
  const terms = explainCvssContributions(vector);
  if (terms === null) {
    return null;
  }
  return Math.max(terms.impact.confidentiality.weight, terms.impact.integrity.weight) / IMPACT_WEIGHTS.H;
};
