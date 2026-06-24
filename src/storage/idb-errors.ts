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
 *
 * Dexie wraps the underlying IDB `DataCloneError` as a `DexieError` whose
 * `.name` is the wrapper's (not the original's), so checking `.name` alone
 * misses the runtime failure (caught by a real-browser run, not the synthetic
 * test stub). Detect the boundary three ways: the raw error name (the direct
 * DOMException / V8 throw), the signature in the message ("DataCloneError" /
 * "cannot be cloned" — how the wrapped DexieError surfaces the original), and a
 * nested `.inner` (some wrappers carry the original there). Narrow `unknown`
 * with `typeof` / `in` — no assertions.
 */
export function isUncloneable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name: unknown = "name" in error ? error.name : undefined;
  if (name === "DataCloneError" || name === "RangeError") return true;
  const message: unknown = "message" in error ? error.message : undefined;
  if (
    typeof message === "string" &&
    (message.includes("DataCloneError") || message.includes("cannot be cloned"))
  ) {
    return true;
  }
  // A wrapper may carry the original error in `.inner`; recurse so any layer's
  // signature is caught.
  if ("inner" in error && isUncloneable(error.inner)) return true;
  return false;
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
