import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { syntheticGrid, mountMultiCell, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";
import { SYNTHETIC_FOOTPRINTS } from "@/data/catalog/modules/synthetic-capital";

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
    // alone. A full armour shell wraps the hull — the machine silhouette — with
    // only the lateral thrusters piercing the top and bottom rails.
    grid: subdivideGrid(withEdges(syntheticGrid([
      "###>##",
      "EPGCNe",
      "###<##",
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
    grid: mountMultiCell(
      subdivideGrid(withEdges(syntheticGrid([
        ".#####>",
        "EXGCINe",
        "EPG~RN#",
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
      F_NODE,
      [
        // Twin precision cannon bank replaces the centre-row targeting cannon
        // — twice the throw weight at the same muzzle velocity.
        [3, 2, "syn-targeting-bank", SYNTHETIC_FOOTPRINTS.targetingBank],
      ],
    ),
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
    //
    // The coordinator's centre row steps up to capital multi-cell stores: a
    // Coordination Hub (J, plus-shape datalink hub replacing a coordination
    // node), a Coilgun Bank (K, twin barrels replacing a coilgun), and an
    // Interceptor Grid (L, a dense two-cell screen replacing an interceptor
    // array). Each anchor's covered cells are installed by `mountMultiCell`
    // after subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(syntheticGrid([
        ".#########>",
        "EX~GRHAINe#",
        "EPAGKHJLN##",
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
      F_NETWORK_HUB,
      [
        [4, 2, "syn-coilgun-bank", SYNTHETIC_FOOTPRINTS.coilgunBank],
        [6, 2, "syn-coordination-hub", SYNTHETIC_FOOTPRINTS.coordinationHub],
        [7, 2, "syn-interceptor-grid", SYNTHETIC_FOOTPRINTS.interceptorGrid],
        // Twin sustained cutter beam on the upper deck corridor — the
        // Collective's first capital-grade beam battery.
        [2, 3, "syn-twin-cutter", SYNTHETIC_FOOTPRINTS.twinCutter],
        // Tactical blink drive on the lower deck corridor — the Collective's
        // first phase-shift repositioning drive.
        [2, 1, "syn-tactical-blink", SYNTHETIC_FOOTPRINTS.tacticalBlink],
      ],
    ),
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
    //
    // The apex hull fields the full capital multi-cell kit on its centre row
    // and one coordinator slot: the stern Ion Drive Bank (T, twin ion
    // thrusters), the keel Quantum Core Array (M, three ganged antimatter
    // cores — the capital command heart), a Coordination Hub (J, plus-shape
    // datalink), a Heavy Drone Hangar (D, 2×2 fabrication deck), a Phalanx
    // Shield Hub (S, plus-shape capital shield), an Interceptor Grid (L, a
    // dense two-cell screen), and a Coilgun Bank (K, twin barrels). Each
    // anchor's covered cells are installed by `mountMultiCell` after
    // subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(syntheticGrid([
        ".###########>",
        "EX~GHAINRR##e",
        "EX~GJHAINR##e",
        "TPMGADSL~AN#e",
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
      F_NEXUS_PRIME,
      [
        [0, 3, "syn-thruster-bank", SYNTHETIC_FOOTPRINTS.thrusterBank],
        [2, 3, "syn-quantum-core-heavy", SYNTHETIC_FOOTPRINTS.quantumCoreHeavy],
        [4, 2, "syn-coordination-hub", SYNTHETIC_FOOTPRINTS.coordinationHub],
        [5, 3, "syn-drone-hangar-heavy", SYNTHETIC_FOOTPRINTS.droneHangarHeavy],
        [6, 3, "syn-shield-hub", SYNTHETIC_FOOTPRINTS.shieldHub],
        [7, 3, "syn-interceptor-grid", SYNTHETIC_FOOTPRINTS.interceptorGrid],
        // T-tetromino coilgun replaces the 2-cell coilgun bank — one more
        // barrel, a heavier alpha strike at the same electromagnetic reach.
        [8, 3, "syn-tetromino-coilgun", SYNTHETIC_FOOTPRINTS.tetrominoCoilgun],
        // Capital ECCM bastion on the upper keel deck.
        [2, 2, "syn-eccm-bastion", SYNTHETIC_FOOTPRINTS.eccmBastion],
        // Capital sensor bastion on the lower keel deck.
        [2, 4, "syn-sensor-bastion", SYNTHETIC_FOOTPRINTS.sensorBastion],
        // Y8 phalanx-deflector and Y9 drone-launch-deck remain in the catalogue
        // but are not mounted here: the Nexus Armada fleet budget (20 000 pts)
        // cannot absorb five capital additions on one hull. The two omitted are
        // the most redundant — a second defence screen alongside the existing
        // shield-hub, and a second drone bay alongside the drone-hangar-heavy.
      ],
    ),
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
    //
    // The carrier's interior rows step up to capital multi-cell stores: a pair
    // of Heavy Drone Hangars (D, 2×2 fabrication decks — four times the single
    // hangar's swarm each), an Ion Drive Bank (T, twin ion thrusters), and an
    // Interceptor Grid (L, a dense two-cell screen). Each anchor's covered
    // cells are installed by `mountMultiCell` after subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(syntheticGrid([
        ".#########>",
        "EX~GDHAINe#",
        "TPAGRHALN##",
        "EX~GDHAINe#",
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
      F_MAINFRAME,
      [
        [0, 2, "syn-thruster-bank", SYNTHETIC_FOOTPRINTS.thrusterBank],
        [4, 1, "syn-drone-hangar-heavy", SYNTHETIC_FOOTPRINTS.droneHangarHeavy],
        [4, 3, "syn-drone-hangar-heavy", SYNTHETIC_FOOTPRINTS.droneHangarHeavy],
        [7, 2, "syn-interceptor-grid", SYNTHETIC_FOOTPRINTS.interceptorGrid],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
