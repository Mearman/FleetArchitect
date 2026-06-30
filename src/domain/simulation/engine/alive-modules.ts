/** Critical-module "is the ship still viable" predicates. Extracted from
 *  physics.ts to keep that module under the 800-line lint cap; re-exported there
 *  so existing `import { hasAliveCommand, hasAliveReactor } from "./physics"`
 *  callers are unchanged. */

import type { SimShip } from "./types";

/** Whether the ship has at least one alive command (bridge) module. Ships
 *  without any command module cannot fire. A module at 0 hp counts as
 *  destroyed even before its `alive` flag is flipped (destruction is hp-driven). */
export function hasAliveCommand(ship: SimShip): boolean {
  if (ship.modules === undefined) return true;
  for (const m of ship.modules) {
    if (m.command && m.alive && m.hp > 0) return true;
  }
  return false;
}

/** Whether the ship has at least one alive reactor (power) module. A modular
 *  ship with no reactor is destroyed by the reactor-loss death rule in the tick
 *  loop — without power it cannot fire, shield, or run life support, and the
 *  simulation has no other path that kills it, so leaving it alive would stall a
 *  battle on a mutual brownout. Uses structural loss (`alive`/`hp`), not the
 *  `manned` gate — an alive-but-unmanned reactor is a recoverable brownout.
 *  Legacy non-modular ships are unaffected. */
export function hasAliveReactor(ship: SimShip): boolean {
  if (ship.modules === undefined) return true;
  for (const m of ship.modules) {
    if (m.alive && m.hp > 0 && m.effect.kind === "power") return true;
  }
  return false;
}
