import { describe, expect, it } from 'vitest';
import { canonicalReport, normalizeDomain, normalizeEmail } from './validation';
import { chooseSecurityContact, parseSecurityTxt } from './security-txt';

describe('input validation', () => {
  it('canonicalizes domains and emails', () => {
    expect(normalizeDomain('https://Sub.Acme.CO.KR/path')).toBe('sub.acme.co.kr');
    expect(normalizeEmail(' HANA@ACME.CO.KR ')).toEqual({ email: 'hana@acme.co.kr', domain: 'acme.co.kr' });
  });

  it.each(['localhost', '127.0.0.1', '-bad.example', 'example'])(
    'rejects unsafe or invalid domains',
    (domain) => {
      expect(() => normalizeDomain(domain)).toThrow('valid organization domain');
    },
  );

  it('uses a stable report field order', () => {
    expect(canonicalReport({ departmentOrAsset: ' A ', title: ' B ', summary: ' C ', details: ' D ' })).toBe(
      '{"departmentOrAsset":"A","title":"B","summary":"C","details":"D"}',
    );
  });

  it('rejects an expired security.txt policy', () => {
    const document = parseSecurityTxt(
      'Contact: mailto:security@acme.co.kr\nExpires: 2025-01-01T00:00:00Z',
      'https://acme.co.kr/.well-known/security.txt',
    );
    expect(() => chooseSecurityContact(document, 'acme.co.kr', Date.parse('2026-01-01T00:00:00Z'))).toThrow(
      'expired',
    );
  });
});
