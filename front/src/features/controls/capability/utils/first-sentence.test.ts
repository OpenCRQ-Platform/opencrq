import { describe, expect, it } from 'vitest';
import { splitFirstSentence } from './first-sentence';

const CATALOGUE_LABEL = 'Adds schema/contract validation and rate limiting: method, route, parameters, types and size are checked against the published API definition and abusive volumes are throttled, so malformed and injection-style requests are rejected at the edge before reaching application code. Step over L1: the request must conform to the contract, not merely be authenticated. Reference rung.';

describe('splitFirstSentence', () => {
  it('should cut a real catalogue label before its comparative clause, and keep the rest', () => {
    expect(splitFirstSentence(CATALOGUE_LABEL)).toEqual({
      first: 'Adds schema/contract validation and rate limiting: method, route, parameters, types and size are checked against the published API definition and abusive volumes are throttled, so malformed and injection-style requests are rejected at the edge before reaching application code.',
      rest: 'Step over L1: the request must conform to the contract, not merely be authenticated. Reference rung.',
    });
  });

  it('should not cut on a colon, which is how the comparative clause opens', () => {
    expect(splitFirstSentence('Step over L1: the request must conform. Reference rung.')).toEqual({
      first: 'Step over L1: the request must conform.',
      rest: 'Reference rung.',
    });
  });

  it('should return a text with no sentence boundary whole, with nothing left', () => {
    expect(splitFirstSentence('One clause with no full stop')).toEqual({ first: 'One clause with no full stop', rest: '' });
  });

  it('should keep a trailing period when the text is a single sentence', () => {
    expect(splitFirstSentence('A single sentence.')).toEqual({ first: 'A single sentence.', rest: '' });
  });

  it('should trim surrounding whitespace', () => {
    expect(splitFirstSentence('  Leading space. Then more.  ')).toEqual({ first: 'Leading space.', rest: 'Then more.' });
  });
});
