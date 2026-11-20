import { describe, expect, it } from 'vitest';
import { assetTagsFormValuesFrom, createTagFromInput, tagNamesFrom } from './asset-tags-form-utils';

describe('assetTagsFormValuesFrom', () => {
  it('should keep only the tags the manual author asserted', () => {
    const tags = [
      { id: 'tag-1', name: 'Critical', color: null, isManual: false },
      { id: 'tag-2', name: 'PCI', color: '#fff', isManual: true },
    ];

    expect(assetTagsFormValuesFrom(tags)).toEqual([{ id: 'tag-2', name: 'PCI', color: '#fff' }]);
  });

  it('should return an empty list when every tag came from a connector', () => {
    const tags = [{ id: 'tag-1', name: 'Critical', color: null, isManual: false }];

    expect(assetTagsFormValuesFrom(tags)).toEqual([]);
  });
});

describe('tagNamesFrom', () => {
  it('should return every selected tag name, whichever origin it came from', () => {
    const tags = [createTagFromInput('typed'), { id: 'tag-1', name: 'from-list', color: '#fff' }];

    expect(tagNamesFrom(tags)).toEqual(['typed', 'from-list']);
  });

  it('should return an empty list when no tag is selected', () => {
    expect(tagNamesFrom([])).toEqual([]);
  });
});
