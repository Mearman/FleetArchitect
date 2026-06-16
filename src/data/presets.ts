import { Fleet } from "@/schema/fleet";
import type { Orders } from "@/schema/fleet";
import { ShipDesign } from "@/schema/ship";

/**
 * Bundled starter ships and fleets, so a brand-new player can run a battle the
 * moment the app loads instead of designing everything from scratch first.
 *
 * Designs and fleets are authored as plain objects and validated against the
 * schema at load time (same pattern as the catalog). Every design is a valid
 * build — mass within capacity, power and crew in surplus, slot types matching
 * — which `presets.test.ts` asserts, so a catalog change that breaks a preset
 * fails loudly rather than shipping a broken starter ship.
 *
 * Preset ids are stable ("preset-*"); seeding is idempotent and version-gated
 * (see src/storage/seed.ts), so a player who deletes a preset doesn't get it
 * re-added until the preset set itself changes.
 */

/** Fixed timestamp: presets are built-in content, not user-authored records. */
const PRESET_TIME = "2026-06-16T00:00:00.000Z";

const designData: ShipDesign[] = [
  {
    id: "preset-ship-sabre",
    name: "Sabre Interceptor",
    hullId: "hull-wasp",
    faction: "Terran",
    placements: [
      { slotId: "wasp-weapon-1", moduleId: "mod-pulse-laser" },
      { slotId: "wasp-system-1", moduleId: "mod-reactor-fusion" },
      { slotId: "wasp-general-1", moduleId: "mod-crew-quarters" },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-gunship",
    name: "Vanguard Gunship",
    hullId: "hull-vanguard",
    faction: "Terran",
    placements: [
      { slotId: "vanguard-weapon-1", moduleId: "mod-railgun" },
      { slotId: "vanguard-weapon-2", moduleId: "mod-pulse-laser" },
      { slotId: "vanguard-weapon-3", moduleId: "mod-pulse-laser" },
      { slotId: "vanguard-engine-1", moduleId: "mod-engine-ion" },
      { slotId: "vanguard-engine-2", moduleId: "mod-engine-ion" },
      { slotId: "vanguard-system-1", moduleId: "mod-reactor-fusion" },
      { slotId: "vanguard-system-2", moduleId: "mod-reactor-fusion" },
      { slotId: "vanguard-general-1", moduleId: "mod-crew-quarters" },
      { slotId: "vanguard-general-2", moduleId: "mod-crew-quarters" },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-bulwark",
    name: "Bulwark Escort",
    hullId: "hull-vanguard",
    faction: "Terran",
    placements: [
      { slotId: "vanguard-weapon-1", moduleId: "mod-pulse-laser" },
      { slotId: "vanguard-weapon-2", moduleId: "mod-pulse-laser" },
      { slotId: "vanguard-weapon-3", moduleId: "mod-pulse-laser" },
      { slotId: "vanguard-engine-1", moduleId: "mod-engine-ion" },
      { slotId: "vanguard-engine-2", moduleId: "mod-engine-ion" },
      { slotId: "vanguard-system-1", moduleId: "mod-reactor-fusion" },
      { slotId: "vanguard-system-2", moduleId: "mod-reactor-fusion" },
      { slotId: "vanguard-general-1", moduleId: "mod-shield-mk2" },
      { slotId: "vanguard-general-2", moduleId: "mod-crew-quarters" },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-torpedo",
    name: "Vanguard Torpedo Boat",
    hullId: "hull-vanguard",
    faction: "Terran",
    placements: [
      { slotId: "vanguard-weapon-1", moduleId: "mod-plasma-torpedo" },
      { slotId: "vanguard-weapon-2", moduleId: "mod-missile-rack" },
      { slotId: "vanguard-engine-1", moduleId: "mod-engine-ion" },
      { slotId: "vanguard-system-1", moduleId: "mod-reactor-fusion" },
      { slotId: "vanguard-system-2", moduleId: "mod-reactor-fusion" },
      { slotId: "vanguard-general-1", moduleId: "mod-crew-quarters" },
      { slotId: "vanguard-general-2", moduleId: "mod-armour-titanium" },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-leviathan",
    name: "Leviathan Battleship",
    hullId: "hull-leviathan",
    faction: "Terran",
    placements: [
      { slotId: "lev-weapon-1", moduleId: "mod-plasma-torpedo" },
      { slotId: "lev-weapon-2", moduleId: "mod-plasma-torpedo" },
      { slotId: "lev-weapon-3", moduleId: "mod-railgun" },
      { slotId: "lev-weapon-4", moduleId: "mod-railgun" },
      { slotId: "lev-weapon-5", moduleId: "mod-pulse-laser" },
      { slotId: "lev-weapon-6", moduleId: "mod-pulse-laser" },
      { slotId: "lev-engine-1", moduleId: "mod-engine-ion" },
      { slotId: "lev-engine-2", moduleId: "mod-engine-ion" },
      { slotId: "lev-engine-3", moduleId: "mod-engine-ion" },
      { slotId: "lev-system-1", moduleId: "mod-reactor-antimatter" },
      { slotId: "lev-system-2", moduleId: "mod-reactor-antimatter" },
      { slotId: "lev-system-3", moduleId: "mod-reactor-antimatter" },
      { slotId: "lev-general-1", moduleId: "mod-crew-quarters" },
      { slotId: "lev-general-2", moduleId: "mod-crew-quarters" },
      { slotId: "lev-general-3", moduleId: "mod-crew-quarters" },
      { slotId: "lev-general-4", moduleId: "mod-shield-mk2" },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];

const swarmOrders: Orders = {
  stance: "aggressive",
  targetPriority: "nearest",
  engageRange: "short",
  retreatThreshold: 0,
};
const lineOrders: Orders = {
  stance: "defensive",
  targetPriority: "strongest",
  engageRange: "long",
  retreatThreshold: 0.3,
};
const strikeOrders: Orders = {
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0.15,
};

const fleetData: Fleet[] = [
  {
    id: "preset-fleet-swarm",
    name: "Fighter Swarm",
    faction: "Terran",
    ships: [
      { designId: "preset-ship-sabre", position: { x: -340, y: -120 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -340, y: -60 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 0 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -340, y: 60 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -340, y: 120 }, facing: 0, orders: swarmOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-battleline",
    name: "Battle Line",
    faction: "Terran",
    ships: [
      { designId: "preset-ship-leviathan", position: { x: -300, y: 0 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -340, y: -130 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -340, y: 130 }, facing: 0, orders: lineOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-strike",
    name: "Strike Wing",
    faction: "Terran",
    ships: [
      { designId: "preset-ship-gunship", position: { x: -300, y: -70 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-torpedo", position: { x: -300, y: 70 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: -150 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 0 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 150 }, facing: 0, orders: strikeOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];

export const presetDesigns: readonly ShipDesign[] = designData.map((d) =>
  ShipDesign.parse(d),
);
export const presetFleets: readonly Fleet[] = fleetData.map((f) => Fleet.parse(f));
