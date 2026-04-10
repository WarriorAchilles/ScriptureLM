/**
 * Serialize float vectors for PostgreSQL `pgvector` columns (`::vector` cast).
 * Values must be finite numbers (NaN/Infinity are rejected at validation time).
 */
export function formatVectorLiteral(values: readonly number[]): string {
  return `[${values.map((value) => String(value)).join(",")}]`;
}
