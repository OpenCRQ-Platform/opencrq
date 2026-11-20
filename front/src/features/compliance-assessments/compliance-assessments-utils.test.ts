import type { AnswerState } from '@app/module/client';
import { describe, expect, it } from 'vitest';
import type { AnswerDraft, AssessmentNode } from './compliance-assessments-utils';
import {
  buildAssessmentTree,
  completionPercent,
  conflictingAnswerFields,
  fedControlCount,
  filterAssessments,
  filterAssessmentTree,
  filterBySource,
  latestUpdatedFirst,
  maturitySeverity,
  rebaseAnswerDraft,
  sectionIds,
  toAssessmentListRows,
} from './compliance-assessments-utils';

const node = (id: string, parentId: string | null, kind: AssessmentNode['kind'], position: number, title = id): AssessmentNode => ({
  id, parentId, code: id, title, kind, isRequirement: kind === 'subcategory', position,
});

const NODES: Array<AssessmentNode> = [
  node('PR', null, 'function', 0, 'PROTECT'),
  node('PR.AA', 'PR', 'category', 1, 'Identity Management'),
  node('PR.AA-01', 'PR.AA', 'subcategory', 2, 'Identities are managed'),
  node('PR.AA-02', 'PR.AA', 'subcategory', 3, 'Identities are proofed'),
  node('PR.AT', 'PR', 'category', 4, 'Awareness and Training'),
  node('PR.AT-01', 'PR.AT', 'subcategory', 5, 'Personnel are trained'),
  node('RC', null, 'function', 6, 'RECOVER'),
  node('RC.RP', 'RC', 'category', 7, 'Recovery Plan Execution'),
  node('RC.RP-01', 'RC.RP', 'subcategory', 8, 'The recovery plan is executed'),
];

const answers = (entries: Record<string, AnswerState>) => new Map(Object.entries(entries));

describe('buildAssessmentTree', () => {
  it('nests functions, categories and requirements in document order', () => {
    const tree = buildAssessmentTree([...NODES].reverse(), answers({}));

    expect(tree.map((entry) => entry.node.id)).toEqual(['PR', 'RC']);
    expect(tree[0].children.map((entry) => entry.node.id)).toEqual(['PR.AA', 'PR.AT']);
    expect(tree[0].requirementIds).toEqual(['PR.AA-01', 'PR.AA-02', 'PR.AT-01']);
  });

  it('scores each section on its answered requirements, leaving a section with none at null', () => {
    const tree = buildAssessmentTree(NODES, answers({
      'PR.AA-01': { level: 3, notApplicable: false },
      'PR.AA-02': { level: null, notApplicable: true },
      'PR.AT-01': { level: 2, notApplicable: false },
    }));

    expect(tree[0].maturity).toMatchObject({ answeredCount: 2, notApplicableCount: 1, meanLevel: 2.5 });
    expect(tree[0].children[0].maturity.meanLevel).toBe(3);
    expect(tree[1].maturity.meanLevel).toBeNull();
    expect(completionPercent(tree[0].maturity)).toBe(100);
    expect(completionPercent(tree[1].maturity)).toBe(0);
  });
});

describe('filterAssessmentTree', () => {
  const answered = answers({
    'PR.AA-01': { level: 3, notApplicable: false },
    'PR.AT-01': { level: null, notApplicable: true },
  });
  const tree = buildAssessmentTree(NODES, answered);

  it('keeps only the unanswered requirements and the sections leading to them', () => {
    const filtered = filterAssessmentTree(tree, answered, { search: '', unansweredOnly: true });

    expect(sectionIds(filtered)).toEqual(['PR', 'PR.AA', 'RC', 'RC.RP']);
    expect(filtered[0].children[0].children.map((entry) => entry.node.id)).toEqual(['PR.AA-02']);
  });

  it('counts an owner or a due date alone as unanswered', () => {
    const ownedOnly = answers({ 'RC.RP-01': { level: null, notApplicable: false } });
    const filtered = filterAssessmentTree(buildAssessmentTree(NODES, ownedOnly), ownedOnly, { search: '', unansweredOnly: true });

    expect(filtered.map((entry) => entry.node.id)).toEqual(['PR', 'RC']);
  });

  it('matches the search on a requirement code or title, case aside', () => {
    expect(sectionIds(filterAssessmentTree(tree, answered, { search: 'proofed', unansweredOnly: false }))).toEqual(['PR', 'PR.AA']);
    expect(filterAssessmentTree(tree, answered, { search: 'rc.rp-01', unansweredOnly: false })[0].node.id).toBe('RC');
  });

  it('keeps only the requirements that feed a control when asked to', () => {
    const filtered = filterAssessmentTree(tree, answered, { search: '', unansweredOnly: false, feedingControls: new Set(['PR.AA-02', 'RC.RP-01']) });

    expect(sectionIds(filtered)).toEqual(['PR', 'PR.AA', 'RC', 'RC.RP']);
    expect(filtered[0].children[0].children.map((entry) => entry.node.id)).toEqual(['PR.AA-02']);
  });

  it('keeps the whole subtree of a section matching the search', () => {
    const filtered = filterAssessmentTree(tree, answered, { search: 'awareness', unansweredOnly: false });

    expect(filtered[0].children[0].children.map((entry) => entry.node.id)).toEqual(['PR.AT-01']);
  });
});

describe('fedControlCount', () => {
  const links = [
    { requirementId: 'PR.AA-01', capabilityId: 'IDP' },
    { requirementId: 'PR.AA-01', capabilityId: 'PAM' },
    { requirementId: 'PR.AA-02', capabilityId: 'IDP' },
    { requirementId: 'PR.AT-01', capabilityId: 'SAT' },
    { requirementId: 'RC.RP-01', capabilityId: 'BKP' },
  ];

  it('counts the distinct controls fed by the requirements answered on a level', () => {
    expect(fedControlCount(links, answers({
      'PR.AA-01': { level: 0, notApplicable: false },
      'PR.AA-02': { level: 3, notApplicable: false },
      'PR.AT-01': { level: null, notApplicable: true },
      'RC.RP-01': { level: null, notApplicable: false },
    }))).toEqual({ fed: 2, reached: 4 });
  });

  it('feeds nothing while nothing is answered', () => {
    expect(fedControlCount(links, answers({}))).toEqual({ fed: 0, reached: 4 });
  });
});

describe('maturitySeverity', () => {
  it('paints the lowest maturities the warmest', () => {
    expect([0, 1.4, 1.5, 2.4, 2.5, 3.4, 3.5, 5].map(maturitySeverity))
      .toEqual(['high', 'high', 'medium', 'medium', 'low', 'low', 'info', 'info']);
  });
});

describe('filterAssessments', () => {
  const rows = [
    { name: 'NIST CSF 2.0 · T2 2026', frameworkTitle: 'NIST CSF 2.0' },
    { name: 'Audit interne', frameworkTitle: 'NIST CSF 2.0' },
  ];

  it('keeps every assessment when the search is blank', () => {
    expect(filterAssessments(rows, '  ')).toEqual(rows);
  });

  it('matches the name, whatever the case', () => {
    expect(filterAssessments(rows, 't2 2026').map((row) => row.name)).toEqual(['NIST CSF 2.0 · T2 2026']);
  });

  it('matches the framework title too', () => {
    expect(filterAssessments(rows, 'csf')).toHaveLength(2);
  });
});

describe('toAssessmentListRows', () => {
  const native = { id: 'a1', name: 'NIST CSF 2.0 · T2 2026', frameworkTitle: 'NIST CSF 2.0', updatedAt: '2026-10-01T08:00:00.000Z' };
  const drata = { id: 'f1', name: 'SOC 2', lastReportedAt: new Date('2026-10-04T10:30:00.000Z') };

  it('lists a Drata framework as an assessment of itself, dated by its last sync', () => {
    const rows = toAssessmentListRows([native], [drata]);

    expect(rows.map(({ source, id, name, frameworkTitle, updatedAt }) => ({ source, id, name, frameworkTitle, updatedAt }))).toEqual([
      { source: 'opencrq', id: 'a1', name: 'NIST CSF 2.0 · T2 2026', frameworkTitle: 'NIST CSF 2.0', updatedAt: '2026-10-01T08:00:00.000Z' },
      { source: 'drata', id: 'f1', name: 'SOC 2', frameworkTitle: 'SOC 2', updatedAt: '2026-10-04T10:30:00.000Z' },
    ]);
  });

  it('reads a sync date sent as a string', () => {
    const [row] = toAssessmentListRows([], [{ ...drata, lastReportedAt: '2026-10-04T10:30:00.000Z' }]);

    expect(row.updatedAt).toBe('2026-10-04T10:30:00.000Z');
  });

  it('keeps one source or both', () => {
    const rows = toAssessmentListRows([native], [drata]);

    expect(filterBySource(rows, 'all')).toHaveLength(2);
    expect(filterBySource(rows, 'drata').map((row) => row.id)).toEqual(['f1']);
    expect(filterBySource(rows, 'opencrq').map((row) => row.id)).toEqual(['a1']);
  });

  it('orders both sources by their latest change', () => {
    expect(latestUpdatedFirst(toAssessmentListRows([native], [drata])).map((row) => row.id)).toEqual(['f1', 'a1']);
  });
});

describe('rebaseAnswerDraft', () => {
  const base: AnswerDraft = { ownerId: 'u1', dueDate: null, level: 2, notApplicable: false, comment: 'old' };

  it('keeps the fields the draft changed and takes the stored value of the others', () => {
    const draft = { ...base, comment: 'mine' };
    const stored = { ...base, ownerId: 'u2', comment: 'theirs' };

    expect(rebaseAnswerDraft(base, draft, stored)).toEqual({ ...base, ownerId: 'u2', comment: 'mine' });
  });

  it('keeps a changed level together with the not applicable flag it was picked with', () => {
    const draft = { ...base, level: 4 };
    const stored = { ...base, level: null, notApplicable: true };

    expect(rebaseAnswerDraft(base, draft, stored)).toMatchObject({ level: 4, notApplicable: false });
  });

  it('takes the stored rating when the draft left it untouched', () => {
    const stored = { ...base, level: null, notApplicable: true };

    expect(rebaseAnswerDraft(base, base, stored)).toEqual(stored);
  });

  it('keeps a not applicable picked on a blank answer over a level stored since', () => {
    const blank: AnswerDraft = { ownerId: null, dueDate: null, level: null, notApplicable: false, comment: null };
    const draft = { ...blank, notApplicable: true };
    const stored = { ...blank, level: 3 };

    expect(rebaseAnswerDraft(blank, draft, stored)).toMatchObject({ level: null, notApplicable: true });
  });
});

describe('conflictingAnswerFields', () => {
  const base: AnswerDraft = { ownerId: 'u1', dueDate: null, level: 2, notApplicable: false, comment: 'old' };

  it('lists only the fields both sides changed, to different values', () => {
    const draft = { ...base, ownerId: 'u3', dueDate: '2026-12-01', comment: 'mine' };
    const stored = { ...base, ownerId: 'u3', level: 4, comment: 'theirs' };

    expect(conflictingAnswerFields(base, draft, stored, [])).toEqual(['comment']);
  });

  it('counts level and not applicable as one rating', () => {
    const draft = { ...base, level: null, notApplicable: true };
    const stored = { ...base, level: 4 };

    expect(conflictingAnswerFields(base, draft, stored, [])).toEqual(['rating']);
  });

  it('keeps a previous conflict while the draft still differs from the stored value', () => {
    const draft = { ...base, comment: 'mine' };

    expect(conflictingAnswerFields(base, draft, base, ['comment'])).toEqual(['comment']);
    expect(conflictingAnswerFields(base, draft, draft, ['comment'])).toEqual([]);
  });
});

describe('compliance search accents', () => {
  it('should find an accented assessment name or framework title from its plain spelling, and the reverse', () => {
    const rows = [
      { name: 'École Straße', frameworkTitle: 'Cadre' },
      { name: 'ecole plain', frameworkTitle: 'Référentiel' },
    ];

    expect(filterAssessments(rows, 'strasse').map((row) => row.name)).toEqual(['École Straße']);
    expect(filterAssessments(rows, 'referentiel').map((row) => row.name)).toEqual(['ecole plain']);
    expect(filterAssessments(rows, 'éco')).toHaveLength(2);
  });

  it('should find an accented requirement title from its plain spelling', () => {
    const nodes = [node('S', null, 'function', 0, 'Sécurité Straße'), node('S-1', 'S', 'subcategory', 1, 'ecole plain')];
    const tree = buildAssessmentTree(nodes, answers({}));

    expect(filterAssessmentTree(tree, answers({}), { search: 'securite', unansweredOnly: false })[0].node.id).toBe('S');
    expect(filterAssessmentTree(tree, answers({}), { search: 'strasse', unansweredOnly: false })[0].node.id).toBe('S');
    expect(filterAssessmentTree(tree, answers({}), { search: 'éco', unansweredOnly: false })[0].children[0].node.id).toBe('S-1');
  });
});
