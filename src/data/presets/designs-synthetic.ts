import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import {
  ammoConduit,
  mountMultiCell,
  PRESET_TIME,
  syntheticGrid,
  withConnections,
  withEdges,
} from "@/data/presets/tokens";
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
    grid: withConnections(
      subdivideGrid(
        withEdges(syntheticGrid([
          "###>##",
          "EPGCNe",
          "###<##",
        ]), [
          // Ammo-feed / maintenance passage between the magazine and the cannon.
          { col: 2, row: 1, dir: "e", kind: "door" },
        ]),
        F_AUTOMATON,
      ),
      // Hardwire ammo conduit: the crewless hull feeds the targeting cannon
      // straight from the slug reservoir — no crew haul (crewRequired is 0).
      ammoConduit(F_AUTOMATON, { col: 2, row: 1 }, [{ col: 3, row: 1 }]),
    ),
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
    grid: withConnections(
      mountMultiCell(
        subdivideGrid(withEdges(syntheticGrid([
          ".#####>",
          "EXGCINe",
          "EPG~R~#",
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
          // Grid Deflector on the centre-row sensor blister — a moderate
          // momentum screen, the patrol frigate's first kinetic defence layer.
          [5, 2, "syn-grid-deflector", [{ dx: 0, dy: 0 }]],
        ],
      ),
      // Hardwire ammo conduits: each slug reservoir feeds the weapons on its row
      // — the centre magazine feeds both the targeting bank and the coilgun.
      // No crew haul on a crewless hull (crewRequired is 0).
      [
        ...ammoConduit(F_NODE, { col: 2, row: 1 }, [{ col: 3, row: 1 }]),
        ...ammoConduit(F_NODE, { col: 2, row: 2 }, [
          { col: 3, row: 2 },
          { col: 4, row: 2 },
        ]),
        ...ammoConduit(F_NODE, { col: 2, row: 3 }, [{ col: 3, row: 3 }]),
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
    grid: withConnections(
      mountMultiCell(
        subdivideGrid(withEdges(syntheticGrid([
          ".#########>",
          "EX~GRHAI~e#",
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
          // Decoy launcher on the upper deck corridor — false contacts that
          // pair with the Interceptor Grid to exhaust an attacker's volley.
          [2, 3, "syn-decoy-launcher", [{ dx: 0, dy: 0 }]],
          // ECCM suite on the lower deck corridor — restores tracking and lock
          // the coordinator's fleet needs to cut through enemy jamming.
          [2, 1, "syn-eccm", [{ dx: 0, dy: 0 }]],
          // Grid Shield on the upper sensor blister — a moderate regenerating
          // field, the first defensive layer below the capital shield-hub.
          [8, 1, "syn-screen-shield", [{ dx: 0, dy: 0 }]],
        ],
      ),
      // Hardwire ammo conduits: each slug reservoir feeds the kinetic battery on
      // its row — the coilgun bank on the centre row, a coilgun above and below.
      // No crew haul on a crewless hull (crewRequired is 0).
      [
        ...ammoConduit(F_NETWORK_HUB, { col: 3, row: 1 }, [{ col: 4, row: 1 }]),
        ...ammoConduit(F_NETWORK_HUB, { col: 3, row: 2 }, [{ col: 4, row: 2 }]),
        ...ammoConduit(F_NETWORK_HUB, { col: 3, row: 3 }, [{ col: 4, row: 3 }]),
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
    grid: withConnections(
      mountMultiCell(
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
          // Phalanx deflector on the upper keel corridor — a 2×2 capital
          // momentum screen. The Network Hub and Node now field lighter defence
          // layers (screen shield, grid deflector), which trims enough Nexus
          // Armada budget to absorb this hull's second capital screen alongside
          // the shield-hub.
          [2, 1, "syn-phalanx-deflector", SYNTHETIC_FOOTPRINTS.phalanxDeflector],
          // Y9 drone-launch-deck remains in the catalogue but is not mounted
          // here: a second drone bay alongside the drone-hangar-heavy is the
          // most redundant capital addition on this hull, and the Mainframe
          // carrier already fields the launch deck as its doctrinal apex.
        ],
      ),
      // Hardwire ammo conduits: each row's slug reservoir feeds the kinetic
      // battery on its row — the railgun pairs on rows 1 and 5, the lone
      // railguns on rows 2 and 4, and the T-tetromino coilgun on the centre
      // row. No crew haul on a crewless hull (crewRequired is 0).
      [
        ...ammoConduit(F_NEXUS_PRIME, { col: 3, row: 1 }, [{ col: 8, row: 1 }, { col: 9, row: 1 }]),
        ...ammoConduit(F_NEXUS_PRIME, { col: 3, row: 2 }, [{ col: 9, row: 2 }]),
        ...ammoConduit(F_NEXUS_PRIME, { col: 3, row: 3 }, [{ col: 8, row: 3 }]),
        ...ammoConduit(F_NEXUS_PRIME, { col: 3, row: 4 }, [{ col: 9, row: 4 }]),
        ...ammoConduit(F_NEXUS_PRIME, { col: 3, row: 5 }, [{ col: 8, row: 5 }, { col: 9, row: 5 }]),
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
    grid: withConnections(
      mountMultiCell(
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
          // Mine-drone layer on the upper magazine-shaft corridor — precision
          // proximity mines the carrier drops in an enemy's approach lane.
          [2, 1, "syn-mine-drone-layer", SYNTHETIC_FOOTPRINTS.mineDroneLayer],
          // Drone launch deck on the lower magazine-shaft corridor — the
          // carrier's apex hangar, a twelve-drone swarm it looses before the
          // lines close.
          [2, 3, "syn-drone-launch-deck", SYNTHETIC_FOOTPRINTS.droneLaunchDeck],
        ],
      ),
      // Hardwire ammo conduit: the centre-row slug reservoir feeds the lone
      // coilgun — the only direct-fire battery on this carrier. No crew haul
      // on a crewless hull (crewRequired is 0).
      ammoConduit(F_MAINFRAME, { col: 3, row: 2 }, [{ col: 4, row: 2 }]),
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
