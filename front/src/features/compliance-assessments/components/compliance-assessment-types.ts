import type { TRPCRouter } from '@app/back/src/types/trpc-router';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<TRPCRouter>;

export type ComplianceAssessment = NonNullable<RouterOutputs['complianceAssessments']['getAssessment']>;
export type AssessmentNodeRow = ComplianceAssessment['nodes'][number];
export type AssessmentAnswer = ComplianceAssessment['answers'][number];
export type AssessmentControlLink = ComplianceAssessment['controlLinks'][number];
