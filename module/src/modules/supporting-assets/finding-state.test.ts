import { describe, expect, it } from 'vitest';
import type { DerivedFindingState, FindingStateRow, SourceStanding } from './finding-state';
import { deriveFindingState } from './finding-state';

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

const exposed = (n: number, reason: string | null = `exposed on ${n}`): SourceStanding =>
  ({ id: `exposed-${n}`, verdictAt: day(n), exposed: true, reporting: true, reason });
const notExposed = (n: number, reason: string | null = `held on ${n}`): SourceStanding =>
  ({ id: `held-${n}`, verdictAt: day(n), exposed: false, reporting: true, reason });
const silent = (n: number, lastSaidExposed = false): SourceStanding =>
  ({ id: `silent-${n}`, verdictAt: day(n), exposed: lastSaidExposed, reporting: false, reason: 'stale wording' });

const row = (state: FindingStateRow['state'], origin: FindingStateRow['origin']): FindingStateRow => ({ state, origin });

const RETIRED = 'No longer reported by OpenAEV';

const derive = (latest: FindingStateRow | null, sources: Array<SourceStanding>, handedBackAt: Date | null = null) =>
  deriveFindingState({ sources, latest, handedBackAt, retirementReason: RETIRED });

const toExposed = (n: number): DerivedFindingState =>
  ({ state: 'applicable', origin: 'exposed', observedAt: day(n), reason: `exposed on ${n}` });
const toNotExposed = (n: number): DerivedFindingState =>
  ({ state: 'dismissed', origin: 'not_exposed', observedAt: day(n), reason: `held on ${n}` });
const toNoLongerReported = (n: number): DerivedFindingState =>
  ({ state: 'dismissed', origin: 'no_longer_reported', observedAt: day(n), reason: RETIRED });

describe('deriveFindingState', () => {
  describe('one source per finding', () => {
    it.each<[string, FindingStateRow | null, Array<SourceStanding>, DerivedFindingState | null]>([
      ['opens a new finding a test reports exposed', null, [exposed(1)], toExposed(1)],
      ['opens a new finding a test reports not exposed as not exposed', null, [notExposed(1)], toNotExposed(1)],
      ['writes nothing while an exposed finding stays exposed', row('applicable', 'exposed'), [exposed(3)], null],
      ['closes an exposed finding a test reports not exposed', row('applicable', 'exposed'), [notExposed(3)], toNotExposed(3)],
      ['writes nothing while a not exposed finding stays so', row('dismissed', 'not_exposed'), [notExposed(3)], null],
      ['reopens a not exposed finding a test reports exposed', row('dismissed', 'not_exposed'), [exposed(3)], toExposed(3)],
      ['retires an exposed finding no source reports any more', row('applicable', 'exposed'), [silent(5)], toNoLongerReported(5)],
      ['retires a not exposed finding no source reports any more, though its state agrees', row('dismissed', 'not_exposed'), [silent(5)], toNoLongerReported(5)],
      ['writes nothing while a retired finding stays unreported', row('dismissed', 'no_longer_reported'), [silent(6)], null],
      ['reopens a retired finding reported exposed again', row('dismissed', 'no_longer_reported'), [exposed(7)], toExposed(7)],
      ['reads a retired finding reported not exposed again as tested', row('dismissed', 'no_longer_reported'), [notExposed(7)], toNotExposed(7)],
    ])('%s', (_, latest, sources, expected) => {
      expect(derive(latest, sources)).toEqual(expected);
    });
  });

  describe('sources that disagree', () => {
    it('keeps a finding exposed while any source still reports it exposed, whatever the order', () => {
      expect(derive(row('applicable', 'exposed'), [exposed(1), notExposed(3)])).toBeNull();
      expect(derive(row('applicable', 'exposed'), [notExposed(1), exposed(3)])).toBeNull();
      expect(derive(row('applicable', 'exposed'), [exposed(2), notExposed(2)])).toBeNull();
    });

    it('opens a finding at the first exposed verdict, with its wording', () => {
      expect(derive(null, [exposed(4), exposed(2), notExposed(1)])).toEqual(toExposed(2));
    });

    it('closes a finding once the last exposed source says otherwise, at the last verdict', () => {
      expect(derive(row('applicable', 'exposed'), [notExposed(2), notExposed(4)])).toEqual(toNotExposed(4));
    });

    it('reads a finding as not exposed while one source still reports it and another went silent', () => {
      expect(derive(row('applicable', 'exposed'), [notExposed(2), silent(5)])).toEqual(toNotExposed(2));
    });

    it('closes a finding when its last exposed source goes silent, at that silence, with the wording of the source still reporting', () => {
      expect(derive(row('applicable', 'exposed'), [notExposed(2), silent(5, true)])).toEqual({ ...toNotExposed(5), reason: 'held on 2' });
    });

    it('reads a silent source that last said exposed as no longer exposing the finding', () => {
      expect(derive(row('applicable', 'exposed'), [silent(5, true)])).toEqual(toNoLongerReported(5));
    });

    it.each<[string, FindingStateRow | null, (n: number, reason: string) => SourceStanding]>([
      ['opening', null, exposed],
      ['closing', row('applicable', 'exposed'), notExposed],
    ])('carries the same wording on a tie at %s, whatever the order the sources were read in', (_, latest, source) => {
      const a = { ...source(4, 'wording of a'), id: 'a' };
      const b = { ...source(4, 'wording of b'), id: 'b' };

      expect(derive(latest, [a, b])).toEqual(derive(latest, [b, a]));
    });

    it('keeps a finding exposed by a source while another went silent', () => {
      expect(derive(row('applicable', 'exposed'), [exposed(2), silent(5)])).toBeNull();
    });
  });

  describe('a person\'s decision', () => {
    it.each<[string, FindingStateRow]>([
      ['set aside', row('dismissed', 'user')],
      ['marked applicable', row('applicable', 'user')],
    ])('stands against every source while %s', (_, latest) => {
      expect(derive(latest, [exposed(9)])).toBeNull();
      expect(derive(latest, [notExposed(9)])).toBeNull();
      expect(derive(latest, [silent(9)])).toBeNull();
    });
  });

  describe('a handover', () => {
    const handedBackAt = day(10);

    it('keeps the person\'s state until a source speaks after the handover', () => {
      expect(derive(row('dismissed', 'reset'), [exposed(9)], handedBackAt)).toBeNull();
      expect(derive(row('dismissed', 'reset'), [], handedBackAt)).toBeNull();
    });

    it('writes the first verdict after the handover, though it agrees with the person\'s state', () => {
      expect(derive(row('dismissed', 'reset'), [notExposed(11)], handedBackAt)).toEqual(toNotExposed(11));
      expect(derive(row('applicable', 'reset'), [exposed(11)], handedBackAt)).toEqual(toExposed(11));
    });

    it('changes the state when the first verdict after the handover disagrees', () => {
      expect(derive(row('dismissed', 'reset'), [exposed(11)], handedBackAt)).toEqual(toExposed(11));
    });

    it('retires a handed-back finding its source left out after the handover', () => {
      expect(derive(row('applicable', 'reset'), [silent(12)], handedBackAt)).toEqual(toNoLongerReported(12));
    });

    it('hears no verdict from before the handover, even after a later one took the finding over', () => {
      expect(derive(row('dismissed', 'not_exposed'), [exposed(9), notExposed(11)], handedBackAt)).toBeNull();
    });
  });
});
