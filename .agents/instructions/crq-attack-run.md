---
applyTo: "module/src/modules/crq-indicators/**,module/src/modules/entry-openings/**,module/src/modules/attack-surfaces/entry-applicability*,module/src/modules/finding-score/technique-scores*,module/src/modules/controls/capability/constants.ts,module/src/modules/attack-outcomes/data/attack-paths-data*"
description: 'The CRQ attack run engine: worlds, the initial access door, the data path behind it, the attack paths after it, what-ifs, invariants, calibration and known limits'
---

# The CRQ attack run engine

The engine prices one risk scenario: how often an attacker gets in, how far the attack run goes
against the declared controls, and what each stop costs. It is a closed-form law evaluated on
stratified worlds, with no simulation of individual attackers. This is the reference for whoever
changes it; read the sections your change touches, and section 7 whatever it touches.

## 1. What the engine computes

Per world `w`, per attacker `a` (one per actor class present in the scenario):

```
ALE(w) = SUM_a  TEF(w) x share_a x magnitude(w) x pricedFraction(outcomes_a(w))
```

| Term | Source |
| --- | --- |
| `TEF(w)` | the scenario's PERT range (manual, or the open-data catalogue's read for the risk scope's country, sector and size: the employee count's class, else the classes a revenue band spans, else every class alike), one stratified column. It counts **attack campaigns** per year, not exposure |
| `share_a` | the sum of the admitted actors' shares of the class |
| `magnitude(w)` | the sum of one stratified PERT column per loss driver |
| `outcomes_a(w)` | `blocked`, `evicted`, `impactDetected`, `impactUndetected`, summing to 1: the mixture of the paths an attack takes after the door, below |
| `pricedFraction` | `evicted x RESPONSE_COST_FRACTION + impactDetected x DETECTED_MAGNITUDE_FACTOR + impactUndetected` |

The FAIR vulnerability node is `impactDetected + impactUndetected`: the probability that one attack
lands an impact. `LEF = TEF x vulnerability`. `ALE` is therefore TEF x vulnerability x magnitude
only when every impact is undetected; the price fractions are what make a detected impact and an
eviction cheaper.

**The outcomes are a mixture of paths.** After the door an attack takes one of three chains of
obstacles (section 4), and `mixAttackPaths` weights them:

```
outcomes_a(w) = (1 - g) x [direct part + long part] + g x [path around the door]
```

`g` is the share of the scenario outcome's attacks that bypass initial access, `blocked` is what the
other three leave. The same split is kept as four path shares summing to 1, `evaluateAttackRun`
returning them as `paths`:

| Share | Value |
| --- | --- |
| stopped at initial access | `(1 - g) x (1 - D_T - D_O)` |
| direct | `(1 - g) x D_T` |
| long | `(1 - g) x D_O` |
| without initial access | `g` |

`D_T` and `D_O` are the door's two clears (section 2). A run stores the shares mixed over actors like
`outcomes` (`crq_indicator_runs.path_share_stopped_at_initial_access`, `path_share_direct`,
`path_share_long`, `path_share_without_initial_access`), and `no_target` when no asset of the scope
is linked to a primary asset of the scenario.

**A world draws only what holds for a whole year, nothing about the attack.** It fixes the TEF, the
loss magnitudes, which CVE exploits circulate, which asset families hold an unknown flaw, how many
assets each kind declared as a range counts (section 3), and the uniforms that decide sabotage
knockouts. A control reads its declared strength and coverage
in every world, audited by OpenAEV's results on a technique they tested (section 4), and the reaction time is read as a probability (section 4): an
incident's own variability drawn per world would leave the mean where it is and widen the spread,
since a world prices the expected loss of its year, linear in the campaigns. Every attacker is
evaluated inside every world, so a cross-attacker comparison and every what-if are paired
differences with no simulation noise. The number of worlds is capped by `MAX_CRQ_ITERATIONS` and
the run seed is the risk scenario id.

**Every draw is keyed by id, never by position.** Each quantity owns a shuffled permutation of the
`N` cell centres of the unit interval, seeded by `deriveSeed(seed, key)`; world `i` reads cell `i`.
The key names what is drawn (a control's capability and obstacle for a knockout, a CVE's row id, a family, a declared kind), see
`buildAttackRunWorlds`. This gives exact marginals (the share of worlds where a CVE's exploit
circulates is exactly its threat) and shared worlds: removing a control or a CVE from the run shifts no other draw, so a
baseline and a what-if differ by the perturbation alone. Anything new that needs a draw gets its
own keyed column in `buildAttackRunWorlds`; a draw taken from a shared stream or by iteration order
breaks this, and with it every what-if.

**One attacker per actor class** (`resolveAttackRunInputs`): the class's repertoire is the pool of
its actors' parent techniques that are playable on the estate and contestable by the catalogue (plus the techniques of the path around the
door, which the catalogue does not narrow, section 4), and
each technique's `prevalence` is the share of the class's actor weight holding it. Capability, stealth, patience and attack-run days come from the class
preset (`ACTOR_CLASS_PRESETS`, `ATTACK_RUN_DAYS_BY_CLASS`), never per actor. An actor's class is the
one its producer states, which only the Default Threats file does, else the one its STIX labels and
resource level give (`deriveActorClass`), else `default`. A manual class (`actor_class_override`)
wins over all of them (`resolveEffectiveActorClass`), and a resync leaves it in place.

**The admitted actors are stored, never computed by the run.** The attacker mixture of an
(organization, attack outcome) pair, the admitted actors and their shares of the pair's targeting
profile, is written by the observed, daily job `attack-outcome-mixture-recompute`
(`recomputeAttackOutcomeMixtures`) into `attack_outcome_mixtures` and `attack_outcome_mixture_groups`
for every pair carrying a risk scenario, against the start of the UTC day (`mixtureClockOf`). The
job runs `getAttackerMixtureEvidenceByProfile` then `computeAttackerMixture` once per targeting
profile and keeps no selection rule of its own, and a pair whose result did not move is not
rewritten. Every reader takes the stored rows: the scenario page and the TTP tab
(`getMitreTechniquesForOutcome`, `getRepertoireTechniquesForOutcome`), the control links
(`getActiveTechniqueIdsByOrganization`), the engine, the price pass and the platform seed, which runs
the job's service method before it seeds simulations. The technique weights are not stored: they are
recomputed on read from the stored actors' repertoires (`linksOfMixture`). A pair with no stored row
answers `evidenceMode: 'mixture-pending'` when it carries a scenario and `'no-scenario'`, with the
outcome's curated techniques at their editorial levels, when it does not; the engine throws
`InputsNotReadyError` for a pending pair, so a `crq-simulation` waits in the queue for the mixture
job and prices the scenario in its own run, while the price pass lists the scenario among its
refusals and reprices it once the job has written the row. The scenario page holds its Run CRQ
meanwhile.

**An actor holds what the vendored ATT&CK plays.** A feed keeps citing the ids it was written
against, and a revoked id has no family and no control edge, so it would leave the repertoire. The
actors' techniques are read through `playedTechniquesOf` (`threat-analyses/played-techniques.ts`),
which reads a revoked technique as its `replaced_by_technique_id`, at the cited grain and before the
fold to the parent, since ATT&CK split some revoked parents across several new ones (T1562.001 to
T1685, T1562.004 to T1686). A revoked id with no successor stays as cited and leaves the run. The
scenario's controls list reads the same function, so a control priced on a successor has its row,
and the TTP tab weighs a revoked citation under the same successor (`techniqueSuccessorsOf`,
`mitre-attack/technique-successors.ts`). The tab applies the tenant's confidence gate, which the run
does not, so a citation under the gate counts in the run and not on the tab.

The threat list's technique counts, a CVE's actors' counts and the actor's page read the same
successors: T1070.001 plays T1685.005 and counts under T1685, no longer under its cited parent
T1070. The successor is keyed on the catalogue side, so a claim still joins on its own two indexed
columns: comparing the claim's successor would put an expression on the side no index serves.

**The actors a scenario admits come from a stored probability, not from its techniques.** The
offline outcome counter (`threat-analyses/outcome-counter/`) scores each actor at ingestion and
stores one probability per attack outcome (`threat_analysis_outcome_probabilities`). A default
threat the Default Threats file judges stores the judged probabilities instead, dated by
`outcome_judged_at`, and the counter fills only the outcomes the judgment leaves out. The counter
recompute leaves default threats to the connector's sync, which reloads the file on a new app
version. An actor weighs on an outcome only above 50 % on a record with enough evidence, by
`((p - 0.5) / 0.5)^2` (`effectiveOutcomeWeight`), and the weight is read in SQL, so no claim of the
tenant is read to select. The organization's targeting then only scales that weight: x2.5 for a
matching country and x4 for a matching sector, x10 for both (`computeTau`; `MAX_TAU` brings a
relevance back into [0, 1]), read for the selected actors alone. The actors the Relevant Threats tab
lists are exactly those the run draws from.

**The obstacles** are derived, not written down: the walk table (`attack-walk.ts`) is walked from
the empty state to the terminal tactic of the outcome, and tactics granting the same fact pool into
one obstacle. For an Impact scenario (TA0040) the chain is `foothold` (the door), `credentials`,
`knowledge`, `deep_access`, then the terminal tactic. Five support functions (tooling, discretion,
sabotage, persistence, channel) each read the repertoire's techniques of one tactic.

## 2. Initial access: the door

The first obstacle is **one campaign over the whole risk scope**. It is not a per-asset step
weighted by exposure and criticality like the later ones, and the scenario's primary resources do
not weight it: it counts every asset of the scope, whatever its family. They only split what falls
(below).

**Which techniques.** The door plays the repertoire's techniques of tactic TA0001 for which
`isPlayedAtInitialAccess` holds, which excludes those with no asset a campaign can land on (the
last row of the table below). T1078 is among them, although the walk asks for held credentials
before it anywhere else (`TECHNIQUE_WALK_EXCEPTIONS` still applies at the other obstacles). One
attempt picks a technique by prevalence **normalised over the class's door techniques only**: it
never renormalises onto the techniques the estate happens to open, so an estate with no exposed
service resists T1190 campaigns instead of seeing them move onto phishing. A technique is in the
repertoire only when some family of the estate carries it and the catalogue can contest it there;
one outside that leaves the run. A class left with no door technique has an unplayable first
obstacle and never gets in.

**Where each technique applies**: `entryTechniqueApplies` in
`module/src/modules/attack-surfaces/entry-applicability.ts`, on the parent technique (`T1566.002`
follows `T1566`), crossed by callers with the technique families table.

| Technique | Applies to |
| --- | --- |
| T1190, T1133 | assets whose effective exposure is `internet_facing`; `unknown` follows the tenant setting `unknownExposureCountsAs` (default `internal`); any family the families table carries |
| T1566, T1189 | `host` workstations, laptops or with no subcategory; the `mobile_device` family; enabled `identity/user_account`; whatever the exposure. Never servers, VMs, hypervisors, thin clients, `generic_asset` |
| T1078 | enabled `identity` of subcategory `user_account`, `service_account` or `non_human_identity`; `cloud_resource/iam_principal` |
| T1091, T1200, T1669, T1195, T1199, T1659 | never |

An identity is disabled only when **every** observation that fills `is_enabled` says false; no
observation counts as enabled. T1190 and T1133 never apply to an `internal` asset: the setting only
decides for `unknown` ones.

**The rule is the same for T1566, but the door reads its cells differently.** An enabled
`identity/user_account` is a person, the one thing a phishing campaign needs; a device is where a
person's client-side flaws sit, so it opens phishing only through its primary user (below). T1189
keeps reading the devices as assets of the door.

**The same function gates the asset TTP tab.** `findingOpenings` in
`finding-score/technique-scores.ts` filters every TA0001 technique (`isInitialAccessTechnique`)
through it, so a technique the door cannot play on an asset is no cell on that asset's TTP tab, and
an internal workstation carries phishing and drive-by cells. One rule for the screen and the
engine; a second copy of it is a defect. Changing the unknown exposure setting moves both. Its
exposure test, `isEffectivelyExposed`, is also the one the path around the door reads (section 4).

An enabled user account carries no finding, so its T1566 cell is computed on read by
`susceptibilityCell`, with no stored row: the declared simulation rate while it is fresh (section 3),
else `PHISHING_CONSTANTS.defaultSusceptibility`, before any control, and it takes the technique over a
finding cell. A device keeps the cell its findings open.

**How an asset falls.** For a technique `t` other than T1566 (which leaves the per-asset path, see
**Phishing is carried by people** below), a family `f` and a world, with `LT` the share of
attempts the deployed prevent controls covering `(t, f)` let through (after any knockout the
obstacle applied) and `cap = coupleSuccessCap`:

| Case | Probability the asset falls to `t` |
| --- | --- |
| the world drew the family's **unknown flaw floor** | `min(cap, LT)`, for every asset of `f` the technique applies to; an asset with openings is counted here and never a second time |
| otherwise, the asset carries findings whose exploit circulates in this world | `min(cap, LT x [1 - PROD(1 - opening_c)])` over its drawn CVEs `c` that open `t` |
| otherwise | 0 |

- **The exploit is drawn once per CVE per world** against that CVE's threat: it circulates when
  `cveUniform < threat`. All findings and assets carrying the CVE see the same outcome. A CVE has
  one threat per run, the highest stored among its findings.
- **A finding's opening** on a technique is the CVSS access term times the worse of
  confidentiality and integrity, normalised so that a High on either is 1 (`entryImpact`).
  Availability gives no foothold. Exposure is not in it: exposure counts once, in the applicability
  above.
- **The unknown flaw floor** stands for the flaws no finding lists: per world and per family, the
  family holds one when `familyUniform < unknownFlawFloorScale x class capability`
  (`unknownFlawFloor`). It is the **only** place the class capability
  reaches the door, and one draw per family covers every door technique of that family. The floor is
  drawn per world like an exploit, so in a world that holds it the family is open to every campaign
  of the year: the mean is that of a per-campaign draw, the spread is wider.
- Per technique, `P_t = 1 - PROD_assets (1 - fall)`: **at least one asset falls**, computed in log
  space so thousands of assets keep their precision. Cost is linear in the openings plus families x
  techniques.
- The door clears with `SUM_t q_t x P_t`, `q_t` being the class's normalised prevalence; the
  evaluation computes it as the sum of two clears, `D_T + D_O` (below).

**Phishing is carried by people** (`engine/attack-run-phishing.ts`, `phishingPass`). A client-side
flaw does not make anyone open an email, so T1566 is read on the people of the scope, not on the
assets a flaw sits on: the enabled `identity/user_account` assets, and nothing else. A disabled
account, a group, a role, a shared mailbox or a service account is no person, and a host never stands
in for one: an estate with no enabled user account has no person, `DoorEstate.phishing` is null, T1566
clears nothing at the door however many workstations the estate holds, and its campaign sends no email:
nothing for detection to see, and no noise for the obstacles after the door. Its prevalence is not renormalised onto the other door techniques, as for any
technique the estate offers nothing to. `DoorEstate.phishing` holds the people, the
law's `CompiledPhishing` resolves their families once, and `doorClearOf` replaces the T1566 entry of
`doorPassByTechnique` with `phishingPass`; the rest of the door is untouched. A campaign sends
`n = min(people, campaign size of the class)` emails (`PHISHING_CAMPAIGN_BY_CLASS`, section 7), each to
one person, and a person acts on one email with

```
q = min(cap, L x s x [c x B_cred + (1 - c) x B_exec x ((1 - kappa) + kappa x o)])
```

- **`L`, `B_cred`, `B_exec`** are the let-through of the three stages, one per family:
  delivery (prevent edges on T1566, read on the people's family), credential (T1078, `identity`) and
  payload (T1204 and T1203), the techniques of `PHISHING_STAGE_TECHNIQUES` and their
  sub-techniques, whose prevent edges `findAttackRunControlInputs` reads whatever the repertoire plays.
  The payload stage is read per person, on the family of each of their paired devices, flawed or not
  (`cleanPersons` counts the people whose devices carry no flaw, by family): a person counts for the device
  that favours the attacker most, so UEM, which protects `mobile_device`, acts for a person whose device is a
  phone. A person with no paired device, and a person the door does not list, read the `host` family.
  A control acts at the first stage that holds one of its edges, in that order, so email filtering
  and awareness count once at delivery and are not applied again downstream. `L` is the one filter of the campaign, shared
  by all its recipients: the declared let-through, with no per-world draw of a novel campaign.
  Phishing-resistant MFA is IDP declared at L3, read through its T1078 edges: an edge on T1566 would
  credit the L1 push and OTP rungs too, which a relay defeats. The catalogue's own T1566 prevent edges of
  EDR, OSH, IDP, FRAUD and IDV are removed by the generator for that reason, each acting downstream of
  the email's delivery.
- **Anchors at the stage.** SEG (email security) at delivery and IDP (its multi-factor authentication) at the credential stage read
  `PHISHING_STAGE_ANCHORS` (section 7), a judged effectiveness per declared rung, in place of the shared rung
  scale `LAYER_BLOCK_RATE`, at that stage only. Coverage applies as for any control, the
  strength lever reads the next rung's anchor, and every other reading of the control (per-technique
  products, the obstacles after the door) and every other control (SAT, SWG, IGA, UEM) stays on the shared scale.
  The two controls' level descriptions, written in the defense catalogue converter, must keep naming the
  mechanism each rung's value stands for (SEG's filtering generations, IDP's MFA factor types), or the anchors
  are chosen again: `attack-run-phishing-anchor-labels.test.ts` pins them.
- **`s`**, the susceptibility without training, is `PHISHING_CONSTANTS.defaultSusceptibility` until
  the tenant declares a simulation rate (section 3). The declared rate is read as measured under the
  awareness declared now, so the law backs the training out, `s = min(1, rate / LT_training)`, and
  applies it again at delivery: at the declared posture the rate comes back, and the awareness levers
  keep their gain. `s` is fixed for the run: a what-if that moves awareness moves `L`, never `s`.
- **`c`** (`credentialShare`) splits the branches; **`kappa`** is the share of the payload branch that
  needs a client-side exploit on the person's device, and **`o`** the chance the device has one: 1 in
  a world that draws the unknown flaw floor of the device's family, else `1 - PROD(1 - opening)` over the
  device's T1566 openings whose exploit circulates, and 0 for a device with none. A person reads each of
  their devices on its own family's floor, openings and payload controls, and counts for the most favourable
  one; an unlisted person reads the `host` floor. A flaw on a device with no user is worth exactly 0 on
  phishing, and a flaw adds to it by `kappa x (1 - c)` of the payload branch at most.
- **Target and other.** A person is a target when their account is depended on by a primary asset of
  the scenario. Each group receives `n x group / people` of the emails, each landing at the group's
  mean `q`, closed in log space like the door; with no target, `other` is the whole campaign to the
  bit.

The three terms of the door then read as for any technique: `P_T(T1566)` and `P_O(T1566)` enter
`D_T` and `D_O` below.

**Targets and other assets.** A target is an asset of the scope linked by
`support_to_primary_links` to a primary asset of the scenario; every other asset is an other.
`doorPassByTechnique` returns `{ target, other }`, per technique `P_T(t)`, the chance that at least
one target falls, and `P_O(t)`, the chance that at least one other asset falls, each the formula
above over its own assets: the floor case splits `applicable[t][f]` by `targetApplicable[t][f]`, the
openings case reads `DoorAsset.target`. Assets fall independently within a world, so the two
recompose the whole door, and `doorClearOf` reads them as

```
D_T = SUM_t q_t x P_T(t)                      a campaign lands on a target
D_O = SUM_t q_t x (1 - P_T(t)) x P_O(t)       it lands only elsewhere
```

`D_T + D_O` is the whole door `SUM_t q_t x P_t`, and `clearByObstacle[0]` stays that sum. With no
target `P_T` is 0 and `D_O` is `SUM_t q_t x P_O(t)` to the bit, the whole door, which the product
form `1 - (1 - P_T)(1 - P_O)` would not keep (it rounds a pass of 1e-20 to 0).

**The door still does not single out the target for the attacker**: a campaign picks a technique by
prevalence and lands where it lands. The split only decides which path follows, `D_T` the direct one
and `D_O` the long one (section 4).

Because "at least one" over dozens of assets approaches 1, the door saturates fast: once a flaw sits
on many assets, strong controls barely move it. Controls bite at the door only while few assets are
open.

**What the door does not read**: the class capability (except through the floor, and the campaign size
of the class, which only phishing reads), the tooling
factor, the visits (`visitQuota`), the actors' exploited-CVE floor (`actorExploitedCveFloor`, which
only the later obstacles keep), the scenario group boost and, on its success side, the exposure and
criticality step weights. A door family that no group of the law holds reads no control at all (`LT = 1`).

**Detection at the door** keeps the per-group reading every obstacle has, with its own constant:
for a population-scoped technique (T1566 and its sub-techniques, T1189, T1195) the opportunities
are `min(populationDetectionCap, sqrt(assets x (1 - reached)))`, independent of `visitQuota`. For T1566
`assets` is the campaign size `n`, the emails a detector can see, not the assets of the group; on an
estate with no person it is 0 and the technique emits no signal. Only the success side of the door is the estate-wide law above; `reached`
in the detection term is still the group's ordinary success, capability included. The campaign's
noise is spread over the groups by their step weight at depth 0, exposure alone, so the unknown
exposure setting reaches the door's detection, never its success (section 4).

## 3. The data path behind the door

```
finding-score recompute -> entry_openings -> findEntryOpenings ----+
asset counts by (category, subcategory, exposure, enabled)         |
                                         -> findDoorEstateCounts --+-> buildDoorEstate -> DoorEstate -> engine
primary_user_of pairs, enabled user accounts -> findPrimaryUsers --+
```

- **`entry_openings`** (module `entry-openings`, schema only) holds one row per finding and entry
  technique: `opening` (above) and `threat` (the finding's stored threat factor), both before any
  control. It is written by the
  `finding-score` recompute, in the transaction that writes the scores, so it is fresh whenever the
  scores are and the observed job re-runs it when an input changes. A row exists for a finding
  with a parsable CVSS 2.0, 3.x or 4.0 vector, a positive opening and a technique the finding claims,
  its family carries and `entryTechniqueApplies` accepts **with an unknown exposure counted as
  internet-facing**, the widest reading of the setting: the table also holds the T1190 and T1133
  rows of unknown-exposure assets, whatever the tenant holds. A dismissed finding keeps its rows
  too, so dismissing or reopening it leaves the table untouched and wakes the price pass once, on
  `asset_evidence`, whose stored state the dismissal moves. Rows no longer
  produced are deleted at the end of the run, and an unchanged row is not rewritten, so a settled
  estate rings no doorbell. A finding without a row is no data, never a safe finding.
- **What the run reapplies.** The recompute may trail what the run reads, so `findEntryOpenings`
  reads the asset's subcategory and exposure beside each row, and the finding's stored state
  (`asset_evidence.current_state`; a dismissed finding is left out). `buildDoorEstate` then
  keeps a row only if its family carries the technique in the families table and
  `entryTechniqueApplies` accepts it under the setting the run holds, with the identity enabled as
  for any finding. The counts and the openings therefore read one setting, one
  exposure and one state, whatever the recompute has caught up with.
- **The `target` flag.** Both reads carry it, `findDoorEstateCounts(tenantId, estate,
  primaryAssetIds)` and `findEntryOpenings(tenantId, estate, primaryAssetIds)`. The counts split each
  (category, subcategory, exposure, enabled) tuple into a target row and an other row, `count` staying
  a count of assets. Both left-join `targetAssetsOf`, a `select distinct` of the linked assets, so an
  asset linked to two primary assets counts once. `buildDoorEstate` carries the flag into
  `DoorAsset.target` and `DoorEstate.targetApplicable` (the targets among `applicable`, never above
  it). A target no door technique applies to leaves no trace in the door, so `no_target` is read from
  the counts and enters the run's input fingerprint.
- **`findPrimaryUsers(tenantId, estate, primaryAssetIds)`** reads the pairs phishing files a device's
  flaws under: a `select distinct` of the `primary_user_of` relations whose `from` end is an enabled
  `identity/user_account`, both ends in the estate, with the account's `identityTarget` flag from
  `targetAssetsOf`. The enabled state comes from `enabledIdentitiesOf`
  (`supporting-assets/enabled-identities.ts`), the one definition shared with the finding score and the
  counts, so a disabled account is no person in any of them. `buildDoorEstate` counts the people on the
  counts' enabled `identity/user_account` rows, target apart, and on nothing else, files each device's
  T1566 openings under its primary users, dedups the pairs
  on `(identity, device)` and drops T1566 from `applicable` and from every `DoorAsset.openings`; the
  openings of a device with no user stay for T1189. A person paired only with devices that carry no
  flaw is counted in `cleanPersons`, by the families of those devices and target apart, within the
  people counts, so a device's family is read whether or not it is flawed.
- **The declared phishing simulation** is a pair in `crq_indicator_settings`,
  `phishing_failure_rate` in [0, 1] and `phishing_failure_measured_on`, given or cleared together
  (two CHECK constraints, the service and the router enforce it, the date is not after today in UTC).
  The rules live once in `crq-indicator-settings/phishing-declaration.ts`, which the front form imports
  too. The rate is fresh while its campaign is within `measuredValidityDays`, the validity window of a
  measured result, counted in whole UTC days (`freshPhishingFailureRate`): past it the default stands
  in, and with the window off the rate counts however old. The run reads the fresh rate as
  `AttackRunLawInputs.phishing.declaredSusceptibility` and the TTP cell as the susceptibility of an
  account (`susceptibilityCell`, `expired` when a declaration gave way), so it enters the input
  fingerprint and a change reprices the scenarios. Expiry itself changes no table: a scenario reprices
  on the next run that reads it.
- **A CVE is read by its row id, never from the `cve` catalogue.** The threat travels in
  `entry_openings`, and the price pass wakes on every table the run reads: a join on `cve` for the
  CVE's name would reprice every scenario on each EPSS, NVD or CISA sync, for a figure that only
  moves once the recompute rewrites `entry_openings`. The draw and `crq_cve_what_if_results` both
  key on `cve.id`.
- **Why a separate table and module.** `asset_technique_scores` cannot serve: it bakes the threat
  in, combines C, I and A, keeps only the worst finding per cell and rounds to an integer. The
  engine must never read a score that already carries controls (it models them itself), and
  `crq-indicators/finding-score-isolation.test.ts` forbids any mention of `finding-score`,
  `finding_scores` or `asset_technique_scores` in the engine's sources. A neutral module is how the
  threat reaches the engine without breaking that guard. Keeping every finding (the engine needs
  each CVE's own exploit draw) is why the table is per finding and not per cell.
- **`buildDoorEstate`** (`crq-indicators/attack-run-door-estate.ts`) is pure and order-independent:
  techniques, families, CVEs and assets are sorted and the reductions are integer sums and maxima.
  Sub-techniques fold to their parent (keeping an asset's strongest opening per CVE), and a family
  or an opening counts for a technique only when the families table carries it and
  `entryTechniqueApplies` accepts it. It does not apply the catalogue's `uncontestableByCatalogue` exclusion: a family no control can
  contest still falls, with nothing held back. One door per run, shared by every attacker.
- **The threat is shared with the finding score.** `threatFactor` (`finding-score/engine.ts`) is the
  highest floor among the signals received (the base `SILENT_FLAW_THREAT`, a citation by an active
  threat, the EPSS probability, a CISA listing; floors in `finding-score/constants.ts`), lifted by a
  third of the distance to 1 when two independent families agree, damped by CVSS attack complexity
  and never below the base.
  **Listed means CISA dated it.** `isCisaListed` and `cisaListedSql` (`cve/cisa-listing.ts`) read
  `kev_updated_at is not null` and are the only definition; every reader (score, dashboard, CVE
  catalogue, finding rows, the unique findings list, the scenario Findings tab) goes through them.
  The `kev` flag is not read: connectors also set it for "an exploit is available".
- **The tenant setting `unknownExposureCountsAs`** (`crq_indicator_settings`, `internal` or
  `internet_facing`) is read by the recompute for the TTP cells, by the run for the
  `buildDoorEstate` counts and openings, by the law for the step weights, the door's detection
  included, and the path around the door (section 4), and by the finding score, which gives an unknown-exposure
  asset the weight of that exposure, in the reachability and in the families' shares, and the
  techniques the topology rule gives that exposure, in the score, its explanation, the TTP cells, a
  unique CVE finding's techniques and the technique filter of the findings list.
  `entry_openings` does not depend on it: it is written under the widest reading and the run narrows
  it. It is the single lever for assets whose exposure nobody declared.
- **The tenant setting `unknownCriticalityCountsAs`** (`crq_indicator_settings`, a criticality
  band, `low` by default) is read by the finding score, which weighs an unknown-criticality asset as
  that band, and by the law for the step weights (section 4). It is the single lever for assets
  whose criticality nobody declared. The engine holds no value of its own for an unknown exposure or
  criticality: `EXPOSURE_SCALARS` and `CRITICALITY_SCALARS` have no `unknown` entry, and the law
  reads the setting before it reads a scalar.
- **The declared estate completes the measured one** (module `declared-estate`), and is the one
  place a scope's numbers of assets live: the financial questionnaire asks none. A risk scope
  answers, per kind of asset (twelve kinds grouping the categories, `host` and `identity` split by
  subcategory, `DECLARED_ESTATE_KINDS`), a low and a high bound and, for the kinds that can be
  exposed, whether at least one is reachable from the Internet. `completeDeclaredEstate`
  (`crq-indicators/declared-estate-completion.ts`, pure) measures each kind on the door's counts,
  every family included, with `declaredEstateKindOf` (a host with no subcategory is a workstation,
  a disabled account no person, groups, roles, shared mailboxes and `generic_asset` no kind), and
  adds the virtual assets the low bound asks beyond them: `internal`, of unknown criticality, never a
  target, with the kind's `virtualSubcategory` so the applicability rule reads them as real ones (a
  virtual person is an enabled `identity/user_account`, which phishing counts). A "yes" with no real
  asset of the kind effectively exposed makes one of them `internet_facing`, or adds one when the
  measure already reaches the low bound. `resolveAttackRunInputs` adds them to the estate counts,
  restricted to the walked families as the measured ones are, and to the door's counts, so a family
  only declared makes its techniques playable, and virtual assets matched by no scenario group can
  turn the group boost on in a scope whose real assets all were. `estateAssetCount` and
  `unscannedAssetCount` stay the real assets: the virtual ones are reported apart
  (`reach.declared`, stored as `crq_indicator_runs.declared_asset_count` and
  `declared_asset_share`). A closed scope that maps no asset is priced when it declares something.
  A scope with no answer adds nothing and leaves `reach` without the `declared` key, so its run and
  its digest are what they were. The run reads the answers through
  the declared estate service, which the price pass then observes, without the `users` join the
  screens make. The screens compare each kind's measure with its bounds
  (`getDeclaredEstateComparison`, `declared-estate/comparison.ts`) counting through the same
  `declaredEstateKindOf` and enabled test over the estate the run resolves, so a kind measured below
  its low bound is exactly one the completion adds virtual assets to in every world.
- **Each world draws a declared range again.** A kind whose high bound passes both its low bound and
  what it already holds (its measured assets and the exposed virtual one a "yes" adds) is a drawn
  kind (`DeclaredEstateCompletion.kinds`, `AttackRunDeclaredKind`), with its own keyed column
  `declared:<kind>`. A world reads it uniform on a log scale between the bounds, a range starting at 0
  uniformly, rounded to an integer (`declaredVirtualCount`), and the kind's internal virtual assets are
  the draw less what it holds, never below zero: each world takes the larger of the draw and the
  measure, and the exposed virtual asset stays outside the draw. The compiled inputs hold every drawn
  kind at its low bound, the completion keeping its internal row even at a count of 0 so its family
  stays in the estate: the unmatched plain group of `(family, internal, unknown)` names it
  (`AttackRunGroup.declaredKinds`, the per-CVE groups alike), and the door names the techniques whose
  `applicable` row counts it and whether it is people (`DoorEstate.declared`). `refreshWorld` moves
  them by the world's draw (`refreshCounts`, keyed on the draw's identity): the groups' assets, the
  door's rows and people on a copy of the law's, and the phishing campaign size. Only an obstacle
  holding such a group (`CompiledObstacle.varies`) recomputes its shares per world, from each group's
  step weight per asset, and leaves out a group the world draws empty; the others keep their compiled
  shares. An exact number, or a range the measure already fills, is no drawn kind, so its run is the
  one the low bound always gave, bit for bit.
- **The declared workstations and servers also price two losses**, incident response (D1.1) and
  restoration (D2.1), outside the engine (`deriveSystemsInScope`, `loss-drivers`). Each driver
  prices its amount at the low bound, the middle and the high bound: minimum = amount(low) × the
  low spread ratio, likely = amount(middle), maximum = amount(high) × the high ratio, so an exact
  number gives one amount and a range widens the triplet. The middle is read on a log scale (1,001
  to 5,000 gives 2,237), a range starting at 0 linearly. An undeclared side keeps its proxy
  (headcount × 0.9 workstations, servers by size class), and the low-confidence flag stays until
  both sides are declared, however wide. The "answers changed" notice reads `lossAnswersVersion`
  (`financial-profiles/answers-version.ts`): the latest of the profile's date and the two kinds'
  rows and journal, so a change to another kind never raises it. With no financial profile nothing
  is derived.

## 4. After the door

**Three chains, all cut from the full walk.** The walk of section 1 gives the full chain; the paths
an attack takes after the door are:

| Chain | Obstacles | Door clears at | Played |
| --- | --- | --- | --- |
| long | the full walk | `D_O` | always |
| direct | the door, then the resource-touching obstacles (`resourceTouching`: gathered data then exfiltration, or the Impact tactic alone) | `D_T` | when `D_T > 0` |
| around the door | the terminal obstacle alone, its techniques restricted to the path's | none | when `g > 0` |

A direct chain equal to the full walk is not played twice: `chains.direct` is null and the long chain
takes the whole door. Each chain is folded by `foldChain` with **its own detection accumulator and
its own length for `remainingHours`**, so a shorter chain leaves each obstacle a larger share of the
attack run's time. The door is evaluated once, and every chain through it starts from the same
emission and detection, the campaign's noise. A short chain reads each obstacle's knockout uniform
by its index in the full chain, never by its position in the short one.

There is **no fall-back**: a direct path that fails does not replay the long chain, which the
mixture formula of section 1 already says. A scenario with no target has `D_T = 0`, so no direct
path: every campaign that lands takes the long chain, and the run stores `no_target`. No path
reaches the target through an account already held (a mailbox, a SaaS, a cloud console): the estate
records no entitlement on the target.

**The path around the door** is data of the outcome, `PATHS_WITHOUT_INITIAL_ACCESS` in
`attack-outcomes/data/attack-paths-data.ts`, read by the service per catalogue outcome:

| Outcome | Path | `g` | Techniques | Why |
| --- | --- | --- | --- | --- |
| Service Disruption | `outside_perimeter` | 1 | T1498, T1499 | its TEF counts DDoS incidents, which need no foothold |
| Financial Fraud & Funds Theft | `access_held_or_outside_perimeter` | 0.05 | T1657 | a floor: the cases that start from a spoofed domain or an insider |

Any other outcome sends no attack around the door. The step plays the path's techniques the
terminal tactic admits and some family the surface admits holds (`pathFamilies`), **not narrowed by
the catalogue's reach**: an outcome opens this path, no control inventory closes it. Among them the
class's held techniques play at their prevalence; when it holds none, the shares are equal. A
technique at prevalence 0 is played on no other chain: only the path around the door plays it, and
it keeps its technique what-if row and its place in the run's technique count while that path plays
it (`playedTechniques`); one no chain plays has neither. The chain has one obstacle, so no anchoring and an eviction of 0:
nothing is left to react in. At a share of 1 the door, the long and the direct chains weigh 0 and
are not folded: the evaluation keeps the door's clear and the path shares, and the fields of the
long chain alone read 0.

**One attempt, "at least one exposed asset falls", and the door's exposure rule.** The TEF counts
campaigns and a campaign has no door to retry, so this obstacle is one attempt and clears like the
door, when at least one exposed asset falls:

```
clear = 1 - PROD_g (1 - pass_g)^(assets_g x w_g)      w_g = 1 matched by the scenario, 1 / SCENARIO_GROUP_BOOST_G otherwise
```

`pass_g` is the group's choice-weighted success of one attempt, computed in log space like the door.
A population-scoped technique already reaches its whole group in one move, so it counts once for the
group (`(1 - pass)^w_g`), not once per asset again. The weight is fixed, with or without a matched
group: renormalising it on the targets present would let exposing a target lower the vulnerability. Exposing
one more group can therefore only raise the clear, and a better defended group never dilutes a weaker
one; spreading load is the `DDOS` capability's job (prevent on T1498 and T1499), never the asset
count. The detection side keeps its weighted reading. The long and direct chains keep
`1 - (1 - pass)^visits` with `visits = min(visitQuota, assets)`.

The noticed share of the impacts on this chain is the detect posture itself,
`undetected = reachedUnseen / reach x (1 - detectPosture)`, and not the post-detection term below,
whose `postDetectionRate` was fitted for a stealthy intrusion found later and caps at 66 %: with no
monitoring an outage is noticed late by its users and priced in full, with full monitoring it is
noticed.

T1498 and T1499 are floods launched at an exposed service,
so they play only on groups whose effective exposure is internet-facing, `unknown` following the
tenant setting `unknownExposureCountsAs`, which the law is always handed, by the door's own
test, `isEffectivelyExposed`; `needsExposureOutsidePerimeter` names these techniques, both in
`attack-surfaces/entry-applicability.ts`. T1657 asks nothing of the exposure, like T1566. An outcome
whose path has no eligible exposed group is unplayable and clears 0: the setting's consequence, not a
defect. The run names it among its unplayable obstacles by the path's own key (`outside_perimeter`,
`access_held_or_outside_perimeter`) when its share is above 0, never by the terminal tactic, which
the long chain's last obstacle already carries. At a share of 1 the run names no obstacle of the
long chain, which no attack plays. The setting enters the law inputs, so a change of it
reprices through the run's input fingerprint.

The later obstacles keep the per-group law. For an obstacle, a group (family, exposure, criticality
weighted by depth, an unknown exposure or criticality read as its tenant setting,
`unknownExposureCountsAs` and `unknownCriticalityCountsAs`), and a technique: success is
`clamp(capability x prevented x toolFactor, 0, coupleSuccessCap)`, raised toward
`actorExploitedCveFloor` for the share of actors citing a CVE the group carries in an applicable
finding (`findActorCveClaimsOnAssets` reads the stored state, as the door does). The floor holds in
every world, not drawn: an actor citing a CVE is known to exploit it, whatever the circulation of
the exploit the draw measures. The reference groups carry that mask and nothing else: the CVE
what-if reads the estate as its dismissal leaves it (section 5). The group's pass is the
prevalence-weighted sum, a population-scoped technique reaches its whole group with
`1 - (1 - p)^assets`, and the obstacle clears with `1 - (1 - pass)^visits`,
`visits = min(visitQuota, assets)` (the path around the door clears by its own law, above).

**The step weights are shares, and an unknown reads the setting.** Where an obstacle spreads the
attacker over groups, a group weighs `assets x exposure scalar ^ (1 - depth) x criticality scalar ^
depth` (`stepWeight`, times `resourceStepWeight` on the resource-touching steps), divided by the
sum over the groups eligible at that obstacle: `weightShare`, summing to 1. An unknown exposure
or criticality has no scalar of its own: the group is read as the exposure `unknownExposureCountsAs`
counts it as (`countedExposure`) and the criticality `unknownCriticalityCountsAs` names
(`countedCriticality`, `supporting-assets/constants.ts`, which the finding score reads too), so the
weight routes the attack and carries no caution of the engine's. Both settings are required inputs of
the law and of the run, so a caller that forgets one does not compile instead of reading a default. The shares are normalised per
obstacle, so an estate whose groups are all unknown does not move when a setting changes: only the
split between unknown and declared groups does, at the obstacles where both are eligible. With
the defaults (`internal`, `low`) an unknown group weighs as a declared internal, low-criticality
one, the reading the finding score and the door already have.

**A control acts with efficacy `θ x c` at every attempt, in every world**: its declared
strength (the anchor of its rung at its own phishing stage, section 2) and coverage, at the door as after it, with no spread drawn around them: the
run is not linear in strength (several visits, one success suffices), so a width nobody declares
would move the risk on its own. Coverage is the share of the assets the control
protects, never the chance it exists: folding it in equals an independent presence per asset, exact
for attempts on distinct assets, so a partly covered estate offers the attacker its uncovered
machines on every visit. A control is present when its coverage is positive; one declared at
coverage 0 is absent and contributes nothing. The confidence a tenant's derivation carries on the strength or the coverage is not read.

**A technique OpenAEV tested audits the declaration.** OpenAEV tests whether a host is protected
against a technique, which an absent control and a present one letting it through answer alike, so
its rate `T` estimates `D = θ x c` itself and never multiplies it. Per (control, function, technique)
of the scenario's risk scope, `control_technique_test_results` (module `control-validation`) holds
`T`, its tests and held tests (`T` = held / tests), the hosts tested `n` and the scope's hosts `N`,
and the engine reads

```
efficacy = min(D, (1 - α) x D + α x T) = D - α x max(0, D - T)       α = n / N
```

(`testedEfficacy`, `controls/capability/tested-efficacy.ts`). The declaration is the ceiling: a test
validates a promise and cannot create coverage nobody declared, so a rate at or above `D` keeps it,
and a rate below pulls it down as far as the scope was tested. `E <= D` keeps every product
divisible. The law compiles the results per control (`testedPrevent`, `testedDetect` keyed by
repertoire technique, and `testedStage` for the phishing stage, every technique of the stage the
control has an edge under and was tested on, of which the stage reads the weakest efficacy
(`lowestTestedEfficacy`): a failure on any technique the stage models is one it lets through), and
`applyControl` multiplies one efficacy per technique into every
family the control protects: the world's state still carries the declaration, so a lever, a plan move
or a basket moves `D` and the audited value follows with the same `T`, `n` and `N` (in full where
`D <= T`, for `1 - α` of its size above). An estate-grain read (`estateProduct`: the sabotage
establishment and the anchoring) reads the same per-technique value. No row, `N = 0` or a declaration
at 0 reads the declaration exactly, and a control at no coverage stays absent. The phishing
training's back-out reads the audited delivery efficacy too, so the declared simulation rate still
comes back at the declared posture.

The capability derivation job counts the rows (`controlValidation.measureTechniqueTestResults`),
daily and after each sync, outside its write transaction. The counting happens in Postgres
(`countTechniqueTests`: tests, held tests and distinct hosts per control, expectation type, technique
and grain), never on the tests loaded one by one, which on the large estate are some 400,000 rows.
`N` is every `host` asset of the scope's estate, through `estateFilter`, whatever its `last_seen_at`
and whichever sources report it, a lab VM only OpenAEV knows included. A test is one finding of a
host of that population: its technique or sub-technique, expectation type, platform type and
scenario, read at its latest verdict, so a replay of the scenario refreshes the test rather than
adding one. Every fresh test counts in `T`, none deduplicated per host: a host tested on two
sub-techniques, or by two scenarios, weighs two tests, and a failure on one is never hidden by a
success on the other. `n` counts the distinct hosts among those tests. A test is attributed by
platform type, counted for every control the platform type implements whatever the control covers,
and filed under the parent technique, the only one the engine prices, fresh within the tenant's
validation validity window (`measuredValidityDays`), with no age weight. The engine reads a row only
on a cell `testedCellReader` (`attack-run-law.ts`) names: a technique the control has an edge on for
that function, and on prevent a technique of its phishing stage it has an edge under. Elsewhere the
control declares nothing, so the row is stored for the screens and never read: the law drops it when
it compiles the control, and the rebook check below reads its rows through the same function, storing
the others unbooked.
A test on a sub-technique also counts in that sub-technique's own row, its tests and its hosts
alone, which only the screens read; a test on the parent counts in the parent's row alone. `grain`
tells the two apart (`technique`, `sub_technique`): `findAttackRunControlInputs` and the rebook
check below read `technique` rows only, and a `sub_technique` row is never booked. `E` is never stored, since `D` moves without an import. It writes the tenant level
on the open estate and every risk scope on its own estate, as a diff. Only a risk scope prices levers,
so the tenant level is stored unbooked. A scope whose technique, read at
the scope's declaration, moves by `TESTED_REBOOK_STEP` (5 points) from the result its levers were last
priced on (`booked_*`) books that control's levers again, through a `PostureCrossing` naming the scope.
The declaration is read as the engine reads it: on the shared rung scale and, on a prevent technique of
the phishing stage a control with a `PHISHING_STAGE_ANCHORS` entry acts at, on that anchor too, either
reading moving enough. The posture crossings the same job derived advance `booked_*` only in the scopes
they reprice, by `crossingRepricesScope`, the rule `getScenariosRepricedByCrossings` reads: a scope
whose own declaration pins every moved axis keeps the result its levers were priced on.
`N` takes every host whatever the technique's OS.

A technique's page shows the same figure (`controlValidation.getTechniqueTestReadings`,
`control-validation/technique-test-readings.ts`): per control and function, the stored tests, held
tests, `T`, `n` and `N` of the selected level and `testedEfficacy` computed on the server from that
level's resolved posture, beside `D` and its two factors. A reading is `covered` exactly where the
engine reads the control's family row, `engineReads` on `testedCellReader`, the one predicate the
lever booking uses too: an edge on that parent technique for the function, or on prevent a technique
of the control's phishing stage it has an edge under. A technique reads its `technique` row; a
sub-technique reads its own `sub_technique` row and an efficacy on its own `T` and `α` with the
control's `D`, the declaration alone without one, and carries its parent's efficacy
(`parentEfficacy`), which its dialog names as the one the engine prices. Both figures read θ x c, so
L2 / L2 shows about 50%, never the screens' effectiveness, which divides strength by L3's.

On prevent, a technique of a control's phishing stage that `PHISHING_STAGE_ANCHORS` anchors (SEG's
T1566 at delivery, IDP's T1078 at the credential stage, and their sub-techniques) reads `D` as the
engine prices that stage: the declared rung's anchor times the coverage, audited by the
stage's result. `stageAnchorAt` in `control-validation/service.ts` decides it from the readers
`findEngineReaders` builds, the one test `declaredReadings` reads for the rebook, and `declarationAt`
puts the anchor in the declaration's `strength`, naming the stage in `phishingStage`. The stage's
result is the first of its techniques the control was tested on (`testedStage`); an anchored stage
holds one technique, so it is that technique's own row, which `technique-test-readings.test.ts` pins.
The dialog then writes the strength as "Stage anchor for" the rung, with the stage it applies at,
and drops the shared scale's ceiling of one control, which the anchor exceeds (SEG L2 /
L2 reads 67.9%, not 50.3%). IDP's T1078 is also read on the shared scale by the per-technique products
(the door's valid accounts, the obstacles after it), which the screens do not show.

Every other control with an edge there or a stored row of that grain reads `covered: false`, its
result alone (`tested`, none for an untested edge) and no engine figure: an edge removed, an edge on
the sub-technique alone, whose parent the engine does not read for it, and a control OpenAEV tested
there through its platform type with no edge at all. The page lists them after the covered ones, an
edge it does not read, then the removed ones, then the ones only tested, by catalogue id
(`controlRowsForFunction`), with the control's own rungs in the declared posture column
(`capabilityRungs`) and "Not covered" in place of the efficacy. The card's chip counts the controls
covering the technique, edges the tenant has not removed, and the other rows it lists after them,
"3 + 2 not covered" (`controlCounts`), the plain count where it lists none. A not-covered row's dialog says the engine does not
count these tests, naming the parent it prices for a sub-technique, and leads to their evidence; with
no active edge, the row warns "Tested, not declared" and leads to where the technique is linked.

Every engine figure on both pages, their matrix cells, tooltips and the dialog is written as a whole
percent (`ENGINE_FIGURE_DECIMALS` at 0, `formatEnginePercent`), and the verdict is read at that same
precision: lowered only where `E` written is below `D` written (`isLoweredAsShown`), so a cell, a
filter's count and the dialog never disagree, and moving the constant moves all of them. T1055.012's
50.27% beside a declared 50.3% reads 50%, confirmed. The result reads "held tests of tests (`T`)" over
"on `n` of the `N` hosts". The "i" beside the figure opens its derivation
(`engine-efficacy-explanation.tsx`): the declaration, the result, then `D - T` taken off in proportion
to `alpha` (`displayedCalculation`), every figure in percent. The gap is the written `D` less the
written `T`, and the removal the written `D` less the written `E`, so both lines hold as written and
the last ends on the cell's own figure: "50% − 17% = 33%", "33% × 50% ≈ 16%", "50% − 16% = 34%". `≈`
marks only the weighting, where `gap × share` as written approximates the removal, and the
declaration's product where `strength × coverage` as written approximates it ("97% × 70% ≈ 68%"). A confirmed reading claims the tests did at least as well as the
declaration only where `T ≥ D`; below it, too small a share to move the figure, it states the tests
and the efficacy alone (`efficacyReadingOf`). A detection row reads its efficacy as the `detected`
term of the signal below, never as a chance of stopping the technique.

A control's Prevention and Detection tabs read the converse on the same path
(`controlValidation.getControlTechniqueTestReadings`): one control and function, every technique it
has an edge on and every technique it has a stored row on, each a row of its own read at its own
grain as above, sub-techniques included. A sub-technique row with no edge whose family the engine
reads is left to the family's row; a parent the engine reads with no edge, a phishing stage reached
through a sub-technique, is a covered row of its own. The three verdict filters (confirmed, lowered,
not tested, `efficacyVerdict`) partition the techniques the engine reads (`pricedTechniqueIds`), and
"Tested, not covered" holds the tested ones it does not, a removed one included, each a row with a
Link action where it has no active edge. A tested matrix cell carries the efficacy, the declared bar
and the OpenAEV bar, opening the same dialog; a tested one the engine does not read is a dashed cell
of its own with the OpenAEV bar alone, in the warning tone ("Tested, not declared") where no active
edge links it, its dialog then offering the link beside the evidence. The technique page warns the
same way and leads to the control's function tab, where the link is made. A sub-technique keeps
the neutral reading: the engine prices it on its parent, so linking it alone would not count its tests.

A threat's TTP tab reads its techniques in one call on the threat's id,
`controlValidation.getTechniquesCoverage`, which takes the catalogue techniques the threat plays as
its detail matches them, builds every technique's readings with the same
functions as the technique page and ranks each function's into the best control and the others
(`coverageOfReadings`): highest efficacy, then highest declaration, then catalogue id by code point. A control
the level does not assess, or declares at coverage 0, is absent to the engine and never the best
one. The cell, the dialog and the verdict filters are the control page's, read on that best
control; a technique none covers shows the first control tested there that the engine does not read,
as "Tested, not declared" with the link where no active edge ties it (each reading carries `linked`,
so a control linked on a sub-technique alone, which the engine prices on its parent, reads "Not
covered" with no link), else the first linked one tested there by why the engine
reads it as absent ("Declared at no coverage" or "Not assessed", no link), else "Not covered". It is a floor of the layered defense, not the product the engine multiplies.

On both pages, a reading with a result leads from its dialog to the control's Validation tab
(`evidenceLinkOf`), filtered on an ATT&CK id (`?technique=T1055`): a covered sub-technique's parent, or
the technique itself. `listControlValidationEvidence` keeps the lines filed on that id and on the ids
under it, so a parent whose result comes from its sub-techniques' tests lands on their lines. The tab
also lists the tests on a technique the control does not score but holds a stored result on, each
filed on its own technique, so a "Tested, not declared" reading has its evidence to show. The link needs the
tenant's OpenAEV connector, as the tab does; a control holding a result is one a simulation reaches.

Detection is a hazard with memory: `p = clamp(detectionScale x signal x (1 + signalGain x acc))`
with `signal = noise x detected x (1 - stealth x discretion)`, and the accumulator decays by the
class patience and gains what each obstacle emitted. The door is evaluated with the accumulator
read before it emits, so it is never amplified. A first detection leads to an eviction weighted by
the probability that the reaction time is shorter than the time left (`remainingHours`), read from
the reaction time's PERT (`inTimeByPosition`, once per chain length the law plays, each chain
reading the window against its own length), conditioned on the attack run otherwise reaching; the
share of windows exceeded a run reports is the probability of missing even the door's window, the
long chain's, the widest of every chain; an actor whose attacks all go around the door reports none.
Undetected impacts are discovered later with `1 - exp(-postDetectionRate x
detectPosture)`. Sabotage (Defense Impairment techniques, TA0112) can knock a control out per
obstacle, decided against the intact posture. One attempt plays the class's impairment techniques
by prevalence, normalised over those the obstacle's estate admits (`estateDraw`), as every obstacle
plays its own (`choiceOf`): the class impairs the way its documented actors do on average. A
technique entering the repertoire takes its share of that attempt from the others, so one that is
better contested, louder or takes down less than they do lowers the knockouts and can lower the
ALE. The ordering inside `evaluateObstacle` is the law and is documented there.

## 5. What-ifs

Every what-if is an extra evaluation of the same worlds, so each is exact against the baseline.

| What-if | How | Stored in |
| --- | --- | --- |
| technique | per attacker and repertoire technique: prevent interdiction (its let-through is 0 everywhere, the door included, and so is the phishing stage it names: T1566 delivery, T1078 credential, T1204 or T1203 payload, so a technique's row is never worth less than a perfect control on it) and detect interdiction (its detection fully covered, still through the hazard) | `crq_technique_what_if_results` |
| control levers | `strength`, `coverage`, `deploy` (the anchor step for a control declared at coverage 0 and no rung). Each is a direct evaluation of the control moved on the run's own worlds, every other control held: `coverage` at the upgraded coverage, `strength` at the declared coverage, `deploy` at the upgraded rung and coverage. The upgraded arm is the next rung's or bucket's value, as plain as the declaration. A tested technique keeps its rate and counts, so the move lands there in full up to `T`, then for `1 - α` of its size (section 4) | `crq_control_what_if_results` |
| treatment plan | the whole plan at once on the same world (not the sum of its moves), each move's target rung and coverage read at their values (`targetStateAt`) | `crq_plan_what_if_results` |
| CVE | `ALE(as declared) - ALE(this flaw forgone)`: the exploit at the door in the worlds where it is drawn, and the floor each group keeps for the CVE, in every world. A flaw never drawn and floored by no group is worth exactly 0. A CVE the door lists no opening of has the floor alone | `crq_cve_what_if_results` |

- **Every what-if inherits the mixture**, because each is an `evaluateAttackRun`: a lever moves the
  long, the direct and the around-the-door chain alike, and a forgone exploit is forgone at the
  door for the targets and the other assets alike.
- **The CVE what-if is the `cves` family of the run profile.** A full run computes it; a price run
  (`PRICE_RUN_PROFILE`) does not, so it evaluates the baseline and its memoryless replay only and
  stores no `crq_cve_what_if_results` row. A scenario with no TEF or no loss estimate runs as a full
  run whatever it was booked for. The baseline does not depend on it. The screens (the scenario's
  "Unique findings" view, the unique CVE page's "Risk scenarios" card) read it from the newest run
  holding the `cves` token, date it like the levers when that run is older than the latest
  (`getFigureFamilyDates`), and recompute it alone with `cvesRunProfile`. A CVE with no amount reads "not
  computed" when no run of the scenario computed the family, or when that run had no ALE (no TEF or no
  loss estimate: its rows hold no amount), "changed since" when that run is older than the latest and the
  CVE meets the pricing condition today (an approximation: the CVE's state at the time of the run is not
  stored; the stored openings are narrowed by the applicability rule under the tenant's unknown exposure
  setting at read time, and a dismissed finding counts for nothing), else "not priced" (`cveGainState`).
- The per-CVE what-if is **priced only for a CVE whose threat is above `SILENT_FLAW_THREAT`**: a
  CISA listing, an EPSS above the base or a cited threat. The others still count in the door. A CVE an
  admitted actor cites and the estate carries through a finding that is not dismissed is priced too
  when the door does not price it, whether it lists none of its openings (`EngineRunInputs.floorCves`)
  or lists them under `SILENT_FLAW_THREAT`, as long as the CVE has a law of its own for some actor:
  see below. The rows overlap across flaws: they are a ranking and a ceiling, never a decomposition
  of the ALE.
- **The CVE what-if forgoes the flaw wherever it acts.** It removes the exploit at the door, in the
  worlds where it is drawn, and the floor each group keeps for that CVE after the door; a floor a
  second CVE still gives stays. The floor holds in every world, so the evaluation is not bound to
  the worlds where the exploit is drawn.
- **A CVE some group loses its floor to has a law of its own, the estate as its dismissal leaves it.**
  `prepareCollapse(...).groups` holds the reference groups, built from the masks alone, identical
  whichever CVEs the run prices. For each priced or cited CVE the door does not price, whose removal
  changes the mask of some asset, `EngineRunActor.cveGroups` holds
  `prepareCollapse(...).without(cve)`: each asset that changes is regrouped by the mask it keeps,
  into the group of that mask or, with no floor left, into the plain group of its key, which is the
  partition a rerun after the dismissal builds (two plain hosts and two hosts losing their only
  floor are one group of 4, not two of 2). The run compiles a law and a `PreparedWorld` from them.
  Its what-if is evaluated once in every world on that law, forgoing the exploit at the door when
  the CVE is the door's (an unpriced door CVE included), and the series gets `baselineAle - scale x
  pricedFraction(forgone)`. The groups are the rerun's, so the figure equals the ALE drop of a rerun
  to the rounding of a different group order, about 1e-15 relative: a result within
  `CVE_WHAT_IF_EXACT_BAND` (1e-12, relative to the world's baseline) of zero is that rounding and
  the series gets exactly 0, with no second evaluation: a flaw that moves nothing prices exactly 0
  and the order of the groups leaves no residue. The one effect lost is a real one smaller than
  1e-12 of the world's ALE. The cost of an evaluation follows the group count, so the reference
  groups are never split by every cited CVE; one CVE at a time stays near the reference count. Only
  a run that prices the CVE what-ifs builds these groups (`computesCveWhatIfs`), and the input
  fingerprint leaves them out, so a price run and a full run over the same state share it.
- **A cited CVE that opens no entry at the door is priced by its floor alone.**
  `resolveAttackRunInputs` lists, sorted, the cited CVEs the door does not list whose removal changes
  the mask of some group of some actor (`floorCves`, left out of the fingerprint like the groups). They
  take the indexes after the door's in the what-if rows, and the evaluation forgoes no exploit, since
  the door lists none. Each is evaluated like a door CVE with a law of its own, in every world, and a
  floor-only CVE with no law of its own for an actor does nothing for that actor. Its row reads
  `ALE - ALE(same run with that CVE's floor gone)`, and dismissing its findings drops the ALE by it.
- **A cited CVE the door lists but does not price gets a row when it has a law of its own.** A door
  CVE at or under `SILENT_FLAW_THREAT` that an admitted actor cites, and whose removal changes the
  mask of some asset for some actor, is priced for the what-if like a priced door CVE: evaluated on
  its own law in every world, forgoing its exploit at the door too. The door itself still prices
  nothing new, since `priced` gates only the what-if. An unpriced door CVE with no law of its own for
  any actor keeps no row.
- **A door CVE with no law of its own is evaluated on the reference law**, only in the worlds where its
  exploit is drawn and the actor's door plays a technique it opens. Elsewhere forgoing it moves no
  pass the door weighs and no floor, so the evaluation would equal the baseline and add exactly 0; the
  skip is precomputed per actor and changes no result.
- **Cost.** One baseline and one memoryless evaluation per attacker and world, two per repertoire
  technique, one per lever of a reaching control (up to three, each differenced against the
  baseline), one per plan, one per priced CVE and world where the exploit is drawn and the actor's door can play it,
  and, for each CVE with a law of its own, one per world. The door is
  computed once per attacker and world and reused by every evaluation that leaves its let-through
  and drawn exploits unchanged (a memo on the `PreparedWorld` holding the
  target and the other pass, exact by input equality); a CVE what-if recomputes it only where it
  removes a drawn exploit, so in the worlds where the exploit is not drawn the memo is reused,
  forgoing an undrawn exploit leaving the door unchanged. A flaw's own world shares the memo of the
  actor's baseline world: its law is compiled from the same inputs, groups apart, so only the family
  indexes the let-through is read through can differ, and `prepareWorld` checks them once. It adds
  no door pass there either. A door CVE on the reference law whose exploit is drawn is first read
  against the memo, which the baseline wrote: one door pass on the memo's let-through with the
  exploit forgone (`forgoneExploitLeavesDoor`). The forgone exploit is read by the door alone, so
  when every pass comes back bit for bit the evaluation would answer the baseline, and it is skipped
  with a saving of exactly 0. On the large estate's closed scope that is 39,462 of the 41,727 such
  evaluations, about 16 % of a full run. The baseline also records its door head and each
  obstacle's outcome on the long and the direct chain (`evaluateBaseline`), and a technique
  interdiction or a control lever resumes after the obstacles it cannot change (`evaluateWhatIf`, at
  the obstacle `resumePointsOf` names): an interdiction at the first obstacle playing its technique,
  a lever at the first one playing a technique its control prevents or detects, and none for what
  the door or the anchoring reads (a door technique, a support technique, a prevent interdiction
  naming a phishing stage, a control covering any of them or acting at a stage). The obstacles
  before are read back with the door and the fold replays their outcomes, so the accumulator it
  resumes with is the one a whole evaluation reaches, bit for bit; on the large estate's closed
  scope this skips about a fifth of the evaluation time, nearly all of it on the interdictions.
  The resumption is read off the world, never passed in: the world knows whether its controls sit
  at the draw, have one control moved by `refreshWorld` or one moved in place by `setControlState`,
  and only the first two resume, an interdiction on the first and a lever on the second.
  What costs on a large estate is the control
  lever and technique what-ifs over the obstacles after the door, against the job's time
  budget: re-measure run time on a large estate after any change that makes the door or an
  evaluation more expensive. The direct chain is folded only when a target fell and the
  around-the-door chain only when `g > 0`, the long and the direct chains only when `g < 1`, so a
  scenario with neither costs and prices exactly as the long chain alone.
- The loop yields to the event loop every `ENGINE_SLICE_MS`, inside a world as much as
  between two, and reads the abort signal there: the job shares its process with the HTTP server and
  its lease renewal. Do not turn it into a synchronous loop.

## 6. Invariants a change must keep

1. **TEF counts campaigns and exposure counts once, in the entry conditions.** The door is the
   chance a campaign gets in; the TEF carries no exposure term (the catalogue's rows have no
   exposure dimension, and none is to be added). A second exposure term double counts.
2. **The engine never reads a score that already carries controls**: no `finding_scores`,
   `asset_technique_scores`, nor `finding-score` import in `crq-indicators`. The guard test enforces
   it; threat and openings arrive through `entry_openings` only.
3. **One applicability rule** (`entryTechniqueApplies`) for the TTP tab, `entry_openings` and the
   door. One definition of "listed" (`isCisaListed`) and one threat (`threatFactor`) for the score
   and the door.
4. **Draws are keyed by id** (section 1). No shared stream, no iteration-order dependence; every
   collection reaching a float reduction is canonicalised in `resolveAttackRunInputs` and
   `buildDoorEstate`.
5. **The door prices what the estate exposes**: no capability, tooling, visits or CVE floor in it.
   Capability enters through the floor only, which the calibration guards.
6. **`visitQuota` and `populationDetectionCap` stay apart**, so refitting the visits does not move
   the door's detection.
7. **Evaluations are exact differences on shared worlds.** A what-if rebuilds the world from the
   draw (`refreshWorld`) rather than unwinding the previous state, or a flaw that moves nothing
   reads a rounding error instead of exactly 0. An obstacle undoes its knockouts by copying the
   products back, never by multiplying the knocked controls back in, so an evaluation leaves the
   world at the bits it found and an interdiction needs no rebuild.
   A world's draw is never written in place, since the door memo and the baseline record are keyed
   on its identity.
8. **A change that moves a calibrated behaviour says so in its pull request** (section 7): the
   calibration is replayed by the maintainers with their own tooling, so the pull request names what
   it moves, and measures run time on a large estate.
9. **A short chain reads its knockout draws by the full-chain index** of each obstacle (section 4).
   Reading them by position keys a draw to another obstacle and breaks the shared worlds.
10. **With no reachable target and no share around the door, the evaluation equals the long chain
    bit for bit**: `mixAttackPaths` returns the long partition as is, and the long chain takes the
    whole door.
11. **T1566 is carried by people, never by an asset's flaws.** `applicable`, `targetApplicable` and
    `DoorAsset.openings` hold no T1566, and a flaw reaches phishing only through the person whose device
    carries it, bounded by `kappa`: a flaw on a device with no user is worth exactly 0, the CVE what-if
    included.
12. **A control acts once along a phishing branch**, at the first of delivery, credential and payload
    that holds one of its edges: a control with edges on T1566 and T1204 is counted at delivery only,
    and applying then removing it returns the stage let-through to its starting bits, knockouts included.
13. **A resumed what-if reads back only what none of its inputs reach.** `resumePointsOf` holds what
    the door, the anchoring and each obstacle read of a technique and of a control's state. A new read
    of either in `evaluateObstacle`, `headOf` or what they call is added to it in the same change, or
    a resumed what-if answers from a prefix it moved; `attack-run-prefix-reuse.test.ts` compares
    every resumed evaluation with a whole one, bit for bit, on every fixture, and checks that the
    obstacles before the resumption are read back rather than evaluated.

## 7. Calibration

The shipped constants are OpenCRQ's own calibration. A surface that displays a figure names the
vintage (`ATTACK_RUN_CALIBRATION_VINTAGE`, recorded on each run), `replay-2026-10-12`. The
maintainers replay the calibration with their own tooling, outside this repository: the product
ships the constants it landed and the vintage it records, and a change moves neither by itself.

**Coverage.** The detection scale was fitted while coverage was still drawn as a per-world presence,
and it is not refitted since coverage is folded in per attempt, until the engine is calibrated on
observed data. Every control is read at its declared strength and the reaction time as a probability,
as the engine does: the constants are checked at the point production runs at.

**The shipped constants** and their nature. **Swept** means the calibration measured a window rather
than a point, **fitted** that it landed a value against the engine's closed forms, **judgment** that
OpenCRQ's calibration chose it and a security officer is entitled to hear it named as an argument,
**read** that a shipped surface owns it.

| Constant | Value | Nature |
| --- | --- | --- |
| `LAYER_BLOCK_RATE` (`controls/capability/constants.ts`) | 0.47 | Swept: the sweep's one knob. A rung is that many layers of the same control, so `L1/L2/L3 = 1 - (1 - rate)^1..3`. It also sets what the **finding score and the controls screen** read for a rung: moving it moves both, so measure how many findings change band |
| `visitQuota` | 16 | Swept, with no observed anchor: below the window the weakest classes are stopped on an estate that declares nothing, above it the stronger classes overrun their ceilings |
| `populationDetectionCap` | 7 | Judgment; kept apart from `visitQuota` |
| `unknownFlawFloorScale` | 0.04 | Judgment: the top of NIST's very low band, scaled as FAIR reads threat capability |
| `detectionScale` | 0.0403 | Fitted, at the shipped gain and rate |
| `signalGain` | 0.3 | Judgment: gain and scale are not separately identifiable, so the gain is decided and the scale fitted at it; each run reports its ALE with the accumulator off |
| `execFloor` | 0.7 | Judgment: the share of an intrusion that runs without tooling its attacker had to establish, since many intrusions use no malware at all |
| `postDetectionRate` | 1.071 | Fitted |
| `coupleSuccessCap`, `actorExploitedCveFloor` | 0.98, 0.9 | Read: arithmetic guards (`engine-constants.ts`) |
| class capabilities (`ACTOR_CLASS_PRESETS`) | 0.3 / 0.3 / 0.5 / 0.55 / 0.9 | Not moved by the calibration; the unknown flaw floor follows them |
| `ATTACK_RUN_DAYS_BY_CLASS` | 1 / 5 / 2 / 14 / 90 days | Judgment on every row |
| `RESPONSE_COST_FRACTION`, `DETECTED_MAGNITUDE_FACTOR` | 0.15, 0.75 | Judgment, not fitted; the prevent-versus-detect exchange rate, so they belong in a sensitivity run |
| `PHISHING_CONSTANTS.defaultSusceptibility` (`DEFAULT_PHISHING_SUSCEPTIBILITY`, `attack-surfaces/phishing.ts`, shared with the TTP cell) | 0.07 | Judgment, read as untrained: a middle value across click rates, whose lures move it from 2 % to 22 % |
| `PHISHING_CONSTANTS.credentialShare` | 0.7 | Judgment: the share of phishing that harvests credentials, the rest delivering a payload |
| `PHISHING_CONSTANTS.clientExploitShare` (κ) | 0.2 | Judgment: the share of the payload branch that needs a client-side flaw on the person's device, so it bounds what such flaws add to phishing |
| `PHISHING_STAGE_ANCHORS` | SEG at delivery L1 0.89 / L2 0.97 / L3 0.98; IDP at the credential stage L1 0.76 / L2 0.90 / L3 0.99 | Judgment per rung, not fitted: replace the rung scale at that stage only, uncapped by `ATTACK_RUN_THETA_CAP` |
| `PHISHING_CAMPAIGN_BY_CLASS` | state, default, hacktivist 10 recipients; ransomware 30 % of the workforce, at least 10; opportunistic 1 %, at least 1 | Judgment, weak on the shares; the hacktivist row reads the state values as a stated assumption |

**The rule: a change that moves a calibrated behaviour says so in its pull request, and does not
refit.** That means any change to the door, the obstacle law, detection, the walk or noise tables,
the repertoire resolution, the class presets, how a control's declaration reaches its efficacy, or
`LAYER_BLOCK_RATE`. The maintainers replay the calibration with their own tooling and decide whether
a constant moves. A refit lands the reference posture back in its band by construction, so it cannot
arbitrate between two readings of a law, and a figure that moves is read and explained, never
loosened. The change also measures run time on a large estate before review. A real calibration, on
observed estates, postures and incident outcomes, is still to come.

## 8. Known limits

- **`kappa` has no source.** The 0.2 share of the payload branch that needs a client-side exploit is
  a judgment; it only bounds what a person's device flaws add to phishing, and no published split
  of payloads says more.
- **Blocking client-side exploitation closes the whole payload branch.** A control whose only payload
  edge is T1203, or an interdiction of T1203, acts on every payload a phishing email delivers, although
  only `kappa` of them needs a client-side flaw.
- **The filter is the declared let-through, with no novel-campaign draw.** Email filtering is read as
  the controls' declared posture, shared by the whole campaign: a campaign the filter has never seen
  is not drawn, because no source gives its share and a per-world draw would widen the spread
  without moving the mean.
- **The phishing entry grows with the campaign size.** A campaign sends `n` emails to independent
  recipients, so the entry is "at least one of n" and tends to 1 as `n` grows. The fixed ten recipients of
  the targeted classes do not grow with the workforce, a share does (ransomware 30 %, opportunistic 1 %), and
  no ceiling is set on the recipients. With the flaws unchanged and only the people more numerous,
  the ransomware entry saturates within a few hundred people and the opportunistic one keeps growing,
  while the fixed-ten classes stay where they are. Controls then bite little: at a few thousand people
  even multi-factor at L3 leaves about half of the ransomware entry open.
- **A person with several devices counts for the most favourable one**, the device with the highest chance
  of acting, where the real campaign lands on whichever the person opens it on; this slightly favours the
  attacker.
- **The target and other split by people is exact only when both groups share a mean `q`.** The
  emails go to each group in proportion to its people and land at the group's mean, so the two recompose
  the whole campaign only then; with no target the split is exact to the bit.
- **An estate with no user account has no phishing.** No account known, no phishing target known: a
  tenant whose directory is not synced prices no T1566, however many workstations it holds, and its
  figures read lower than its workforce warrants until its people are known.
- **The declared rate lags when the training changed after the measurement.** The rate is read as
  measured under the awareness declared now; a rate measured under an older posture is backed out of
  the wrong training.
- **Detection at the door counts the campaign's recipients**, fewer than the assets the group holds,
  and fewer campaigns clear the door: the detection scale fitted before this reading is not refitted
  here.
- **Valid accounts sit at the floor.** T1078 is opened by the unknown flaw floor alone: no finding
  sits on an identity, and the identity's own evidence (Entra risk, leaked credentials, MFA at
  sign-in, legacy authentication, guest, directory flags) is unread. A default or hard-coded
  credential (CWE-798) on an exposed asset is to open it there. Its share of the successful
  entries stays low, which is why T1190's share reads high beside phishing's.
- **Detection at the door reads the campaign's noise**, the per-group reading of every family of the
  law, not the assets that fell, and both paths through the door share it.
  Switching it off entirely raises vulnerability by under 1 % on a two-asset scope and by 3.5 to 5 %
  on a 2,600-asset one, the door, the blocked share and the path shares unchanged, which bounds what reading
  it on the fallen assets alone could take away.
- **No path goes through an account already held.** Reading the data or taking the control plane
  from an account needs that account's entitlements on a target, which the estate does not record.
- **Access already held has a share of 0 for the data and destruction outcomes**: no source gives it
  per outcome, and an employee is not an external campaign.
- **Service Disruption prices denial of service alone, on exposed groups.** Its TEF counts DDoS
  incidents, so all its attacks go around the door on T1498 and T1499, one attempt each and only on
  internet-facing groups (unknown ones by the tenant setting, `internal` by default): an estate that
  declares nothing exposed prices it at 0. Its intrusion-led disruptions have no frequency in the
  catalogue and weigh 0.
- **Host and cloud detect controls read nothing on the exposed web application and AI target families.** The
  protection map gives EDR and CNAPP neither family, and the groups carry no hosting dimension, so a
  denial of service on such an asset is read as unmonitored by whatever watches the hosts behind it:
  only a SIEM or a SOC watches a web application, and only the AI gateway an AI target.
- **A held machine reads an independent presence.** The steps played on a machine the attacker
  already holds (credentials, discovery) fold the coverage in like any other, where the real
  presence is shared with the step that took the machine, and biased toward the uncovered machine
  that let the attacker in. This slightly favours the defender.
- **A knockout lifts a control on the whole estate.** It is decided once per obstacle, on the
  families the obstacle spans, not the ones the control protects, so a Defense Impairment success
  on one family takes the control down on all of them: T1685 on a workstation lifts FIM, CWPP and
  DAM on the servers and workloads too, as it does SIEM. This favours the attacker, and the
  impairment relation cannot narrow it.
- **The visit count is fixed** (`visitQuota`), a calibration constant with no observed anchor. An
  attacker who retries until success, detection or abandonment is to replace it, measured against
  the calibration.
- **Only the baseline follows the estate.** The price pass (`crq-price-recompute`, an observed
  job) runs `PRICE_RUN_PROFILE` over every scenario when a table the run reads changes, and writes
  a run only for a scenario whose inputs moved: it compares a digest of the baseline's inputs, the
  app version included, with the latest run's `inputs_fingerprint`. The digest leaves out
  what only some profiles compute (what-ifs, plans, budget review baskets), so the pass that
  follows a full simulation writes nothing; a scenario with no TEF or loss estimate runs in full
  and keeps its plans in it. The actors' activity decays against the start of the UTC
  day, in the stored attacker mixture (section 1), so the digest holds until the mixture job
  rewrites it, and the pass, which reads that table, reprices the scenarios of a moved pair. A
  moved finding, exposure, identity state, unknown exposure setting or stored threat reaches the
  ALE once the recompute has rewritten `entry_openings`. The what-ifs, the CVE's among them, still
  quote the last full run until one is asked, and EPSS drifts daily, so a threshold on it is part
  of the design.
- **The connector's exploit-available flag is read nowhere.** Its findings fall to the base threat
  until the flag moves to its own column and its floor is decided; only `isCisaListed` and
  `cisaListedSql` change then.
- **What nobody declared widens nothing.** An estate where nearly every asset has an unknown
  exposure or criticality reads the tenant setting for all of them at once, in every world, so its
  ALE spread is as narrow as a fully classified estate's.

Two more: a finding with no usable CVSS vector opens nothing at the door; and
the door saturates under "at least one" (section 2).

## 9. Key files

| Concern | File (under `module/src/modules/`) |
| --- | --- |
| entry point, run storage, what-if storage | `crq-indicators/service.ts` (`runAttackRunEngine`, `storeEngineRun`) |
| tenant rows to law inputs, the one attacker per class | `crq-indicators/attack-run-inputs.ts` |
| an actor's techniques, revoked ids read as their successors | `threat-analyses/played-techniques.ts` (`playedTechniquesOf`), on `mitre-attack/technique-successors.ts` (`techniqueSuccessorsOf`) |
| the actors an outcome selects, with their weight | `threat-analyses/repository.ts` (`findSelectedThreats`), `threat-analyses/outcome-counter/outcome-weight.ts` (`effectiveOutcomeWeight`, `computeTau`) |
| door estate builder | `crq-indicators/attack-run-door-estate.ts` |
| the declared estate, its kinds, the virtual assets completing the measured estate, the per-world draw | `declared-estate/constants.ts` (`DECLARED_ESTATE_KINDS`, `declaredEstateKindOf`), `crq-indicators/declared-estate-completion.ts` (`completeDeclaredEstate`), `crq-indicators/engine/attack-run-worlds.ts` (`declaredVirtualCount`) |
| door reads | `crq-indicators/repository.ts` (`findDoorEstateCounts`, `findEntryOpenings`, `findPrimaryUsers`) |
| enabled identities, shared by the counts, the pairs and the finding score | `supporting-assets/enabled-identities.ts` (`enabledIdentitiesOf`) |
| the door's law | `crq-indicators/engine/attack-run-door.ts` (`doorPassByTechnique`, `unknownFlawFloor`) |
| the phishing law, on people | `crq-indicators/engine/attack-run-phishing.ts` (`phishingPass`, `phishingSusceptibility`), read by `doorClearOf`; stages and compiled form in `attack-run-law.ts` (`CompiledPhishing`) |
| compiled law, door techniques | `crq-indicators/engine/attack-run-law.ts` (`compileAttackRunLaw`, `isDoorTechnique`) |
| one world evaluated | `crq-indicators/engine/attack-run-evaluation.ts` (`evaluateAttackRun`, `foldChain`, `doorClearOf`; `evaluateBaseline`, `evaluateWhatIf`, `resumePointsOf` for the resumed what-ifs) |
| the admitted actors of a pair, stored; written by the job `attack-outcome-mixture-recompute` (`back/src/features/attack-outcome-mixture/`) | `attack-outcomes/schema.ts` (`attackOutcomeMixtures`, `attackOutcomeMixtureGroups`), `attack-outcomes/stored-mixture.ts` (`mixtureToRows`, `mixtureFromRows`, `linksOfMixture`, `mixtureClockOf`), `attack-outcomes/service.ts` (`recomputeAttackOutcomeMixtures`, `getMitreTechniquesForOutcome`) |
| the mixture of the paths | `crq-indicators/engine/attack-paths-mix.ts` (`mixAttackPaths`) |
| the path around the door, as data | `attack-outcomes/data/attack-paths-data.ts` (`PATHS_WITHOUT_INITIAL_ACCESS`) |
| worlds, keyed draws | `crq-indicators/engine/attack-run-worlds.ts` |
| the run, what-ifs | `crq-indicators/engine/engine-run.ts` |
| walk, obstacles | `crq-indicators/engine/attack-walk.ts`, `attack-run-obstacles.ts` |
| constants | `crq-indicators/engine/attack-run-constants.ts`, `engine-constants.ts`, `controls/capability/constants.ts` |
| applicability | `attack-surfaces/entry-applicability.ts` |
| phishing technique and default susceptibility, shared by the engine and the TTP cell | `attack-surfaces/phishing.ts` |
| openings table and its writer | `entry-openings/schema.ts`, `finding-score/service.ts` (`entryOpeningsOf`), `finding-score/repository.ts` (`upsertEntryOpeningBatch`) |
| TTP cells | `finding-score/technique-scores.ts` (`findingOpenings`, `susceptibilityCell`) |
| threat, listing | `finding-score/engine.ts` (`threatFactor`), `finding-score/constants.ts`, `cve/cisa-listing.ts`, `cve/silent-flaw-threat.ts` |
| CVSS access and entry impact | `cve/cvss-vector.ts` (`entryImpact`) |
| topology rule (which techniques a flaw claims) | `technique-mapping/topology-rule.ts` |
| OpenAEV's results per technique, the audit, the counting | `controls/capability/tested-efficacy.ts` (`testedEfficacy`), `control-validation/technique-test-results.ts` (`techniqueTestResultsOf`), `control-validation/repository.ts` (`countTechniqueTests`, `countScopeHosts`), `control-validation/service.ts` (`measureTechniqueTestResults`, `getTechniqueTestReadings`, `getControlTechniqueTestReadings`), `control-validation/technique-test-readings.ts` (`readTechniqueTests`, `readUncoveredTests`) |
| step weights | `crq-indicators/engine/asset-scalars.ts` (`stepWeight`), read by `compileAttackRunLaw` with `countedExposure` (`attack-surfaces/entry-applicability.ts`) and `countedCriticality` (`supporting-assets/constants.ts`) |
| tenant settings | `crq-indicator-settings/` (`unknownExposureCountsAs`, `unknownCriticalityCountsAs`, `phishingFailureRate`, `phishingFailureMeasuredOn`) |
| the paths' tests | `crq-indicators/engine/attack-run-paths.test.ts` |
| isolation guard | `crq-indicators/finding-score-isolation.test.ts` |
