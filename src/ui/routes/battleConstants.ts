import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { BattleAnomaly } from "@/schema/battle";
import type { BattleAnomaly as BattleAnomalyType } from "@/schema/battle";
import type { WeaponType } from "@/schema/module";
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

/** Per-module part colour, by module kind, for the battle canvas. */
export const MODULE_COLOUR: Record<string, string> = {
  weapon: NEON_MAGENTA,
  shield: NEON_CYAN,
  armour: "#4d544c",
  engine: PHOSPHOR_GREEN,
  power: PHOSPHOR_AMBER,
  crew: "#9a66cc",
  hull: "#2f342e",
  magazine: "#ff8c1a",
  pointDefense: NEON_MAGENTA,
  repair: PHOSPHOR_GREEN,
  sensor: NEON_CYAN,
  comms: "#80c8ff",
  // Tech modules (factions update).
  blink: "#80d0ff",
  afterburner: PHOSPHOR_AMBER,
  overcharge: "#ffd24d",
  cloak: "#9060cc",
  signature: "#7040a0",
  ecm: NEON_CYAN,
  eccm: "#26c6da",
  decoy: "#aab4a6",
  commandAura: PHOSPHOR_AMBER,
  hangar: NEON_CYAN,
  mineLayer: "#ff5a1a",
  boarding: NEON_MAGENTA,
};

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

export const ANOMALY_LABEL: Record<BattleAnomalyType, string> = {
  none: "Open space",
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
export { BattleAnomaly };
