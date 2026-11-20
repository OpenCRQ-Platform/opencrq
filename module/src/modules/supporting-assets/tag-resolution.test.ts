import { describe, expect, it } from 'vitest';
import { normalizeManualTagNames, resolveTagOrigin } from './tag-resolution';

describe('resolveTagOrigin', () => {
  it('recognizes an origin by id and reports noop when the name is unchanged', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'production',
      existingOrigin: { tagId: 'tag-1', reportedName: 'production', tagName: 'production', tagIsMerged: false },
      isSoleOriginOfCurrentTag: true,
      existingTagIdForReportedName: 'tag-1',
    });

    expect(resolution).toEqual({ action: 'noop' });
  });

  it('renames the tag in place when its one origin reports a new name unused by any other tag', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'prod',
      existingOrigin: { tagId: 'tag-1', reportedName: 'production', tagName: 'production', tagIsMerged: false },
      isSoleOriginOfCurrentTag: true,
      existingTagIdForReportedName: null,
    });

    expect(resolution).toEqual({ action: 'renameInPlace' });
  });

  it('splits off a new tag when a non-sole origin reports a new name unused by any other tag', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'prod',
      existingOrigin: { tagId: 'tag-1', reportedName: 'production', tagName: 'production', tagIsMerged: false },
      isSoleOriginOfCurrentTag: false,
      existingTagIdForReportedName: null,
    });

    expect(resolution).toEqual({ action: 'split' });
  });

  it('merges into the existing tag when the sole origin renames onto a name another tag already uses', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'production',
      existingOrigin: { tagId: 'tag-typo', reportedName: 'produtcion', tagName: 'produtcion', tagIsMerged: false },
      isSoleOriginOfCurrentTag: true,
      existingTagIdForReportedName: 'tag-production',
    });

    expect(resolution).toEqual({ action: 'merge', targetTagId: 'tag-production', deleteOldTag: true });
  });

  it('merges without deleting the old tag when a non-sole origin renames onto a name another tag already uses', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'production',
      existingOrigin: { tagId: 'tag-typo', reportedName: 'produtcion', tagName: 'produtcion', tagIsMerged: false },
      isSoleOriginOfCurrentTag: false,
      existingTagIdForReportedName: 'tag-production',
    });

    expect(resolution).toEqual({ action: 'merge', targetTagId: 'tag-production', deleteOldTag: false });
  });

  it('treats a rename as noop when the canonical tag already carries the new name', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'production',
      existingOrigin: { tagId: 'tag-1', reportedName: 'produtcion', tagName: 'production', tagIsMerged: false },
      isSoleOriginOfCurrentTag: true,
      existingTagIdForReportedName: 'tag-1',
    });

    expect(resolution).toEqual({ action: 'noop' });
  });

  it.each([
    { label: 'renames in place', isSoleOriginOfCurrentTag: true, existingTagIdForReportedName: null },
    { label: 'splits', isSoleOriginOfCurrentTag: false, existingTagIdForReportedName: null },
    { label: 'merges', isSoleOriginOfCurrentTag: true, existingTagIdForReportedName: 'tag-2' },
  ])('leaves a tag a user renamed where it is, where a connector rename otherwise $label', ({ isSoleOriginOfCurrentTag, existingTagIdForReportedName }) => {
    const resolution = resolveTagOrigin({
      reportedName: 'production-v2',
      existingOrigin: { tagId: 'tag-1', reportedName: 'production', tagName: 'prod-eu', tagIsMerged: false },
      isSoleOriginOfCurrentTag,
      existingTagIdForReportedName,
    });

    expect(resolution).toEqual({ action: 'noop' });
  });

  it.each([
    { label: 'renames in place', isSoleOriginOfCurrentTag: true, existingTagIdForReportedName: null },
    { label: 'splits', isSoleOriginOfCurrentTag: false, existingTagIdForReportedName: null },
    { label: 'merges', isSoleOriginOfCurrentTag: true, existingTagIdForReportedName: 'tag-2' },
  ])('leaves a merged tag where it is, where a connector rename otherwise $label', ({ isSoleOriginOfCurrentTag, existingTagIdForReportedName }) => {
    const resolution = resolveTagOrigin({
      reportedName: 'production-v2',
      existingOrigin: { tagId: 'tag-1', reportedName: 'production', tagName: 'production', tagIsMerged: true },
      isSoleOriginOfCurrentTag,
      existingTagIdForReportedName,
    });

    expect(resolution).toEqual({ action: 'noop' });
  });

  it('attaches an unknown origin to the existing tag matching its reported name', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'production',
      existingOrigin: null,
      isSoleOriginOfCurrentTag: false,
      existingTagIdForReportedName: 'tag-1',
    });

    expect(resolution).toEqual({ action: 'attachExisting', targetTagId: 'tag-1' });
  });

  it('creates a new tag for an unknown origin with no matching name', () => {
    const resolution = resolveTagOrigin({
      reportedName: 'production',
      existingOrigin: null,
      isSoleOriginOfCurrentTag: false,
      existingTagIdForReportedName: null,
    });

    expect(resolution).toEqual({ action: 'createNew' });
  });
});

describe('normalizeManualTagNames', () => {
  it('trims whitespace around a name', () => {
    expect(normalizeManualTagNames(['  production  '])).toEqual(['production']);
  });

  it('drops a name that is empty or only whitespace', () => {
    expect(normalizeManualTagNames(['production', '', '   '])).toEqual(['production']);
  });

  it('collapses an exact duplicate, keeping the first occurrence', () => {
    expect(normalizeManualTagNames(['production', 'production'])).toEqual(['production']);
  });

  it('collapses a duplicate that only differs by surrounding whitespace', () => {
    expect(normalizeManualTagNames(['production', ' production '])).toEqual(['production']);
  });

  it('keeps two names that differ only by case as distinct', () => {
    expect(normalizeManualTagNames(['Production', 'production'])).toEqual(['Production', 'production']);
  });
});
