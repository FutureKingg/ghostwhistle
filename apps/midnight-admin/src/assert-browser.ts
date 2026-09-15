/** Minimal Node assert-compatible default export used by Subsquid's browser bundle. */
export default function assert(value: unknown, message = 'Assertion failed'): asserts value {
  if (!value) throw new Error(String(message));
}
