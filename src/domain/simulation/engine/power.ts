/**
 * Phase 12 — Power economy (underlying resource simulation; use deferred).
 *
 * Per-tick reactor output versus module draw, accumulated into a ship-level
 * energy buffer measured in joules. This module is a **pure** stepper: given
 * the sources (reactor outputs, watts), the sinks (module draws, watts), the
 * current buffer state and its capacity, it returns the next buffer state.
 *
 * Physics. Power is energy per unit time (watts = joules/second). Over one
 * sim tick of duration `dt = 1 / TICKS_PER_SECOND` seconds, a source of
 * `P` watts delivers `P · dt` joules and a sink of `P` watts consumes
 * `P · dt` joules. The net power is
 *
 *     P_net = Σ P_source − Σ P_sink   [watts]
 *
 * and the buffer delta over the step is
 *
 *     ΔE = P_net · dt                  [joules].
 *
 * The buffer is a finite capacitor bank: it cannot hold negative charge and
 * cannot exceed its rated capacity. Hitting either bound is modelled as a
 * hard clamp. **Use is deferred** (Phase 12): no brownout, no reactor trip,
 * no module-idle behaviour is enforced here. The clamp merely keeps the state
 * physically valid; callers that want to act on a deficit read `buffer.energy`
 * and decide for themselves.
 *
 * Determinism. The stepper is a pure function of its inputs with no rng and a
 * fixed iteration order (sources then sinks, in array order). Two same-input
 * calls return byte-identical results.
 */

import { z } from "zod";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";

/**
 * Duration of one simulation tick, in seconds. Derived from the canonical
 * tick rate rather than authored directly: the engine emits one frame per
 * tick at `TICKS_PER_SECOND`, so the physical elapsed time per step is its
 * reciprocal. Documented rate anchor (see Phase 1 — `TICKS_PER_SECOND`).
 */
export const TICK_DURATION_SECONDS = 1 / TICKS_PER_SECOND;

/**
 * A single power source or sink. `watts` is non-negative; the sign of its
 * contribution to the net is determined by `direction`. Reactors are sources
 * (`direction: "source"`); powered modules are sinks
 * (`direction: "sink"`). Keeping the sign out of the magnitude lets the
 * schema reject negative power values, which have no physical meaning.
 */
export const PowerTerminal = z.object({
  /** Power rating in watts (joules per second). Always non-negative. */
  watts: z.number().min(0),
  /** Whether this terminal supplies the grid or draws from it. */
  direction: z.enum(["source", "sink"]),
});
export type PowerTerminal = z.infer<typeof PowerTerminal>;

/**
 * A bounded energy store. `energy` is the current charge in joules;
 * `capacityJoules` is the maximum charge the bank can hold. Both are
 * non-negative, and `energy` must not exceed `capacityJoules` (the stepper
 * enforces this invariant on every step).
 */
export const EnergyBuffer = z.object({
  /** Current stored energy, in joules. */
  energy: z.number().min(0),
  /** Maximum storable energy, in joules. */
  capacityJoules: z.number().min(0),
});
export type EnergyBuffer = z.infer<typeof EnergyBuffer>;

/**
 * The complete power-budget input for one ship: the live terminals (reactors
 * and powered modules) and the capacitor bank state. All values are in SI
 * units (watts, joules). This is the shape the integration step will assemble
 * each tick from the ship's fitted modules once Phase 12 is wired in.
 */
export const PowerBudget = z.object({
  /** Current energy store. */
  buffer: EnergyBuffer,
  /** Reactor outputs and module draws active this tick, in array order. */
  terminals: z.array(PowerTerminal),
});
export type PowerBudget = z.infer<typeof PowerBudget>;

/**
 * Sum the power contributions of a set of terminals. Sources add, sinks
 * subtract. Returns the net power in watts. Pure and order-stable: iteration
 * is in array order, summing into a running accumulator, so the result is
 * deterministic for any fixed input.
 */
export function netPower(terminals: readonly PowerTerminal[]): number {
  let net = 0;
  for (const terminal of terminals) {
    net += terminal.direction === "source" ? terminal.watts : -terminal.watts;
  }
  return net;
}

/**
 * Advance the energy buffer by one tick given the net power.
 *
 * `next = clamp(energy + net · dt, 0, capacity)` where `dt` is
 * `TICK_DURATION_SECONDS`. The clamp models the physical bounds of a
 * capacitor bank: charge cannot go negative (no borrowing from nowhere) and
 * cannot exceed the rated capacity (excess dissipates). Hitting a bound does
 * **not** trigger any gameplay consequence here — brownout, reactor trip and
 * module-idle behaviour are deferred to a later pass (Phase 12, use deferred).
 *
 * Pure: a deterministic function of `buffer` and `netWatts` with no rng.
 */
export function stepEnergyBuffer(
  buffer: EnergyBuffer,
  netWatts: number,
): EnergyBuffer {
  const deltaJoules = netWatts * TICK_DURATION_SECONDS;
  const unclamped = buffer.energy + deltaJoules;
  // Physical bounds of a capacitor: no negative charge, no overfill.
  const clamped = Math.min(
    buffer.capacityJoules,
    Math.max(0, unclamped),
  );
  return { energy: clamped, capacityJoules: buffer.capacityJoules };
}

/**
 * Convenience: compute the net power from a budget's terminals and step its
 * buffer one tick. Equivalent to
 * `stepEnergyBuffer(budget.buffer, netPower(budget.terminals))`. Returns the
 * post-step buffer only; the terminals are not modified (a caller that wants
 * to mutate module state on a deficit does so from its own read of the
 * result — deferred behaviour).
 */
export function stepPowerBudget(budget: PowerBudget): EnergyBuffer {
  return stepEnergyBuffer(budget.buffer, netPower(budget.terminals));
}
