// Formatting helpers shared by components that display file metadata.

/** A byte count as a person reads it. Null/undefined renders as nothing, not as "0 B" — an
 *  unknown size is not a size of zero. */
export function bytesLabel(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
