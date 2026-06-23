/**
 * The single piece of module-level mutable simulation state: the deterministic
 * per-battle projectile id counter. Kept in its own leaf (rather than the
 * constants leaf `config.ts`) so the tunable `SIM` constants stay pure data and
 * the one stateful concern is isolated. `config.ts` re-exports these so callers
 * keep importing them from `./config` unchanged.
 *
 * The counter is reset at the start of each `simulateBattle` call and
 * incremented in spawn order, so two same-seed runs produce byte-identical
 * projectile ids. The get/set pair makes it authoritative checkpoint state: the
 * next `claimProjectileId` mints `proj-<counter>`, so capturing and restoring the
 * counter keeps ids byte-identical to a fresh run that reached the same tick.
 */

/** Deterministic per-battle projectile id counter. Used by the snapshot →
 *  interpolation path to match projectiles across consecutive frames for smooth
 *  sub-tick rendering. */
let projectileCounter = 0;

/** Reset the per-battle projectile id counter to zero. Called once at the top of
 *  `simulateBattle` so each run starts ids at 0 regardless of prior runs. */
export function resetProjectileCounter(): void {
  projectileCounter = 0;
}

/** Claim the next projectile id in spawn order, returning the `proj-<n>` form
 *  the snapshot path matches across frames. Increments the counter so the next
 *  call yields the next id — byte-identical to the original
 *  `\`proj-${projectileCounter++}\`` expression. */
export function claimProjectileId(): string {
  const id = `proj-${projectileCounter}`;
  projectileCounter += 1;
  return id;
}

/** Read the current projectile-id counter so a checkpoint can capture it. The
 *  counter is authoritative state: the next `claimProjectileId` will mint
 *  `proj-<this value>`, so restoring it on resume keeps projectile ids
 *  byte-identical to a fresh run that reached the same tick. */
export function getProjectileCounter(): number {
  return projectileCounter;
}

/** Restore the projectile-id counter from a checkpoint so projectile ids minted
 *  after a resume continue the same spawn-order sequence. Paired with
 *  `getProjectileCounter()`; the restored run mints the same ids a fresh run
 *  would from this tick onward. */
export function setProjectileCounter(n: number): void {
  projectileCounter = n;
}
