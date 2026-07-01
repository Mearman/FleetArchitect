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
  "31f81614feb0eea3841265db88fd880ed78f95b6e6be2bf827ef8776bf03d4a7",
  "8e8033072bc3035fc70e910840888e0396e0ba7b20ce8143546bfd2e599eefd4",
  "c117299611839de5c1f1016a15c41c2eb50eff0b807c3f83fefd4c8fa8d9113a",
  "ce8e4d3f3751c63773e6f931c5b426e7deb2e417adf13d50e8d49f206f798133",
  "47ceac3747b3ed2f1a01abfabed10a476583c49326710a9e9fb835535831cb12",
  "1ad5e7e2f217df8ac319afc748ac6c4fd023787783c7a125ae8fda4d63131998",
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
