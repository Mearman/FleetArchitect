import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { foundryGrid, PRESET_TIME } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";

// Foundry Combine designs, isolated from designs.ts so the roster file stays
// under the max-lines guard. Slow, heavily-armoured fortress slabs: thick
// reactive prows, repair bays that weld damage shut, and (after the roster
// review) real capital weapons — gauss, siege plasma, torpedoes, flak,
// bulwark deflectors. No shields — they take every hit on the plate.

// Subdivision factors: expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_INGOT       = 4;   // 5 m × 4 → 20 m (fighter)
const F_ANVIL       = 3;   // 7 m × 3 → 21 m (frigate)
const F_BATTLERAM   = 6;   // 11 m × 6 → 66 m (cruiser)
const F_SIEGE_TITAN = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_CRUCIBLE    = 3;   // 7 m × 3 → 21 m (frigate)
const F_CAULDRON    = 6;   // 11 m × 6 → 66 m (cruiser)

/** Foundry Combine preset ship designs. */
export const foundryDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-ingot",
    name: "Ingot",
    faction: "Foundry",
    // Fighter: the heavy interceptor. A squat block of reactive plating around
    // an autocannon battery and a pair of crew barracks; slow but near-unkillable.
    grid: subdivideGrid(foundryGrid([
      "###>#",
      "#CFA#",
      "EFAGe",
      "#CFA#",
      "###<#",
    ]), F_INGOT),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-anvil",
    name: "Anvil",
    faction: "Foundry",
    // Frigate: a fortress slab with a deep reactive prow and an autocannon
    // battery fronted by a damage-control bay. No shields — it absorbs fire.
    grid: subdivideGrid(foundryGrid([
      ".###>##",
      "ECFW~A#",
      "XFW~AGe",
      "ECFW~A#",
      ".###<##",
    ]), F_ANVIL),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-battleram",
    name: "Battleram",
    faction: "Foundry",
    // Cruiser, re-armed: heavy gauss cannons (H, fnd-heavy-cannon) form the
    // broadside, flak batteries (L) shred ordnance, a bulwark deflector (U)
    // arrests kinetics, a mine layer (M) holds the close lane, repair bay (W).
    grid: subdivideGrid(foundryGrid([
      "..###H####.",
      ".#XCFW~HAG#",
      "#XCCW~LUAG#",
      "PXCCFWHMAGe",
      "#XCCW~LUAG#",
      ".#XCFW~HAG#",
      "..###H####.",
    ]), F_BATTLERAM),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-siege-titan",
    name: "Siege Titan",
    faction: "Foundry",
    // Dreadnought, re-armed: siege-plasma mortars (Q) alpha, gauss cannons (H)
    // sustain, torpedoes (Y) crack plate, flak (L) and bulwark deflectors (U)
    // screen every vector — the previously unfielded capital battery. Plus
    // repair bays (W) and mine layers (M).
    grid: subdivideGrid(foundryGrid([
      "...##>######.",
      "..##XCFW~HL##",
      ".##XCCW~HQG##",
      "##XCCCFWUQMY#",
      "PXCCCFW~QHGe.",
      "##XCCCFWUQMY#",
      ".##XCCW~HQG##",
      "..##XCFW~HL##",
      "...##<######.",
    ]), F_SIEGE_TITAN),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-crucible",
    name: "Crucible",
    faction: "Foundry",
    // Frigate PD escort: flak batteries (L, fnd-flak-battery) flank an
    // autocannon (A) to shred incoming ordnance so the slabs reach range.
    // Repair bay (W), magazine (G), balanced drives. Grid 7×5, ×3 → 21 m.
    grid: subdivideGrid(foundryGrid([
      ".###>##",
      "ECFWL~#",
      "CFAGLGe",
      "ECFWL~#",
      ".###<##",
    ]), F_CRUCIBLE),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-cauldron",
    name: "Cauldron",
    faction: "Foundry",
    // Cruiser minelayer: sows minefields across approach lanes (M, five
    // layers) while heavy cannons (H) and flak (L) dissuade anything that
    // closes. Magazines (G) feed the ammo weapons; repair bays (W) sustain.
    grid: subdivideGrid(foundryGrid([
      "..###>####.",
      ".#XCFW~MLG#",
      "#XCCW~MHAG#",
      "PXCCFWMHAGe",
      "#XCCW~MHAG#",
      ".#XCFW~MLG#",
      "..###<####.",
    ]), F_CAULDRON),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
