/**
 * The per-tick AI interpreter step (Phase 7 wiring). For each ship, build the
 * {@link TriggerContext} from the live frame state, call {@link effectiveAi}
 * against the ship's stance + rules, and write the resulting decision onto the
 * ship's transient AI fields (currently just `aiHoldFire`, which gates the
 * weapon-fire step).
 *
 * The context is built from the post-awareness, pre-targeting state: shield and
 * structure fractions from the ship's effective HP, the current target's range
 * and classification, the set of destroyed module kinds, and an outclassed flag
 * derived from the two sides' total effective HP. Deterministic throughout:
 * ships iterate in array order, the destroyed-kind set is built in module array
 * order, and `effectiveAi` is a pure first-match-wins rule evaluation.
 *
 * All five AiState outputs are written onto the ship's transient `ai*` fields:
 * `aiHoldFire`, `aiFocusFire`, `aiRetreat`, `aiPrioritiseRepair`, `aiRally`, and
 * `aiStance` (set only when a `setStance` rule overrode the base stance, left
 * `null` otherwise so a rule-less ship falls back to its static orders). The
 * targeting, movement and crew steps read these and prefer the live value when
 * the AI has raised it, falling back to the static {@link Orders} otherwise —
 * so a ship with no rules and the default stance behaves byte-identically.
 */

import {
  effectiveAi,
  effectiveDoctrineAi,
  type TriggerContext,
} from "@/domain/simulation/engine/ai";
import type { ModuleKind } from "@/schema/ai";
import type { SimShip } from "@/domain/simulation/engine/types";

/** The transient AI-decision fields every SimShip is born with, before its first
 *  AI step runs: no stance override and every flag down. Shared by all four
 *  SimShip constructors (`toSimShip`, `makeDrone`, `makeDecoy`, `makeChunkShip`)
 *  so the "AI has said nothing yet" defaults live in one place and cannot drift.
 *  `stepAi` overwrites every one of these each tick for non-phantom ships. */
export function defaultAiDecisions(): Pick<
  SimShip,
  "aiHoldFire" | "aiStance" | "aiFocusFire" | "aiRetreat" | "aiPrioritiseRepair" | "aiRally"
> {
  return {
    aiHoldFire: false,
    aiStance: null,
    aiFocusFire: false,
    aiRetreat: false,
    aiPrioritiseRepair: false,
    aiRally: false,
  };
}

/**
 * Compute the per-side total effective hit points (structure + shield) over the
 * real ships (phantoms excluded). Used as the fleet-strength comparison that
 * drives the `outclassed` trigger: a side is outclassed when the opposing
 * side's total exceeds its own. Effective HP is the natural quantity — it is
 * what "can this fleet win a sustained fight" reduces to at the resolution of a
 * per-tick doctrine flag.
 */
function sideStrength(ships: readonly SimShip[], side: "attacker" | "defender"): number {
  let total = 0;
  for (const s of ships) {
    if (s.side !== side) continue;
    if (s.phantom !== undefined) continue;
    if (!s.alive) continue;
    total += s.structure + s.shield;
  }
  return total;
}

/**
 * The set of module kinds with at least one destroyed module on the ship, in
 * module array order (the deterministic order modules are scanned elsewhere).
 * A kind appears once even if several of its modules are destroyed.
 */
function destroyedModuleKinds(ship: SimShip): Set<ModuleKind> {
  const kinds = new Set<ModuleKind>();
  if (ship.modules === undefined) return kinds;
  for (const m of ship.modules) {
    if (m.alive) continue;
    kinds.add(m.kind);
  }
  return kinds;
}

/**
 * Build the {@link TriggerContext} for one ship from the live frame state and
 * the two sides' pre-computed strength totals. Pure: a read over the ship, its
 * target (looked up by id), and the two scalar totals.
 */
function buildContext(
  ship: SimShip,
  byId: ReadonlyMap<string, SimShip>,
  attackerStrength: number,
  defenderStrength: number,
): TriggerContext {
  const target =
    ship.target !== undefined ? byId.get(ship.target) : undefined;
  const targetRange =
    target !== undefined
      ? Math.hypot(target.x - ship.x, target.y - ship.y)
      : undefined;
  const ownSideStrength = ship.side === "attacker" ? attackerStrength : defenderStrength;
  const opposingSideStrength =
    ship.side === "attacker" ? defenderStrength : attackerStrength;
  // Outclassed: the opposing fleet's effective HP exceeds the ship's own side's.
  // A side with equal or greater strength is not outclassed, so a matched fight
  // never trips the trigger.
  const outclassed = opposingSideStrength > ownSideStrength;
  return {
    shieldFraction: ship.maxShield > 0 ? ship.shield / ship.maxShield : 0,
    structureFraction:
      ship.maxStructure > 0 ? ship.structure / ship.maxStructure : 0,
    targetRange,
    targetClassification: target?.classification,
    destroyedModuleKinds: destroyedModuleKinds(ship),
    outclassed,
  };
}

/**
 * Run the AI interpreter for every ship and write the resulting decision onto
 * each ship's transient `ai*` fields. Called once per tick before targeting so
 * the firing, targeting, movement and crew steps read the fresh decision. Ships
 * with no rules and the default stance evaluate to every flag false and no
 * stance override, preserving the historical behaviour byte-for-byte.
 */
export function stepAi(
  ships: readonly SimShip[],
  byId: ReadonlyMap<string, SimShip>,
): void {
  const attackerStrength = sideStrength(ships, "attacker");
  const defenderStrength = sideStrength(ships, "defender");
  for (const ship of ships) {
    // Phantoms carry no AI of their own; leave their (default) fields.
    if (ship.phantom !== undefined) continue;
    const ctx = buildContext(ship, byId, attackerStrength, defenderStrength);
    const state =
      ship.doctrine !== undefined
        ? effectiveDoctrineAi(ship.doctrine, ctx)
        : effectiveAi(ship.shipStance, ship.rules, ctx);
    ship.aiHoldFire = state.holdFire;
    ship.aiFocusFire = state.focusFire;
    ship.aiRetreat = state.retreat;
    ship.aiPrioritiseRepair = state.prioritiseRepair;
    ship.aiRally = state.rally;
    // `aiStance` records a stance OVERRIDE only: the effective stance differs
    // from the ship's base stance exactly when a `setStance` rule fired this
    // tick. Leaving it `null` otherwise keeps a rule-less ship on its static
    // `orders.stance`, so the movement/targeting stance reads are unchanged.
    ship.aiStance = state.stance !== ship.shipStance ? state.stance : null;
  }
}
