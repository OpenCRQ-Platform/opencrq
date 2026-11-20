/**
 * The answers contract lives in the module so the form and the tRPC input cannot drift; this file
 * only re-exports it under the names this feature already imports.
 */
export type { FinancialProfileAnswers } from '@app/module/client';
export { EMPTY_FINANCIAL_PROFILE_ANSWERS, financialProfileAnswersSchema } from '@app/module/client';
