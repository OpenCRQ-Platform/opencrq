import { describe, expect, it } from 'vitest';
import { parseApprovalRequest } from './xtm-one-approvals';

const CONVERSATION_ID = '01998a4c-9f4e-7a3b-8c1d-6f2b7e4a5d10';

const decision = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  tool_call_id: 'call_1',
  decision: 'approve',
  ...overrides,
});

const request = (decisions: unknown): unknown => ({ conversation_id: CONVERSATION_ID, decisions });

describe('XTM One tool approval payload', () => {
  it('forwards the three verdicts a reviewer can give', () => {
    const parsed = parseApprovalRequest(request([
      decision(),
      decision({ tool_call_id: 'call_2', decision: 'approve_always' }),
      decision({ tool_call_id: 'call_3', decision: 'reject', rejection_reason: 'Wrong scope' }),
    ]));
    expect(parsed).toEqual({
      conversation_id: CONVERSATION_ID,
      decisions: [
        { tool_call_id: 'call_1', decision: 'approve' },
        { tool_call_id: 'call_2', decision: 'approve_always' },
        { tool_call_id: 'call_3', decision: 'reject', rejection_reason: 'Wrong scope' },
      ],
    });
  });

  it('refuses an unrecognized verdict instead of relaying it', () => {
    expect(parseApprovalRequest(request([decision({ decision: 'maybe' })]))).toBeNull();
    expect(parseApprovalRequest(request([decision({ decision: undefined })]))).toBeNull();
  });

  it('refuses a decision that names no tool call', () => {
    expect(parseApprovalRequest(request([decision({ tool_call_id: '' })]))).toBeNull();
    expect(parseApprovalRequest(request([{ decision: 'approve' }]))).toBeNull();
  });

  it('refuses a body that is not a decision on one conversation', () => {
    expect(parseApprovalRequest(undefined)).toBeNull();
    expect(parseApprovalRequest(request([]))).toBeNull();
    expect(parseApprovalRequest(request('approve'))).toBeNull();
    expect(parseApprovalRequest({ decisions: [decision()] })).toBeNull();
  });

  it('bounds the batch and the rejection reason', () => {
    const many = Array.from({ length: 51 }, (_, index) => decision({ tool_call_id: `call_${index}` }));
    expect(parseApprovalRequest(request(many))).toBeNull();
    expect(parseApprovalRequest(request(many.slice(0, 50)))).not.toBeNull();

    const reason = 'x'.repeat(2001);
    expect(parseApprovalRequest(request([decision({ decision: 'reject', rejection_reason: reason })]))).toBeNull();
    expect(parseApprovalRequest(request([decision({ decision: 'reject', rejection_reason: reason.slice(1) })])))
      .not.toBeNull();
  });

  it('drops a reason attached to an approval rather than refusing the consent', () => {
    const parsed = parseApprovalRequest(request([decision({ rejection_reason: 'stray note' })]));
    expect(parsed?.decisions).toEqual([{ tool_call_id: 'call_1', decision: 'approve' }]);
  });
});
