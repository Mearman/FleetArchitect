import type { BattleFrame, MediumSnapshot } from "@/schema/battle";

// ---------------------------------------------------------------------------
// Arena medium field: shared renderer helpers (used by every medium overlay)
// ---------------------------------------------------------------------------
//
// The arena carries two scalar substrates (see `src/schema/battle.ts`,
// `MediumSnapshot`, and the pure solver in `src/domain/simulation/engine/`):
//
//   rho — mass density ρ per cell (kg). The AMBIENT medium. Baseline is the
//         interstellar medium (ISM, ~1.7e-22 kg/m^3, effectively dark); nebula
//         and debris clouds lift ρ far above that (nebula target ~1e-12 kg per
//         cell).
//
//   eps — excitation energy ε per cell (J). Deposited WHERE ENERGY IS DUMPED:
//         thruster exhaust plumes, beam channels, projectile wakes. Diffuses
//         and decays. ε is zero in undisturbed space and high where a ship has
//         just dumped heat or a beam has just cut through.
//
// Physically, an ambient medium glows only when ionised or heated — a nebula
// does not radiate on its own, it radiates where a passing beam or exhaust
// plume excites it. So the glow is DRIVEN by ε and AMPLIFIED by ρ: the same
// energy dump glows brighter in denser matter (more gas to excite). Undisturbed
// space (ε ≈ 0) stays dark regardless of ρ, which is why a quiescent nebula is
// invisible until something lights it up.
//
// Two overlays render this field and share the helpers below:
//   - `mediumGlow.ts`    — broad AMBIENT glow: one soft radial-gradient blob per
//                          excited cell (the coarse field view).
//   - `mediumTrails.ts`  — sharp ANALYTIC per-entity streaks (exhaust/plume
//                          streamers) whose brightness is sampled from the same
//                          field, so the two overlays stay visually consistent.
//
// Keeping the palette, the FX-level reader, the field resolution, and the
// brightness mapping here means both overlays draw from one definition of
// "how bright is this cell" — denser medium = brighter, identically, in both.

// ---------------------------------------------------------------------------
// Cell <-> world mapping (re-derived UI-side — mirrors the engine convention)
// ---------------------------------------------------------------------------
//
// The grid is centred on the world origin. Cell (col, row) — flat index
// `row * widthM + col` — has its CENTRE at world
//
//   wx = (col + 0.5 - widthM / 2) * pitchM
//   wy = (row + 0.5 - heightM / 2) * pitchM
//
// This is the exact mapping the engine's `worldToMediumCell` inverts
// (`col = floor(worldX / pitchM + widthM / 2)`), and the one documented on
// `MediumSnapshot` in `src/schema/battle.ts`. The renderer cannot import the
// engine (UI/domain boundary), so it is re-derived here from the documented
// convention. `worldToCellIndex` below is that inverse.

/**
 * Compute the flat cell index for a world point, or -1 if it falls outside the
 * grid. Mirrors the engine's `worldToMediumCell` convention
 * (`col = floor(wx / pitchM + widthM / 2)`), re-derived UI-side because the
 * renderer cannot import the engine. Used to sample the medium field at a world
 * point (the analytic trails in `mediumTrails.ts`); the ambient glow in
 * `mediumGlow.ts` rasterises the whole field instead, so it does not call this.
 */
export function worldToCellIndex(
  field: MediumSnapshot,
  wx: number,
  wy: number,
): number {
  const { widthM, heightM, pitchM } = field;
  if (pitchM <= 0) return -1;
  const col = Math.floor(wx / pitchM + widthM / 2);
  const row = Math.floor(wy / pitchM + heightM / 2);
  if (col < 0 || col >= widthM || row < 0 || row >= heightM) return -1;
  return row * widthM + col;
}

// ---------------------------------------------------------------------------
// Brightness mapping (ε-driven, ρ-amplified)
// ---------------------------------------------------------------------------
//
// Per cell:
//
//   intensity = eps[cell] * EPS_GAIN_J_INV * (1 + rho[cell] / RHO_REF_KG)
//
// clamped to [0, 1]. `EPS_GAIN_J_INV` normalises ε (in joules) so a typical
// exhaust deposit reads as a clear glow; `RHO_REF_KG` is the density at which
// the ρ-amplifier doubles the glow, tuned to the nebula-target magnitude so a
// nebula battle visibly amplifies its plumes but ISM-baseline space (negligible
// ρ) leaves the amplifier at ~1.0.
//
// Tuning rationale (magnitudes taken from the engine constants):
//   - Exhaust deposit per tick per cell =
//       0.5 * F * v_exhaust * coupling * dt
//     with v_exhaust ≈ 3138 m/s, coupling 0.02, dt 1/30 s. A multi-MN thruster
//     (F ~ 1e6 N) deposits ~1e6 J per cell per tick into ε; cells accumulate
//     and diffuse, so a sustained plume reaches ε on the order of 1e6–1e7 J.
//     EPS_GAIN_J_INV = 3e-7 maps that range to ~0.3–0.7 glow (clear without
//     saturating); ISM-space ε ≈ 0 maps to 0 (dark, as required).
//   - Nebula target ρ is 1e-12 kg per cell. Setting RHO_REF_KG = 5e-13 means a
//     fully filled nebula cell (1e-12 kg) amplifies the glow by 3x (1 + 2),
//     while ISM-baseline cells (1.7e-22 kg) contribute a factor of 1.0 — the
//     amplifier only matters where matter actually exists.
//
// Both constants are named, documented, and derived from the engine's SI
// magnitudes (not magic numbers).

/** ε (joules) → glow normaliser. Inverse of the typical sustained-plume ε so a
 *  plume reads as ~0.3–0.7 and ISM-baseline ε ≈ 0 stays dark. See rationale. */
export const EPS_GAIN_J_INV = 3e-7;

/** ρ (kg per cell) at which the density amplifier doubles the glow. Set to half
 *  the nebula target density so a filled nebula triples the glow; ISM ρ is
 *  negligible and leaves the amplifier at 1.0. See rationale. */
export const RHO_REF_KG = 5e-13;

/** Cells below this normalised intensity are skipped entirely. Bounds paint
 *  count on a 20k-cell grid to the few cells that actually glow. */
export const INTENSITY_DRAW_THRESHOLD = 0.02;

/**
 * Sample the ε-driven, ρ-amplified medium intensity at a world point. Returns a
 * value in [0, 1] (0 outside the grid or where no ε is deposited), scaled by the
 * resolved FX gain. This is the single brightness truth both medium overlays
 * share: a point in a dense/excited region reads bright, a point in cold vacuum
 * reads dark, regardless of which overlay paints it.
 *
 * `fxGain` is the resolved FX multiplier for the current level
 * (`fxGainFor(level)`), NOT the raw level string.
 */
export function sampleMediumIntensity(
  field: MediumSnapshot,
  wx: number,
  wy: number,
  fxGain: number,
): number {
  const idx = worldToCellIndex(field, wx, wy);
  if (idx < 0) return 0;
  const eps = (field.epsVis ?? field.eps)[idx];
  if (eps === undefined || eps <= 0) return 0; // nothing deposited → dark
  const rho = field.rho[idx] ?? 0;
  return Math.max(
    0,
    Math.min(1, eps * EPS_GAIN_J_INV * fxGain * (1 + rho / RHO_REF_KG)),
  );
}

// ---------------------------------------------------------------------------
// FX level
// ---------------------------------------------------------------------------

// The FxProvider writes the effective level to
// `document.documentElement.dataset.fx` ("off" | "reduced" | "full"); overlays
// are pure draw functions with no React access, so they read that single source
// of truth directly. `off` → not drawn at all; `reduced` → dimmer (lower gain);
// `full` → full glow.

/** FX gain multiplier applied at the full FX level. */
export const FX_GAIN_MULTIPLIER_FULL = 1.0;

/** FX gain multiplier applied at the reduced FX level (half brightness). */
export const FX_GAIN_MULTIPLIER_REDUCED = 0.5;

/**
 * Read the effective FX level from the DOM dataset the FxProvider maintains.
 * The FxProvider (`src/ui/fx/FxContext.tsx`) writes
 * `document.documentElement.dataset.fx = level` on every change, so this is the
 * single source of truth — no React context needed in a pure draw function.
 * Defaults to "full" when the attribute is absent (e.g. SSR or a missing
 * provider), matching `DEFAULT_PREF`.
 */
export function readFxLevel(): "off" | "reduced" | "full" {
  const raw = document.documentElement.dataset["fx"];
  if (raw === "off" || raw === "reduced" || raw === "full") return raw;
  return "full";
}

/**
 * Resolve the FX level to its gain multiplier. Returns 0 for "off" — callers
 * that early-return on "off" before drawing will never read the 0; it is the
 * neutral element for any path that does.
 */
export function fxGainFor(level: "off" | "reduced" | "full"): number {
  if (level === "off") return 0;
  return level === "reduced" ? FX_GAIN_MULTIPLIER_REDUCED : FX_GAIN_MULTIPLIER_FULL;
}

// ---------------------------------------------------------------------------
// Hot palette (shared by every medium overlay)
// ---------------------------------------------------------------------------

/** Colour-ramp stops for the hot palette, sampled by normalised intensity. A
 *  cool-magenta outer haze fades up through pink to a near-white core: reads as
 *  ionised gas (hydrogen H-alpha is red/pink; a hot core washes toward white).
 *  Defensible (real ionised-hydrogen emission is red/pink) and legible against
 *  the dark space backdrop. Stops are [intensity, [r,g,b]]. */
export const PALETTE_STOPS: ReadonlyArray<
  readonly [number, readonly [number, number, number]]
> = [
  [0.0, [40, 6, 60]], // deep magenta haze (faint outer glow)
  [0.35, [220, 60, 120]], // pink (ionised hydrogen edge)
  [0.7, [255, 170, 200]], // hot pink (bright plume body)
  [1.0, [255, 248, 240]], // near-white (saturated core)
];

/** Linearly interpolate the palette at normalised intensity t ∈ [0, 1]. */
export function paletteSample(t: number): [number, number, number] {
  const tt = Math.max(0, Math.min(1, t));
  for (let i = 1; i < PALETTE_STOPS.length; i += 1) {
    const hi = PALETTE_STOPS[i];
    if (hi === undefined) break;
    if (tt <= hi[0]) {
      const lo = PALETTE_STOPS[i - 1];
      if (lo === undefined) return [hi[1][0], hi[1][1], hi[1][2]];
      const span = hi[0] - lo[0];
      const f = span > 0 ? (tt - lo[0]) / span : 0;
      return [
        lo[1][0] + (hi[1][0] - lo[1][0]) * f,
        lo[1][1] + (hi[1][1] - lo[1][1]) * f,
        lo[1][2] + (hi[1][2] - lo[1][2]) * f,
      ];
    }
  }
  const last = PALETTE_STOPS[PALETTE_STOPS.length - 1];
  if (last === undefined) return [255, 255, 255];
  return [last[1][0], last[1][1], last[1][2]];
}

// ---------------------------------------------------------------------------
// Tick-based field resolution (pure, deterministic, scrub-safe)
// ---------------------------------------------------------------------------
//
// The engine emits `frame.medium` only every `RESOURCE_EVERY` ticks (the medium
// diffuses slowly, so per-tick snapshots would bloat the frame for no render-
// side gain — mirrors the per-ship resource block); the ticks between emissions
// carry no `medium`. The field to show at any tick is therefore "the snapshot of
// the most recent emission tick AT OR BEFORE this tick", and that is a PURE
// FUNCTION OF THE TICK — not of which frames the renderer happened to draw.
//
// A previous design held the last-seen field in a module-scoped cache updated
// on emission ticks. That is order-dependent and broke under timeline scrubbing:
// scrub values are fractional, so `interpolateFrame` returns a synthetic frame
// that strips `medium`, the cache never updated, and the glow froze on whatever
// emission tick forward playback last visited (backward scrub painted future
// medium, forward scrub painted stale medium). Resolving from the frame history
// by tick instead has no state to go stale, so it is correct in both scrub
// directions and across battles.

/**
 * Resolve the medium field for a given tick from the discrete frame history:
 * the snapshot of the most recent emission tick AT OR BEFORE `tick`. Pure
 * function of `(frames, tick)` — deterministic, so forward and backward scrub to
 * the same tick return the identical field object, regardless of playback order.
 *
 * The scan starts at `tick` and walks backward; because tick 0 always carries a
 * field (0 is an emission tick) it terminates within `RESOURCE_EVERY - 1` steps.
 * Returns `undefined` only when no frame in range has a field (a vacuum-anomaly
 * battle, or a replay recorded before the medium existed) — a clean early-return
 * rather than a sentinel.
 *
 * Both medium overlays call this independently with the same `(frames, tick)`,
 * so they always read the identical field and stay visually consistent without
 * sharing mutable state.
 */
export function resolveMediumField(
  frames: readonly BattleFrame[],
  tick: number,
): MediumSnapshot | undefined {
  const start = Math.min(Math.max(0, Math.floor(tick)), frames.length - 1);
  for (let i = start; i >= 0; i -= 1) {
    const f = frames[i];
    if (f === undefined) continue;
    if (f.medium !== undefined) return f.medium;
  }
  return undefined;
}
