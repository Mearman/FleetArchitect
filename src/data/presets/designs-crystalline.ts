import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { crystalGrid, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";

// Crystalline Concord designs — phase skirmishers: adaptive shields, blink,
// cloak. Brittle crystal hulls that rely on shields and mobility, not bulk.
// Isolated from designs.ts so the roster file stays under the max-lines guard.

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_SHARD    = 4;   // 11 m × 4 → 44 m (frigate)
const F_SPLINTER = 2;   // 8 m × 2 → 16 m (fighter)
const F_MONOLITH = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_OBELISK  = 7;   // 11 m × 7 → 77 m (cruiser)

/** Crystalline Concord preset ship designs. */
export const crystallineDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-shard",
    name: "Shard",
    faction: "Crystalline",
    // A phase skirmisher built to blink in, strike, and cloak out. A power
    // crystal (F, command) and two resonator cores (C×2, 10 berths for 7 crew)
    // anchor a spine carrying an adaptive shield (S), a prism beam (L) and a
    // phase lance (H) as a twin beam battery, a blink drive (B), a resonance
    // sensor (v), and a phase-cloak (K). Balanced drives — an aft resonance
    // thruster (E) plus a forward-firing brake (e) — let it hold a kite. The
    // flanking armour caps (##) form its brittle crystal silhouette; it relies
    // on shields and mobility, not hull. Grid (11 cols × 3 rows), subdivided ×4
    // → 44 m frigate.
    grid: subdivideGrid(withEdges(crystalGrid([
      "###....####",
      "EeFCCSBKvRH",
      "###....####",
    ]), [
      { col: 1, row: 1, dir: "e", kind: "door" },
      { col: 4, row: 1, dir: "e", kind: "door" },
      { col: 8, row: 1, dir: "e", kind: "door" },
    ]), F_SHARD),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-splinter",
    name: "Splinter",
    faction: "Crystalline",
    // The lean cloak-striker fighter — the disposable screen Crystalline
    // otherwise lacks. A glass needle that closes under cloak, lands a prism
    // beam strike, and folds clear; it trades the Shard's signature kit (blink
    // drive, phase lance) for a bare-minimum raider. A power crystal (F,
    // command) and one resonator core (C, 5 berths for 3 crew) feed a prism
    // beam (L), a phase-cloak (K), and a resonance sensor (v). Balanced drives
    // — an aft resonance thruster (E) and a forward brake (e). Brittle armour
    // caps (##) give it its dart silhouette. Grid (8 cols × 3 rows),
    // subdivided ×2 → 16 m fighter.
    grid: subdivideGrid(withEdges(crystalGrid([
      "##....##",
      "EeFCvK~L",
      "##....##",
    ]), [
      { col: 6, row: 1, dir: "e", kind: "door" },
    ]), F_SPLINTER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-monolith",
    name: "Monolith",
    faction: "Crystalline",
    // A capital phase dreadnought: a crystal slab that throws a devastating
    // spinal-lance broadside from behind a wall of adaptive shields, then
    // blinks to a new bearing. A quantum lattice (X, command, 5 GW) drives two
    // spinal resonance lances (Z×2, fixed-forward) and two phase lances (H×2)
    // as the main battery, two adaptive bulwarks Mk II (D×2) for defence, a
    // blink drive (B), a resonance sensor (v), and four resonator cores (C×4,
    // 20 berths for 17 crew). Balanced drives — three aft resonance thrusters
    // (E×3) and a forward brake (e). An armour prow of crystal plate (#) caps
    // the weapon face; the rest is deck over a grown-crystal hull that relies
    // on its shields rather than bulk. Grid (13 cols × 5 rows), subdivided ×12
    // → 156 m dreadnought.
    grid: subdivideGrid(withEdges(crystalGrid([
      "..###~~~~####",
      "E~#CCQ~H~~~~Z",
      "Ee#X~Bv~~####",
      "E~#CCD~H~~~~Z",
      "..###~~~~####",
    ]), [
      { col: 4, row: 1, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "e", kind: "door" },
      { col: 4, row: 3, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "wall" },
      { col: 6, row: 1, dir: "e", kind: "wall" },
      { col: 6, row: 2, dir: "e", kind: "door" },
      { col: 6, row: 3, dir: "e", kind: "wall" },
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "door" },
      { col: 7, row: 3, dir: "e", kind: "wall" },
      { col: 11, row: 1, dir: "e", kind: "door" },
      { col: 11, row: 3, dir: "e", kind: "door" },
    ]), F_MONOLITH),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-obelisk",
    name: "Obelisk",
    faction: "Crystalline",
    // Cruiser: a standing-stone capital — the rung the Concord lacked between
    // the Shard frigate and the Monolith dreadnought. A beam-and-shard hybrid
    // that throws phase lances and lobbed resonance shards from behind a wall
    // of adaptive shielding, then overcharges its arrays and blinks to a new
    // bearing. A quantum lattice (X, command, 5 GW) drives two phase lances
    // (H×2) and a fixed-forward spinal resonance lance (Z) as the main battery,
    // two resonance cannons (Y×2) for lobbed shard fire — the previously
    // unfielded cry-resonance-cannon — an adaptive shield Mk II (D×2) and Mk I
    // (S) plus a resonance bulwark Mk II (Q) for defence, an overcharger (O)
    // — the previously unfielded cry-overcharger — to surge the arrays through
    // a brownout, a blink drive (B), a resonance sensor (v), and four
    // resonator cores (C×4, 20 berths for 20 crew). Balanced drives — three
    // aft resonance thrusters (E×3) and a forward brake (e). Crystal plate
    // (#) caps the prow; the grown-crystal hull relies on its shields and
    // mobility, not bulk. Implies phase doctrine (evasive, long-range, blink
    // away from trouble). Grid (11 cols × 5 rows), subdivided ×7 → 77 m
    // cruiser.
    grid: subdivideGrid(withEdges(crystalGrid([
      "##~~~Y#####",
      "E#CCSDH~~~Z",
      "EeXOBv~~~~#",
      "E#CCQD~H~~~",
      "##~~~Y#####",
    ]), [
      { col: 1, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "wall" },
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "door" },
      { col: 7, row: 3, dir: "e", kind: "wall" },
      { col: 5, row: 0, dir: "s", kind: "door" },
      { col: 5, row: 3, dir: "s", kind: "door" },
    ]), F_OBELISK),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
