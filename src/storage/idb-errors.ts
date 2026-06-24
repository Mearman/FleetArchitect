/**
 * Shared capacity/quota guards for the durable IndexedDB tiers
 * (`DexieSimCache`, `DexieCheckpointStore`). Both adapters persist large,
 * variable-size records across the structured-clone boundary and must
 * distinguish a capacity boundary (the record is too big for IDB to accept, or
 * the origin has exhausted its quota) from a genuine bug — the former is
 * recoverable by skipping the write and degrading, the latter must propagate.
 *
 * The two narrowers below classify a thrown `unknown` without assertions,
 * using only `typeof` and `in`. They are co-located here so the durable tiers
 * apply one definition of each boundary rather than drifting apart.
 */

/**
 * Whether a thrown value signals that a record is too large for the durable
 * tier to handle. Two failure modes are both capacity boundaries, not bugs: a
 * `DataCloneError` from `table.put` (the structured clone of a
 * multi-hundred-MB record exhausts memory) and a `RangeError` from
 * `JSON.stringify` (the serialisation exceeds the V8 string length limit).
 */
export function isUncloneable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("name" in error)) return false;
  return error.name === "DataCloneError" || error.name === "RangeError";
}

/**
 * Whether a thrown value is a storage quota-exceeded error. IndexedDB surfaces
 * an exhausted quota as a `DOMException` named `QuotaExceededError`; Dexie
 * propagates it (or wraps it in an error whose `name` is preserved).
 */
export function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (!("name" in error)) return false;
  return error.name === "QuotaExceededError";
}
