/**
 * Content-addressed cache key for a deterministic battle.
 *
 * `runBattle` is a pure function of its data determinants: the resolved
 * `CombatShip[]` (which already bakes in every catalogue stat), the anomaly,
 * the seed, the effective `maxTicks`, the `SimConfig` snapshot (see
 * `sim-config.ts`), and the integer algorithm version for pure-code changes the
 * data hash cannot observe. The key is a SHA-256 of a canonical JSON encoding of
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
 * Recursively encode a value as stable JSON: object keys sorted lexicographically,
 * array order preserved, `-0` normalised to `0`. Throws on `NaN`/`Infinity` (they
 * must never reach a deterministic key) and on non-serialisable leaf types
 * (functions, symbols, bigints, `undefined`) — all are bugs in the determinant
 * set, not values to paper over. `unknown` is narrowed with `typeof` / `Array.isArray`
 * / `in`; no type assertions.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "string") return JSON.stringify(value);

  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      throw new Error("canonicalize: NaN is not a valid cache determinant");
    }
    if (!Number.isFinite(value)) {
      throw new Error(
        "canonicalize: Infinity is not a valid cache determinant",
      );
    }
    // Normalise -0 to 0 so two engine-equivalent values share one key.
    const normalised = value === 0 ? 0 : value;
    return JSON.stringify(normalised);
  }

  if (Array.isArray(value)) {
    return `[${value.map((element) => canonicalize(element)).join(",")}]`;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      // `key` came from Object.keys(value), so it indexes value; narrow with `in`.
      if (!(key in value)) {
        throw new Error(`canonicalize: key '${key}' vanished from object`);
      }
      const child: unknown = Reflect.get(value, key);
      return `${JSON.stringify(key)}:${canonicalize(child)}`;
    });
    return `{${entries.join(",")}}`;
  }

  throw new Error(
    `canonicalize: non-serialisable value of type '${typeof value}' is not a valid cache determinant`,
  );
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
 * the simulation determinants: the resolved ships, anomaly, seed, effective
 * `maxTicks` (a missing `maxTicks` is the same battle as an explicit
 * {@link DEFAULT_MAX_TICKS}, so they collapse to one key), the `SimConfig`
 * snapshot, and the algorithm version. Fleet ids and result metadata are
 * excluded. Hashing is via the Web Crypto `crypto.subtle.digest('SHA-256')`,
 * available in browsers, workers, and the Node test environment alike.
 */
export async function deriveCacheKey(
  inputs: BattleInputs,
  simConfig: SimConfig,
  algoVersion: number,
): Promise<string> {
  const determinants = {
    ships: inputs.ships,
    anomaly: inputs.anomaly,
    seed: inputs.seed,
    maxTicks: inputs.maxTicks ?? DEFAULT_MAX_TICKS,
    sim: simConfig,
    v: algoVersion,
  };
  const json = canonicalize(determinants);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return toHex(new Uint8Array(digest));
}
