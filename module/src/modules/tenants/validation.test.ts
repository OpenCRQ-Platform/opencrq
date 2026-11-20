import { describe, expect, it } from 'vitest';
import { tenantNameSchema } from './validation';

describe('tenantNameSchema', () => {
  it('should trim the surrounding whitespace', () => {
    expect(tenantNameSchema.parse('  Acme  ')).toBe('Acme');
  });

  it('should keep the inner whitespace', () => {
    expect(tenantNameSchema.parse('Acme  Corp')).toBe('Acme  Corp');
  });

  it('should accept an accented name', () => {
    expect(tenantNameSchema.parse('Société Générale')).toBe('Société Générale');
  });

  it.each(['', '   ', '\t\n'])('should refuse the blank name %j', (name) => {
    expect(tenantNameSchema.safeParse(name).success).toBe(false);
  });
});
