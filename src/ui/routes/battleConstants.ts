import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { BattleAnomalyKind, CellKind } from "@/schema/battle";
import type { WeaponType } from "@/schema/module";
import { MODULE_APPEARANCE } from "@/ui/render/moduleAppearance";
import { PHOSPHOR_AMBER, NEON_CYAN, NEON_MAGENTA, PHOSPHOR_GREEN } from "@/ui/theme/tokens";
import type { Bounds } from "./battleCamera";

/**
 * Side allegiance colours — used for the outline ring, chamfered outline,
 * and heading line. Warm amber vs cool cyan gives ~145 degrees of hue
 * separation with equal luminance, maximising legibility across faction tints.
 */
export const SIDE_COLOUR: Record<"attacker" | "defender", string> = {
  attacker: PHOSPHOR_AMBER,
  defender: NEON_CYAN,
};

export const PROJECTILE_COLOUR: Record<WeaponType, string> = {
  beam: PHOSPHOR_AMBER,
  cannon: "#d0e8ff",
  missile: "#ff8c1a",
  torpedo: NEON_MAGENTA,
  plasma: "#cc44ff",
};

/**
 * The original emission duration (in ticks) of a hitscan beam, used by the
 * renderer to fade the beam line over its lifetime. MUST agree with
 * `SIM.beamEmissionTicks` in `src/domain/simulation/engine/config.ts` — that
 * is the single source of truth for how long the engine carries a beam event.
 * The frame's `BeamSnapshot.emissionTicks` is a countdown from this value, so
 * the fade ratio is `emissionTicks / BEAM_EMISSION_TICKS_UI`.
 */
export const BEAM_EMISSION_TICKS_UI = 3;

/**
 * Per-cell part colour, by kind, for the battle canvas — derived from the
 * shared {@link MODULE_APPEARANCE} table so the battle, the designer, and the
 * isometric views can never drift apart. Keyed over every {@link CellKind}, so
 * (unlike the old hand-maintained map) `rcs` and `reactionWheel` cells are no
 * longer invisible.
 */
export const MODULE_COLOUR: Record<string, string> = Object.fromEntries(
  CellKind.options.map((kind) => [kind, MODULE_APPEARANCE[kind].colour]),
);

/**
 * Per-faction hull/accent palette (factions update). The hull base tints a
 * faction's structural cells; the accent marks it at a glance. Side allegiance
 * (attacker/defender) is shown separately via an outline ring so a mirror match
 * stays legible. Factions absent from the map fall back to the side colour.
 */
export const FACTION_PALETTE: Record<string, { hull: string; accent: string }> = {
  Terran: { hull: "#2a3038", accent: "#ff4a3a" },
  Swarm: { hull: "#243018", accent: "#9be000" },
  Crystalline: { hull: "#221a30", accent: "#b06bff" },
  Foundry: { hull: "#2c241a", accent: "#ff7a00" },
  Corsair: { hull: "#2a2410", accent: "#ffd24a" },
  Synthetic: { hull: "#1c262a", accent: "#26d6c0" },
};

/**
 * Crew dot colour by state, drawn in ship-local space.
 * Walking and hauling use a brighter tint to make movement legible;
 * manning shows green (on-station); injured shows red.
 */
export const CREW_COLOUR: Record<string, string> = {
  idle: "#6c746a",
  walking: NEON_CYAN,
  hauling: PHOSPHOR_AMBER,
  manning: PHOSPHOR_GREEN,
  injured: NEON_MAGENTA,
};

/** Accent dot colour for what a hauling crew member is carrying. */
export const CARRYING_COLOUR: Record<string, string> = {
  power: PHOSPHOR_AMBER,
  ammo: "#ff8c1a",
};

export const DEFAULT_BOUNDS: Bounds = { minX: -700, maxX: 700, minY: -430, maxY: 430 };

/**
 * Exponential-moving-average weight for the measured simulation rate (ticks
 * computed per real second). Each batch nudges the estimate towards its instant
 * rate by this fraction, smoothing the spiky per-batch timings without lagging
 * far behind a genuine change in compute speed.
 */
export const SIM_RATE_EMA_WEIGHT = 0.3;

/**
 * How many real seconds of uninterrupted playback to buffer for before resuming
 * once playback has stalled at the leading edge. When the simulation is slower
 * than playback this sets how much lead to accumulate, trading a longer single
 * rebuffer for fewer stop-start stutters (the streaming-video rebuffer model).
 */
export const REBUFFER_TARGET_SECONDS = 3;

/**
 * Minimum lead (in playback seconds) required to (re)start playback at the
 * leading edge when the simulation is keeping up. A small cushion so a single
 * slow batch does not immediately stall playback again.
 */
export const MIN_RESUME_LEAD_SECONDS = 0.3;

/**
 * Overdrive-OFF pacing thresholds (playback seconds of computed lead ahead of
 * the playhead). When Overdrive is off the simulation is paced: once the lead
 * exceeds {@link PACE_PAUSE_LEAD_SECONDS} the auto-pacer asks the worker to
 * pause (cooperatively, at its next batch boundary); it resumes once the lead
 * drops back below {@link PACE_RESUME_LEAD_SECONDS}.
 *
 * The window is sized for a comfortable buffer rather than a tight pace. The sim
 * is allowed to run slightly ahead of playback (up to the pause threshold) and
 * is only released once the lead drops back to the resume threshold, which stays
 * well above {@link MIN_RESUME_LEAD_SECONDS}. That headroom means the playhead
 * cannot catch the leading edge during the pacer's reaction time (a rAF tick)
 * plus the worker's cooperative-resume latency (a batch interval) — the lead
 * shrinks at the playback speed during that gap, so the margin matters most at
 * high speeds, where a tight pace would dip below the buffering threshold and
 * stutter. Pausing playback releases the sim (only the bezel Pause-computation
 * button actually stops it), so these engage solely while playback is playing.
 */
export const PACE_PAUSE_LEAD_SECONDS = 3.0;
export const PACE_RESUME_LEAD_SECONDS = 1.5;

/**
 * Rolling-window length (ms) for the sim-speed bar's DELIVERED rate (leading-edge
 * advance per real second). Long enough to average the Overdrive-off hold/run
 * cycle down to the effective (paced) rate, short enough to stay responsive. The
 * delivered rate includes cooperative-hold gaps, so the bar drops while the sim
 * is held and reflects the effective rate rather than the raw compute rate.
 * Tunable.
 */
export const SIM_DELIVERED_RATE_WINDOW_MS = 2000;

/**
 * Resume threshold in playback seconds: how far the streamed leading edge must
 * be ahead of the playhead before playback (re)starts. Driven by the measured
 * simulation rate versus the playback consumption rate. When the sim keeps up
 * (rate >= playback rate) a minimal cushion suffices; when it lags, buffer
 * enough lead to sustain `REBUFFER_TARGET_SECONDS` of smooth playback before the
 * playhead would next catch the edge.
 */
export function resumeLeadSeconds(simTickRate: number, playbackTickRate: number): number {
  if (simTickRate <= 0 || simTickRate >= playbackTickRate) {
    return MIN_RESUME_LEAD_SECONDS;
  }
  // Net ticks the buffer drains per real second while playing (playback consumes
  // faster than the sim produces). The lead must cover the whole rebuffer window.
  const drainPerSecond = playbackTickRate - simTickRate;
  const neededTicks = drainPerSecond * REBUFFER_TARGET_SECONDS;
  return Math.max(MIN_RESUME_LEAD_SECONDS, neededTicks / TICKS_PER_SECOND);
}

export const ANOMALY_LABEL: Record<BattleAnomalyKind, string> = {
  asteroidField: "Asteroid field",
  nebula: "Nebula",
  blackHole: "Black hole",
};

export const MODULE_LABEL: Record<string, string> = {
  weapon: "Weapon",
  shield: "Shield",
  armour: "Armour",
  engine: "Engine",
  power: "Power",
  crew: "Crew",
  sensor: "Sensor",
  comms: "Comms",
};

/** Re-export so callers can use the canonical options list for anomaly UIs. */
export { BattleAnomalyKind };
