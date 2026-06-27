import type { input } from "zod";
import type { Fleet } from "@/schema/fleet";
import { flatFormation } from "@/schema/formation";
import type { Doctrine } from "@/schema/ai";

/** The input shape of a Fleet: fields with a schema default are optional here,
 *  so preset literals omit them. `presetFleets` (in ./index.ts) runs each entry
 *  through `Fleet.parse`, which fills the defaults and returns a full `Fleet`. */
type FleetInput = input<typeof Fleet>;

import { PRESET_TIME } from "@/data/presets/tokens";
import {
  broodDoctrine,
  hiveDoctrine,
  lineDoctrine,
  netDoctrine,
  phaseDoctrine,
  raidDoctrine,
  siegeDoctrine,
  skirmishDoctrine,
  spearheadDoctrine,
  strikeDoctrine,
} from "@/data/presets/orders";

// --- Formation-showcase doctrines -------------------------------------------
// Authored inline (not via the `fleetDoctrine` helper) because they exercise the
// formation-aware axes the helper does not surface: relational targeting
// (`threatsTo` a friendly role), conditional retreat keyed on a formation's
// strength, and a `kite` range against an enemy formation role. Attached
// per-ship on the showcase fleets' leaves so the resolver's design+leaf overlay
// builds each ship's effective doctrine from them.

/** Carrier doctrine: hold the line defensively. Authored on every ship in the
 *  carrier sub-formation of the Carrier Group. */
const carrierDoctrine: Doctrine = {
  base: { stance: "defensive" },
  rules: [],
};

/** Escort doctrine: screen ahead of the carrier, concentrate fire on whatever
 *  threatens it, then break off once the carrier is badly damaged. The
 *  `threatsTo` mode and the `formationStrength` rule both key off the carrier's
 *  role — the formation-aware doctrine the showcase demonstrates. */
const carrierEscortDoctrine: Doctrine = {
  base: {
    stance: "balanced",
    targeting: {
      mode: { kind: "threatsTo", reference: { kind: "friendly", role: "carrier" } },
      vulnerableWeight: 0,
      focusFire: true,
    },
  },
  rules: [
    {
      condition: {
        kind: "formationStrength",
        reference: { kind: "friendly", role: "carrier" },
        threshold: 0.3,
        direction: "below",
      },
      then: { stance: "retreat" },
    },
  ],
};

/** Skirmisher doctrine: keep the enemy vanguard at the edge of weapon reach
 *  (kite) while picking off the weakest contact. Authored on every ship in the
 *  skirmishers sub-formation of the Skirmisher Line. */
const skirmisherKiteDoctrine: Doctrine = {
  base: {
    stance: "evasive",
    spatial: {
      reference: { kind: "enemy", role: "vanguard" },
      range: { kind: "kite", maxRange: 60000 },
      bearing: { kind: "free" },
    },
    targeting: {
      mode: { kind: "weakest" },
      vulnerableWeight: 0,
      focusFire: false,
    },
  },
  rules: [],
};

export const fleetData: FleetInput[] = [
  // --- Terran fleets ---
  {
    id: "preset-fleet-battleline",
    name: "Battle Line",
    faction: "Terran",
    // A defensive capital line: twin battleships anchor a wall of shield
    // brawlers, holding at long range and focusing the strongest threat.
    formation: flatFormation([
      { designId: "preset-ship-leviathan", position: { x: -200, y: -70 }, facing: 0, doctrine: lineDoctrine },
      { designId: "preset-ship-leviathan", position: { x: -200, y: 70 }, facing: 0, doctrine: lineDoctrine },
      { designId: "preset-ship-bulwark", position: { x: -240, y: -180 }, facing: 0, doctrine: lineDoctrine },
      { designId: "preset-ship-bulwark", position: { x: -240, y: 0 }, facing: 0, doctrine: lineDoctrine },
      { designId: "preset-ship-bulwark", position: { x: -240, y: 180 }, facing: 0, doctrine: lineDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-gunship", position: { x: -120, y: -90 }, facing: 0, doctrine: strikeDoctrine },
      { designId: "preset-ship-gunship", position: { x: -120, y: 90 }, facing: 0, doctrine: strikeDoctrine },
      { designId: "preset-ship-torpedo", position: { x: -140, y: 0 }, facing: 0, doctrine: strikeDoctrine },
      { designId: "preset-ship-wasp", position: { x: -160, y: -170 }, facing: 0, doctrine: strikeDoctrine },
      { designId: "preset-ship-wasp", position: { x: -160, y: 170 }, facing: 0, doctrine: strikeDoctrine },
      { designId: "preset-ship-sabre", position: { x: -180, y: -60 }, facing: 0, doctrine: strikeDoctrine },
      { designId: "preset-ship-sabre", position: { x: -180, y: 60 }, facing: 0, doctrine: strikeDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-titan", position: { x: -220, y: 0 }, facing: 0, doctrine: spearheadDoctrine },
      { designId: "preset-ship-aegis", position: { x: -280, y: -150 }, facing: 0, doctrine: spearheadDoctrine },
      { designId: "preset-ship-aegis", position: { x: -280, y: 150 }, facing: 0, doctrine: spearheadDoctrine },
      { designId: "preset-ship-gunship", position: { x: -320, y: 0 }, facing: 0, doctrine: spearheadDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-wasp", position: { x: -140, y: -180 }, facing: 0, doctrine: skirmishDoctrine },
      { designId: "preset-ship-wasp", position: { x: -140, y: -90 }, facing: 0, doctrine: skirmishDoctrine },
      { designId: "preset-ship-wasp", position: { x: -140, y: 90 }, facing: 0, doctrine: skirmishDoctrine },
      { designId: "preset-ship-wasp", position: { x: -140, y: 180 }, facing: 0, doctrine: skirmishDoctrine },
      { designId: "preset-ship-sabre", position: { x: -180, y: -135 }, facing: 0, doctrine: skirmishDoctrine },
      { designId: "preset-ship-sabre", position: { x: -180, y: -45 }, facing: 0, doctrine: skirmishDoctrine },
      { designId: "preset-ship-sabre", position: { x: -180, y: 45 }, facing: 0, doctrine: skirmishDoctrine },
      { designId: "preset-ship-sabre", position: { x: -180, y: 135 }, facing: 0, doctrine: skirmishDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-drone", position: { x: -340, y: -200 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -340, y: -150 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -340, y: -100 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -340, y: -50 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -360, y: 0 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -340, y: 50 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -340, y: 100 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -340, y: 150 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -340, y: 200 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-carrion", position: { x: -320, y: -120 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-carrion", position: { x: -320, y: 120 }, facing: 0, doctrine: hiveDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-hive-lord", position: { x: -290, y: -80 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-hive-lord", position: { x: -290, y: 80 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-ravager", position: { x: -360, y: -160 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-ravager", position: { x: -360, y: 0 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-ravager", position: { x: -360, y: 160 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -420, y: -200 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -420, y: -100 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -420, y: 100 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -420, y: 200 }, facing: 0, doctrine: hiveDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-spitter", position: { x: -300, y: -110 }, facing: 0, doctrine: broodDoctrine },
      { designId: "preset-ship-spitter", position: { x: -300, y: 0 }, facing: 0, doctrine: broodDoctrine },
      { designId: "preset-ship-spitter", position: { x: -300, y: 110 }, facing: 0, doctrine: broodDoctrine },
      { designId: "preset-ship-carrion", position: { x: -370, y: -170 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-carrion", position: { x: -370, y: 170 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -400, y: -60 }, facing: 0, doctrine: hiveDoctrine },
      { designId: "preset-ship-drone", position: { x: -400, y: 60 }, facing: 0, doctrine: hiveDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-shard", position: { x: -300, y: -120 }, facing: 0, doctrine: phaseDoctrine },
      { designId: "preset-ship-shard", position: { x: -300, y: -40 }, facing: 0, doctrine: phaseDoctrine },
      { designId: "preset-ship-shard", position: { x: -300, y: 40 }, facing: 0, doctrine: phaseDoctrine },
      { designId: "preset-ship-shard", position: { x: -300, y: 120 }, facing: 0, doctrine: phaseDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-anvil", position: { x: -300, y: -130 }, facing: 0, doctrine: siegeDoctrine },
      { designId: "preset-ship-anvil", position: { x: -300, y: -45 }, facing: 0, doctrine: siegeDoctrine },
      { designId: "preset-ship-anvil", position: { x: -300, y: 45 }, facing: 0, doctrine: siegeDoctrine },
      { designId: "preset-ship-anvil", position: { x: -300, y: 130 }, facing: 0, doctrine: siegeDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-siege-titan",  position: { x: -260, y:    0 }, facing: 0, doctrine: siegeDoctrine },
      { designId: "preset-ship-battleram",     position: { x: -340, y: -180 }, facing: 0, doctrine: siegeDoctrine },
      { designId: "preset-ship-battleram",     position: { x: -340, y:  180 }, facing: 0, doctrine: siegeDoctrine },
      { designId: "preset-ship-ingot",         position: { x: -400, y: -260 }, facing: 0, doctrine: siegeDoctrine },
      { designId: "preset-ship-ingot",         position: { x: -400, y:  260 }, facing: 0, doctrine: siegeDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-reaver", position: { x: -320, y: -130 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-reaver", position: { x: -320, y: -45 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-reaver", position: { x: -320, y: 45 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-reaver", position: { x: -320, y: 130 }, facing: 0, doctrine: raidDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-cutlass", position: { x: -380, y: -250 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass", position: { x: -380, y: -150 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass", position: { x: -380, y:  -50 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass", position: { x: -380, y:   50 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass", position: { x: -380, y:  150 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass", position: { x: -380, y:  250 }, facing: 0, doctrine: raidDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-warbringer", position: { x: -290, y:    0 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-reaver",     position: { x: -360, y: -120 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-reaver",     position: { x: -360, y:  120 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass",    position: { x: -430, y: -200 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass",    position: { x: -430, y:  -60 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass",    position: { x: -430, y:   60 }, facing: 0, doctrine: raidDoctrine },
      { designId: "preset-ship-cutlass",    position: { x: -430, y:  200 }, facing: 0, doctrine: raidDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-node", position: { x: -300, y: -130 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-node", position: { x: -300, y: -45 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-node", position: { x: -300, y: 45 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-node", position: { x: -300, y: 130 }, facing: 0, doctrine: netDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-automaton", position: { x: -340, y: -200 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -340, y: -140 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -340, y: -80 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -340, y: -20 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -340, y: 40 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -340, y: 100 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -340, y: 160 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -340, y: 220 }, facing: 0, doctrine: netDoctrine },
    ]),
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
    formation: flatFormation([
      { designId: "preset-ship-nexus-prime", position: { x: -260, y: 0 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-network-hub", position: { x: -330, y: -160 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-network-hub", position: { x: -330, y: 160 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-node", position: { x: -390, y: -90 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-node", position: { x: -390, y: 90 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -450, y: -200 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -450, y: 0 }, facing: 0, doctrine: netDoctrine },
      { designId: "preset-ship-automaton", position: { x: -450, y: 200 }, facing: 0, doctrine: netDoctrine },
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },

  // --- Formation showcase fleets ---
  //
  // These two fleets exercise the formation feature: nested sub-formations that
  // carry roles + pattern layouts, and formation-aware doctrine whose rules
  // reference formations by role. The doctrine is attached per-ship (the design
  // + leaf overlay the resolver builds), so every ship in a sub-formation shares
  // that formation's doctrine while the sub-formation's `role` advertises the
  // handle the doctrine's references resolve against.

  {
    id: "preset-fleet-carrier-group",
    name: "Carrier Group",
    faction: "Terran",
    // A nested formation tree: a root `line` of two sub-formations — a carrier
    // group (the Leviathan, behind) screened ahead by an escort group (three
    // Sabres in a picket). The root `line` layout staggers the two groups along
    // the forward axis so the escorts sit closer to the midline than the carrier
    // they guard, and each sub-formation's own pattern lays out its ships.
    formation: {
      id: "root",
      doctrine: { base: {}, rules: [] },
      layout: { kind: "pattern", pattern: "line", spacing: 300, facingAligned: true },
      children: [
        {
          kind: "formation",
          formation: {
            id: "carrier",
            role: "carrier",
            doctrine: { base: {}, rules: [] },
            layout: { kind: "pattern", pattern: "line", spacing: 200, facingAligned: true },
            children: [
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-leviathan",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: carrierDoctrine,
                },
              },
            ],
          },
        },
        {
          kind: "formation",
          formation: {
            id: "escort",
            role: "escort",
            doctrine: { base: {}, rules: [] },
            layout: { kind: "pattern", pattern: "screen", spacing: 120, facingAligned: true },
            children: [
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-sabre",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: carrierEscortDoctrine,
                },
              },
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-sabre",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: carrierEscortDoctrine,
                },
              },
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-sabre",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: carrierEscortDoctrine,
                },
              },
            ],
          },
        },
      ],
    },
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-fleet-skirmisher-line",
    name: "Skirmisher Line",
    faction: "Corsair",
    // A single skirmishers sub-formation of four Reavers in an echelon. They
    // kite the enemy vanguard at the edge of weapon reach (60 km — inside the
    // Reaver's 80 km missile envelope) and pick off the weakest contact. The
    // doctrine's spatial reference names the enemy's `vanguard` role: it
    // resolves when the opponent fields one, and otherwise falls through to the
    // ship's default range-keeping (total references, never errors).
    formation: {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [
        {
          kind: "formation",
          formation: {
            id: "skirmishers",
            role: "skirmishers",
            doctrine: { base: {}, rules: [] },
            layout: { kind: "pattern", pattern: "echelon", spacing: 250, facingAligned: true },
            children: [
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-reaver",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: skirmisherKiteDoctrine,
                },
              },
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-reaver",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: skirmisherKiteDoctrine,
                },
              },
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-reaver",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: skirmisherKiteDoctrine,
                },
              },
              {
                kind: "ship",
                ship: {
                  designId: "preset-ship-reaver",
                  position: { x: 0, y: 0 },
                  facing: 0,
                  doctrine: skirmisherKiteDoctrine,
                },
              },
            ],
          },
        },
      ],
    },
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
