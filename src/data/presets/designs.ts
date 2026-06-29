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
  foundryGrid,
  gridFromMap,
  PRESET_TIME,
  swarmGrid,
  syntheticGrid,
} from "@/data/presets/tokens";
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
const F_DRONE    = 4;   // 5 m × 4 → 20 m (fighter)
const F_CARRION  = 2;   // 7 m × 2 → 14 m (fighter)
const F_RAVAGER  = 3;   // 9 m × 3 → 27 m (frigate)
const F_SPITTER  = 3;   // 10 m × 3 → 30 m (frigate)
const F_HIVE_LORD = 5;  // 13 m × 5 → 65 m (cruiser)
const F_SHARD    = 4;   // 11 m × 4 → 44 m (frigate)
const F_SPLINTER = 2;   // 8 m × 2 → 16 m (fighter)
const F_MONOLITH = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_INGOT    = 4;   // 5 m × 4 → 20 m (fighter)
const F_ANVIL    = 3;   // 7 m × 3 → 21 m (frigate)
const F_BATTLERAM = 6;  // 11 m × 6 → 66 m (cruiser)
const F_SIEGE_TITAN = 12; // 13 m × 12 → 156 m (dreadnought)
const F_CUTLASS  = 4;   // 5 m × 4 → 20 m (fighter)
const F_REAVER   = 3;   // 7 m × 3 → 21 m (frigate)
const F_WARBRINGER = 7; // 9 m × 7 → 63 m (cruiser)
const F_AUTOMATON = 3;  // 6 m × 3 → 18 m (fighter)
const F_NODE     = 3;   // 7 m × 3 → 21 m (frigate)
const F_NETWORK_HUB = 6; // 11 m × 6 → 66 m (cruiser)
const F_NEXUS_PRIME = 12; // 13 m × 12 → 156 m (dreadnought)

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
      "..J~L..",
      ".E=#LV.",
      "EFFCC~L",
      ".E=#LO.",
      "..J~L..",
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
      "..J~Mv.",
      "E=CFMM.",
      "EFCCGLL",
      "E=CFMM.",
      "..J~Mv.",
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
      ".>JsRL#.",
      ".EFC~sWR",
      "EFFCGv#R",
      ".EFC~sWR",
      ".<JeRL#.",
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
    // Frigate: a shield brawler using only pulse lasers. No finite-ammo weapons
    // means no magazine required. A broad Mk II shield wall fronts a laser bank;
    // triple fusion reactors and a deep crew and engine block run it.
    grid: subdivideGrid(gridFromMap([
      ".>JWS~L.",
      ".EFCSS~L",
      "EEFFCSvL",
      ".EFCSS~L",
      ".<JeWS~e",
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
    // Frigate: an armour brawler. A blunt prow of ablative plating (#) over a Mk
    // I shield soaks punishment while railgun turrets answer. The magazine (G) in
    // the central corridor feeds all railguns; slow but unyielding. The armoured
    // prow column caps the front of the railgun battery so incoming fire strikes
    // plate before it reaches the guns.
    grid: subdivideGrid(gridFromMap([
      ".>J~~sR#.",
      ".EFCCGsR#",
      "EXEFWGvR#",
      ".EFCCGsR#",
      ".<JeW~se#",
    ]), F_AEGIS),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-torpedo",
    name: "Vanguard Torpedo Boat",
    faction: "Terran",
    // Frigate: stand-off artillery. Spinal plasma torpedoes and wingtip missile
    // turrets hit enormously hard. The munitions magazine (G) sits in the
    // reactor bay feeding all weapons; five crew quarters sustain the large crew
    // needed to man torpedoes and missiles; titanium armour plate (#) on the prow
    // shoulders and core, plus shields, protect the fragile innards.
    grid: subdivideGrid(gridFromMap([
      ".>JeMM#..",
      ".EFCCEWTT",
      "EXFGCv#TT",
      ".EFCCEWTT",
      ".<JeMM#..",
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
      ".>JWSTRL..#..",
      ".EXCCTRRLO##.",
      "EXFCCGvRRL###",
      ".EXCCTRRLO##.",
      ".<JeWSTRL.#..",
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
      "..>JWSvRML#..",
      ".EXCCW~RRML#.",
      "EXFCCG~RRMML#",
      ".EXCCW~RRML#.",
      "..<JeWS~RML#.",
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
    // Fighter: the basic Swarm unit. A spore launcher snout, a neural ganglion
    // core, twin flagella — small, fast, expendable. No crew, no ammo.
    // Phase B: an electro-receptor membrane (e) and a pheromone net (h) extend
    // the Drone's awareness and connect it to the hive-net on channel 0. Both
    // are passive (no metabolic cost or crew), tucked onto the aft wing tips.
    // Merged: keeps the electro-receptor membrane (e) and pheromone net (h) for
    // hive-net awareness, and adds pseudopod clusters (x) so the Drone can turn.
    grid: subdivideGrid(swarmGrid([
      ".>xpe",
      "jgfpp",
      ".<xph",
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
    // Fighter: a fast acid flanker. Forward-swept acid claws strip armour at
    // knife range; paired flagella and a pulse jet make it the quickest hunter.
    grid: subdivideGrid(swarmGrid([
      "..>xa..",
      "j=gfaa.",
      "ug~gfaa",
      "j=gfaa.",
      "..<xa..",
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
      ".>jx~aa..",
      "jgf~zaaa.",
      "ugm~rfaaa",
      "jgf~zaaa.",
      ".<jx~aa..",
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
      "..>xsnn...",
      ".jgfzsnnn.",
      "ugm~rfsnnn",
      ".jgfzsnnn.",
      "..<xsnn...",
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
      "...>x~nnnkccc",
      "..jgfzrsnnnnh",
      ".jgm~rfsannny",
      "ugmm~rfsaannn",
      ".jgm~rfsannny",
      "..jgfzrsnnnnh",
      "...<x~nnnkccc",
    ]), F_HIVE_LORD),
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
      "EeFCCSBKvLH",
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
    // A fast phase fighter: a glass needle that closes under cloak, lands a
    // prism beam strike, and blinks away before the point defences track it.
    // A power crystal (F, command) and one resonator core (C, 5 berths for 4
    // crew) feed a prism beam (L), a blink drive (B), a phase-cloak (K), and a
    // resonance sensor (v). Balanced drives — an aft resonance thruster (E)
    // and a forward brake (e). Brittle armour caps (##) give it its dart
    // silhouette. Grid (8 cols × 3 rows), subdivided ×2 → 16 m fighter.
    grid: subdivideGrid(crystalGrid([
      "##....##",
      "EeFCvKBL",
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
      "E~#CCD~H~~~~Z",
      "Ee#X~Bv~~####",
      "E~#CCD~H~~~~Z",
      "..###~~~~####",
    ]), F_MONOLITH),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // ---------------------------------------------------------------------------
  // Foundry Combine — slow, heavily-armoured fortress slabs. Thick reactive
  // prows, autocannon broadsides, repair bays that weld damage shut. No
  // shields — they take every hit on the plate and keep coming.
  // ---------------------------------------------------------------------------
  {
    id: "preset-ship-ingot",
    name: "Ingot",
    faction: "Foundry",
    // Fighter: the Foundry's heavy interceptor. A squat five-by-five block of
    // reactive plating surrounds a compact autocannon battery and a pair of
    // crew barracks. Heavier than any comparable fighter; slow but almost
    // unkillable at close range. A single forge reactor and magazine feed the
    // guns; industrial thrusters push the whole mass forward.
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
    // Frigate: a five-row fortress slab with a deep reactive prow and an
    // autocannon battery fronted by a damage-control bay. Two forge reactors
    // feed the guns and welders; a shell magazine carries the ammunition;
    // a corridor of deck space lets the crew reach every station. No shields —
    // the Anvil absorbs fire until the enemy breaks.
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
    // Cruiser: a heavy siege platform. A thick reactive prow six cells deep
    // presents an enormous surface for incoming fire while autocannon banks
    // and mine layers work the flanks. Industrial cores and grav-drives push
    // the mass; two barracks blocks and a crew of welders keep it in the
    // fight long after lighter ships have folded. Slow and inexorable.
    grid: subdivideGrid(foundryGrid([
      "..###>####.",
      ".#XCFW~AG##",
      "#XCCW~AAG##",
      "PXCCFW~MAGe",
      "#XCCW~AAG##",
      ".#XCFW~AG##",
      "..###<####.",
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
    // Dreadnought: the Foundry's ultimate weapon. A walking fortress nine
    // rows wide, its prow a solid wall of reactive plating six cells thick.
    // Multiple industrial cores and grav-drives drag the mass forward; banks
    // of autocannons and mine layers cover every approach vector; a deep crew
    // complement mans the welders and magazines. Enemies either destroy it
    // before it closes range — or they do not.
    grid: subdivideGrid(foundryGrid([
      "...##>######.",
      "..##XCFW~AG##",
      ".##XCCW~AAG##",
      "##XCCCFW~MAG#",
      "PXCCCFW~MAGe.",
      "##XCCCFW~MAG#",
      ".##XCCW~AAG##",
      "..##XCFW~AG##",
      "...##<######.",
    ]), F_SIEGE_TITAN),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

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
    // find their rhythm.
    grid: subdivideGrid(corsairGrid([
      ".##>#####",
      "ECF~CM###",
      "EFMGCWM##",
      "#CFBGWM#.",
      "##FM<G##.",
      ".##e####.",
    ]), F_WARBRINGER),
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
];
