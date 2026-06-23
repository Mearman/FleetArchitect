/**
 * Roster refresh — the two parallel implementations of the per-tick per-side
 * roster rebuild.
 *
 * The engine maintains three derived views over the live `ships` array:
 * `attackers`, `defenders` (per-side filtered lists) and `byId` (the id index).
 * Every entry in `ships` appears in exactly one side list and in `byId`.
 * Membership only ever grows — break-apart chunks and phantom launches push into
 * the same stable array, and a ship never changes side — so the rebuilt views
 * are identical whenever the count is unchanged.
 *
 * {@link refreshRosterReference} is the oracle: it rebuilds unconditionally.
 * {@link refreshRosterIncremental} is the optimised implementation: it rebuilds
 * only when `attackers.length + defenders.length !== ships.length`, a signal
 * derived from the state itself rather than from a persistent counter.
 *
 * Both implementations produce byte-identical roster views. The engine wires
 * the incremental form; the reference form exists for the equivalence test and
 * as a readable specification of what the rebuild does.
 */

import type { EngineState } from "./state";

/** Rebuild the per-side lists and id index from `state.ships`. */
function rebuild(state: EngineState): void {
  state.attackers = state.ships.filter((s) => s.side === "attacker");
  state.defenders = state.ships.filter((s) => s.side === "defender");
  state.byId = new Map(state.ships.map((s) => [s.instanceId, s]));
}

/**
 * The reference (oracle) implementation: rebuild the roster unconditionally on
 * every call. This is the naive path that rebuilds at the top of each tick
 * regardless of whether anything changed.
 */
export function refreshRosterReference(state: EngineState): void {
  rebuild(state);
}

/**
 * The optimised implementation: rebuild the roster only when the live ships
 * array has grown since the last rebuild.
 *
 * The derived signal — `attackers.length + defenders.length !== ships.length`
 * — needs no persistent counter. Membership only ever grows (chunks and
 * phantoms push into the stable `ships` array; no ship changes side), so the
 * rebuilt views are identical whenever the count is unchanged. The signal
 * re-derives from the restored state on the first tick after a checkpoint
 * resume, so this path is resume-safe: a checkpoint restores `attackers`,
 * `defenders`, and `byId` alongside `ships`, and the signal correctly reports
 * "unchanged" until the next growth event.
 *
 * The manual full rebuild at the break-apart chunk-push site (in `index.ts`)
 * already leaves `attackers` + `defenders` equal to `ships.length`, so the
 * derived signal stays clean across that site too.
 */
export function refreshRosterIncremental(state: EngineState): void {
  if (state.attackers.length + state.defenders.length !== state.ships.length) {
    rebuild(state);
  }
}
