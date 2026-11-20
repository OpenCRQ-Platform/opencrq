import fs from 'node:fs';
import path from 'node:path';
import { newError } from '@app/utils';
import type { ThreatEntityType } from '../entity-types';
import {
  AttackOutcome_DataBreachResale,
  AttackOutcome_DataTheftExtortion,
  AttackOutcome_DestructiveAttack,
  AttackOutcome_Espionage,
  AttackOutcome_FinancialFraudFundsTheft,
  AttackOutcome_Ransomware,
  AttackOutcome_ServiceDisruption,
} from '../../attack-outcomes/data/attack-outcomes-ids';
import { OUTCOME_COUNTER_MODEL_DIR } from './model-files';

export const OUTCOME_COUNTER_VERSION = '2026.11.1';

const COUNTER_OUTCOMES: ReadonlyArray<{ name: string, attackOutcomeId: string }> = [
  { name: 'Ransomware', attackOutcomeId: AttackOutcome_Ransomware },
  { name: 'Data Theft Extortion', attackOutcomeId: AttackOutcome_DataTheftExtortion },
  { name: 'Data Breach & Resale', attackOutcomeId: AttackOutcome_DataBreachResale },
  { name: 'Financial Fraud & Funds Theft', attackOutcomeId: AttackOutcome_FinancialFraudFundsTheft },
  { name: 'Espionage', attackOutcomeId: AttackOutcome_Espionage },
  { name: 'Service Disruption', attackOutcomeId: AttackOutcome_ServiceDisruption },
  { name: 'Destructive Attack', attackOutcomeId: AttackOutcome_DestructiveAttack },
];

/** The counter's outcomes, in its own order, as catalogue attack-outcome ids. */
export const OUTCOME_COUNTER_OUTCOMES: ReadonlyArray<string> = COUNTER_OUTCOMES.map((outcome) => outcome.attackOutcomeId);

export interface OutcomeCounterRecord {
  id: string | null,
  type: ThreatEntityType,
  name: string,
  aliases: Array<string>,
  title: string | null,
  description: string,
  motivations: Array<string>,
  goals: Array<string>,
  malware: Array<{ name: string, types: Array<string> }>,
  labels: Array<string>,
  sectors: Array<string>,
  techniques: Array<string>,
  parentCount: number,
  /**
   * `evidenceSufficient` is the parent's own minimum-evidence flag. The counter never reads it: it
   * only decides whether the parent counts as the child's evidence.
   */
  parents: Array<{ inferred: boolean, probabilities: ReadonlyArray<number> | null, evidenceSufficient: boolean }>,
  reports: Array<{ title: string, summary: string, labels: Array<string> }>,
}

export interface OutcomeCounter {
  version: string,
  predict: (record: OutcomeCounterRecord) => Array<number>,
}

interface LogisticModel {
  outcomes: Array<string>,
  tfidf: { vocabulary: Array<string>, idf: Array<number> },
  chars?: { vocabulary: Array<string>, idf: Array<number>, ngrams: [number, number] },
  fields: Array<string>,
  coefficients?: Array<Array<number>>,
  intercepts: Array<number>,
  definingTechniques: Array<string>,
  features?: { malwareWords?: boolean, nameSplit?: boolean, reportLabelText?: boolean, malwareTags?: Array<string> },
}

interface Calibration {
  logistic: Array<[number, number]>,
  finetuned: unknown,
  weights: { logistic: number, finetuned: number },
}

interface KnownGroup {
  id: string,
  keys: Array<string>,
  p: Array<number>,
}

interface KnownParent {
  inferred: boolean,
  probabilities: ReadonlyArray<number>,
}

type RecordParent = OutcomeCounterRecord['parents'][number];

const hasProbabilities = (parent: RecordParent): parent is RecordParent & KnownParent => Boolean(parent.probabilities);

const codePoints = (text: string, limit: number): string => [...text].slice(0, limit).join('');
const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '-');
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));
const logit = (p: number): number => {
  const q = Math.min(1 - 1e-4, Math.max(1e-4, p));
  return Math.log(q / (1 - q));
};

// The model's word tokens, on lowercased text: maximal runs of 2+ word characters.
const tokenize = (text: string): Array<string> => text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? [];

// The separators the model splits words on, which differ from JavaScript's \s (0x1c-0x1f and 0x85 split, 0xfeff does not).
const MODEL_WHITESPACE_CODES = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  ...Array.from({ length: 11 }, (_, index) => 0x2000 + index), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
const MODEL_WHITESPACE = new RegExp(`[${String.fromCodePoint(...MODEL_WHITESPACE_CODES)}]+`);

// The model's character n-grams: each whitespace-separated word padded with one space on both sides, its
// n-grams for every n, a word shorter than n counted once and ending the loop over n.
const charNgrams = (text: string, [minN, maxN]: [number, number]): Array<string> => {
  const grams: Array<string> = [];
  for (const word of text.toLowerCase().split(MODEL_WHITESPACE)) {
    if (!word) {
      continue;
    }
    const padded = ` ${word} `;
    const points = Array.from(padded);
    // The model slices by code point: string slicing matches it only when no character is a surrogate pair.
    const slice = points.length === padded.length
      ? (from: number, to: number) => padded.slice(from, to)
      : (from: number, to: number) => points.slice(from, to).join('');
    for (let n = minN; n <= maxN; n++) {
      let offset = 0;
      grams.push(slice(offset, offset + n));
      while (offset + n < points.length) {
        offset += 1;
        grams.push(slice(offset, offset + n));
      }
      if (offset === 0) {
        break;
      }
    }
  }
  return grams;
};

// The model sorts by code point, which differs from JavaScript's default UTF-16 order on astral characters.
const byCodePoint = (a: string, b: string): number => {
  const left = Array.from(a, (c) => c.codePointAt(0)!);
  const right = Array.from(b, (c) => c.codePointAt(0)!);
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return left.length - right.length;
};

const reportLabelText = (record: OutcomeCounterRecord): string => {
  const labels = new Set(record.reports.slice(0, 8).flatMap((report) => report.labels.map(normalize)));
  return [...labels]
    .filter((label) => !label.startsWith('source:') && !label.startsWith('pir:'))
    .map((label) => label.replace(/-/g, ' '))
    .sort(byCodePoint)
    .join(' ');
};

const logisticText = (record: OutcomeCounterRecord, withReportLabels: boolean): string => [
  record.title ?? '',
  codePoints(record.description, 3000),
  record.motivations.join(' '),
  record.goals.join(' '),
  codePoints(record.reports.slice(0, 8).map((report) => `${report.title}. ${report.summary}`).join(' '), 4000),
  withReportLabels ? reportLabelText(record) : '',
].filter(Boolean).join(' ');

const compact = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
// The model's word boundary is Unicode-aware: a word character is a letter, a digit or "_".
const NAME_SEPARATORS = /,|;|\/|&|\+|(?<![\p{L}\p{N}_])and(?![\p{L}\p{N}_])|\(|\)/u;
const GENERIC_SUFFIX = /(\s+(group|ransomware|gang|team|operators|actors?|apt))+$/i;
const NAME_STOP = new Set(['and', 'the']);

const trimChars = (value: string, chars: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start])) {
    start++;
  }
  while (end > start && chars.includes(value[end - 1])) {
    end--;
  }
  return value.slice(start, end);
};

const nameParts = (name: string): Array<string> => {
  const parts: Array<string> = [];
  for (const raw of name.split(NAME_SEPARATORS)) {
    const piece = trimChars(raw, ' -_.');
    if (compact(piece).length < 3) {
      continue;
    }
    parts.push(compact(piece));
    const stripped = piece.replace(GENERIC_SUFFIX, '');
    if (stripped !== piece && compact(stripped).length >= 3) {
      parts.push(compact(stripped));
    }
  }
  return parts;
};

const malwareWords = (name: string): Set<string> =>
  new Set(name.replace(/\s+-\s+S\d{4}$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z]{3,}/g) ?? []);

/**
 * Whether a threat's percentages may weigh in a scenario: its record must say something about what it is
 * after (a description, a report summary of 100+ characters, a declared motivation or goal, or a parent
 * whose percentages are known and that has minimum evidence itself, on a threat with at most 3 parents: the
 * counter ignores the parents of an overview report). Techniques and malware alone do not count. The
 * parent's own evidence is required on top of the model's own rule: an empty group still gets
 * percentages, the counter's prior (about 60 % Espionage), which its children would otherwise weigh with.
 */
export const hasMinimumEvidence = (record: OutcomeCounterRecord): boolean => record.description.trim() !== ''
  || record.reports.some((report) => report.summary.length > 100)
  || record.motivations.length > 0 || record.goals.length > 0
  || (record.parentCount <= 3 && record.parents.some((parent) => parent.probabilities !== null && parent.evidenceSufficient));

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the model files ship with the code and are covered by the parity tests, so a schema pass over 2 MB adds load time and no safety
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

const buildOutcomeCounter = (dir: string): OutcomeCounter => {
  const calibration = readJson<Calibration>(path.join(dir, 'calibration.json'));
  if (calibration.weights.finetuned !== 0 || calibration.finetuned !== null) {
    throw newError('The outcome counter model weighs a fine-tuned model, which this reader does not support', { dir });
  }
  const logistic = readJson<LogisticModel>(path.join(dir, 'logistic.json'));
  const outcomes = logistic.outcomes;
  if (outcomes.length !== COUNTER_OUTCOMES.length || outcomes.some((name, index) => name !== COUNTER_OUTCOMES[index].name)) {
    throw newError('The outcomes of the counter model do not match the catalogue mapping', { dir, outcomes });
  }
  const termIndex = new Map(logistic.tfidf.vocabulary.map((term, index) => [term, index]));
  const fieldIndex = new Map(logistic.fields.map((name, index) => [name, index]));
  const charIndex = logistic.chars ? new Map(logistic.chars.vocabulary.map((term, index) => [term, index])) : null;
  const charNgramSizes = logistic.chars?.ngrams ?? null;
  const charOffset = logistic.tfidf.vocabulary.length;
  const fieldOffset = charOffset + (logistic.chars?.vocabulary.length ?? 0);
  const coefficients = logistic.coefficients!.map((row) => Float64Array.from(row));
  const wordIdf = Float64Array.from(logistic.tfidf.idf);
  const charIdf = logistic.chars ? Float64Array.from(logistic.chars.idf) : null;
  const intercepts = logistic.intercepts;
  const defining = new Set(logistic.definingTechniques);
  const options = logistic.features ?? {};
  const tags = new Set(options.malwareTags ?? []);

  const knownByKey = new Map<string, Array<number>>();
  let knownGroups: Array<KnownGroup> = [];
  if (options.nameSplit) {
    knownGroups = readJson<{ groups: Array<KnownGroup> }>(path.join(dir, 'known-groups.json')).groups;
    knownGroups.forEach((group, index) => {
      for (const key of group.keys) {
        if (!knownByKey.has(key)) {
          knownByKey.set(key, []);
        }
        knownByKey.get(key)!.push(index);
      }
    });
  }

  // Known groups named by the parts of a composite name, the whole name and the threat itself excluded.
  const nameParents = (record: OutcomeCounterRecord): Array<KnownParent> => {
    const whole = compact(record.name);
    const found = new Set<number>();
    for (const part of nameParts(record.name)) {
      if (part === whole) {
        continue;
      }
      for (const index of knownByKey.get(part) ?? []) {
        if (knownGroups[index].id !== record.id) {
          found.add(index);
        }
      }
    }
    return [...found].map((index) => ({ inferred: false, probabilities: knownGroups[index].p }));
  };

  const fields = (record: OutcomeCounterRecord): Map<string, number> => {
    const features = new Map<string, number>([[`type=${record.type}`, 1]]);
    let usable: Array<KnownParent> = record.parentCount <= 3 ? record.parents.filter(hasProbabilities) : [];
    if (options.nameSplit && record.parentCount <= 3) {
      usable = [...usable, ...nameParents(record)];
    }
    if (record.parentCount > 3) {
      features.set('overview-report-child', 1);
    }
    if (usable.length) {
      features.set('parent-prior', 1);
      if (usable.every((parent) => parent.inferred)) {
        features.set('parent-inferred-only', 1);
      }
      outcomes.forEach((outcome, index) => features.set(`parent=${outcome}`, Math.max(...usable.map((parent) => parent.probabilities[index]))));
    }
    for (const malware of record.malware) {
      const kinds = malware.types.length ? malware.types : tags.has(normalize(malware.name)) ? [normalize(malware.name)] : [];
      for (const kind of kinds) {
        const key = `malware-type=${normalize(kind)}`;
        features.set(key, (features.get(key) ?? 0) + 1);
      }
    }
    if (options.malwareWords) {
      for (const malware of record.malware) {
        if (tags.has(normalize(malware.name))) {
          continue;
        }
        for (const word of malwareWords(malware.name)) {
          features.set(`malware-word=${word}`, 1);
        }
      }
    }
    for (const value of record.motivations) {
      features.set(`motivation=${normalize(value)}`, 1);
    }
    for (const value of record.goals) {
      features.set(`goal=${normalize(value)}`, 1);
    }
    for (const value of record.labels) {
      features.set(`label=${normalize(value)}`, 1);
    }
    for (const value of record.sectors) {
      features.set(`sector=${normalize(value)}`, 1);
    }
    for (const name of [record.name, ...record.aliases]) {
      for (const token of name.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
        if (!options.nameSplit || !NAME_STOP.has(token)) {
          features.set(`name=${token}`, 1);
        }
      }
    }
    for (const technique of record.techniques) {
      const base = technique.split('.')[0];
      if (defining.has(base)) {
        features.set(`technique=${base}`, 1);
      }
    }
    for (const [key, value] of features) {
      if (key.startsWith('malware-type=')) {
        features.set(key, Math.log1p(value));
      }
    }
    return features;
  };

  const normalized = (counts: Map<number, number>, idf: Float64Array, offset: number): Array<[number, number]> => {
    const weights = [...counts].map(([index, occurrences]): [number, number] => [index, (1 + Math.log(occurrences)) * idf[index]]);
    const norm = Math.sqrt(weights.reduce((sum, [, value]) => sum + value * value, 0)) || 1;
    return weights.map(([index, value]): [number, number] => [offset + index, value / norm]);
  };
  const count = (terms: Array<string>, vocabulary: Map<string, number>): Map<number, number> => {
    const counts = new Map<number, number>();
    for (const term of terms) {
      const index = vocabulary.get(term);
      if (index !== undefined) {
        counts.set(index, (counts.get(index) ?? 0) + 1);
      }
    }
    return counts;
  };
  const tfidf = (text: string): Array<[number, number]> => {
    const tokens = tokenize(text);
    const bigrams = tokens.slice(1).map((token, index) => `${tokens[index]} ${token}`);
    const words = normalized(count([...tokens, ...bigrams], termIndex), wordIdf, 0);
    return charIndex && charIdf && charNgramSizes
      ? [...words, ...normalized(count(charNgrams(text, charNgramSizes), charIndex), charIdf, charOffset)]
      : words;
  };

  const logisticRaw = (record: OutcomeCounterRecord): Array<number> => {
    const sparse = tfidf(logisticText(record, Boolean(options.reportLabelText)));
    for (const [name, value] of fields(record)) {
      const index = fieldIndex.get(name);
      if (index !== undefined) {
        sparse.push([fieldOffset + index, value]);
      }
    }
    return outcomes.map((_, k) => sigmoid(intercepts[k] + sparse.reduce((sum, [index, value]) => sum + value * coefficients[k][index], 0)));
  };

  return {
    version: OUTCOME_COUNTER_VERSION,
    predict: (record) => logisticRaw(record).map((value, k) => sigmoid(calibration.logistic[k][0] * logit(value) + calibration.logistic[k][1])),
  };
};

const counters = new Map<string, OutcomeCounter>();

/** Loads the model of a directory synchronously on first use, then returns that same counter for it. */
export const loadOutcomeCounter = (dir: string = OUTCOME_COUNTER_MODEL_DIR): OutcomeCounter => {
  const key = path.resolve(dir);
  let counter = counters.get(key);
  if (!counter) {
    counter = buildOutcomeCounter(key);
    counters.set(key, counter);
  }
  return counter;
};
