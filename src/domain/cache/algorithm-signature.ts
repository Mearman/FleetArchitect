/**
 * Refactor-stable algorithm signature for the deterministic result cache.
 *
 * The battle engine is a pure function of (a) the data determinants the
 * {@link SimConfig} snapshot captures and (b) the algorithm itself — the pure
 * code that turns those determinants into frames. A manual integer version tag
 * (the old `ENGINE_ALGORITHM_VERSION`) had to be bumped by hand on every
 * computation-preserving-but-output-affecting refactor, which is easy to forget
 * and which also flushes the whole cache on a change that preserves the output.
 *
 * This module replaces that integer with a content-addressed signature derived
 * from the SIX canonical preset-determinism frame hashes pinned in
 * `engine.preset-determinism.unit.test.ts`. Those hashes are the single source
 * of truth: the test imports them from here, and the cache imports the digest
 * of their canonical serialisation from here.
 *
 * The signature is REFACTOR-STABLE. A change to engine code that does not alter
 * the six pinned frame hashes (the common case: a computation-preserving
 * optimisation, a renamed internal, a parallel-implementation A/B swap) leaves
 * the signature byte-identical, so the cache is RETAINED across the refactor.
 * A change that DOES alter any pinned hash (a real algorithm change) flips the
 * signature, so stale results are never served — exactly the contract the
 * manual bump gave, but derived from the same oracle the determinism test
 * guards, with no manual step.
 *
 * The signature is async because it hashes via `crypto.subtle.digest`, the only
 * hash available in both the browser and the Node test runtime. It is therefore
 * a CACHE-KEY TERM, not a `SimConfig` field: the snapshot stays synchronous.
 */

/** Lower-case hex encoding of raw bytes. */
function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * The six pinned SHA-256 frame hashes that pin the engine's frame-byte output
 * for the smallest and largest preset fleet pairs across seeds 1, 7, 99. This
 * array is the single source of truth: `engine.preset-determinism.unit.test.ts`
 * imports it and asserts live runs match, and {@link engineAlgorithmSignature}
 * hashes its canonical serialisation.
 *
 * CANONICAL ORDER (do not reorder without regenerating the test fixtures):
 *  1. smallest pair (preset-fleet-concord vs preset-fleet-foundry), seed 1
 *  2. smallest pair, seed 7
 *  3. smallest pair, seed 99
 *  4. largest pair (preset-fleet-drone-swarm vs preset-fleet-nexus-armada), seed 1
 *  5. largest pair, seed 7
 *  6. largest pair, seed 99
 */
export const PINNED_FRAME_HASHES: readonly [
  string,
  string,
  string,
  string,
  string,
  string,
] = [
  "5b6c432986f35697b1ccf315de8f1b48f94245910f71d9814dd311c96eb4124e",
  "5b6c432986f35697b1ccf315de8f1b48f94245910f71d9814dd311c96eb4124e",
  "5b6c432986f35697b1ccf315de8f1b48f94245910f71d9814dd311c96eb4124e",
  "e5e0f37d03f9ec579f8fac15bacb44ca7bbfc33fb9f9562b360c9f0442c5dde1",
  "cf14118c1c385fdb4cb5b0209d5661a7b461d3426b6970bd74c9df8861e57513",
  "98d498b91627f63352400ef36db31c43311f5bf65904a16b1955c999804a20b1",
];

/**
 * The refactor-stable algorithm signature: a SHA-256 of the canonical JSON
 * encoding of {@link PINNED_FRAME_HASHES}. This string is a cache-key component
 * passed into {@link deriveCacheKey} by the caller; it never appears in frame
 * data, so changing it causes a one-time cache miss, never a frame change.
 *
 * Hashing uses `crypto.subtle.digest('SHA-256')`, available in browsers,
 * workers, and the Node test runtime alike (the same primitive
 * {@link deriveCacheKey} uses).
 *
 * MEMOISED: {@link PINNED_FRAME_HASHES} is a compile-time constant, so the
 * signature is identical for the app's entire lifetime — yet production composes
 * {@link CachingBattleRunner} and {@link ResumingBattleRunner}
 * (`Caching(Resuming(inner))`), so a normal battle start called this twice and
 * paid two `JSON.stringify` + `crypto.subtle.digest` round-trips (the second
 * result silently discarded when {@link deriveCacheKeyMemoised} hits its own
 * cache). Cache the single in-flight promise at module scope, the same shape
 * {@link deriveCacheKeyMemoised} uses for the key: the computation runs once,
 * every subsequent caller awaits the same promise.
 */
let cachedSignature: Promise<string> | undefined;

export function engineAlgorithmSignature(): Promise<string> {
  if (cachedSignature !== undefined) return cachedSignature;
  cachedSignature = (async () => {
    const json = JSON.stringify([...PINNED_FRAME_HASHES]);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(json),
    );
    return toHex(new Uint8Array(digest));
  })();
  return cachedSignature;
}
