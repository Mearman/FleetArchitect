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
    grid: gridFromMap([
      "...JL..",
      ".E=#LV.",
      "EFFCCLL",
      ".E=#LO.",
      "...JL..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-wasp",
    name: "Wasp Skirmisher",
    faction: "Terran",
    // Fighter-sized missile skirmisher. The central munitions magazine (G)
    // replaces the hull block in the ship's spine, feeding all wingtip missile
    // turrets — the whole ship is 4-connected so crew can walk from any
    // crew-quarters cell to the magazine and back. Plasma drives give good speed.
    grid: gridFromMap([
      "..JM..",
      "P=CFMM",
      "PFCCGL",
      "P=CFMM",
      "..JM..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-gunship",
    name: "Vanguard Gunship",
    faction: "Terran",
    // Frigate: the balanced workhorse. A spinal railgun battery backed by a
    // central magazine (G) fed by a floor corridor, twin fusion reactors, crew
    // quarters, and an engine bank. The Mk I shields protect the flanks.
    grid: gridFromMap([
      "..JsRL..",
      ".EFC~sWR",
      "EFFCG~#R",
      ".EFC~sWR",
      "..JsRL..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-bulwark",
    name: "Bulwark Escort",
    faction: "Terran",
    // Frigate: a shield brawler using only pulse lasers. No finite-ammo weapons
    // means no magazine required. A broad Mk II shield wall fronts a laser bank;
    // triple fusion reactors and a deep crew and engine block run it.
    grid: gridFromMap([
      ".JWS~L.",
      "EFCSS~L",
      "EFFCS~L",
      "EFCSS~L",
      ".JWS~L.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-aegis",
    name: "Aegis Monitor",
    faction: "Terran",
    // Frigate: an armour brawler. A blunt prow of ablative plating over a Mk I
    // shield soaks punishment while railgun turrets answer. The magazine (G) in
    // the central corridor feeds all railguns; slow but unyielding.
    grid: gridFromMap([
      ".J~~sR.",
      "EFCCGsR",
      "EXFWGsR",
      "EFCCGsR",
      ".J~~sR.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
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
    grid: gridFromMap([
      "..~JMM...",
      ".EFCC~WTT",
      "EXFGC~#TT",
      ".EFCC~WTT",
      "..~JMM...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
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
    grid: gridFromMap([
      "..JWSTRL..",
      ".EXCCTRRLO",
      "EXFCCGTRRL",
      ".EXCCGTRLO",
      "..JWSTRL..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
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
    grid: gridFromMap([
      "...JWS~RML...",
      ".EXCCW~RRMLL.",
      "EXFCCG~RRMMLL",
      ".EXCCW~RRMLL.",
      "...JWS~RML...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
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
    grid: swarmGrid([
      ".xpe",
      "jgpp",
      ".xph",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-carrion",
    name: "Carrion Wing",
    faction: "Swarm",
    // Fighter: a fast acid flanker. Forward-swept acid claws strip armour at
    // knife range; paired flagella and a pulse jet make it the quickest hunter.
    grid: swarmGrid([
      "..xa..",
      "j=gaa.",
      "ug~gaa",
      "j=gaa.",
      "..xa..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-ravager",
    name: "Ravager Assault Ship",
    faction: "Swarm",
    // Frigate: a regenerating brawler. Banks of acid sprayers over a
    // self-knitting carapace, a metabolic core, and a cluster of flagella and
    // pulse jets. No discrete ammo weapons so no ammon sac needed.
    grid: swarmGrid([
      ".jx~aa..",
      "jg~zaaa.",
      "ugm~raaa",
      "jg~zaaa.",
      ".jx~aa..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-spitter",
    name: "Brood Spitter",
    faction: "Swarm",
    // Frigate: living artillery. A fan of neural stingers spits homing tendrils
    // downrange; spore clouds screen it. Neural stings have no ammoCapacity so
    // no ammon sac is required. Regen membranes and a metabolic core sustain it.
    grid: swarmGrid([
      "..xsnn...",
      ".jgzsnnn.",
      "ugm~rsnnn",
      ".jgzsnnn.",
      "..xsnn...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
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
    grid: swarmGrid([
      "...x~nnnk...",
      "..jgzrsnnnnh",
      ".jgm~rsannny",
      "ugmm~rsaannn",
      ".jgm~rsannny",
      "..jgzrsnnnnh",
      "...x~nnnk...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
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
    grid: crystalGrid([
      "..##..",
      "ECSFLK",
      "..##..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },

  // ---------------------------------------------------------------------------
  // Foundry Combine — slow, heavily-armoured slabs.
  // ---------------------------------------------------------------------------
  {
    id: "preset-ship-anvil",
    name: "Anvil",
    faction: "Foundry",
    // A frigate that is more plating than ship: forged bulkheads over an
    // autocannon and a damage-control bay, with a shell magazine feeding the
    // gun. No shields — it absorbs fire with raw structure and welds it shut.
    grid: foundryGrid([
      "#~~~~#",
      "ECFWAG",
      "#~~~~#",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },

  // ---------------------------------------------------------------------------
  // Corsair Reavers — fast missile raiders.
  // ---------------------------------------------------------------------------
  {
    id: "preset-ship-reaver",
    name: "Reaver",
    faction: "Corsair",
    // A raider frigate: a missile rack and raid cannon over a hot raid drive,
    // with a magazine for a sustained volley and a scrambler to blunt return
    // fire. Light scrap hull — it strikes and runs.
    grid: corsairGrid([
      ".####.",
      "ECFMGJ",
      ".####.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },

  // ---------------------------------------------------------------------------
  // Synthetic Collective — hardwired, crewless drone hulls.
  // ---------------------------------------------------------------------------
  {
    id: "preset-ship-node",
    name: "Node",
    faction: "Synthetic",
    // A crewless frigate: an AI processor runs the whole ship with no quarters,
    // hardwiring power and ammo directly. A precise cannon and an interceptor
    // array screen the fleet, fed from an integral slug reservoir.
    grid: syntheticGrid([
      ".####.",
      "EPCGIN",
      ".####.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];
