import type { input } from "zod";
import type { Fleet } from "@/schema/fleet";

/** The input shape of a Fleet: fields with a schema default are optional here,
 *  so preset literals omit them. `presetFleets` (in ./index.ts) runs each entry
 *  through `Fleet.parse`, which fills the defaults and returns a full `Fleet`. */
type FleetInput = input<typeof Fleet>;

import { PRESET_TIME } from "@/data/presets/tokens";
import {
  broodOrders,
  hiveOrders,
  lineOrders,
  netOrders,
  phaseOrders,
  raidOrders,
  siegeOrders,
  skirmishOrders,
  spearheadOrders,
  strikeOrders,
} from "@/data/presets/orders";

export const fleetData: FleetInput[] = [
  // --- Terran fleets ---
  {
    id: "preset-fleet-battleline",
    name: "Battle Line",
    faction: "Terran",
    // A defensive capital line: twin battleships anchor a wall of shield
    // brawlers, holding at long range and focusing the strongest threat.
    ships: [
      { designId: "preset-ship-leviathan", position: { x: -200, y: -70 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-leviathan", position: { x: -200, y: 70 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -240, y: -180 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -240, y: 0 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -240, y: 180 }, facing: 0, orders: lineOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-strike",
    name: "Strike Wing",
    faction: "Terran",
    // A balanced mixed-arms wing: paired gunships and torpedo boats for weight,
    // a screen of fast fighters to flank.
    ships: [
      { designId: "preset-ship-gunship", position: { x: -120, y: -90 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-gunship", position: { x: -120, y: 90 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-torpedo", position: { x: -140, y: 0 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-wasp", position: { x: -160, y: -170 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-wasp", position: { x: -160, y: 170 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -180, y: -60 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -180, y: 60 }, facing: 0, orders: strikeOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-spearhead",
    name: "Armoured Spearhead",
    faction: "Terran",
    // A heavy aggressive thrust: the Titan dreadnought punches in flanked by
    // armour brawlers and a gunship, all driving to medium range and focusing
    // fire on the strongest target.
    ships: [
      { designId: "preset-ship-titan", position: { x: -220, y: 0 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-aegis", position: { x: -280, y: -150 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-aegis", position: { x: -280, y: 150 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-gunship", position: { x: -320, y: 0 }, facing: 0, orders: spearheadOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-picket",
    name: "Picket Screen",
    faction: "Terran",
    // A cheap fast screen: a large cloud of interceptors and skirmishers that
    // swarms and harasses, picking off the weakest targets.
    ships: [
      { designId: "preset-ship-wasp", position: { x: -140, y: -180 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-wasp", position: { x: -140, y: -90 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-wasp", position: { x: -140, y: 90 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-wasp", position: { x: -140, y: 180 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -180, y: -135 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -180, y: -45 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -180, y: 45 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -180, y: 135 }, facing: 0, orders: skirmishOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  // --- Swarm fleets ---
  {
    id: "preset-fleet-drone-swarm",
    name: "Drone Swarm",
    faction: "Swarm",
    // The signature Swarm rush: a wall of expendable drones that closes fast
    // and overwhelms by numbers, with acid flankers on the wings.
    ships: [
      { designId: "preset-ship-drone", position: { x: -340, y: -200 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: -150 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: -100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: -50 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -360, y: 0 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 50 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 150 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 200 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -320, y: -120 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -320, y: 120 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-hive-assault",
    name: "Hive Assault",
    faction: "Swarm",
    // The combined assault: twin Hive Lords lead a pack of ravagers and drones
    // in an all-out close-range charge.
    ships: [
      { designId: "preset-ship-hive-lord", position: { x: -290, y: -80 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-hive-lord", position: { x: -290, y: 80 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: -160 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: 0 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: 160 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: -200 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: -100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: 100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: 200 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-brood-flight",
    name: "Brood Flight",
    faction: "Swarm",
    // An artillery brood: a rank of spitters stings from the back while carrion
    // wings and drones screen and run down anything that closes.
    ships: [
      { designId: "preset-ship-spitter", position: { x: -300, y: -110 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-spitter", position: { x: -300, y: 0 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-spitter", position: { x: -300, y: 110 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-carrion", position: { x: -370, y: -170 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -370, y: 170 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -400, y: -60 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -400, y: 60 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // --- Crystalline Concord fleets ---
  {
    id: "preset-fleet-concord",
    name: "Phase Lance",
    faction: "Crystalline",
    // A phase skirmish line: Shards kite at range behind adaptive shields,
    // blinking clear of trouble and cloaking on the approach.
    ships: [
      { designId: "preset-ship-shard", position: { x: -300, y: -120 }, facing: 0, orders: phaseOrders },
      { designId: "preset-ship-shard", position: { x: -300, y: -40 }, facing: 0, orders: phaseOrders },
      { designId: "preset-ship-shard", position: { x: -300, y: 40 }, facing: 0, orders: phaseOrders },
      { designId: "preset-ship-shard", position: { x: -300, y: 120 }, facing: 0, orders: phaseOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // --- Foundry Combine fleets ---
  {
    id: "preset-fleet-foundry",
    name: "Iron Wall",
    faction: "Foundry",
    // A slow armour wall: Anvils hold ground and outlast the enemy, welding
    // shut whatever gets through the bulkheads.
    ships: [
      { designId: "preset-ship-anvil", position: { x: -300, y: -130 }, facing: 0, orders: siegeOrders },
      { designId: "preset-ship-anvil", position: { x: -300, y: -45 }, facing: 0, orders: siegeOrders },
      { designId: "preset-ship-anvil", position: { x: -300, y: 45 }, facing: 0, orders: siegeOrders },
      { designId: "preset-ship-anvil", position: { x: -300, y: 130 }, facing: 0, orders: siegeOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-siege-column",
    name: "Siege Column",
    faction: "Foundry",
    // The Foundry's hammer blow: a Siege Titan grinds forward behind a
    // screen of Ingot interceptors while Battlerams hold the flanks.
    // Nothing fancy — just mass, armour, and autocannons until nothing
    // is left standing.
    ships: [
      { designId: "preset-ship-siege-titan",  position: { x: -260, y:    0 }, facing: 0, orders: siegeOrders },
      { designId: "preset-ship-battleram",     position: { x: -340, y: -180 }, facing: 0, orders: siegeOrders },
      { designId: "preset-ship-battleram",     position: { x: -340, y:  180 }, facing: 0, orders: siegeOrders },
      { designId: "preset-ship-ingot",         position: { x: -400, y: -260 }, facing: 0, orders: siegeOrders },
      { designId: "preset-ship-ingot",         position: { x: -400, y:  260 }, facing: 0, orders: siegeOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // --- Corsair Reaver fleets ---
  {
    id: "preset-fleet-reavers",
    name: "Raid Pack",
    faction: "Corsair",
    // A raid pack: Reavers close fast under scrambler cover to loose missile
    // volleys, then scatter before the response lands.
    ships: [
      { designId: "preset-ship-reaver", position: { x: -320, y: -130 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-reaver", position: { x: -320, y: -45 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-reaver", position: { x: -320, y: 45 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-reaver", position: { x: -320, y: 130 }, facing: 0, orders: raidOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-cutlass-run",
    name: "Cutlass Run",
    faction: "Corsair",
    // Six Cutlass fighters hit fast and scatter faster; no formation, no
    // hesitation. Against heavier targets they swarm from six angles at
    // once and are gone before the point-defence can track.
    ships: [
      { designId: "preset-ship-cutlass", position: { x: -380, y: -250 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass", position: { x: -380, y: -150 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass", position: { x: -380, y:  -50 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass", position: { x: -380, y:   50 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass", position: { x: -380, y:  150 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass", position: { x: -380, y:  250 }, facing: 0, orders: raidOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-reavers-host",
    name: "Reavers' Host",
    faction: "Corsair",
    // The Corsairs' full raid strength: a Warbringer cruiser breaks the
    // enemy line while Reavers work the flanks and Cutlass fighters hunt
    // anything that tries to run.
    ships: [
      { designId: "preset-ship-warbringer", position: { x: -290, y:    0 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-reaver",     position: { x: -360, y: -120 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-reaver",     position: { x: -360, y:  120 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass",    position: { x: -430, y: -200 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass",    position: { x: -430, y:  -60 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass",    position: { x: -430, y:   60 }, facing: 0, orders: raidOrders },
      { designId: "preset-ship-cutlass",    position: { x: -430, y:  200 }, facing: 0, orders: raidOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // --- Synthetic Collective fleets ---
  {
    id: "preset-fleet-collective",
    name: "Drone Net",
    faction: "Synthetic",
    // A defensive net: Nodes screen the fleet with interceptor arrays and pick
    // off the weakest contacts, crewless and co-ordinated.
    ships: [
      { designId: "preset-ship-node", position: { x: -300, y: -130 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-node", position: { x: -300, y: -45 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-node", position: { x: -300, y: 45 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-node", position: { x: -300, y: 130 }, facing: 0, orders: netOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-automaton-swarm",
    name: "Automaton Swarm",
    faction: "Synthetic",
    // A dense fighter screen: a cloud of Automatons floods the approach lanes,
    // precise cannons picking off missiles and escorts while the sensor arrays
    // track every contact in the engagement zone.
    ships: [
      { designId: "preset-ship-automaton", position: { x: -340, y: -200 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -340, y: -140 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -340, y: -80 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -340, y: -20 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -340, y: 40 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -340, y: 100 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -340, y: 160 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -340, y: 220 }, facing: 0, orders: netOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-nexus-armada",
    name: "Nexus Armada",
    faction: "Synthetic",
    // The Collective's combined arms fleet: the Nexus Prime commands from the
    // centre, its coordination nodes extending the coilguns of the flanking
    // Nodes; a cloud of Automatons runs ahead as sensor pickets and intercept
    // drones. No crew anywhere in the formation.
    ships: [
      { designId: "preset-ship-nexus-prime", position: { x: -260, y: 0 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-network-hub", position: { x: -330, y: -160 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-network-hub", position: { x: -330, y: 160 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-node", position: { x: -390, y: -90 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-node", position: { x: -390, y: 90 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -450, y: -200 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -450, y: 0 }, facing: 0, orders: netOrders },
      { designId: "preset-ship-automaton", position: { x: -450, y: 200 }, facing: 0, orders: netOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
