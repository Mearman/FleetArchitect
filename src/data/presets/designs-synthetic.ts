import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { syntheticGrid, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";

// Synthetic Collective designs — hardwired, crewless drone hulls. No crew, no
// quarters, just the network. Armour rails and prow caps give the machine
// silhouette. Isolated from designs.ts so the roster file stays under the
// max-lines guard.

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_AUTOMATON   = 3;   // 6 m × 3 → 18 m (fighter)
const F_NODE        = 3;   // 7 m × 3 → 21 m (frigate)
const F_NETWORK_HUB = 6;   // 11 m × 6 → 66 m (cruiser)
const F_NEXUS_PRIME = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_MAINFRAME   = 7;   // 11 m × 7 → 77 m (cruiser)

/** Synthetic Collective preset ship designs. */
export const syntheticDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-automaton",
    name: "Automaton",
    faction: "Synthetic",
    // Fighter: a compact autonomous combat drone. A single targeting cannon and
    // an active sensor array give it precision at range; a slug reservoir feeds
    // the cannon. No crew, no quarters — the processor runs the whole hull
    // alone. Armour rails top and bottom are the classic Synthetic silhouette.
    grid: subdivideGrid(withEdges(syntheticGrid([
      ".##>..",
      "EPGCNe",
      ".##<..",
    ]), [
      // Ammo-feed / maintenance passage between the magazine and the cannon.
      { col: 2, row: 1, dir: "e", kind: "door" },
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
    grid: subdivideGrid(withEdges(syntheticGrid([
      ".#####>",
      "EXGCINe",
      "EPGCRN#",
      "EXGCINe",
      ".#####<",
    ]), [
      // Drive | reactor bulkhead.
      { col: 0, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "door" },
      { col: 0, row: 3, dir: "e", kind: "wall" },
      // Reactor | magazine bulkhead.
      { col: 1, row: 1, dir: "e", kind: "wall" },
      { col: 1, row: 2, dir: "e", kind: "door" },
      { col: 1, row: 3, dir: "e", kind: "wall" },
      // Magazine | weapons battery bulkhead.
      { col: 2, row: 1, dir: "e", kind: "wall" },
      { col: 2, row: 2, dir: "e", kind: "door" },
      { col: 2, row: 3, dir: "e", kind: "wall" },
      // Weapons battery | sensors bulkhead.
      { col: 4, row: 1, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "e", kind: "door" },
      { col: 4, row: 3, dir: "e", kind: "wall" },
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
    grid: subdivideGrid(withEdges(syntheticGrid([
      ".#########>",
      "EX~GRHAINe#",
      "EPAGRHAIN##",
      "EX~GRHAINe#",
      ".#########<",
    ]), [
      // Drive | reactor-and-command bulkhead.
      { col: 0, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "door" },
      { col: 0, row: 3, dir: "e", kind: "wall" },
      // Command core | magazine shaft.
      { col: 2, row: 1, dir: "e", kind: "wall" },
      { col: 2, row: 2, dir: "e", kind: "door" },
      { col: 2, row: 3, dir: "e", kind: "wall" },
      // Magazine | railgun battery.
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      // Railgun | drone hangars.
      { col: 4, row: 1, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "e", kind: "door" },
      { col: 4, row: 3, dir: "e", kind: "wall" },
      // Hangars | coordination matrix.
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "wall" },
      // Coordination | PD screen.
      { col: 6, row: 1, dir: "e", kind: "wall" },
      { col: 6, row: 2, dir: "e", kind: "door" },
      { col: 6, row: 3, dir: "e", kind: "wall" },
      // PD screen | sensors and brake.
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "door" },
      { col: 7, row: 3, dir: "e", kind: "wall" },
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
    grid: subdivideGrid(withEdges(syntheticGrid([
      ".###########>",
      "EX~GHAINRR##e",
      "EX~GAHAINR##e",
      "EPXGAHAIRAN#e",
      "EX~GAHAINR##e",
      "EX~GHAINRR##e",
      ".###########<",
    ]), [
      // Drive | reactor-and-command bulkhead.
      { col: 0, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "wall" },
      { col: 0, row: 3, dir: "e", kind: "door" },
      { col: 0, row: 4, dir: "e", kind: "wall" },
      { col: 0, row: 5, dir: "e", kind: "wall" },
      // Command core | magazine shaft.
      { col: 2, row: 1, dir: "e", kind: "wall" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
      { col: 2, row: 3, dir: "e", kind: "door" },
      { col: 2, row: 4, dir: "e", kind: "wall" },
      { col: 2, row: 5, dir: "e", kind: "wall" },
      // Magazine | drone hangar bay.
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "wall" },
      { col: 3, row: 3, dir: "e", kind: "door" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
      { col: 3, row: 5, dir: "e", kind: "wall" },
      // Hangar bay | coordination matrix.
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "wall" },
      { col: 5, row: 3, dir: "e", kind: "door" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 5, dir: "e", kind: "wall" },
      // Coordination | PD screen.
      { col: 6, row: 1, dir: "e", kind: "wall" },
      { col: 6, row: 2, dir: "e", kind: "wall" },
      { col: 6, row: 3, dir: "e", kind: "door" },
      { col: 6, row: 4, dir: "e", kind: "wall" },
      { col: 6, row: 5, dir: "e", kind: "wall" },
      // PD screen | railgun battery.
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "wall" },
      { col: 7, row: 3, dir: "e", kind: "door" },
      { col: 7, row: 4, dir: "e", kind: "wall" },
      { col: 7, row: 5, dir: "e", kind: "wall" },
      // Hangar bay stacked decks: col 4 walled, col 5 the launch corridor.
      { col: 4, row: 2, dir: "s", kind: "wall" },
      { col: 5, row: 2, dir: "s", kind: "door" },
      { col: 4, row: 3, dir: "s", kind: "wall" },
      { col: 5, row: 3, dir: "s", kind: "door" },
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
    grid: subdivideGrid(withEdges(syntheticGrid([
      ".#########>",
      "EX~GHHAINe#",
      "EPAGRHAIN##",
      "EX~GHHAINe#",
      ".#########<",
    ]), [
      // Drive | reactor-and-command bulkhead.
      { col: 0, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "door" },
      { col: 0, row: 3, dir: "e", kind: "wall" },
      // Command core | magazine shaft.
      { col: 2, row: 1, dir: "e", kind: "wall" },
      { col: 2, row: 2, dir: "e", kind: "door" },
      { col: 2, row: 3, dir: "e", kind: "wall" },
      // Magazine | drone hangar bay.
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      // Hangar bay | coordination matrix.
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "wall" },
      // Coordination | PD screen.
      { col: 6, row: 1, dir: "e", kind: "wall" },
      { col: 6, row: 2, dir: "e", kind: "door" },
      { col: 6, row: 3, dir: "e", kind: "wall" },
      // PD screen | sensors and brake.
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "door" },
      { col: 7, row: 3, dir: "e", kind: "wall" },
    ]), F_MAINFRAME),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
