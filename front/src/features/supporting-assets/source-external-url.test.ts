import { describe, expect, it } from 'vitest';
import { sourceExternalUrl } from './source-external-url';

describe('sourceExternalUrl', () => {
  it('builds a Microsoft Defender machine link off a base URL that already ends with a slash', () => {
    expect(sourceExternalUrl('microsoft_graph', 'device-1', 'https://security.microsoft.com/', 'host'))
      .toBe('https://security.microsoft.com/machines/v2/device-1/overview');
  });

  it('builds an OpenAEV asset link off a base URL that does not end with a slash', () => {
    expect(sourceExternalUrl('openaev', 'asset-1', 'https://openaev.example.com', 'host'))
      .toBe('https://openaev.example.com/admin/assets/asset-1');
  });

  it('opens an identity on Defender\'s identity page, keyed by its Entra object id', () => {
    expect(sourceExternalUrl('microsoft_graph', 'd48b511b-87fd-4830-83a3-5a49fa0596c4', 'https://security.microsoft.com/', 'identity'))
      .toBe('https://security.microsoft.com/user?aad=d48b511b-87fd-4830-83a3-5a49fa0596c4&tab=overview');
  });

  it('opens an identity keyed by its SID on the same page, by that SID', () => {
    expect(sourceExternalUrl('microsoft_graph', 'sid:S-1-5-21-1-2-3-1001', 'https://security.microsoft.com/', 'identity'))
      .toBe('https://security.microsoft.com/user?sid=S-1-5-21-1-2-3-1001&tab=overview');
  });

  it('returns null when the connector has no base URL configured', () => {
    expect(sourceExternalUrl('microsoft_graph', 'device-1', null, 'host')).toBeNull();
  });

  it('returns null for a source with no known deep link, even with a base URL', () => {
    expect(sourceExternalUrl('drata', 'asset-1', 'https://drata.example.com', 'host')).toBeNull();
  });
});
