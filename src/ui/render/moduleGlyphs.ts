/**
 * Vector glyphs that mark each cell's function. The path data is authored in a
 * unit box centred on the origin (coordinates roughly in [-0.5, 0.5]) so a
 * consumer can scale it to any cell size. The same `d` string drives both the
 * battle canvas (via `new Path2D(d)`, then a scaled transform) and the designer
 * grid (via an SVG `<path d=…>`), so a glyph is defined exactly once.
 *
 * Glyphs are line art meant to be STROKED (not filled) in the cell's lit
 * colour, which keeps them legible on top of the cell fill at small sizes and
 * reads as an engraved marking. A few (the filled dot, the mine) are closed and
 * read fine either way.
 */

import type { GlyphKey } from "./moduleAppearance";

/**
 * SVG path data for each glyph, in the centred unit box. Kept deliberately
 * simple — a handful of segments each — so they stay crisp at ~12px and don't
 * turn to mush when rasterised into the ship sprite.
 */
export const GLYPH_PATHS: Record<GlyphKey, string> = {
  // Weapon: a barrel pointing up with a muzzle line.
  barrel: "M0 0.34 L0 -0.32 M-0.12 -0.16 L0.12 -0.16",
  // Point defence: a four-spoke burst.
  burst: "M0 -0.34 L0 0.34 M-0.34 0 L0.34 0 M-0.22 -0.22 L0.22 0.22 M-0.22 0.22 L0.22 -0.22",
  // Shield: a rounded crest.
  shield: "M0 -0.36 L0.3 -0.2 L0.3 0.1 L0 0.36 L-0.3 0.1 L-0.3 -0.2 Z",
  // RCS: an outward chevron.
  chevron: "M-0.26 0.12 L0 -0.24 L0.26 0.12",
  // Engine: a nozzle splaying downward with an exhaust tick.
  thruster: "M-0.22 -0.24 L-0.3 0.28 M0.22 -0.24 L0.3 0.28 M-0.22 -0.24 L0.22 -0.24 M0 0.16 L0 0.34",
  // Reaction wheel: a ring with a hub.
  wheel: "M0 -0.3 A0.3 0.3 0 1 0 0.0001 -0.3 M0 -0.08 A0.08 0.08 0 1 0 0.0001 -0.08",
  // Power: a lightning bolt.
  bolt: "M0.08 -0.34 L-0.16 0.04 L0.02 0.04 L-0.08 0.34 L0.2 -0.06 L0.0 -0.06 Z",
  // Magazine: stacked rounds.
  ammo: "M-0.22 -0.24 L0.22 -0.24 M-0.22 0 L0.22 0 M-0.22 0.24 L0.22 0.24",
  // Crew: a head and shoulders.
  person: "M0 -0.2 A0.12 0.12 0 1 0 0.0001 -0.2 M-0.24 0.32 A0.24 0.2 0 0 1 0.24 0.32",
  // Sensor: a dish on a short mast.
  dish: "M-0.3 -0.18 A0.34 0.34 0 0 1 0.3 -0.18 M0 -0.18 L0 0.3 M-0.14 0.3 L0.14 0.3",
  // Comms: an antenna with two emission arcs.
  antenna: "M0 0.32 L0 -0.12 M-0.16 -0.28 A0.22 0.22 0 0 1 0.16 -0.28 M-0.3 -0.34 A0.42 0.42 0 0 1 0.3 -0.34",
  // ECM/ECCM: three stacked waves.
  wave: "M-0.32 0.12 A0.18 0.18 0 0 1 0 0.12 A0.18 0.18 0 0 0 0.32 0.12 M-0.32 -0.14 A0.18 0.18 0 0 1 0 -0.14 A0.18 0.18 0 0 0 0.32 -0.14",
  // Repair: a wrench.
  wrench: "M-0.26 0.26 L0.1 -0.1 M0.1 -0.1 A0.16 0.16 0 1 1 0.28 -0.28 L0.14 -0.14 L0.24 -0.04 Z",
  // Armour plate: a bevelled tile.
  plate: "M-0.28 -0.28 L0.28 -0.28 L0.28 0.28 L-0.28 0.28 Z M-0.14 -0.14 L0.14 -0.14 L0.14 0.14 L-0.14 0.14 Z",
  // Hull: a structural lattice.
  grid: "M-0.3 -0.1 L0.3 -0.1 M-0.3 0.1 L0.3 0.1 M-0.1 -0.3 L-0.1 0.3 M0.1 -0.3 L0.1 0.3",
  // Blink drive: a portal ring with a notch.
  blink: "M0 -0.3 A0.3 0.3 0 1 1 -0.21 -0.21 M-0.1 0 L0.1 0 M0 -0.1 L0 0.1",
  // Afterburner: a flame.
  flame: "M0 0.32 C-0.26 0.12 -0.16 -0.16 0 -0.34 C0.16 -0.16 0.26 0.12 0 0.32 Z M0 0.18 C-0.1 0.06 -0.06 -0.06 0 -0.16 C0.06 -0.06 0.1 0.06 0 0.18 Z",
  // Signature/cloak/decoy: an eye (sensing/visibility).
  eye: "M-0.34 0 A0.4 0.3 0 0 1 0.34 0 A0.4 0.3 0 0 1 -0.34 0 Z M0 -0.1 A0.1 0.1 0 1 0 0.0001 -0.1",
  // Cloak/signature: a fading ghost outline.
  ghost: "M-0.24 0.3 L-0.24 -0.08 A0.24 0.24 0 0 1 0.24 -0.08 L0.24 0.3 L0.12 0.2 L0 0.3 L-0.12 0.2 Z",
  // Hangar: an open bay with chevrons.
  bay: "M-0.3 -0.2 L0.3 -0.2 L0.3 0.24 L-0.3 0.24 Z M-0.12 -0.2 L0 -0.04 L0.12 -0.2",
  // Mine: a spiked sphere.
  mine: "M0 -0.16 A0.16 0.16 0 1 0 0.0001 -0.16 M0 -0.32 L0 0.32 M-0.32 0 L0.32 0 M-0.22 -0.22 L0.22 0.22 M-0.22 0.22 L0.22 -0.22",
  // Boarding: a grapple hook.
  grapple: "M0 0.32 L0 -0.16 M-0.18 -0.16 A0.18 0.18 0 0 1 0.18 -0.16 M-0.18 -0.16 L-0.28 -0.3 M0.18 -0.16 L0.28 -0.3 M0 -0.16 L0 -0.34",
  // Command aura: concentric command rings with a centre pip.
  aura: "M0 -0.06 A0.06 0.06 0 1 0 0.0001 -0.06 M0 -0.2 A0.2 0.2 0 1 0 0.0001 -0.2 M0 -0.34 A0.34 0.34 0 1 0 0.0001 -0.34",
};

/**
 * A glyph cache so the battle canvas builds each `Path2D` once and reuses it
 * every frame across every ship and cell. Keyed by glyph; the path is in the
 * centred unit box, scaled by the caller's transform.
 */
const PATH_CACHE = new Map<GlyphKey, Path2D>();

export function glyphPath2D(glyph: GlyphKey): Path2D {
  const cached = PATH_CACHE.get(glyph);
  if (cached !== undefined) return cached;
  const path = new Path2D(GLYPH_PATHS[glyph]);
  PATH_CACHE.set(glyph, path);
  return path;
}
