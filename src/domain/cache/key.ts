/**
 * Content-addressed cache key for a deterministic battle.
 *
 * `runBattle` is a pure function of its data determinants: the resolved
 * `CombatShip[]` (which already bakes in every catalogue stat), the anomaly set,
 * the seed, the effective `maxTicks`, the `SimConfig` snapshot (see
 * `sim-config.ts`), and the refactor-stable algorithm signature for pure-code
 * changes the data hash cannot observe (see `algorithm-signature.ts`). The key
 * is a SHA-256 of a canonical JSON encoding of
 * exactly those determinants — nothing else. Battle METADATA
 * (`attackerFleetId`, `defenderFleetId`, the result `id`, `playedAt`) is
 * deliberately excluded: it never affects the simulation, so two matchups that
 * differ only in which fleets were named must hit the same cache entry.
 *
 * Canonicalisation is the contract the hash rests on: the same determinants must
 * always produce byte-identical JSON regardless of object key insertion order.
 * Two IEEE-754 values that the engine treats as identical must canonicalise
 * identically too, hence `-0` is normalised to `0`. A `NaN` or `Infinity` can
 * never legitimately appear in a deterministic key, so encountering one is a bug
 * upstream and is surfaced loudly rather than silently coerced or skipped.
 */

import type { BattleInputs } from "@/domain/simulation/types";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import type { SimConfig } from "@/domain/cache/sim-config";

/**
 * Encode a value as stable JSON: object keys sorted lexicographically, array
 * order preserved, `-0` normalised to `0`. Throws on `NaN`/`Infinity` (they
 * must never reach a deterministic key) and on non-serialisable leaf types
 * (functions, symbols, bigints, `undefined`) — all are bugs in the determinant
 * set, not values to paper over. `unknown` is narrowed with `typeof` /
 * `Array.isArray`; no type assertions.
 *
 * Single pass: JSON.stringify walks the structure natively (quoting strings,
 * formatting numbers, and building the output string in the engine), so leaf
 * primitives incur no per-value JSON.stringify call. The replacer only sorts
 * object keys and guards the IEEE-754 edge cases.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(value, stableReplacer);
}

/**
 * Replacer for {@link canonicalize}. Returns a key-sorted copy of every plain
 * object so the output is independent of insertion order, and surfaces `NaN` /
 * `Infinity` / non-serialisable leaf types as loud failures rather than letting
 * JSON.stringify silently coerce them (to `null` or by omitting them). `-0`
 * needs no special case: JSON.stringify already renders it as `"0"`, matching
 * the previous explicit normalisation.
 */
function stableReplacer(this: unknown, key: string, value: unknown): unknown {
  // `key` (the property name; "" at the root) is unused — the replacer only
  // transforms `value` — but the (key, value) arity is required by the
  // JSON.stringify contract, so reference it to satisfy noUnusedParameters.
  void key;
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      throw new Error("canonicalize: NaN is not a valid cache determinant");
    }
    if (!Number.isFinite(value)) {
      throw new Error(
        "canonicalize: Infinity is not a valid cache determinant",
      );
    }
    return value;
  }

  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new Error(
      `canonicalize: non-serialisable value of type '${typeof value}' is not a valid cache determinant`,
    );
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const objectKey of Object.keys(value).sort()) {
      sorted[objectKey] = Reflect.get(value, objectKey);
    }
    return sorted;
  }

  return value;
}

/** Lower-case hex encoding of raw bytes. */
function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Derive the content-addressed cache key for a battle. The key depends ONLY on
 * the simulation determinants: the resolved ships, anomaly set, seed, effective
 * `maxTicks` (a missing `maxTicks` is the same battle as an explicit
 * {@link DEFAULT_MAX_TICKS}, so they collapse to one key), the `SimConfig`
 * snapshot, and the algorithm signature. Fleet ids and result metadata are
 * excluded. Hashing is via the Web Crypto `crypto.subtle.digest('SHA-256')`,
 * available in browsers, workers, and the Node test environment alike.
 *
 * The `algorithmSignature` is the refactor-stable string from
 * `algorithm-signature.ts` — the SHA-256 of the six pinned preset-determinism
 * frame hashes. The caller computes it (it is async) and passes it in here as
 * a term of the determinant set.
 */
export async function deriveCacheKey(
  inputs: BattleInputs,
  simConfig: SimConfig,
  algorithmSignature: string,
): Promise<string> {
  const determinants = {
    ships: inputs.ships,
    anomalies: inputs.anomalies,
    seed: inputs.seed,
    maxTicks: inputs.maxTicks ?? DEFAULT_MAX_TICKS,
    // Named waypoints: outcome-affecting when a doctrine references a point, so
    // they are a cache determinant. Canonicalised as a plain object (keys sorted
    // by `canonicalize`) built from the merged points map — an empty map and an
    // absent one both canonicalise to `{}`, so a preset battle (no points) keeps
    // its key unchanged.
    points: Object.fromEntries(inputs.points ?? []),
    sim: simConfig,
    sig: algorithmSignature,
  };
  const json = canonicalize(determinants);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return toHex(new Uint8Array(digest));
}

/**
 * Memoised cache-key derivation. The {@link CachingBattleRunner} and
 * {@link ResumingBattleRunner} are composed (`Caching(Resuming(inner))`), so on
 * a result-cache MISS both derive the key from the SAME `inputs` object —
 * canonicalising the (large) resolved fleet graph, JSON-encoding it, and
 * SHA-256 hashing it twice on the main thread before a battle starts. The
 * `SimConfig` ({@link getSimConfig} singleton) and algorithm signature are
 * app-wide constants for a given run, so the key is a pure function of `inputs`
 * alone; memoise on the `inputs` object so the canonicalisation runs once.
 *
 * Keyed by the `inputs` object reference: the decorator chain passes one
 * reference through, so the inner runner's derivation hits the outer's entry.
 * A different `inputs` object (a different battle) gets no false hit, and the
 * entry is garbage-collected with the object.
 */
const keyByInputs = new WeakMap<BattleInputs, Promise<string>>();

export function deriveCacheKeyMemoised(
  inputs: BattleInputs,
  simConfig: SimConfig,
  algorithmSignature: string,
): Promise<string> {
  const cached = keyByInputs.get(inputs);
  if (cached !== undefined) return cached;
  const pending = deriveCacheKey(inputs, simConfig, algorithmSignature);
  keyByInputs.set(inputs, pending);
  return pending;
}
