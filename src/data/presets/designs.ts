import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** The input shape of a ShipDesign: fields with a schema default are optional
 *  here, so preset literals omit them. `presetDesigns` (in ./index.ts) runs
 *  each entry through `ShipDesign.parse`, which fills the defaults and returns
 *  a full `ShipDesign`. */
type ShipDesignInput = input<typeof ShipDesign>;

import {
  corsairGrid,
  crystalGrid,
  gridFromMap,
  PRESET_TIME,
  swarmGrid,
  syntheticGrid,
} from "@/data/presets/tokens";
import { foundryDesigns } from "@/data/presets/designs-foundry";
import { subdivideGrid } from "@/domain/shipgen";

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the ship reaches its physical scale. Chosen so the longest occupied
// axis of the subdivided hull classifies to the correct tier per
// `deriveClassification` (fighter ≤ 20 m, frigate ≤ 60 m, cruiser ≤ 150 m,
// dreadnought > 150 m). Fixed per design — no dynamic tier-pinning logic.
const F_SABRE    = 2;   // 7 m × 2 → 14 m (fighter)
const F_WASP     = 2;   // 8 m × 2 → 16 m (fighter)
const F_GUNSHIP  = 3;   // 8 m × 3 → 24 m (frigate)
const F_BULWARK  = 3;   // 8 m × 3 → 24 m (frigate)
const F_AEGIS    = 3;   // 9 m × 3 → 27 m (frigate)
const F_TORPEDO  = 3;   // 9 m × 3 → 27 m (frigate)
const F_LEVIATHAN = 7;  // 13 m × 7 → 91 m (cruiser)
const F_TITAN    = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_DRONE    = 3;   // 6 m × 3 → 18 m (fighter; armour sits on the left edge
                        // only so chamfer growth leaves the longest axis ≤ 20 m)
const F_CARRION  = 2;   // 7 m × 2 → 14 m (fighter)
const F_RAVAGER  = 3;   // 9 m × 3 → 27 m (frigate)
const F_SPITTER  = 3;   // 10 m × 3 → 30 m (frigate)
const F_HIVE_LORD = 5;  // 13 m × 5 → 65 m (cruiser)
const F_DEVOURER = 12;  // 14 m × 12 → 168 m (dreadnought)
const F_SHARD    = 4;   // 11 m × 4 → 44 m (frigate)
const F_SPLINTER = 2;   // 8 m × 2 → 16 m (fighter)
const F_OBELISK  = 7;   // 11 m × 7 → 77 m (cruiser)
const F_MONOLITH = 12;  // 13 m × 12 → 156 m (dreadnought)
// Foundry designs live in designs-foundry.ts (kept the roster file under the
// max-lines guard); their subdivision factors are declared there.
const F_CUTLASS  = 4;   // 5 m × 4 → 20 m (fighter)
const F_REAVER   = 3;   // 7 m × 3 → 21 m (frigate)
const F_WARBRINGER = 7; // 10 m × 7 → 70 m (cruiser)
const F_MARAUDER = 3;   // 9 m × 3 → 27 m (frigate)
const F_GALLEON  = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_AUTOMATON = 3;  // 6 m × 3 → 18 m (fighter)
const F_NODE     = 3;   // 7 m × 3 → 21 m (frigate)
const F_NETWORK_HUB = 6; // 11 m × 6 → 66 m (cruiser)
const F_NEXUS_PRIME = 12; // 13 m × 12 → 156 m (dreadnought)
const F_MAINFRAME = 7;  // 11 m × 7 → 77 m (cruiser)

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

export const designData: ShipDesignInput[] = [
  // ===========================================================================
  // Terran designs — ferro-steel hulls, energy shields, conventional drives.
  // Angular, symmetrical warships with armoured prows and aft engine banks.
  // ===========================================================================
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
    grid: subdivideGrid(gridFromMap([
      "..J~L##",
      ".E=#LV.",
      "EFFCC~L",
      ".E=#LO.",
      "..J~L##",
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
    grid: subdivideGrid(gridFromMap([
      "..J~Mv#",
      "E=CFMM.",
      "EFCCGLL",
      "E=CFMM.",
      "..J~Mv#",
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
    grid: subdivideGrid(gridFromMap([
      ".>JsRL##",
      ".EFC~YWR",
      "EFFCGv#R",
      ".EFC~sWR",
      ".<JeRL##",
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
    grid: subdivideGrid(gridFromMap([
      "#>JWS~L#",
      ".EFCYS~L",
      "EEFFCYvL",
      ".EFCSS~L",
      "#<JeWS~#",
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
    grid: subdivideGrid(gridFromMap([
      "#>J~~YR##",
      ".EFCCG#R#",
      "EXEFWGvY#",
      ".EFCCG#R#",
      "#<JeW~#e#",
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
    grid: subdivideGrid(gridFromMap([
      "#>JeMM#.#",
      ".EFCCEWTT",
      "EXFGCv#TT",
      ".EFCCEWTT",
      "#<JeMM#.#",
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
    grid: subdivideGrid(gridFromMap([
      "#>JWUTRL..#..",
      ".EXCCTRRLO##.",
      "EXFCCGvRRL###",
      ".EXCCTRRLO##.",
      "#<JeWSTRL.#..",
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
    grid: subdivideGrid(gridFromMap([
      ".#>JWUvRML#..",
      ".EXCCW~RRML#.",
      "EXFCCG~RRMML#",
      ".EXCCW~RRML#.",
      ".#<JeWS~RML#.",
    ]), F_TITAN),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // ===========================================================================
  // Swarm designs — bio-organic insectoid ships. Asymmetric, clawed, organic
  // silhouettes: tapered stingers, swept carapace, clustered drive flagella.
  //
  // Swarm weapons are all bio-organic — spore launchers (cannon), acid sprayers
  // (beam), and neural stings (missile with tracking). Neural stings have no
  // ammoCapacity in the schema (they are guided bio-electric tendrils, not
  // discrete rounds), so no ammon sac is needed even for sting-armed ships.
  // All Swarm crewRequired values are 0; no crew quarters are needed either.
  // ===========================================================================
  {
    id: "preset-ship-drone",
    name: "Drone Skimmer",
    faction: "Swarm",
    // Fighter: the expendable chaff brawler — the brick the Swarm throws in
    // numbers. A spore launcher snout and a neural ganglion core over twin
    // flagella, with a regen-membrane spine (r) running fore–aft through the
    // hull so a Drone cloud knits back together and survives the approach.
    // Tougher but slower than the Carrion flanker (no pulse jet). No crew, no
    // ammo. An electro-receptor membrane (e) and a pheromone net (h) sit on the
    // aft wing tips for hive-net awareness on channel 0; pseudopod clusters (x)
    // let it turn.
    grid: subdivideGrid(swarmGrid([
      "#>xpre",
      "jgfprp",
      "#<xprh",
    ]), F_DRONE),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-carrion",
    name: "Carrion Wing",
    faction: "Swarm",
    // Fighter: the glass-cannon knife-range flanker — the blade that gets
    // behind armour and strips it. Opposite of the Drone: faster and more
    // fragile. Forward-swept acid claws dissolve plate at knife range; a pulse
    // jet (u) over the flagella gives it the speed edge. The armour shoulders
    // are gone — only a pair of carapace screens (w) at the prow offer token
    // kinetic defence. The ganglion core and flagella bank fill out the hull.
    grid: subdivideGrid(swarmGrid([
      "..>xaw.",
      "j~gfaa.",
      "ug~gfaa",
      "j~gfaa.",
      "..<xaw.",
    ]), F_CARRION),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-ravager",
    name: "Ravager Assault Ship",
    faction: "Swarm",
    // Frigate: a regenerating brawler. Banks of acid sprayers over a
    // self-knitting carapace, a metabolic core, and a cluster of flagella and
    // pulse jets. No discrete ammo weapons so no ammon sac needed.
    grid: subdivideGrid(swarmGrid([
      "#>jx~aa##",
      "jgf~zaaa.",
      "ugm~rfaaa",
      "jgf~zaaa.",
      "#<jx~aa##",
    ]), F_RAVAGER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-spitter",
    name: "Brood Spitter",
    faction: "Swarm",
    // Frigate: living artillery. A fan of neural stingers spits homing tendrils
    // downrange; spore clouds screen it. Neural stings have no ammoCapacity so
    // no ammon sac is required. Regen membranes and a metabolic core sustain it.
    grid: subdivideGrid(swarmGrid([
      ".#>xsnn#..",
      ".jgfzsnnn.",
      "ugm~rfsnnn",
      ".jgfzsnnn.",
      ".#<xsnn#..",
    ]), F_SPITTER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-hive-lord",
    name: "Hive Lord",
    faction: "Swarm",
    // Cruiser: the swarm capital. A great clawed prow of neural stingers and
    // acid sprayers over a regenerating carapace, ringed by spore-cloud defences,
    // with a metabolic heart and a bank of pulse-jet flagella driving the whole
    // mass. No discrete ammo weapons; no ammon sac needed.
    // Phase B: pheromone nets (h) on rows 1 and 5 provide omni squad-net
    // coverage on channel 0. Chemosensor organs (y) on rows 2 and 4 extend
    // the hive's detection reach well beyond weapon range. A biolaser spine
    // (k) on row 3 extends the Hive Lord to a high-bandwidth backbone relay
    // linking other hive-kin on the same channel. All bio-comms/sensors are
    // autonomous (crewRequired 0), adding only metabolic draw.
    // Merged: keeps the biolaser spines (k), pheromone nets (h) and chemosensor
    // organs (y) for hive-net coverage, and adds pseudopod clusters (x) plus
    // gyral organs (z) on the spine so the capital can come about.
    grid: subdivideGrid(swarmGrid([
      "..#>x~nnnkccc",
      "..jgfzrsnnnnh",
      ".jgm~rfsannny",
      "ugmm~rfsaannn",
      ".jgm~rfsannny",
      "..jgfzrsnnnnh",
      "..#<x~nnnkccc",
    ]), F_HIVE_LORD),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-devourer",
    name: "Devourer",
    faction: "Swarm",
    // Dreadnought: the bio-capital — a vast spawning organism whose prow is a
    // wall of neural stings and acid sprayers, ringed by spore clouds and
    // carapace screens, with a metabolic heart and a biolaser-spine relay
    // linking the brood. Five metabolic cores and a ganglion ring drive the
    // mass; regen membranes knit the carapace; pseudopod and gyral organs let
    // it come about. It is a force multiplier for the brood, not a solo killer
    // — no spinal-lance-class alpha, just short-range sting and acid pressure
    // behind a screen of spores and living momentum baffles. Neural stings have
    // no ammoCapacity so no ammon sac is required; all Swarm modules are
    // crewless. Implies hive doctrine (aggressive short-range).
    //
    // Layout (14 cols × 7 rows), subdivided ×12 → 168 m dreadnought:
    // stern (left) → drive flagella → ganglion/metabolic spine →
    // regen + spore-cloud screen → sting/acid battery → carapace-screened prow.
    grid: subdivideGrid(swarmGrid([
      "..#>x~nnnkwccc",
      "..jgfzrsnnnnwh",
      ".jgm~rfsannnwy",
      "ugmmmrfsaannnw",
      ".jgm~rfsannnwy",
      "..jgfzrsnnnnwh",
      "..#<x~nnnkwccc",
    ]), F_DEVOURER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // ---------------------------------------------------------------------------
  // Crystalline Concord — phase skirmishers: adaptive shields, blink, cloak.
  // ---------------------------------------------------------------------------
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
    grid: subdivideGrid(crystalGrid([
      "###....####",
      "EeFCCSBKvRH",
      "###....####",
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
    grid: subdivideGrid(crystalGrid([
      "##....##",
      "EeFCvK~L",
      "##....##",
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
    grid: subdivideGrid(crystalGrid([
      "..###~~~~####",
      "E~#CCQ~H~~~~Z",
      "Ee#X~Bv~~####",
      "E~#CCD~H~~~~Z",
      "..###~~~~####",
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
    grid: subdivideGrid(crystalGrid([
      "##~~~Y#####",
      "E#CCSDH~~~Z",
      "EeXOBv~~~~#",
      "E#CCQD~H~~~",
      "##~~~Y#####",
    ]), F_OBELISK),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // ---------------------------------------------------------------------------
  // Foundry Combine — slow, heavily-armoured fortress slabs. Thick reactive
  // prows, repair bays that weld damage shut, and now real capital weapons.
  // Designs live in designs-foundry.ts (keeps this file under the max-lines
  // guard) and are spread into the roster here.
  // ---------------------------------------------------------------------------
  ...foundryDesigns,


  // ---------------------------------------------------------------------------
  // Corsair Reavers — asymmetric scavenger hulls. One heavy side, one light
  // side; ragged silhouettes; missile volleys and scrambled ECM. Strike fast,
  // blink out, let the Foundry wonder what hit it.
  // ---------------------------------------------------------------------------
  {
    id: "preset-ship-cutlass",
    name: "Cutlass",
    faction: "Corsair",
    // Fighter: a fast asymmetric raider interceptor. The upper hull carries
    // heavier plating and a pair of missile racks; the lower hull is stripped
    // back for engine clearance. A salvaged reactor and magazine keep the
    // volley sustained; lateral drives give it the edge in a turning fight.
    grid: subdivideGrid(corsairGrid([
      ".##>.",
      "ECFM#",
      "#FMGe",
      ".#<..",
    ]), F_CUTLASS),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-reaver",
    name: "Reaver",
    faction: "Corsair",
    // Frigate: the classic asymmetric raider. The top half carries armour and
    // missile racks; the bottom is engine-heavy with a scrambler and a blink
    // drive for the getaway. Crew quarters sit off-centre on the lighter side.
    // It looks like it was assembled in a hurry from three different ships —
    // which it was — and it works exactly because of that.
    grid: subdivideGrid(corsairGrid([
      ".####>.",
      "ECF##Me",
      "EFM~GJe",
      "#CFMGe.",
      "..##<..",
    ]), F_REAVER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-warbringer",
    name: "Warbringer",
    faction: "Corsair",
    // Cruiser: a massive raider hull with a blink drive and a swarm missile
    // complement that can strip shields off a Leviathan in a single volley.
    // Asymmetric by design: the upper section is all armour and missile
    // launchers, the lower section carries the drives and the blink core.
    // Raids in, empties the magazines, blinks out before the point defences
    // find their rhythm. A raid cannon (R) per broadside gives sustained fire
    // once the missile magazines run dry, and a holo decoy launcher (L) on
    // the lower stern covers its withdrawal.
    grid: subdivideGrid(corsairGrid([
      ".##>######",
      "ECF~CMR###",
      "EFMGCWMR##",
      "#CFBGWM##.",
      "##FM<GL##.",
      ".##e#####.",
    ]), F_WARBRINGER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-marauder",
    name: "Marauder",
    faction: "Corsair",
    // Frigate: the ambush payoff specialist — closes under cloak, looses
    // boarding pods (O) to disable a target's systems, then finishes with
    // raid cannons (R) at point-blank. A raider missile rack (M) softens the
    // approach and an ECM scrambler (J) spoils the return fire. Twin
    // magazines (G) feed the missile rack and pods; salvaged reactors and
    // crew quarters keep the raid sustained. Balanced raid drives — aft (E),
    // forward brake (e), lateral (>/<) — let it hold position long enough to
    // board, then scatter. Fields the previously unshipped cor-boarding-pod
    // as its primary armament. Implies raid doctrine (aggressive, short-range,
    // scatter). Grid (9 cols × 5 rows), subdivided ×3 → 27 m frigate.
    grid: subdivideGrid(corsairGrid([
      ".####>###",
      "ECFC#MRe#",
      "EFM~GJOe#",
      "#CFMGRe#.",
      "..##<O###",
    ]), F_MARAUDER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-galleon",
    name: "Galleon",
    faction: "Corsair",
    // Dreadnought: the pirate treasure-ship — a vast scavenger hull that
    // raids in with a storm of raider and swarm missiles, punch-through raid
    // cannons for sustained fire, and a pair of boarding pods (O) to finish
    // crippled capitals. Banks of salvaged reactors and deep magazines feed
    // the volley; an ECM scrambler (J) strips return fire and a holo decoy
    // launcher (L) covers the withdrawal. A blink drive (B) stands by for the
    // unthinkable (retreat). Balanced raid drives — aft (E×3), forward brake
    // (e), lateral (>/<) — drive the mass. Fields cor-boarding-pod,
    // cor-raid-cannon, cor-swarm-missile, and cor-decoy-launcher. Implies
    // raid doctrine. Grid (13 cols × 7 rows), subdivided ×12 → 156 m
    // dreadnought.
    grid: subdivideGrid(corsairGrid([
      "..##>########",
      ".ECF~CMR#####",
      "EFMG~CWMRR###",
      "#CFBGOOJMWLe#",
      "##FMG~CWMRR##",
      ".ECF~CMR#####",
      "..##<########",
    ]), F_GALLEON),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // ---------------------------------------------------------------------------
  // Synthetic Collective — hardwired, crewless drone hulls.
  // ---------------------------------------------------------------------------
  {
    id: "preset-ship-automaton",
    name: "Automaton",
    faction: "Synthetic",
    // Fighter: a compact autonomous combat drone. A single targeting cannon and
    // an active sensor array give it precision at range; a slug reservoir feeds
    // the cannon. No crew, no quarters — the processor runs the whole hull
    // alone. Armour rails top and bottom are the classic Synthetic silhouette.
    grid: subdivideGrid(syntheticGrid([
      ".##>..",
      "EPGCNe",
      ".##<..",
    ]), F_AUTOMATON),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-node",
    name: "Node",
    faction: "Synthetic",
    // Frigate: a crewless patrol hull with a five-row modular layout. Twin
    // quantum cores power a mixed battery — a precise cannon and a coilgun
    // flanked by an interceptor array and a sensor suite. Paired slug
    // reservoirs keep both weapons fed. Armour rails wrap the grid; an armour
    // cap seals the prow behind the gun battery.
    grid: subdivideGrid(syntheticGrid([
      ".#####>",
      "EXGCINe",
      "EPGCRN#",
      "EXGCINe",
      ".#####<",
    ]), F_NODE),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-network-hub",
    name: "Network Hub",
    faction: "Synthetic",
    // Cruiser: the Collective's fleet coordinator. A command processor and twin
    // quantum cores drive three interior rows — coilguns for direct fire,
    // drone hangars to saturate the engagement zone, coordination nodes that
    // extend the range and accuracy of every allied ship in range, a sensor
    // array, and an interceptor screen. Armour rails lock the hull into its
    // machine-precise frame; a double armour cap seals the prow on the
    // centre row.
    grid: subdivideGrid(syntheticGrid([
      ".#########>",
      "EX~GRHAINe#",
      "EPAGRHAIN##",
      "EX~GRHAINe#",
      ".#########<",
    ]), F_NETWORK_HUB),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-nexus-prime",
    name: "Nexus Prime",
    faction: "Synthetic",
    // Dreadnought: the Collective's apex hull. A master command processor and
    // five quantum cores deliver enormous output across a seven-row grid:
    // twin coilguns on the outer rows for sustained high-calibre fire, a
    // mixed battery of coilguns, coordination nodes, and drone hangars on
    // the inner rows, and a dense interceptor array behind the sensor suite.
    // Slug reservoirs on every interior row keep the coilguns fed
    // indefinitely. Armour rails and a double prow cap give the hull its
    // unmistakable machine silhouette — no crew, no quarters, just the
    // network.
    grid: subdivideGrid(syntheticGrid([
      ".###########>",
      "EX~GHAINRR##e",
      "EX~GAHAINR##e",
      "EPXGAHAIRAN#e",
      "EX~GAHAINR##e",
      "EX~GHAINRR##e",
      ".###########<",
    ]), F_NEXUS_PRIME),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-mainframe",
    name: "Mainframe",
    faction: "Synthetic",
    // Cruiser: the Collective's dedicated carrier. Where the Network Hub is a
    // generalist coordinator, the Mainframe is built around its drone hangars —
    // stacks of fabrication bays line every interior row, loosing autonomous
    // swarms to saturate the engagement zone. A single coilgun on the centre
    // line is the only direct fire; the hull's strength is the drones it
    // launches and the network it runs (coordination nodes extend every allied
    // ship's range and accuracy), screened by interceptor arrays and watched
    // over by active sensors. Twin quantum cores and a command processor power
    // the whole hardwired hull with no crew aboard.
    grid: subdivideGrid(syntheticGrid([
      ".#########>",
      "EX~GHHAINe#",
      "EPAGRHAIN##",
      "EX~GHHAINe#",
      ".#########<",
    ]), F_MAINFRAME),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
