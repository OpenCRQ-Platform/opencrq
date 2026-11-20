import { newError } from '@app/utils';
import type { OutcomeCounter } from '../../modules/threat-analyses/outcome-counter/outcome-counter';
import { OUTCOME_COUNTER_VERSION } from '../../modules/threat-analyses/outcome-counter/outcome-counter';

/**
 * The outcome counter's percentages for each demo threat, by STIX id, in the counter's outcome order.
 * The platform seed reads them instead of loading the model, about 50 MB of heap for seventeen threats.
 * `acme-threat-outcome-probabilities.test.ts` rescores the demo bundle with the
 * shipped model and fails until these are regenerated for a new model or a changed demo threat.
 */
export const ACME_THREAT_OUTCOME_PROBABILITIES: Readonly<Record<string, ReadonlyArray<number>>> = {
  'intrusion-set--seed-salt-typhoon': [
    0.021720907884195104,
    0.013469765736204136,
    0.028863601569274113,
    0.23719925152157212,
    0.9708481199820057,
    0.0010860515230959869,
    0.0039751303399373165,
  ],
  'intrusion-set--seed-scattered-spider': [
    0.9203691780781534,
    0.9998754146214439,
    0.3503952446468356,
    0.8938645961290108,
    0.00028474563160464216,
    0.0006464117578692057,
    0.004263677503554981,
  ],
  'intrusion-set--seed-alphv-blackcat': [
    0.9994842201752712,
    0.004827528055380803,
    0.0030644539227544605,
    0.026298993405729647,
    0.00028474563160464216,
    0.028944243472961307,
    0.003167839272375585,
  ],
  'intrusion-set--seed-lockbit': [
    0.9977517603242089,
    0.45926910839522084,
    0.025436823075976302,
    0.18141066932932529,
    0.0007318442990496396,
    0.005382087850084949,
    0.011508106597324229,
  ],
  'intrusion-set--seed-volt-typhoon': [
    0.016983836767296104,
    0.0004216664145791814,
    0.04009960926972659,
    0.016189071331207585,
    0.9678017766443716,
    0.09072859100136423,
    0.02320500650285247,
  ],
  'intrusion-set--seed-apt28': [
    0.006791621460322577,
    0.00005214443887239384,
    0.013339936701297546,
    0.4153817879994389,
    0.9956328878153733,
    0.034094568881408056,
    0.011935082774983332,
  ],
  'intrusion-set--seed-apt29': [
    0.00479126258287253,
    0.00005214443887239384,
    0.003133178849526563,
    0.023854048677823984,
    0.9993008260848203,
    0.0007734940822013318,
    0.003341273011572054,
  ],
  'intrusion-set--seed-fin7': [
    0.9917834250166477,
    0.8600584708011271,
    0.6686024728885727,
    0.9023590465011022,
    0.00028474563160464216,
    0.000259329997821023,
    0.0038835209113845383,
  ],
  'intrusion-set--seed-lazarus': [
    0.7882037451826198,
    0.01729072042866585,
    0.032789614621415504,
    0.9003954866177637,
    0.0709568976634756,
    0.034606969457452494,
    0.2228334036982675,
  ],
  'intrusion-set--seed-sandworm': [
    0.206259634623881,
    0.03797979076425026,
    0.009479435562829657,
    0.012436960369771854,
    0.07996626619718215,
    0.9995121470437973,
    0.5151378842219326,
  ],
  'intrusion-set--seed-apt41': [
    0.007457923132712384,
    0.001512782980411605,
    0.14174355433142158,
    0.9347791211467691,
    0.8624614225988058,
    0.000259329997821023,
    0.004769347612030184,
  ],
  'intrusion-set--seed-phantom-locker': [
    0.9645471301551288,
    0.3967130619334863,
    0.11528812351647946,
    0.0857644220261745,
    0.06137382516151364,
    0.054304484292676015,
    0.02621383714443522,
  ],
  'intrusion-set--seed-hollow-tide': [
    0.9862549103817502,
    0.2503873909698411,
    0.13683129329605967,
    0.09405826496182376,
    0.022218147370754518,
    0.08735413796369643,
    0.032211367499968155,
  ],
  'threat-actor--seed-kraken-syndicate': [
    0.2942236470305257,
    0.002354781327887283,
    0.35970291774994745,
    0.9283214515658456,
    0.0072332271285955934,
    0.23744947752697948,
    0.02170252471115275,
  ],
  'intrusion-set--seed-unc-drift': [
    0.31693224477133336,
    0.12854543155830556,
    0.08172502316955413,
    0.05840025293817434,
    0.1786428079012126,
    0.057864528084475016,
    0.01689386336730013,
  ],
  'campaign--seed-operation-ledger-lure': [
    0.27552396836221704,
    0.000291484381033787,
    0.18366565288948233,
    0.789325070928143,
    0.10916524102476133,
    0.020482600457593862,
    0.013227473577090703,
  ],
  'campaign--seed-operation-gilded-checkout': [
    0.40026749663473515,
    0.00047524904781367616,
    0.1859092948661998,
    0.3946095972664628,
    0.06428020004342613,
    0.0025968819441725766,
    0.005014892168059203,
  ],
};

/** A counter answering the demo threats from `ACME_THREAT_OUTCOME_PROBABILITIES`, and refusing any other. */
export const acmeSeedOutcomeCounter: OutcomeCounter = {
  version: OUTCOME_COUNTER_VERSION,
  predict: (record) => {
    const probabilities = record.id === null ? undefined : ACME_THREAT_OUTCOME_PROBABILITIES[record.id];
    if (probabilities === undefined) {
      throw newError('The demo seed has no stored outcome probabilities for this threat', { stixId: record.id });
    }
    return [...probabilities];
  },
};
