import { describe, expect, it } from 'vitest';
import { formatEvidenceSize, validateEvidenceSelection } from './evidence';

const evidence = {
  name: 'proof.png',
  mediaType: 'image/png',
  size: 3,
  sha256: 'ab'.repeat(32),
  contentBase64: 'AQID',
};

describe('browser evidence validation', () => {
  it('accepts supported evidence metadata and formats sizes', () => {
    expect(() => validateEvidenceSelection([evidence])).not.toThrow();
    expect(formatEvidenceSize(3)).toBe('3 B');
    expect(formatEvidenceSize(1536)).toBe('1.5 KB');
    expect(formatEvidenceSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('rejects unsupported and oversized selections before submission', () => {
    expect(() => validateEvidenceSelection([{ ...evidence, mediaType: 'image/svg+xml' }])).toThrow(
      /Unsupported evidence file type/,
    );
    expect(() => validateEvidenceSelection(Array.from({ length: 6 }, () => evidence))).toThrow(/최대 5개/);
  });
});
