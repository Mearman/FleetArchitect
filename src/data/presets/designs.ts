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
import type { TileGrid } from "@/schema/grid";
import { DREADNOUGHT_MAX_LENGTH_M, SHIP_LENGTH_METRES, bounds } from "@/domain/grid";

/**
 * Subdivide a coarse ASCII-authored grid so its hull length classifies into the
 * intended ship tier. Uses the **minimum** subdivision factor `f` that places
 * the hull just above the tier's lower length threshold, keeping the cell count
 * as small as possible so the simulation engine remains tractable.
 *
 * The tier thresholds are (from `deriveClassification`):
 *   fighter  : longestAxis ≤ 20 m  →  lowerBound = 0  (any f ≥ 1 stays fighter)
 *   frigate  : longestAxis > 20 m  →  lowerBound = 20 (need f × longest > 20)
 *   cruiser  : longestAxis > 60 m  →  lowerBound = 60 (need f × longest > 60)
 *   dreadnought : longestAxis > 150 m → lowerBound = 150 (need f × longest > 150)
 *
 * For fighters the target is the class upper bound (20 m) rather than zero, so
 * the hull fills out to a recognisable fighter length rather than staying at 1 m
 * per coarse cell; `Math.floor` is used so the result never exceeds the 20 m
 * threshold and accidentally classifies as a frigate.
 *
 * For frigates, cruisers, and dreadnoughts `Math.ceil` is used on `(lowerBound
 * + 1) / longest`, giving the smallest integer f such that f × longest >
 * lowerBound.  The upper-bound limit is then clamped to prevent a cruiser being
 * re-classified as a dreadnought.
 *
 * @param coarse - The coarse grid from `gridFromMap` / `swarmGrid` / etc.
 * @param lowerBound - Class threshold the output must **exceed** in metres.
 *   Pass 0 for fighters (use upper-bound clamping instead via `maxM`).
 * @param maxM - Upper length limit in metres. The resulting f is clamped so
 *   the output never exceeds this value and crosses into the next tier.
 */
function scaleToTier(coarse: TileGrid, lowerBound: number, maxM: number): TileGrid {
  const b = bounds(coarse);
  if (b === undefined) return coarse;
  const longest = Math.max(b.maxCol - b.minCol + 1, b.maxRow - b.minRow + 1);

  let f: number;
  if (lowerBound === 0) {
    // Fighter tier: pick the largest f that stays ≤ maxM (the 20 m upper
    // bound), so the ship fills out to a recognisable fighter hull.
    f = Math.max(1, Math.floor(maxM / longest));
  } else {
    // All other tiers: minimum f such that longest × f > lowerBound.
    f = Math.ceil((lowerBound + 1) / longest);
    // Clamp so we don't overshoot into the tier above.
    const maxF = Math.floor(maxM / longest);
    if (maxF >= 1) f = Math.min(f, maxF);
  }

  if (f <= 1) return coarse;
  return subdivideGrid(coarse, f);
}

// Class length thresholds (metres), taken from `deriveClassification`.
const FIGHTER_MAX_M  = SHIP_LENGTH_METRES.fighter;   // 20 m  (upper bound)
const FIGHTER_LB_M   = 0;                             // lower bound (any length is fighter)
const FRIGATE_MAX_M  = SHIP_LENGTH_METRES.frigate;   // 60 m  (upper bound)
const FRIGATE_LB_M   = SHIP_LENGTH_METRES.fighter;   // 20 m  (lower bound: must exceed this)
const CRUISER_MAX_M  = SHIP_LENGTH_METRES.cruiser;   // 150 m (upper bound)
const CRUISER_LB_M   = SHIP_LENGTH_METRES.frigate;   // 60 m  (lower bound)
const DREAD_MAX_M    = DREADNOUGHT_MAX_LENGTH_M;     // 300 m (upper bound; dreadnoughts may be ≤ 300 m)
const DREAD_LB_M     = SHIP_LENGTH_METRES.cruiser;   // 150 m (lower bound: must exceed this)

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
    grid: scaleToTier(gridFromMap([
      "..J~L..",
      ".E=#LV.",
      "EFFCC~L",
      ".E=#LO.",
      "..J~L..",
    ]), FIGHTER_LB_M, FIGHTER_MAX_M),
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
    grid: scaleToTier(gridFromMap([
      "..J~Mv.",
      "E=CFMM.",
      "EFCCGLL",
      "E=CFMM.",
      "..J~Mv.",
    ]), FIGHTER_LB_M, FIGHTER_MAX_M),
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
    // quarters, and an engine bank. The Mk I shields protect the flanks.
    grid: scaleToTier(gridFromMap([
      ".>JsRL..",
      ".EFC~sWR",
      "EFFCGv#R",
      ".EFC~sWR",
      ".<JeRL..",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    grid: scaleToTier(gridFromMap([
      ".>JWS~L.",
      ".EFCSS~L",
      "EEFFCSvL",
      ".EFCSS~L",
      ".<JeWS~e",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-aegis",
    name: "Aegis Monitor",
    faction: "Terran",
    // Frigate: an armour brawler. A blunt prow of ablative plating over a Mk I
    // shield soaks punishment while railgun turrets answer. The magazine (G) in
    // the central corridor feeds all railguns; slow but unyielding.
    grid: scaleToTier(gridFromMap([
      ".>J~~sR.",
      ".EFCCGsR",
      "EXEFWGvR",
      ".EFCCGsR",
      ".<JeW~se",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    // needed to man torpedoes and missiles; titanium armour and shields protect
    // the fragile innards.
    grid: scaleToTier(gridFromMap([
      ".>JeMM...",
      ".EFCCEWTT",
      "EXFGCv#TT",
      ".EFCCEWTT",
      ".<JeMM...",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    // through two magazines (G) to the torpedo and railgun batteries along the
    // flanks. A stepped armoured prow fronts the works; antimatter cores and a
    // five-engine stern bank drive the whole mass.
    //
    // Phase B: omni transceivers (O) bolted to the outer prow tips (rows 0 and 6
    // col 10) give fleet squad-net coverage on channel 0. Laser backbone links
    // (b) on rows 2 and 4 col 13 extend the high-bandwidth spine to relay ships
    // (dish/laser, also channel 0). Laser links are manned — crew can reach them
    // via the continuous walkable surface from the C cells in the interior.
    //
    // Layout (14 cols × 7 rows):
    // stern (left) → crew/reactor spine → corridors → magazines → weapons → prow
    // Merged: keeps the omni transceivers (O, prow tips rows 0/6) and the laser
    // backbone links (b, rows 2/4 col 13) for fleet squad-net, and adds RCS (J)
    // plus reaction wheels (W) on the spine so the capital can come about.
    grid: scaleToTier(gridFromMap([
      ".>JWSTRL..",
      ".EXCCTRRLO",
      "EXFCCGvRRL",
      ".EXCCGTRLO",
      ".<JeWSTRe.",
    ]), CRUISER_LB_M, CRUISER_MAX_M),
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
    // branching to magazines (G) that supply the railgun and missile batteries.
    // A great arrowhead prow of ablative armour and stacked Mk II shields fronts
    // banked weapon batteries; antimatter cores and crew decks drive a vast stern
    // engine bank. One anchors an entire fleet.
    //
    // Layout (19 cols × 9 rows):
    // stern → engines → reactor/crew spine → crew decks → magazines → weapons → prow
    // C cells (crew quarters) line the central corridor; G (magazine) cells sit
    // between the crew block and the weapon batteries so crew can haul ammo.
    grid: scaleToTier(gridFromMap([
      "..>JWSvRML...",
      ".EXCCW~RRMLL.",
      "EXFCCG~RRMMLL",
      ".EXCCW~RRMLL.",
      "..<JeWS~RMLe.",
    ]), DREAD_LB_M, DREAD_MAX_M),
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
    grid: scaleToTier(swarmGrid([
      ".>xpe",
      "jgfpp",
      ".<xph",
    ]), FIGHTER_LB_M, FIGHTER_MAX_M),
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
    grid: scaleToTier(swarmGrid([
      "..>xa..",
      "j=gfaa.",
      "ug~gfaa",
      "j=gfaa.",
      "..<xa..",
    ]), FIGHTER_LB_M, FIGHTER_MAX_M),
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
    grid: scaleToTier(swarmGrid([
      ".>jx~aa..",
      "jgf~zaaa.",
      "ugm~rfaaa",
      "jgf~zaaa.",
      ".<jx~aa..",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    grid: scaleToTier(swarmGrid([
      "..>xsnn...",
      ".jgfzsnnn.",
      "ugm~rfsnnn",
      ".jgfzsnnn.",
      "..<xsnn...",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    grid: scaleToTier(swarmGrid([
      "...>x~nnnk...",
      "..jgfzrsnnnnh",
      ".jgm~rfsannny",
      "ugmm~rfsaannn",
      ".jgm~rfsannny",
      "..jgfzrsnnnnh",
      "...<x~nnnk...",
    ]), CRUISER_LB_M, CRUISER_MAX_M),
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
    // A frigate built to phase in and out: an adaptive shield and prism beam
    // over a crystal spine, with a blink drive to reposition and a phase-cloak
    // to close unobserved. Brittle hull — it relies on shields and mobility.
    grid: scaleToTier(crystalGrid([
      "..##..",
      "ECSFLK",
      "..##..",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    grid: scaleToTier(foundryGrid([
      "###>#",
      "#CFA#",
      "EFAGe",
      "#CFA#",
      "###<#",
    ]), FIGHTER_LB_M, FIGHTER_MAX_M),
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
    grid: scaleToTier(foundryGrid([
      ".###>##",
      "ECFW~A#",
      "XFW~AGe",
      "ECFW~A#",
      ".###<##",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    grid: scaleToTier(foundryGrid([
      "..###>####.",
      ".#XCFW~AG##",
      "#XCCW~AAG##",
      "PXCCFW~MAGe",
      "#XCCW~AAG##",
      ".#XCFW~AG##",
      "..###<####.",
    ]), CRUISER_LB_M, CRUISER_MAX_M),
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
    grid: scaleToTier(foundryGrid([
      "...##>######.",
      "..##XCFW~AG##",
      ".##XCCW~AAG##",
      "##XCCCFW~MAG#",
      "PXCCCFW~MAGe.",
      "##XCCCFW~MAG#",
      ".##XCCW~AAG##",
      "..##XCFW~AG##",
      "...##<######.",
    ]), DREAD_LB_M, DREAD_MAX_M),
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
    grid: scaleToTier(corsairGrid([
      ".##>.",
      "ECFM#",
      "#FMGe",
      ".#<..",
    ]), FIGHTER_LB_M, FIGHTER_MAX_M),
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
    grid: scaleToTier(corsairGrid([
      ".####>.",
      "ECF##Me",
      "EFM~GJe",
      "#CFMGe.",
      "..##<..",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    grid: scaleToTier(corsairGrid([
      ".##>#####",
      "ECF~CM###",
      "EFMGCWM##",
      "#CFBGWM#.",
      "##FM<G##.",
      ".##e####.",
    ]), CRUISER_LB_M, CRUISER_MAX_M),
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
    grid: scaleToTier(syntheticGrid([
      ".##>..",
      "EPGCNe",
      ".##<..",
    ]), FIGHTER_LB_M, FIGHTER_MAX_M),
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
    grid: scaleToTier(syntheticGrid([
      ".#####>",
      "EXGCINe",
      "EPGCRN#",
      "EXGCINe",
      ".#####<",
    ]), FRIGATE_LB_M, FRIGATE_MAX_M),
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
    grid: scaleToTier(syntheticGrid([
      ".#########>",
      "EX~GRHAINe#",
      "EPAGRHAIN##",
      "EX~GRHAINe#",
      ".#########<",
    ]), CRUISER_LB_M, CRUISER_MAX_M),
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
    grid: scaleToTier(syntheticGrid([
      ".###########>",
      "EX~GHAINRR##e",
      "EX~GAHAINR##e",
      "EPXGAHAIRAN#e",
      "EX~GAHAINR##e",
      "EX~GHAINRR##e",
      ".###########<",
    ]), DREAD_LB_M, DREAD_MAX_M),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
