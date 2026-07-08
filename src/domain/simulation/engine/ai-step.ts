/**
 * The per-tick AI interpreter step (Phase 7 wiring). For each ship, build the
 * {@link TriggerContext} from the live frame state, call
 * {@link effectiveDoctrineAi} against the ship's doctrine, and write the
 * resulting decision onto the ship's transient AI fields (currently just
 * `aiHoldFire`, which gates the weapon-fire step).
 *
 * The context is built from the post-awareness, pre-targeting state: shield and
 * structure fractions from the ship's effective HP, the current target's range
 * and classification, the set of destroyed module kinds, and an outclassed flag
 * derived from the two sides' total effective HP. Deterministic throughout:
 * ships iterate in array order, the destroyed-kind set is built in module array
 * order, and `effectiveDoctrineAi` is a pure first-match-wins rule evaluation.
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
  baseAiState,
  effectiveDoctrineAi,
  type TriggerContext,
} from "@/domain/simulation/engine/ai";
import type { Condition, Doctrine, ModuleKind } from "@/schema/ai";
import type { SimShip } from "@/domain/simulation/engine/types";

/** The transient AI-decision fields every SimShip is born with, before its first
 *  AI step runs: no stance override and every flag down. Shared by all four
 *  SimShip constructors (`toSimShip`, `makeDrone`, `makeDecoy`, `makeChunkShip`)
 *  so the "AI has said nothing yet" defaults live in one place and cannot drift.
 *  `stepAi` overwrites every one of these each tick for non-phantom ships. */
export function defaultAiDecisions(): Pick<
  SimShip,
  | "aiHoldFire"
  | "aiStance"
  | "aiFocusFire"
  | "aiRetreat"
  | "aiPrioritiseRepair"
  | "aiRally"
  | "aiWasFiredUpon"
> {
  return {
    aiHoldFire: false,
    aiStance: null,
    aiFocusFire: false,
    aiRetreat: false,
    aiPrioritiseRepair: false,
    aiRally: false,
    aiWasFiredUpon: false,
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
 * Whether a single condition tree references the `moduleDestroyed` kind,
 * recursing through the bounded `all`/`any` combinators. The condition schema
 * caps each combinator at four sub-conditions but permits arbitrary nesting
 * depth, so this is a recursive scan rather than a flat check.
 */
function conditionUsesModuleDestroyed(condition: Condition): boolean {
  switch (condition.kind) {
    case "moduleDestroyed":
      return true;
    case "all":
    case "any":
      return condition.of.some(conditionUsesModuleDestroyed);
    default:
      return false;
  }
}

/**
 * Whether any of a doctrine's rules can read the destroyed-module-kinds set —
 * i.e. whether its condition tree contains a `moduleDestroyed` kind anywhere.
 * A doctrine's rules are static for the lifetime of a battle (`ship.doctrine`
 * is never reassigned mid-sim, only inside test fixtures), so this is a fixed
 * property of the doctrine object, memoised on it via a {@link WeakMap}. The
 * first lookup pays the recursive scan; every later tick for the same doctrine
 * hits the cache. Ships whose doctrine never uses `moduleDestroyed` — the
 * common case across the preset corpus, where every rules array is empty or
 * uses only formation/spatial kinds — skip the per-tick module scan and Set
 * allocation in {@link buildContext} entirely.
 */
const DOCTRINE_USES_MODULE_DESTROYED = new WeakMap<Doctrine, boolean>();

/** Memoised predicate (see {@link DOCTRINE_USES_MODULE_DESTROYED}). Exported so
 *  the recursion over `all`/`any` combinators is unit-testable in isolation. */
export function doctrineUsesModuleDestroyed(doctrine: Doctrine): boolean {
  const cached = DOCTRINE_USES_MODULE_DESTROYED.get(doctrine);
  if (cached !== undefined) return cached;
  const result = doctrine.rules.some((r) =>
    conditionUsesModuleDestroyed(r.condition),
  );
  DOCTRINE_USES_MODULE_DESTROYED.set(doctrine, result);
  return result;
}

/** Shared empty sentinel for ships whose doctrine never reads destroyed kinds.
 *  Only ever assigned to {@link TriggerContext.destroyedModuleKinds}, which the
 *  interpreter reads via `.has` alone — never mutated — so a single shared
 *  instance is safe. */
const EMPTY_KINDS: ReadonlySet<ModuleKind> = new Set<ModuleKind>();

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
    // Build the destroyed-kind set only when the doctrine can read it; the
    // common case (no `moduleDestroyed` condition anywhere in the rules) passes
    // a shared empty sentinel, skipping the O(module-count) scan and Set
    // allocation. The sentinel is read via `.has` alone, so sharing is safe.
    destroyedModuleKinds: doctrineUsesModuleDestroyed(ship.doctrine)
      ? destroyedModuleKinds(ship)
      : EMPTY_KINDS,
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
    // A doctrine with no rules evaluates to its base stance with every flag
    // down and never reads the trigger context, so skip building it (no target
    // lookup, hypot, or destroyed-kind scan) and go straight to the base state.
    // Byte-identical to running an empty rules array through effectiveDoctrineAi.
    const state =
      ship.doctrine.rules.length > 0
        ? effectiveDoctrineAi(
            ship.doctrine,
            buildContext(ship, byId, attackerStrength, defenderStrength),
          )
        : baseAiState(ship.doctrine.base.stance ?? "balanced");
    ship.aiHoldFire = state.holdFire;
    ship.aiFocusFire = state.focusFire;
    ship.aiRetreat = state.retreat;
    ship.aiPrioritiseRepair = state.prioritiseRepair;
    ship.aiRally = state.rally;
    // `aiStance` records a stance OVERRIDE only: the effective stance differs
    // from the doctrine base stance exactly when a `setStance` rule fired this
    // tick. Leaving it `null` otherwise keeps a rule-less ship on its doctrine
    // base stance, so the movement/targeting stance reads are unchanged.
    const baseStance = ship.doctrine.base.stance ?? "balanced";
    ship.aiStance = state.stance !== baseStance ? state.stance : null;
  }
}
