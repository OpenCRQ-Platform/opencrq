import { describe, expect, it } from 'vitest';
import {
  ANY_RESOURCE_TYPE,
  filterLinksByResourceType,
  isResourceTypeNameTaken,
  NO_RESOURCE_TYPE,
  resourceTypeOptions,
} from './primary-to-primary-links-utils';

const link = (id: string, typeId: string | null, typeName: string | null) => ({ id, dependencyResourceTypeId: typeId, dependencyResourceTypeName: typeName });

const links = [
  link('a', 'type-supplier', 'Supplier'),
  link('b', 'type-it', 'IT'),
  link('c', 'type-supplier', 'Supplier'),
  link('d', null, null),
];

describe('resourceTypeOptions', () => {
  it('should offer each type the links carry once, by name, then the links without a type', () => {
    expect(resourceTypeOptions(links)).toEqual([
      { value: 'type-it', name: 'IT' },
      { value: 'type-supplier', name: 'Supplier' },
      { value: NO_RESOURCE_TYPE, name: null },
    ]);
  });

  it('should not offer the links without a type when every link has one', () => {
    expect(resourceTypeOptions(links.slice(0, 3)).map((option) => option.value)).toEqual(['type-it', 'type-supplier']);
  });
});

describe('filterLinksByResourceType', () => {
  it('should keep every link when no type is picked', () => {
    expect(filterLinksByResourceType(links, ANY_RESOURCE_TYPE).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('should keep only the links of the picked type', () => {
    expect(filterLinksByResourceType(links, 'type-supplier').map((row) => row.id)).toEqual(['a', 'c']);
  });

  it('should keep only the links without a type', () => {
    expect(filterLinksByResourceType(links, NO_RESOURCE_TYPE).map((row) => row.id)).toEqual(['d']);
  });
});

describe('isResourceTypeNameTaken', () => {
  const types = [{ id: '1', name: 'Équipements' }, { id: '2', name: 'IT' }];

  it('should find a name another type holds, case and accents aside', () => {
    expect(isResourceTypeNameTaken(types, ' equipements ', null)).toBe(true);
  });

  it('should leave the type being renamed its own name', () => {
    expect(isResourceTypeNameTaken(types, 'it', '2')).toBe(false);
  });

  it('should find a free name free', () => {
    expect(isResourceTypeNameTaken(types, 'Supplier', null)).toBe(false);
  });
});
