import { describe, expect, it } from 'vitest';
import { getInitials, userDetailHref } from './utils';

describe('userDetailHref', () => {
  it('should append the user id to a bare pathname', () => {
    expect(userDetailHref('/t1/settings/security/users', 'u1')).toBe('/t1/settings/security/users/u1');
  });

  it('should insert the user id before the search string, not after it', () => {
    expect(userDetailHref('/t1/settings/security/users', 'u1', '?scope=platform')).toBe('/t1/settings/security/users/u1?scope=platform');
  });

  it('should default to no search string', () => {
    expect(userDetailHref('/settings/security/users', 'u1')).toBe('/settings/security/users/u1');
  });
});

describe('getInitials', () => {
  it('should return two initials from a full name', () => {
    expect(getInitials('John Doe', 'john@example.com')).toBe('JD');
  });

  it('should use first and last name for multi-word names', () => {
    expect(getInitials('Jean Claude Van Damme', 'jcvd@example.com')).toBe('JD');
  });

  it('should return first two chars for single-word name', () => {
    expect(getInitials('Alice', 'alice@example.com')).toBe('AL');
  });

  it('should fall back to email prefix when name is null', () => {
    expect(getInitials(null, 'bob@example.com')).toBe('BO');
  });

  it('should uppercase the result', () => {
    expect(getInitials('jane doe', 'jane@example.com')).toBe('JD');
  });

  it('should handle names with extra whitespace', () => {
    expect(getInitials('  John   Doe  ', 'john@example.com')).toBe('JD');
  });
});
