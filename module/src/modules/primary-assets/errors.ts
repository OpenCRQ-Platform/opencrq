import { StructuredError } from '@app/utils';

export class DuplicatePrimaryAssetReferenceError extends StructuredError {
  override readonly name: string = 'DuplicatePrimaryAssetReferenceError';

  override readonly reason: string = 'DUPLICATE_PRIMARY_ASSET_REFERENCE';

  constructor(reference: string) {
    super('Another primary asset of this risk scope already uses this reference', { data: { reference } });
  }
}

/** A scope holds at most one primary asset per Get started template: the wizard offers each once. */
export class DuplicatePrimaryAssetTemplateError extends StructuredError {
  override readonly name: string = 'DuplicatePrimaryAssetTemplateError';

  override readonly reason: string = 'DUPLICATE_PRIMARY_ASSET_TEMPLATE';

  constructor(template: string) {
    super('This risk scope already holds the primary asset of this template', { data: { template } });
  }
}
