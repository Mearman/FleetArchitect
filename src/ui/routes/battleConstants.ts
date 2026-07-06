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
 * Static cell-edge rendering. A cell's `edges` (n/e/s/w as wall/door/open) come
 * from the ship descriptor; the renderer strokes wall and door edges in these
 * colours so bulkheads and doorways are visible at a glance.
 */
export const WALL_COLOUR = "#3a3f3c";
export const DOOR_COLOUR = "#ffb000";

/**
 * Wall stroke width for the 2D sprite renderer, in sprite pixels. Doors share
 * the same width — only their colour differs.
 */
export const WALL_STROKE_PX = 2;

/**
 * Wall stroke width for the isometric renderer, as a FRACTION of CELL_SIZE. The
 * concrete pixel width is `ISO_WALL_STROKE_FRACTION * CELL_SIZE * scale`, i.e.
 * the same form as the existing top-face edge stroke
 * (`0.06 * CELL_SIZE * scale`), so a wall reads at comparable thickness to the
 * cell's top-face outline at every zoom level.
 */
export const ISO_WALL_STROKE_FRACTION = 0.06;

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
 * Lead (in playback seconds) below which playback eases its speed down toward
 * what the simulation is currently delivering. Above it, playback runs at the
 * selected speed — there is enough computed buffer to do so. The threshold is
 * small so playback only eases when the playhead is genuinely close to the
 * leading edge, and the easing itself keeps the playhead from ever hard-stalling
 * there.
 */
export const COMFORT_LEAD_SECONDS = 0.5;

/**
 * Per-frame low-pass factor at which the playback clock eases its effective
 * speed toward the target. Small enough to ride out a single slow batch without
 * a visible drop, large enough to track a sustained change in delivered rate
 * within about a second. Applied to the delta between the target and the current
 * effective speed each rAF tick.
 */
export const PLAYBACK_EASE_FACTOR = 0.1;

/**
 * Rolling-window length (ms) for the delivered sim rate (leading-edge advance
 * per real second), shown by the speed slider's cyan bar and used to drive
 * playback easing. Long enough to average batch arrivals down to a stable rate,
 * short enough to react to a real change in compute speed within about a second.
 * The delivered rate includes any real-time-pacing idle, so under Overdrive off
 * it settles near 1x; under Overdrive it pokes past. Tunable.
 */
export const SIM_DELIVERED_RATE_WINDOW_MS = 2000;

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
