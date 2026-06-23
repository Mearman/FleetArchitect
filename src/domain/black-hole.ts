/**
 * The single source of truth for the gameplay black hole's two characteristic
 * radii. Previously this geometry was duplicated as bare literals in three
 * places that cannot import each other's internals — the simulation engine
 * (`engine/arena-physics.ts`), the pure occluder module (`occluders.ts`), and
 * the canvas renderer (`ui/routes/battleAnomaly.ts`). This leaf lives in the
 * pure-domain layer so all three import the same constant: the engine derives
 * the well's `G·M` from it, the occluder module sizes the line-of-sight disc to
 * it, and the renderer draws the event-horizon and tidal rings at it. A future
 * rescale of the well is now a single-line change here rather than three
 * literals that can silently drift apart.
 *
 * No React, no Dexie, no DOM, no engine dependency — a bare numeric leaf,
 * safe for every layer to import.
 */

/**
 * The black hole's Schwarzschild radius (metres) — the radius of its event
 * horizon, `r_s`, taken literally as the lethal radius: a ship within `r_s`
 * has crossed the horizon and is destroyed. A physically meaningful
 * combat-scale length (a ship-length or two) rather than the sub-atomic figure
 * the real `r_s = 2·G·M / c^2` gives at the relativistic speed of light, because
 * the arena's gravitational sector propagates at the much slower arena signal
 * speed (see `engine/arena-physics.ts`), not at relativistic `c`. The engine
 * derives the well's `G·M` FROM this radius via the Schwarzschild relation
 * `G·M = r_s · c_arena^2 / 2`, so the horizon and the pull share one scale.
 */
export const BLACK_HOLE_SCHWARZSCHILD_RADIUS_M = 24;

/**
 * Multiplier (dimensionless) taking the event-horizon radius out to the tidal
 * (spaghettification) zone radius. The tidal zone — within which a ship of
 * finite size takes `1/r^3` tidal damage but has not yet crossed the horizon —
 * extends to a fixed multiple of the horizon, set to twice the horizon radius
 * so the danger zone is a clearly readable annulus one horizon-width thick.
 * A future rescale that re-derives this as the Roche limit from the real tidal
 * field versus hull structural tolerance replaces this multiple in one place.
 */
export const BLACK_HOLE_TIDAL_RADIUS_FACTOR = 2;

/**
 * The black hole's tidal-zone radius (metres) — the outer edge of the
 * spaghettification danger zone, `BLACK_HOLE_TIDAL_RADIUS_FACTOR × r_s`.
 * Derived from the horizon radius and the tidal-zone multiple above so the two
 * radii cannot drift apart.
 */
export const BLACK_HOLE_TIDAL_RADIUS_M =
  BLACK_HOLE_SCHWARZSCHILD_RADIUS_M * BLACK_HOLE_TIDAL_RADIUS_FACTOR;
