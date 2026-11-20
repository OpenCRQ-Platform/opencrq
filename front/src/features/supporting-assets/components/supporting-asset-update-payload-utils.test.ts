import { describe, expect, it } from 'vitest';
import type { SupportingAssetUpdateFormValues } from './supporting-asset-update-payload-utils';
import { emptyAssetPropertiesFormValues } from './asset-properties-form-utils';
import { buildSupportingAssetUpdatePayload } from './supporting-asset-update-payload-utils';

const values: SupportingAssetUpdateFormValues = {
  name: 'Web front',
  ownerId: null,
  description: 'Public site',
  exposure: 'unknown',
  categoryId: 'host',
  subcategoryId: null,
  url: null,
  linkedPerson: null,
  criticality: 'high',
  properties: emptyAssetPropertiesFormValues,
  tags: [{ id: 'tag-1', name: 'PCI', color: null }],
};

describe('buildSupportingAssetUpdatePayload', () => {
  it('should send nothing when no field was touched', () => {
    expect(buildSupportingAssetUpdatePayload(values, {}, [])).toEqual({});
  });

  it('should send the touched fields alone, so an untouched one is never pinned', () => {
    const payload = buildSupportingAssetUpdatePayload(values, { name: true, exposure: true }, []);

    expect(payload).toEqual({ name: 'Web front', exposure: 'unknown' });
  });

  it('should send a touched field even when it was set back to empty', () => {
    const payload = buildSupportingAssetUpdatePayload({ ...values, description: null }, { description: true }, []);

    expect(payload).toEqual({ description: null });
  });

  it('should send every selected tag once the tags were touched', () => {
    const payload = buildSupportingAssetUpdatePayload(values, { tags: [{ name: true }] }, []);

    expect(payload).toEqual({ tagNames: ['PCI'] });
  });

  it('should send the family block once one of its fields was touched', () => {
    const payload = buildSupportingAssetUpdatePayload(
      { ...values, properties: { ...emptyAssetPropertiesFormValues, hostname: 'web-01' } },
      { properties: { hostname: true } },
      [],
    );

    expect(payload).toEqual({ properties: expect.objectContaining({ family: 'machine', hostname: 'web-01' }) });
  });
});
