import { z } from 'zod';
import { DECLARED_ESTATE_KIND_VALUES, DECLARED_ESTATE_KINDS, DECLARED_ESTATE_MAX_COUNT } from './constants';

const countSchema = z.number().int().nonnegative().max(DECLARED_ESTATE_MAX_COUNT);

/**
 * One kind's answer. Zod only, so the browser bundle validates the form through it too and a rule
 * cannot hold on one side of the wire alone.
 */
export const declaredEstateAnswerSchema = z.object({
  kind: z.enum(DECLARED_ESTATE_KIND_VALUES).describe('The kind of asset the answer counts.'),
  bounds: z.object({
    low: countSchema.describe('The fewest assets of the kind the scope holds.'),
    high: countSchema.describe('The most assets of the kind the scope holds. An exact number is two equal bounds.'),
  })
    .nullable()
    .describe('A number of assets, as a low and a high bound; null clears the answer, its exposure included.'),
  internetFacing: z.boolean()
    .nullable()
    .describe('Whether at least one asset of the kind is reachable from the Internet; null when unanswered. Only asked of the kinds that can be exposed, and of an answer above zero.'),
}).superRefine((answer, context) => {
  if (answer.bounds !== null && answer.bounds.low > answer.bounds.high) {
    context.addIssue({ code: 'custom', path: ['bounds', 'high'], message: 'The high bound is below the low bound' });
  }
  if (answer.internetFacing === null) {
    return;
  }
  if (!DECLARED_ESTATE_KINDS[answer.kind].exposable) {
    context.addIssue({ code: 'custom', path: ['internetFacing'], message: 'This kind of asset is not asked about its exposure' });
  } else if (answer.bounds === null || answer.bounds.high === 0) {
    context.addIssue({ code: 'custom', path: ['internetFacing'], message: 'An exposure needs at least one asset' });
  }
});
export type DeclaredEstateAnswer = z.infer<typeof declaredEstateAnswerSchema>;

/** A partial save: the kinds it leaves out keep their answer. */
export const declaredEstateAnswersSchema = z.array(declaredEstateAnswerSchema)
  .max(DECLARED_ESTATE_KIND_VALUES.length)
  .refine((answers) => new Set(answers.map((answer) => answer.kind)).size === answers.length, { error: 'A kind is answered twice' });
