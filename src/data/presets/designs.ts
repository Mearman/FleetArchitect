import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** The input shape of a ShipDesign: fields with a schema default are optional
 *  here, so preset literals omit them. `presetDesigns` (in ./index.ts) runs
 *  each entry through `ShipDesign.parse`, which fills the defaults and returns
 *  a full `ShipDesign`. */
type ShipDesignInput = input<typeof ShipDesign>;

import { foundryDesigns } from "@/data/presets/designs-foundry";
import { terranDesigns } from "@/data/presets/designs-terran";
import { swarmDesigns } from "@/data/presets/designs-swarm";
import { crystallineDesigns } from "@/data/presets/designs-crystalline";
import { corsairDesigns } from "@/data/presets/designs-corsair";
import { syntheticDesigns } from "@/data/presets/designs-synthetic";

// Authoring note on orientation: ships face +x (to the right). A cell's world
// x grows with its column, so the RIGHTMOST columns are the prow (forward) and
// the LEFTMOST are the stern — engines (`E`/`P`, `j`/`u`) sit at the left edge
// firing aft, weapons cluster toward the right. Empty cells (`.`) carve the
// silhouette: tapered prows, swept-back wings, engine nacelles. Rows are the
// beam (top-to-bottom) axis; designs are mirrored top/bottom so they fly true.
//
// Phase D interior design notes:
// - `~` (floor / corridor) tiles connect modules to quarters and magazines.
// - `G` (munitions magazine) must appear on every ship with finite-ammo weapons
//   (railguns, missiles, torpedoes). All occupied cells are walkable, so a
//   connected ship with at least one `G` automatically satisfies the
//   noAmmoSource reachability check.
// - Crew quarters (`C`) are needed whenever any module has crewRequired > 0.
//   All Terran modules with crew draw on the connected walkable surface, so
//   any connected design with crew quarters satisfies unreachableStation.
//
// Per-faction designs live in their own `designs-<faction>.ts` files (each kept
// under the max-lines guard) and are spread into the roster here in doctrine
// order: Terran → Swarm → Crystalline → Foundry → Corsair → Synthetic.
export const designData: ShipDesignInput[] = [
  ...terranDesigns,
  ...swarmDesigns,
  ...crystallineDesigns,
  ...foundryDesigns,
  ...corsairDesigns,
  ...syntheticDesigns,
];
