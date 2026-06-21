/**
 * The per-battle spatial configuration and the astronomical-scale factor.
 *
 * Kept out of the `config` leaf (which holds the static tunables) because this is
 * a derived, per-run concern: the engine resolves one of these from the battle's
 * {@link BattleScale} setting and threads it through every spatial step as a
 * parameter rather than reading mutable global state, so two concurrent battles
 * can run at different scales without interfering. Depends on `config` for the
 * unscaled anchors; `config` never imports this, so there is no cycle.
 */

import type { BattleScale } from "@/schema/battle";

import { EM_RECEIVER_NOISE_FLOOR, SIM, SPEED_OF_LIGHT_M_PER_TICK } from "./config";

/**
 * The spatial-expansion factor applied to every distance, range and deployment
 * separation when a battle runs at {@link BattleScale} `astronomical`. Derived
 * from the light-tick: at the canonical tick rate `SPEED_OF_LIGHT_M_PER_TICK`
 * metres of light cross the arena per tick, so `SPEED_OF_LIGHT_M_PER_TICK · 30`
 * is roughly one light-second of reach, and dividing by 600 sizes the arena to
 * about 1/20th of a light-second across — a few hundred thousand kilometres
 * between the two deployment lines. At sub-km default scale a sensor pulse
 * crosses the engagement in a fraction of a tick and the light-lag is invisible;
 * scaled up by this factor the same pulse takes many tens of ticks to arrive, so
 * the engine's existing light-lag, Doppler and aberration become observable.
 * Engine physics — mass, thrust, the tick rate, the speed of light per tick — is
 * deliberately NOT scaled: only the spatial geometry stretches, so ships
 * accelerate exactly as before but take far longer to close the larger gap.
 *
 * Classification: derived-by-formula (a multiple of the light-tick); the divisor
 * is the authored fraction-of-a-light-second the arena is sized to.
 */
export const ASTRONOMICAL_SCALE = (SPEED_OF_LIGHT_M_PER_TICK * 30) / 600;

/**
 * The per-battle spatial configuration: every spatial quantity that an
 * astronomical-scale run stretches, resolved once per battle and threaded through
 * the engine as a parameter rather than read from mutable global state — so two
 * concurrent battles can run at different scales without interfering. At default
 * scale every field equals the global `SIM`/`EM` constant verbatim, so a default
 * battle is byte-identical to the pre-scale engine.
 *
 * The detection model is electromagnetic and inverse-square: a contact forms when
 * a source's emission, falling off as `1/dist^2`, clears the receiver's noise
 * floor (see `emissions.ts`). To stretch every detection reach by `spaceScale`
 * the floor is divided by `spaceScale^2` (so `continuousRange ∝ 1/sqrt(floor)`
 * grows by `spaceScale`) and the baseline visual radius — which the sensor-gain
 * formula `(range / visualLosRadius)^2` is measured against — is multiplied by
 * `spaceScale`, keeping every sensor's gain unchanged so its reach scales by
 * exactly `spaceScale` too. Weapon, sensor and comms RANGES carried on module
 * effects are scaled at the engine input boundary (`toSimShip`), so the values
 * here are only the constants that live on `SIM`/`EM` rather than on an effect.
 */
export interface BattleSpaceConfig {
  /** The spatial-expansion factor: 1 at default scale, {@link ASTRONOMICAL_SCALE}
   *  at astronomical scale. Applied to ship deployment positions and module-effect
   *  ranges at the input boundary. */
  readonly spaceScale: number;
  /** Receiver noise floor, divided by `spaceScale^2` so every inverse-square
   *  detection reach grows by `spaceScale`. */
  readonly noiseFloor: number;
  /** Innate visual line-of-sight radius (metres), multiplied by `spaceScale`.
   *  Used both as the rendered innate-sight circle and as the denominator of the
   *  sensor-gain ratio so scaled sensor ranges keep their authored gain. */
  readonly visualLosRadius: number;
  /** Base passive acquisition radius (metres), multiplied by `spaceScale`. */
  readonly baseAcquireRange: number;
  /** Fallback engagement range for weaponless ships (metres), multiplied by
   *  `spaceScale`. */
  readonly defaultRange: number;
  /** Spacing between mines in a laid batch (metres), multiplied by `spaceScale`. */
  readonly mineRingSpacing: number;
}

/** The default (sub-km) spatial configuration: every field is the unscaled
 *  global constant, so a default-scale battle is byte-identical to the engine
 *  before the scale mode existed. */
export function defaultSpaceConfig(): BattleSpaceConfig {
  return {
    spaceScale: 1,
    noiseFloor: EM_RECEIVER_NOISE_FLOOR,
    visualLosRadius: SIM.visualLosRadius,
    baseAcquireRange: SIM.baseAcquireRange,
    defaultRange: SIM.defaultRange,
    mineRingSpacing: SIM.mineRingSpacing,
  };
}

/** The astronomical-scale spatial configuration: every spatial quantity stretched
 *  by {@link ASTRONOMICAL_SCALE} (the noise floor by its square, per the
 *  inverse-square reasoning on {@link BattleSpaceConfig}) so the whole arena
 *  geometry — separations, ranges, sight — expands uniformly while the engine's
 *  physics stays untouched. */
export function astronomicalSpaceConfig(): BattleSpaceConfig {
  const s = ASTRONOMICAL_SCALE;
  return {
    spaceScale: s,
    noiseFloor: EM_RECEIVER_NOISE_FLOOR / (s * s),
    visualLosRadius: SIM.visualLosRadius * s,
    baseAcquireRange: SIM.baseAcquireRange * s,
    defaultRange: SIM.defaultRange * s,
    mineRingSpacing: SIM.mineRingSpacing * s,
  };
}

/** Resolve the spatial configuration for a battle from its scale setting. The
 *  single place that maps the {@link BattleScale} enum to a concrete config, so
 *  the engine never branches on the scale string beyond this point. */
export function spaceConfigFor(scale: BattleScale): BattleSpaceConfig {
  return scale === "astronomical" ? astronomicalSpaceConfig() : defaultSpaceConfig();
}
