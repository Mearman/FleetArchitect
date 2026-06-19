import { defaultOrders } from "@/schema/fleet";
import type { Orders } from "@/schema/fleet";

// Fleet doctrines — each a distinct set of orders the ships in it share.
export const lineOrders: Orders = {
  ...defaultOrders,
  stance: "defensive",
  targetPriority: "strongest",
  engageRange: "long",
  retreatThreshold: 0.3,
  focusFire: true,
  rangeKeepingBand: 0.5,
};
export const strikeOrders: Orders = {
  ...defaultOrders,
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0.15,
  rangeKeepingBand: 0.3,
};
export const skirmishOrders: Orders = {
  ...defaultOrders,
  stance: "evasive",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.4,
  focusFire: true,
  rangeKeepingBand: 0.6,
};
export const spearheadOrders: Orders = {
  ...defaultOrders,
  stance: "aggressive",
  targetPriority: "strongest",
  engageRange: "medium",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.25,
};
/** Orders for Swarm fleets: extremely aggressive, close-range pack hunters. */
export const hiveOrders: Orders = {
  ...defaultOrders,
  stance: "aggressive",
  targetPriority: "nearest",
  engageRange: "short",
  retreatThreshold: 0,
  focusFire: true,
  rangeKeepingBand: 0.2,
};
/** Orders for the Swarm brood artillery: hang back and sting from range. */
export const broodOrders: Orders = {
  ...defaultOrders,
  stance: "balanced",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.5,
};
/** Orders for Crystalline phase fleets: kite at range, blink away from trouble. */
export const phaseOrders: Orders = {
  ...defaultOrders,
  stance: "evasive",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.35,
  focusFire: true,
  rangeKeepingBand: 0.6,
};
/** Orders for Foundry siege fleets: hold ground and outlast at range. */
export const siegeOrders: Orders = {
  ...defaultOrders,
  stance: "defensive",
  targetPriority: "strongest",
  engageRange: "medium",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.3,
};
/** Orders for Corsair raid fleets: close fast, hit hard, scatter. */
export const raidOrders: Orders = {
  ...defaultOrders,
  stance: "aggressive",
  targetPriority: "nearest",
  engageRange: "short",
  retreatThreshold: 0.2,
  focusFire: false,
  rangeKeepingBand: 0.25,
};
/** Orders for Synthetic nets: a defensive screen that picks off the weakest. */
export const netOrders: Orders = {
  ...defaultOrders,
  stance: "defensive",
  targetPriority: "weakest",
  engageRange: "medium",
  retreatThreshold: 0.25,
  focusFire: true,
  rangeKeepingBand: 0.4,
};
