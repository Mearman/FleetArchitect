import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { BattleAnomaly } from "@/schema/battle";
import type { BattleAnomaly as BattleAnomalyType } from "@/schema/battle";
import type { WeaponType } from "@/schema/module";
import type { Bounds } from "./battleCamera";

export const PROJECTILE_COLOUR: Record<WeaponType, string> = {
  beam: "#ffe066",
  cannon: "#e8e8f5",
  missile: "#ff9a3c",
  torpedo: "#ff5a5a",
  plasma: "#e06bff",
};

/** Per-module part colour, by module kind, for the battle canvas. */
export const MODULE_COLOUR: Record<string, string> = {
  weapon: "#ff8c5a",
  shield: "#6ea8ff",
  armour: "#b0b0c0",
  engine: "#7bd88f",
  power: "#ffe066",
  crew: "#c792ff",
  hull: "#5a6172",
  magazine: "#e8a550",
  pointDefense: "#ff8c5a",
  repair: "#80d4a0",
  sensor: "#40d0d0",
  comms: "#a0c0ff",
  // Tech modules (factions update).
  blink: "#9ad0ff",
  afterburner: "#ffb347",
  overcharge: "#ffd24d",
  cloak: "#b39ddb",
  signature: "#9575cd",
  ecm: "#4dd0e1",
  eccm: "#26c6da",
  decoy: "#cfd8dc",
  commandAura: "#f0c060",
  hangar: "#90caf9",
  mineLayer: "#ff7043",
  boarding: "#e57373",
};

/**
 * Per-faction hull/accent palette (factions update). The hull base tints a
 * faction's structural cells; the accent marks it at a glance. Side allegiance
 * (attacker/defender) is shown separately via an outline ring so a mirror match
 * stays legible. Factions absent from the map fall back to the side colour.
 */
export const FACTION_PALETTE: Record<string, { hull: string; accent: string }> = {
  Terran: { hull: "#7e88a0", accent: "#d65a5a" },
  Swarm: { hull: "#5e8c4a", accent: "#8bd450" },
  Crystalline: { hull: "#8a6fc9", accent: "#5fd0e0" },
  Foundry: { hull: "#6b6f78", accent: "#ff8c3a" },
  Corsair: { hull: "#7a5a3a", accent: "#ffc04a" },
  Synthetic: { hull: "#9aa6b0", accent: "#4fd0e6" },
};

/**
 * Crew dot colour by state, drawn in ship-local space.
 * Walking and hauling use a brighter tint to make movement legible;
 * manning shows green (on-station); injured shows red.
 */
export const CREW_COLOUR: Record<string, string> = {
  idle: "#b0b0b8",
  walking: "#a0d4ff",
  hauling: "#ffe066",
  manning: "#7bd88f",
  injured: "#ff5a5a",
};

/** Accent dot colour for what a hauling crew member is carrying. */
export const CARRYING_COLOUR: Record<string, string> = {
  power: "#ffe066",
  ammo: "#ff9a3c",
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
