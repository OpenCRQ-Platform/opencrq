/**
 * Returns true for techniques that are active for resistance scoring and CRQ computation.
 *
 * A technique is active when it carries a non-zero attacker-mixture weight (weight > 0), that is
 * when at least one admitted relevant threat has it in its ingested repertoire. Techniques
 * used by nobody weigh 0 and drop out of vulnerability by design: the weight is a conditional
 * distribution over one attack event, so mass belongs only to what an admitted actor actually does.
 *
 * Use this filter uniformly across all services that build TTP lists from attack outcomes
 * (controls, risk scenarios, CRQ engine) to ensure consistency with what the CRQ Monte Carlo
 * actually incorporates into its simulation.
 *
 * Navigation queries (e.g. "which controls are linked to this scenario?") apply the same filter, so
 * a technique curated on an attack outcome that no relevant actor uses produces NO control links and
 * NO shared-TTP counts. That is intentional. The `evidenceMode: 'no-relevant-threats'` fallback of
 * `getMitreTechniquesForOutcome` weights every curated technique but does not make a CRQ run
 * possible: the engine refuses an outcome with no mixture group.
 */
export const isActiveTechnique = (t: { weight: number }): boolean => t.weight > 0;
