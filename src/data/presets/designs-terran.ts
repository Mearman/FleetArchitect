import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { gridFromMap, mountMultiCell, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";
import { TERRAN_FOOTPRINTS } from "@/data/catalog/modules/terran-capital";

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
    grid: mountMultiCell(
      subdivideGrid(withEdges(gridFromMap([
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
      F_GUNSHIP,
      [
        // Twin Pulse Array on the central deck corridor (wingtip battery
        // upgrade), Twin Rail Turret on the lower deck corridor.
        [4, 1, "ter-twin-pulse-array", TERRAN_FOOTPRINTS.twinPulseArray],
        [4, 3, "ter-twin-rail-turret", TERRAN_FOOTPRINTS.twinRailTurret],
      ],
    ),
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
    grid: mountMultiCell(
      subdivideGrid(withEdges(gridFromMap([
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
      F_BULWARK,
      [
        // Damage Control Bay on the upper deck corridor near the reactor bay.
        [6, 1, "ter-damage-control-bay", TERRAN_FOOTPRINTS.damageControlBay],
      ],
    ),
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
    grid: mountMultiCell(
      subdivideGrid(withEdges(gridFromMap([
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
      F_AEGIS,
      [
        // Mine Layer Bank on the aft deck corridor — area-denial matching
        // the Aegis's armour-anchor doctrine.
        [5, 4, "ter-mine-layer-bank", TERRAN_FOOTPRINTS.mineLayerBank],
      ],
    ),
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
    grid: mountMultiCell(
      subdivideGrid(withEdges(gridFromMap([
        "#>Je~M#.#",
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
      F_TORPEDO,
      [
        // Broadside Missile Bank on the freed prow missile cell — capital-grade
        // alpha strike replacing the singleton wingtip rack.
        [4, 0, "ter-broadside-missile-bank", TERRAN_FOOTPRINTS.broadsideMissileBank],
      ],
    ),
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
    // The centre spine mounts a four-cell Spinal Lance (I) — a fixed-forward
    // 3.5 GW capital beam replacing the old broadside railgun at the keel. Its
    // three covered cells extend east within the keel block via `coverFootprint`
    // (the anchor token `I` carries the module id; the helper installs the
    // `covers` back-pointers at the matching fine sub-cells).
    //
    // Omni transceivers (O) bolted to the prow (rows 1 and 3, col 9) give fleet
    // squad-net coverage on channel 0. RCS thrusters (J) and reaction wheels (W)
    // on the spine let the capital come about.
    //
    // Layout (13 cols × 5 rows), subdivided ×7 → 91 m cruiser:
    // stern (left) → crew/reactor spine → corridors → magazine → weapons → prow
    grid: mountMultiCell(
      subdivideGrid(withEdges(gridFromMap([
        "#>JWUTRL..#..",
        ".EXCCT~RLO##.",
        "EXFCCGvI~L###",
        ".EXCCTRRLO##.",
        "#<JeW~TRL.#..",
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
      F_LEVIATHAN,
      [
        [7, 2, "ter-spinal-lance", TERRAN_FOOTPRINTS.spinalLance],
        // Light Spear Lance on the freed upper railgun cell — a fixed spinal
        // secondary beam for the cruiser.
        [6, 1, "ter-light-spear-lance", TERRAN_FOOTPRINTS.lightSpearLance],
        // Flak Bastion on the freed prow railgun cell — capital PD coverage.
        [8, 2, "ter-flak-bastion", TERRAN_FOOTPRINTS.flakBastion],
        // Bulwark Shield Bank on the freed stern shield cell — capital-grade
        // shield wall upgrading the Leviathan's Mk II.
        [5, 4, "ter-bulwark-shield-bank", TERRAN_FOOTPRINTS.bulwarkShieldBank],
      ],
    ),
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
    // The apex hull fields the full capital multi-cell kit. The centre spine
    // trades its railgun pair for a Spinal Mass Driver (Q, fixed-forward
    // coilgun) and a Heavy Railgun Turret (H); the port stern engine becomes a
    // Capital Plasma Drive (B); the keel antimatter core is replaced by the
    // four-cell Cross-Section Antimatter command core (Z); the stern shield
    // steps up to a 2×2 Bastion Shield Array (N); and the prow deflector
    // becomes a two-cell Bulwark Screen (k). Each anchor's covered cells are
    // installed by `mountMultiCell` after subdivision.
    //
    // Layout (13 cols × 5 rows), subdivided ×12 → 156 m dreadnought:
    // stern → engines → reactor/crew spine → crew decks → magazine → weapons → prow
    // C cells (crew quarters) line the central corridor; the G (magazine) cell
    // sits between the crew block and the weapon batteries so crew can haul ammo.
    grid: mountMultiCell(
      subdivideGrid(withEdges(gridFromMap([
        ".#>JWkvRML#..",
        ".BXCCW~RRML#.",
        "EZFCCG~QHMML#",
        ".EXCCW~RRML#.",
        ".#<JeWN~RML#.",
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
      F_TITAN,
      [
        // Centre-spine weapon pair: a fixed-forward spinal coilgun (Q) and a
        // heavy railgun turret (H), each claiming one extra keel sub-cell.
        [7, 2, "ter-spinal-driver", TERRAN_FOOTPRINTS.spinalDriver],
        [8, 2, "ter-heavy-railgun-turret", TERRAN_FOOTPRINTS.heavyRailTurret],
        // Port stern: a three-cell Capital Plasma Drive (B) replaces the ion
        // drive as the main propulsion.
        [1, 1, "ter-capital-drive", TERRAN_FOOTPRINTS.capitalDrive],
        // Keel reactor: the four-cell T-section Cross-Section Antimatter core
        // (Z) — the 12 GW command heart, supplanting the single antimatter X.
        [1, 2, "ter-cross-reactor", TERRAN_FOOTPRINTS.crossReactor],
        // Stern shield: the 2×2 Bastion Shield Array (N) replaces the Mk II.
        [6, 4, "ter-bastion-shield", TERRAN_FOOTPRINTS.bastionShield],
        // Prow momentum screen: the two-cell Bulwark Deflector (k).
        [5, 0, "ter-bulwark-deflector", TERRAN_FOOTPRINTS.bulwarkDeflector],
        // Plus-Section Fusion Core on the central keel deck corridor — a 7.5 GW
        // advanced-fusion command core alongside the existing antimatter heart.
        [6, 2, "ter-plus-reactor", TERRAN_FOOTPRINTS.plusReactor],
        // Compass Drone Hangar on the lower-deck corridor — drone capability,
        // a new doctrine angle for the Titan.
        [6, 3, "ter-drone-hangar", TERRAN_FOOTPRINTS.droneHangar],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
