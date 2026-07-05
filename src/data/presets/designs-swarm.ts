import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { swarmGrid, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";

// Swarm designs — bio-organic insectoid ships. Asymmetric, clawed, organic
// silhouettes: tapered stingers, swept carapace, clustered drive flagella.
// Swarm weapons are all bio-organic — spore launchers (cannon), acid sprayers
// (beam), and neural stings (missile with tracking). Neural stings have no
// ammoCapacity in the schema (guided bio-electric tendrils, not discrete
// rounds), so no ammon sac is needed even for sting-armed ships. All Swarm
// crewRequired values are 0; no crew quarters are needed either. Isolated
// from designs.ts so the roster file stays under the max-lines guard.

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_DRONE     = 3;   // 6 m × 3 → 18 m (fighter; armour sits on the left edge
                        // only so chamfer growth leaves the longest axis ≤ 20 m)
const F_CARRION   = 2;   // 7 m × 2 → 14 m (fighter)
const F_RAVAGER   = 3;   // 9 m × 3 → 27 m (frigate)
const F_SPITTER   = 3;   // 10 m × 3 → 30 m (frigate)
const F_HIVE_LORD = 5;   // 13 m × 5 → 65 m (cruiser)
const F_DEVOURER  = 12;  // 14 m × 12 → 168 m (dreadnought)

/** Swarm preset ship designs. */
export const swarmDesigns: ShipDesignInput[] = [
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
    grid: subdivideGrid(withEdges(swarmGrid([
      "#>xpre",
      "jgfprp",
      "#<xprh",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
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
    grid: subdivideGrid(withEdges(swarmGrid([
      "..>xaw.",
      "j~gfaa.",
      "ug~gfaa",
      "j~gfaa.",
      "..<xaw.",
    ]), [
      { col: 3, row: 0, dir: "e", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
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
    grid: subdivideGrid(withEdges(swarmGrid([
      "#>jx~aa##",
      "jgf~zaaa.",
      "ugm~rfaaa",
      "jgf~zaaa.",
      "#<jx~aa##",
    ]), [
      { col: 0, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "door" },
      { col: 0, row: 3, dir: "e", kind: "wall" },
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
    grid: subdivideGrid(withEdges(swarmGrid([
      ".#>xsnn#..",
      ".jgfzsnnn.",
      "ugm~rfsnnn",
      ".jgfzsnnn.",
      ".#<xsnn#..",
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
      { col: 5, row: 1, dir: "e", kind: "door" },
      { col: 5, row: 2, dir: "e", kind: "wall" },
      { col: 5, row: 3, dir: "e", kind: "door" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
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
    grid: subdivideGrid(withEdges(swarmGrid([
      "..#>x~nnnkccc",
      "..jgfzrsnnnnh",
      ".jgm~rfsannny",
      "ugmm~rfsaannn",
      ".jgm~rfsannny",
      "..jgfzrsnnnnh",
      "..#<x~nnnkccc",
    ]), [
      { col: 1, row: 2, dir: "e", kind: "wall" },
      { col: 1, row: 3, dir: "e", kind: "door" },
      { col: 1, row: 4, dir: "e", kind: "wall" },
      { col: 3, row: 0, dir: "e", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "door" },
      { col: 3, row: 2, dir: "e", kind: "wall" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
      { col: 3, row: 5, dir: "e", kind: "door" },
      { col: 3, row: 6, dir: "e", kind: "wall" },
      { col: 5, row: 0, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "wall" },
      { col: 5, row: 3, dir: "e", kind: "door" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 5, dir: "e", kind: "wall" },
      { col: 5, row: 6, dir: "e", kind: "wall" },
      { col: 7, row: 0, dir: "e", kind: "wall" },
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "wall" },
      { col: 7, row: 3, dir: "e", kind: "door" },
      { col: 7, row: 4, dir: "e", kind: "wall" },
      { col: 7, row: 5, dir: "e", kind: "wall" },
      { col: 7, row: 6, dir: "e", kind: "wall" },
      { col: 9, row: 0, dir: "e", kind: "wall" },
      { col: 9, row: 1, dir: "e", kind: "wall" },
      { col: 9, row: 2, dir: "e", kind: "door" },
      { col: 9, row: 3, dir: "e", kind: "wall" },
      { col: 9, row: 4, dir: "e", kind: "door" },
      { col: 9, row: 5, dir: "e", kind: "wall" },
      { col: 9, row: 6, dir: "e", kind: "wall" },
      { col: 11, row: 1, dir: "e", kind: "wall" },
      { col: 11, row: 2, dir: "e", kind: "wall" },
      { col: 11, row: 3, dir: "e", kind: "door" },
      { col: 11, row: 4, dir: "e", kind: "wall" },
      { col: 11, row: 5, dir: "e", kind: "wall" },
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
];
