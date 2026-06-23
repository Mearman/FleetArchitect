/**
 * The single source of truth for how a ship cell looks, keyed by its
 * {@link CellKind}. Every renderer — the designer grid (DOM), the battle canvas
 * (2D and isometric), and any future view — reads its colour, glyph, extrusion
 * height, and function group from here, so a weapon cell looks like a weapon
 * cell everywhere and the four render paths can never drift apart.
 *
 * The table is a `Record<CellKind, …>`, so adding a cell kind to the schema
 * without giving it an appearance is a compile error rather than an invisible
 * cell (the old `MODULE_COLOUR` map silently dropped `rcs` and `reactionWheel`).
 *
 * Hue is grouped by function so a glance reads the layout ("that warm cluster is
 * the gun battery"); the glyph carries the precise identity (shape beats colour
 * and is colour-blind-safe); the height gives the cell volume in the isometric
 * views so components read as 3D objects with their own silhouette.
 */

import { CellKind } from "@/schema/battle";
import { NEON_CYAN, NEON_MAGENTA, PHOSPHOR_AMBER, PHOSPHOR_GREEN } from "@/ui/theme/tokens";

/**
 * Glyph identifiers. A glyph is a small vector mark drawn at the centre of a
 * cell; the path data lives in `moduleGlyphs.ts` and is shared by the canvas
 * (via `Path2D`) and the designer (via SVG `<path>`).
 */
export type GlyphKey =
  | "barrel"
  | "burst"
  | "shield"
  | "chevron"
  | "thruster"
  | "wheel"
  | "bolt"
  | "ammo"
  | "person"
  | "dish"
  | "antenna"
  | "wave"
  | "wrench"
  | "plate"
  | "grid"
  | "blink"
  | "flame"
  | "eye"
  | "ghost"
  | "bay"
  | "mine"
  | "grapple"
  | "aura";

/**
 * Function family. Drives the hue ramp and lets the UI group/legend cells by
 * role. Structural cells (hull, armour) are the ship's body; everything else is
 * an installed system.
 */
export type ModuleGroup =
  | "weapon"
  | "defence"
  | "propulsion"
  | "power"
  | "sensing"
  | "crew"
  | "structure"
  | "utility";

export interface ModuleAppearance {
  /** Lit fill / top-face colour. */
  readonly colour: string;
  /** Function family for hue grouping and legends. */
  readonly group: ModuleGroup;
  /** Centre glyph identifying the kind. */
  readonly glyph: GlyphKey;
  /**
   * Isometric extrusion height in CELL_SIZE units (0 = flat plate, 1 = a cube
   * one cell tall). Structure sits low; turrets, masts and antennae stand tall,
   * so the ship's silhouette alone distinguishes its components.
   */
  readonly height: number;
  /** Human-readable label for tooltips and legends. */
  readonly label: string;
}

export const MODULE_APPEARANCE: Record<CellKind, ModuleAppearance> = {
  // --- Structure: the ship's body. Low, muted steel. ---
  hull: { colour: "#3a4048", group: "structure", glyph: "grid", height: 0.12, label: "Hull" },
  armour: { colour: "#6f7a86", group: "structure", glyph: "plate", height: 0.2, label: "Armour" },

  // --- Weapons: warm magenta/red family. Tall turrets. ---
  weapon: { colour: NEON_MAGENTA, group: "weapon", glyph: "barrel", height: 0.7, label: "Weapon" },
  pointDefense: { colour: "#ff6aa8", group: "weapon", glyph: "burst", height: 0.5, label: "Point defence" },
  boarding: { colour: "#ff5a4a", group: "weapon", glyph: "grapple", height: 0.55, label: "Boarding pod" },
  mineLayer: { colour: "#ff7a2a", group: "weapon", glyph: "mine", height: 0.4, label: "Mine layer" },

  // --- Defence: cool cyan/blue family. ---
  shield: { colour: NEON_CYAN, group: "defence", glyph: "shield", height: 0.5, label: "Shield" },
  repair: { colour: "#3ad6a0", group: "defence", glyph: "wrench", height: 0.35, label: "Repair bay" },

  // --- Propulsion: green family. ---
  engine: { colour: PHOSPHOR_GREEN, group: "propulsion", glyph: "thruster", height: 0.4, label: "Engine" },
  afterburner: { colour: "#b6ff3a", group: "propulsion", glyph: "flame", height: 0.42, label: "Afterburner" },
  rcs: { colour: "#86e6a0", group: "propulsion", glyph: "chevron", height: 0.24, label: "RCS thruster" },
  reactionWheel: { colour: "#5ec888", group: "propulsion", glyph: "wheel", height: 0.3, label: "Reaction wheel" },
  blink: { colour: "#36e0c0", group: "propulsion", glyph: "blink", height: 0.45, label: "Blink drive" },

  // --- Power: amber/gold family. ---
  power: { colour: PHOSPHOR_AMBER, group: "power", glyph: "bolt", height: 0.45, label: "Reactor" },
  overcharge: { colour: "#ffd24d", group: "power", glyph: "bolt", height: 0.45, label: "Overcharge" },
  magazine: { colour: "#ff9a2a", group: "power", glyph: "ammo", height: 0.34, label: "Magazine" },

  // --- Sensing & EW: teal/violet family. Tall masts and dishes. ---
  sensor: { colour: "#3ac8ff", group: "sensing", glyph: "dish", height: 0.85, label: "Sensor" },
  comms: { colour: "#80c8ff", group: "sensing", glyph: "antenna", height: 0.8, label: "Comms" },
  ecm: { colour: "#26c6da", group: "sensing", glyph: "wave", height: 0.62, label: "ECM" },
  eccm: { colour: "#4ad8c0", group: "sensing", glyph: "wave", height: 0.62, label: "ECCM" },
  signature: { colour: "#7e5ad0", group: "sensing", glyph: "ghost", height: 0.3, label: "Signature damper" },
  cloak: { colour: "#9a66e0", group: "sensing", glyph: "ghost", height: 0.34, label: "Cloak" },
  decoy: { colour: "#aab4c0", group: "sensing", glyph: "ghost", height: 0.4, label: "Decoy" },
  commandAura: { colour: "#ffcf5a", group: "sensing", glyph: "aura", height: 0.55, label: "Command aura" },

  // --- Crew: purple. ---
  crew: { colour: "#9a66cc", group: "crew", glyph: "person", height: 0.28, label: "Crew quarters" },

  // --- Utility. ---
  hangar: { colour: "#00b0c0", group: "utility", glyph: "bay", height: 0.22, label: "Hangar" },
};

/**
 * Appearance for a cell kind. The snapshot's `kind` is a plain string at the
 * render boundary, so it is validated against the {@link CellKind} enum; an
 * unrecognised kind falls back to the structural-hull appearance rather than
 * vanishing. Prefer passing an already-typed {@link CellKind} where possible.
 */
export function appearanceOf(kind: string): ModuleAppearance {
  const parsed = CellKind.safeParse(kind);
  return parsed.success ? MODULE_APPEARANCE[parsed.data] : MODULE_APPEARANCE.hull;
}
