/**
 * Fast 2-D Euclidean length for the engine's hot N²/N×M loops.
 *
 * `Math.hypot` is IEEE-754 correctly-rounded — it scales its inputs to avoid
 * intermediate overflow/underflow — which makes it ~3.4× slower in V8 than the
 * direct `Math.sqrt(dx*dx + dy*dy)`. At combat-range inputs (dx, dy far below
 * `sqrt(Number.MAX_VALUE)`) the overflow protection never triggers, so the two
 * differ only by last-ULP rounding. The per-tick hot loops (gravity, separation,
 * EM reception, emissions, …) use this; cold or once-per-tick paths keep
 * `Math.hypot` for readability.
 *
 * Determinism: the result is a deterministic function of its inputs (same bits
 * every run), so run-to-run byte-identity is preserved. Adopting it does change
 * the pinned frame hashes by last-ULP jitter; those are re-baselined in
 * `@/domain/cache/algorithm-signature.ts`.
 */
export function fastHypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}
