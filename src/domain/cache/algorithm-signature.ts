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
  "3411072c6d1afc4bcf90f58cc10de3fa4899b7ebc1dad8d1a4b6140588445a1e",
  "8fa90e143b9ccaa685e427cf2b701ee96a3864e2a388cb1dfaaffa76c86141be",
  "7e98d80bfdf1677068ebb19182f00001182414fb1d8e221a82d2f98486ecd8f0",
  "8280c6da7bac772e32befde09d24d3baa7c394eef128502b85eaa1b02033221d",
  "902b70f451cbf5a7f2f2860f495829ad2e0dacd96abcb14b6cec87f749fc7dcd",
  "d74f8f3d7c8dcf39762c869002c1093e94416f0fd5e93fd5185ed18c5670f87d",
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
 */
export async function engineAlgorithmSignature(): Promise<string> {
  const json = JSON.stringify([...PINNED_FRAME_HASHES]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return toHex(new Uint8Array(digest));
}
