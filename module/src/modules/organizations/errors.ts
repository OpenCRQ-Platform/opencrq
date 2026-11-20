import { StructuredError } from '@app/utils';

/** An id in a mapping batch names no asset the caller can see, which the junction's policy alone would not catch. */
export class MappedAssetNotVisibleError extends StructuredError {
  override readonly name: string = 'MappedAssetNotVisibleError';

  constructor() {
    super('Access Denied', { data: {} });
  }
}

/** A scope id already taken, typically by a create a caller retries after missing its answer. */
export class RiskScopeAlreadyExistsError extends StructuredError {
  override readonly name: string = 'RiskScopeAlreadyExistsError';

  constructor() {
    super('A risk scope with this id already exists', { data: {} });
  }
}

export class RiskScopeNotFoundError extends StructuredError {
  override readonly name: string = 'RiskScopeNotFoundError';

  constructor() {
    super('Risk scope not found', { data: {} });
  }
}

/** A sector id the caller's tenant cannot see: unknown, or another tenant's. */
export class SectorNotFoundError extends StructuredError {
  override readonly name: string = 'SectorNotFoundError';

  constructor() {
    super('Sector not found', { data: {} });
  }
}

/** A country id the caller's tenant cannot see: unknown, or another tenant's. */
export class CountryNotFoundError extends StructuredError {
  override readonly name: string = 'CountryNotFoundError';

  constructor() {
    super('Country not found', { data: {} });
  }
}
