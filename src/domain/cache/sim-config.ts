/**
 * Canonical snapshot of every non-input data determinant the battle engine reads
 * at sim-time. The deterministic result cache (Part 1 of the cache plan) keys on
 * the resolved battle inputs PLUS this snapshot, so that a change to any tunable
 * the engine consumes flips the cache key and a stale result is never served.
 *
 * Two distinct sources of output change exist for a pure, deterministic engine:
 *
 *  1. **Data the engine reads** — the `SIM` feel constants and the standalone
 *     physical/scale anchors imported from `engine/config.ts` and
 *     `simulation/types.ts`. These are serialisable values, so the cache hashes
 *     them directly: change one and the key changes, no manual intervention.
 *  2. **The engine algorithm itself** — pure code the data hash cannot observe.
 *     A change here (a reordered accumulation, a new force term) alters output
 *     with the data unchanged, so it needs a manual bump of
 *     {@link ENGINE_ALGORITHM_VERSION}.
 *
 * This module reads the existing engine exports and bundles them; it does NOT
 * refactor the engine to thread a parameter. The engine keeps importing `SIM`
 * and the anchors directly. `getSimConfig()` merely exposes the same values in
 * one canonical, serialisable shape for hashing.
 */

import {
  ARRIVAL_CLOSING_SPEED_MPS,
  CREW_HP,
  GRAVITY_CONSTANT_ARENA,
  SIM,
  SPEED_OF_LIGHT_M_PER_S,
  SPEED_OF_LIGHT_M_PER_TICK,
  THRUST_ALIGNMENT_RAD,
} from "@/domain/simulation/engine/config";
import {
  EM_HULL_AMBIENT_EMISSION,
  EM_RECEIVER_NOISE_FLOOR,
} from "@/domain/simulation/engine/em-anchors";
import {
  ACCEL_PER_TICK_FROM_SI,
  STALEMATE_IDLE_TICKS,
  TICKS_PER_SECOND,
} from "@/domain/simulation/types";

/**
 * Manual version tag for pure-code output changes the data hash cannot see.
 *
 * The cache key is a content hash of {@link getSimConfig}'s serialisable data
 * plus this integer. When a change to engine CODE (not data) alters battle
 * output — a reordered floating-point accumulation, a new force term, a changed
 * integration step — bump this by one so previously cached results, computed by
 * the old algorithm, are no longer served. Data-driven changes (editing a
 * `SIM.*` value or an anchor) do NOT need a bump: they already flow into the
 * hash through {@link getSimConfig}.
 */
export const ENGINE_ALGORITHM_VERSION = 1;

/**
 * The standalone sim-time constants the engine consumes alongside `SIM`. Every
 * one is a value the engine reads during a battle and that therefore changes
 * output if changed, so each must enter the cache key.
 *
 *  - The speed-of-light anchors and the EM reception reference power drive the
 *    light-lag, relativistic, and sensor models.
 *  - The arena gravitational constant drives the N-body field.
 *  - The crew HP anchor, thrust-alignment band, and arrival epsilon drive crew,
 *    movement, and the translation controller.
 *  - The tick rate, the SI→tick acceleration rescale, and the stalemate window
 *    are read from `simulation/types.ts` and govern integration and termination.
 */
export interface SimConstants {
  readonly SPEED_OF_LIGHT_M_PER_S: number;
  readonly SPEED_OF_LIGHT_M_PER_TICK: number;
  readonly EM_RECEIVER_NOISE_FLOOR: number;
  readonly EM_HULL_AMBIENT_EMISSION: number;
  readonly GRAVITY_CONSTANT_ARENA: number;
  readonly CREW_HP: number;
  readonly THRUST_ALIGNMENT_RAD: number;
  readonly ARRIVAL_CLOSING_SPEED_MPS: number;
  readonly TICKS_PER_SECOND: number;
  readonly ACCEL_PER_TICK_FROM_SI: number;
  readonly STALEMATE_IDLE_TICKS: number;
}

/**
 * The canonical determinant snapshot: the `SIM` feel constants, the standalone
 * sim-time anchors, and the algorithm version. `sim` is typed as the engine's
 * own `SIM` object so a new tunable added to `SIM` flows in automatically; the
 * completeness test guards that every `SIM.*` key survives into the snapshot.
 */
export interface SimConfig {
  readonly sim: typeof SIM;
  readonly constants: SimConstants;
  readonly algorithmVersion: number;
}

/**
 * Assemble the canonical, serialisable determinant snapshot. Pure: it reads the
 * existing engine exports and returns a fresh value. Contains only serialisable
 * data — no functions, no the `UNREACHABLE` Symbol (a sentinel, not a
 * determinant), no derived caches. The cache layer hashes the result; this
 * module owns WHAT is a determinant, the key layer owns HOW it is canonicalised.
 */
export function getSimConfig(): SimConfig {
  return {
    sim: SIM,
    constants: {
      SPEED_OF_LIGHT_M_PER_S,
      SPEED_OF_LIGHT_M_PER_TICK,
      EM_RECEIVER_NOISE_FLOOR,
      EM_HULL_AMBIENT_EMISSION,
      GRAVITY_CONSTANT_ARENA,
      CREW_HP,
      THRUST_ALIGNMENT_RAD,
      ARRIVAL_CLOSING_SPEED_MPS,
      TICKS_PER_SECOND,
      ACCEL_PER_TICK_FROM_SI,
      STALEMATE_IDLE_TICKS,
    },
    algorithmVersion: ENGINE_ALGORITHM_VERSION,
  };
}
