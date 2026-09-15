const encoder = new TextEncoder();

export function compactPad32(value: string): Uint8Array {
  const encoded = encoder.encode(value);
  if (encoded.byteLength > 32) throw new Error('Compact Bytes<32> text exceeds 32 bytes.');
  const padded = new Uint8Array(32);
  padded.set(encoded);
  return padded;
}
