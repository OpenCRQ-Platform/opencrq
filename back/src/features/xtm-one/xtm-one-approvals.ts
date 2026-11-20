/*
Copyright (c) 2026 Filigran SAS

This file is part of the OpenCRQ Enterprise Edition ("EE") and is
licensed under the OpenCRQ Enterprise Edition License (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://github.com/OpenCRQ-Platform/opencrq/blob/main/LICENSE

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/

import { z } from 'zod';

/**
 * Human-in-the-loop tool approval - the decision payload the chat panel
 * POSTs to answer a turn XTM One paused on a gated tool call. Kept free of
 * Fastify/config imports so the contract stays unit-testable.
 */

/** One turn can propose several calls, but not unboundedly many. */
const MAX_DECISIONS_PER_REQUEST = 50;

/** The rejection reason is a short note for the agent to adapt to, not a document. */
const MAX_REJECTION_REASON_LENGTH = 2000;

const REJECT_VERDICT = 'reject';

const approvalDecisionSchema = z.object({
  tool_call_id: z.string().min(1),
  // Allowlisted rather than forwarded as-is: a human-consent control must
  // refuse an unrecognized verdict here instead of leaving upstream leniency
  // as the only thing between an undecided call and an executed one.
  decision: z.enum(['approve', 'approve_always', REJECT_VERDICT]),
  rejection_reason: z.string().max(MAX_REJECTION_REASON_LENGTH).optional(),
});

const approvalRequestSchema = z.object({
  // Shape only - the conversation id is checked by the route, with the same
  // test its sibling chat routes apply. A proxy stricter than the route that
  // handed the id to the panel would 400 every decision on a turn the panel
  // can still display, stranding it.
  conversation_id: z.string(),
  decisions: z.array(approvalDecisionSchema).min(1).max(MAX_DECISIONS_PER_REQUEST),
});

interface ApprovalDecision {
  tool_call_id: string,
  decision: z.infer<typeof approvalDecisionSchema>['decision'],
  rejection_reason?: string,
}

export interface ApprovalRequest {
  conversation_id: string,
  decisions: Array<ApprovalDecision>,
}

/**
 * Validate a decision payload and normalize it for XTM One, or return `null`
 * when it is not a decision this proxy relays.
 */
export const parseApprovalRequest = (body: unknown): ApprovalRequest | null => {
  const parsed = approvalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  return {
    conversation_id: parsed.data.conversation_id,
    decisions: parsed.data.decisions.map(({ tool_call_id, decision, rejection_reason }) => (
      // Upstream declares `rejection_reason` on every decision but reads it
      // only on the reject path. A reason attached to an approval is dropped
      // rather than refused: the reviewer still gave a valid consent, and
      // losing it would strand the turn.
      decision === REJECT_VERDICT && rejection_reason !== undefined
        ? { tool_call_id, decision, rejection_reason }
        : { tool_call_id, decision }
    )),
  };
};
