import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { gridFromMap, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";

// Terran designs — ferro-steel hulls, energy shields, conventional drives.
// Angular, symmetrical warships with armoured prows and aft engine banks.
// Isolated from designs.ts so the roster file stays under the max-lines guard.

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the ship reaches its physical scale. Chosen so the longest occupied
// axis of the subdivided hull classifies to the correct tier per
// `deriveClassification` (fighter ≤ 20 m, frigate ≤ 60 m, cruiser ≤ 150 m,
// dreadnought > 150 m). Fixed per design — no dynamic tier-pinning logic.
const F_SABRE     = 2;   // 7 m × 2 → 14 m (fighter)
const F_WASP      = 2;   // 8 m × 2 → 16 m (fighter)
const F_GUNSHIP   = 3;   // 8 m × 3 → 24 m (frigate)
const F_BULWARK   = 3;   // 8 m × 3 → 24 m (frigate)
const F_AEGIS     = 3;   // 9 m × 3 → 27 m (frigate)
const F_TORPEDO   = 3;   // 9 m × 3 → 27 m (frigate)
const F_LEVIATHAN = 7;   // 13 m × 7 → 91 m (cruiser)
const F_TITAN     = 12;  // 13 m × 12 → 156 m (dreadnought)

/** Terran preset ship designs. */
export const terranDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-sabre",
    name: "Sabre Interceptor",
    faction: "Terran",
    // Fighter: a darting laser interceptor. Pulse lasers need no ammo supply
    // so no magazine is required. A central crew deck and fusion reactor keep
    // the design self-sufficient; swept hull struts give it its silhouette.
    // Phase B: a long-range scanner (V) on the starboard wing tip and an omni
    // transceiver (O) on the port wing tip make the Sabre the fleet's eyes —
    // it scouts ahead and relays contact data back on channel 0. The central
    // hull block is replaced by a second crew bay so the scanner operator has
    // a berth. crewRequired 9 / crewCapacity 16 — comfortably manned.
    // Merged: keeps the scanner (V) and omni transceiver (O), and adds RCS
    // thrusters (J) on the nose and tail so the Sabre can actually slew.
    grid: subdivideGrid(withEdges(gridFromMap([
      "..J~L##",
      ".E=#LV.",
      "EFFCC~L",
      ".E=#LO.",
      "..J~L##",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 2, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
    ]), F_SABRE),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-wasp",
    name: "Wasp Skirmisher",
    faction: "Terran",
    // Fighter-sized missile skirmisher. The central munitions magazine (G)
    // replaces the hull block in the ship's spine, feeding all wingtip missile
    // turrets — the whole ship is 4-connected so crew can walk from any
    // crew-quarters cell to the magazine and back. Plasma drives give good speed.
    grid: subdivideGrid(withEdges(gridFromMap([
      "..J~Mv#",
      "E=CFMM.",
      "EFCCGLL",
      "E=CFMM.",
      "..J~Mv#",
    ]), [
      { col: 1, row: 2, dir: "e", kind: "door" },
    ]), F_WASP),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-gunship",
    name: "Vanguard Gunship",
    faction: "Terran",
    // Frigate: the balanced workhorse. A spinal railgun battery backed by a
    // central magazine (G) fed by a floor corridor, twin fusion reactors, crew
    // quarters, and an engine bank. The Mk I shields protect the flanks, and a
    // light armour shoulder (#) caps each prow corner ahead of the railguns.
    grid: subdivideGrid(withEdges(gridFromMap([
      ".>JsRL##",
      ".EFC~YWR",
      "EFFCGv#R",
      ".EFC~sWR",
      ".<JeRL##",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
      { col: 2, row: 3, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
      { col: 3, row: 0, dir: "e", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
      { col: 4, row: 0, dir: "e", kind: "wall" },
      { col: 4, row: 1, dir: "e", kind: "door" },
      { col: 4, row: 2, dir: "e", kind: "wall" },
      { col: 4, row: 3, dir: "e", kind: "door" },
      { col: 4, row: 4, dir: "e", kind: "wall" },
    ]), F_GUNSHIP),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-bulwark",
    name: "Bulwark Escort",
    faction: "Terran",
    // Frigate: the mobile shield brawler. Pulse-laser pressure behind a broad
    // Mk II shield wall, advancing with the line. A centre-line deflector Mk I
    // (Y) sheds kinetic rounds — this is what separates it from the Aegis (pure
    // armour anchor) and lets it screen a Leviathan against railgun spam. No
    // finite-ammo weapons means no magazine required; fusion reactors and a deep
    // crew and engine block run it.
    grid: subdivideGrid(withEdges(gridFromMap([
      "#>JWS~L#",
      ".EFCYS~L",
      "EEFFCYvL",
      ".EFCSS~L",
      "#<JeWS~#",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
      { col: 2, row: 3, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
      { col: 3, row: 0, dir: "e", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "door" },
      { col: 3, row: 2, dir: "e", kind: "wall" },
      { col: 3, row: 3, dir: "e", kind: "door" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 0, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "door" },
      { col: 5, row: 2, dir: "e", kind: "wall" },
      { col: 5, row: 3, dir: "e", kind: "door" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
    ]), F_BULWARK),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-aegis",
    name: "Aegis Monitor",
    faction: "Terran",
    // Frigate: the pure armour anchor. No shields — it leans entirely on a blunt
    // prow of ablative plating, thickened into a solid cap. Deflector Mk I
    // screens stop the kinetics that would otherwise strip the plate, while
    // railgun turrets answer over the top. The magazine (G) in the central
    // corridor feeds all railguns; slow, unyielding, the thing you park in
    // front of a Leviathan. This is the clean split with the Bulwark: Bulwark =
    // shields + mobility, Aegis = plate + momentum screen.
    grid: subdivideGrid(withEdges(gridFromMap([
      "#>J~~YR##",
      ".EFCCG#R#",
      "EXEFWGvY#",
      ".EFCCG#R#",
      "#<JeW~#e#",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
      { col: 2, row: 3, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
      { col: 4, row: 0, dir: "e", kind: "wall" },
      { col: 4, row: 1, dir: "e", kind: "door" },
      { col: 4, row: 2, dir: "e", kind: "wall" },
      { col: 4, row: 3, dir: "e", kind: "door" },
      { col: 4, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 0, dir: "e", kind: "door" },
      { col: 5, row: 2, dir: "e", kind: "door" },
    ]), F_AEGIS),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-torpedo",
    name: "Bombard Torpedo Boat",
    faction: "Terran",
    // Frigate: stand-off artillery. Spinal plasma torpedoes and wingtip missile
    // turrets hit enormously hard. The munitions magazine (G) sits in the
    // reactor bay feeding all weapons; five crew quarters sustain the large crew
    // needed to man torpedoes and missiles; titanium armour plate (#) on the prow
    // shoulders and core, plus shields, protect the fragile innards.
    grid: subdivideGrid(withEdges(gridFromMap([
      "#>JeMM#.#",
      ".EFCCEWTT",
      "EXFGCv#TT",
      ".EFCCEWTT",
      "#<JeMM#.#",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
      { col: 2, row: 3, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
      { col: 4, row: 0, dir: "e", kind: "wall" },
      { col: 4, row: 1, dir: "e", kind: "door" },
      { col: 4, row: 2, dir: "e", kind: "wall" },
      { col: 4, row: 3, dir: "e", kind: "door" },
      { col: 4, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "door" },
    ]), F_TORPEDO),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-leviathan",
    name: "Leviathan Battleship",
    faction: "Terran",
    // Cruiser: a true capital broadside. Corridors (~) run from the crew block
    // through the magazine (G) to the torpedo and railgun batteries along the
    // flanks. A stepped armoured prow of ablative plate (#) caps the weapon
    // face — a 1-2-3-2-1 arrowhead shouldering forward to the centre row, so
    // incoming fire strikes plate before it reaches the guns; antimatter cores
    // and a five-engine stern bank drive the whole mass.
    //
    // Omni transceivers (O) bolted to the prow (rows 1 and 3, col 9) give fleet
    // squad-net coverage on channel 0. RCS thrusters (J) and reaction wheels (W)
    // on the spine let the capital come about.
    //
    // Layout (13 cols × 5 rows), subdivided ×7 → 91 m cruiser:
    // stern (left) → crew/reactor spine → corridors → magazine → weapons → prow
    grid: subdivideGrid(withEdges(gridFromMap([
      "#>JWUTRL..#..",
      ".EXCCTRRLO##.",
      "EXFCCGvRRL###",
      ".EXCCTRRLO##.",
      "#<JeWSTRL.#..",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
      { col: 2, row: 3, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
      { col: 4, row: 0, dir: "e", kind: "wall" },
      { col: 4, row: 1, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "e", kind: "door" },
      { col: 4, row: 3, dir: "e", kind: "wall" },
      { col: 4, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 0, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "wall" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "door" },
      { col: 7, row: 3, dir: "e", kind: "wall" },
    ]), F_LEVIATHAN),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-titan",
    name: "Titan Dreadnought",
    faction: "Terran",
    // Capital: the apex Terran hull — a true dreadnought with a proper crewed
    // interior. Floor corridors (~) run fore–aft through the ship's core,
    // branching to a magazine (G) that supplies the railgun and missile
    // batteries. A great arrowhead prow of ablative armour (#) sweeps forward
    // from the weapon face — a diagonal cap pointing at the prow tip (centre
    // row, col 12), shouldering back over the laser battery — so incoming fire
    // strikes plate before it reaches the guns; stacked shields front the banked
    // weapons. Antimatter cores and crew decks drive a vast stern engine bank.
    // One anchors an entire fleet.
    //
    // Layout (13 cols × 5 rows), subdivided ×12 → 156 m dreadnought:
    // stern → engines → reactor/crew spine → crew decks → magazine → weapons → prow
    // C cells (crew quarters) line the central corridor; the G (magazine) cell
    // sits between the crew block and the weapon batteries so crew can haul ammo.
    grid: subdivideGrid(withEdges(gridFromMap([
      ".#>JWUvRML#..",
      ".EXCCW~RRML#.",
      "EXFCCG~RRMML#",
      ".EXCCW~RRML#.",
      ".#<JeWS~RML#.",
    ]), [
      { col: 1, row: 1, dir: "e", kind: "wall" },
      { col: 1, row: 2, dir: "e", kind: "door" },
      { col: 1, row: 3, dir: "e", kind: "wall" },
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
      { col: 2, row: 3, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
      { col: 4, row: 0, dir: "e", kind: "wall" },
      { col: 4, row: 1, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "e", kind: "door" },
      { col: 4, row: 3, dir: "e", kind: "wall" },
      { col: 4, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 0, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "wall" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
      { col: 6, row: 0, dir: "e", kind: "wall" },
      { col: 6, row: 1, dir: "e", kind: "door" },
      { col: 6, row: 2, dir: "e", kind: "wall" },
      { col: 6, row: 3, dir: "e", kind: "door" },
      { col: 6, row: 4, dir: "e", kind: "wall" },
      { col: 7, row: 0, dir: "e", kind: "wall" },
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "door" },
      { col: 7, row: 3, dir: "e", kind: "wall" },
      { col: 7, row: 4, dir: "e", kind: "wall" },
    ]), F_TITAN),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
