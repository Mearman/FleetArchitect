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
// One overlay renders this field and shares the helpers below:
//   - `battleGlow.ts` — the unified battlefield glow: the ambient field (one
//                       texel per cell, smoothed) PLUS the live particles, both
//                       through the one brightness truth below.
//
// Keeping the palette, the FX-level reader, the field resolution, and the
// brightness mapping here means the field and the particles draw from one
// definition of "how bright is this energy here".

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
 * point (the particle splat in `battleGlow.ts`); the field raster scan iterates
 * cells directly, so it does not call this.
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
// Brightness mapping (ε-driven, ρ-amplified, tone-mapped)
// ---------------------------------------------------------------------------
//
// Per cell the glow intensity is a saturating (Michaelis–Menten) response over
// the ρ-amplified excitation:
//
//   effEps    = eps[cell] * min(RHO_AMPLIFIER_CAP, 1 + rho[cell] / RHO_REF_KG)
//   intensity = fxGain * effEps / (effEps + EPS_HALFSAT_J)
//
// Why saturating, not a linear gain. ε spans a huge range — a fresh muzzle
// flash deposits ~1e3 J, a sustained multi-MN drive plume accumulates to
// ~1e6–1e7 J — and it grows over a battle as plumes sustain. A linear
// `eps * gain` either saturates the bright cores (every exhaust cell clamps to
// 1 → a flat max-brightness blob) or, with a gain low enough to avoid that,
// makes everything else invisible. The saturating response asymptotes to 1, so
// the glow never hard-clips however large ε grows, yet small ε still reads as a
// visible non-zero value: the full range is a gradient (bright core fading to a
// faint haze) rather than a blob.
//
// Tuning anchors (magnitudes from the engine SI constants):
//   - A sustained drive plume reaches ε ≈ 2e6 J (measured on the preset
//     matchups); with the 3× ρ-amplifier, effEps ≈ 6e6, so EPS_HALFSAT_J = 4e6
//     maps it to 6e6 / (6e6 + 4e6) ≈ 0.6. ISM-space ε ≈ 0 maps to 0 (dark).
//   - Nebula target ρ is 1e-12 kg/cell; RHO_REF_KG = 5e-13 → a filled nebula
//     amplifies 3× (the cap); ISM ρ (1.7e-22) leaves the amplifier at 1.0. An
//     exhaust plume's own ρ (~1e-5) is capped at the same 3× so it cannot
//     self-amplify to saturation.
//
// fxGain (`fxGainFor(level)`) scales the result for the FX level ("off" → 0,
// "reduced" → 0.5, "full" → 1). The mapping is a pure renderer choice; the
// simulation's ε/ρ fields are unchanged.

/** ρ-amplified ε (joules) at which a cell reaches half-max glow brightness. The
 *  glow uses a saturating `effEps / (effEps + K)` response (not a linear gain):
 *  ε spans a huge range (a fresh muzzle flash ~1e3 J, a sustained drive plume
 *  ~1e6–1e7 J) and grows over a battle, so a linear gain either saturates the
 *  bright cores to a flat max-brightness blob or makes the rest invisible. The
 *  saturating response asymptotes to 1, so the glow never hard-clips however
 *  large a plume grows, yet small ε still maps to a visible value — the full
 *  range reads as a gradient (bright core fading to faint haze) instead of a
 *  blob. Calibrated so a sustained drive plume (ε ~2e6 J, 3× ρ-amplified →
 *  effEps ~6e6) reads 6e6 / (6e6 + 4e6) ≈ 0.6. */
export const EPS_HALFSAT_J = 4e6;

/** ρ (kg per cell) at which the density amplifier doubles the glow. Set to half
 *  the nebula target density so a filled nebula triples the glow; ISM ρ is
 *  negligible and leaves the amplifier at 1.0. See rationale. */
export const RHO_REF_KG = 5e-13;

/** Cap on the ρ-amplifier. An exhaust plume's own ρ (~1e-5 kg/cell) is orders
 *  above the nebula target this amplifier is scaled to, so without a cap it
 *  would amplify the plume's own ε by ~1e7 and saturate the glow to a flat blob.
 *  Capping at the intended nebula max (3×) keeps the denser-medium boost without
 *  the exhaust self-amplification blow-out. */
export const RHO_AMPLIFIER_CAP = 3;

/** Cells below this normalised intensity are skipped entirely. Bounds paint
 *  count on a 20k-cell grid to the few cells that actually glow. */
export const INTENSITY_DRAW_THRESHOLD = 0.02;

/** Number of cell-rows at each grid edge over which the ambient glow fades from
 *  full intensity to zero. The glow only exists inside the medium grid, so
 *  without a feather the buffer hard-clips at the grid rectangle — a visible
 *  straight border wherever the edge falls on screen. The grid is padded
 *  (`MEDIUM_GRID_MARGIN_CELLS` in the engine) so this feather fades within the
 *  padded margin (behind the ships), not into the ships' own plumes. Keep this
 *  ≤ the engine margin. */
export const GLOW_EDGE_FEATHER_CELLS = 3;

/**
 * Edge fade factor (0 at the grid boundary → 1 in the interior) for a cell at
 * `(col, row)` in a `widthM × heightM` grid, ramping linearly over the outermost
 * {@link GLOW_EDGE_FEATHER_CELLS} rows/cols. The glow overlay multiplies each
 * cell's intensity by this so the field fades out at the grid edge instead of
 * being hard-clipped by the buffer's rectangle. */
export function glowEdgeFade(
  col: number,
  row: number,
  widthM: number,
  heightM: number,
): number {
  const edgeDist = Math.min(col, widthM - 1 - col, row, heightM - 1 - row);
  return Math.max(0, Math.min(1, edgeDist / GLOW_EDGE_FEATHER_CELLS));
}

/**
 * The ε-driven, ρ-amplified, tone-mapped glow intensity for one cell: a
 * saturating `effEps / (effEps + EPS_HALFSAT_J)` response over the
 * ρ-amplified excitation, scaled by the FX gain. Returns a value in [0, fxGain]
 * — the saturating response never reaches fxGain, so the glow never hard-clips
 * however large ε grows. 0 where no ε is deposited. This is the single
 * brightness truth both medium overlays share: a sustained plume reads bright at
 * its core and fades to a faint haze at its edges, regardless of which overlay
 * paints it.
 *
 * `fxGain` is the resolved FX multiplier for the current level
 * (`fxGainFor(level)`), NOT the raw level string.
 */
export function mediumCellIntensity(eps: number, rho: number, fxGain: number): number {
  if (eps <= 0) return 0;
  const amp = densityAmplifier(rho);
  const effEps = eps * amp;
  return (fxGain * effEps) / (effEps + EPS_HALFSAT_J);
}

/**
 * Divisor mapping a particle's raw emitted energy (Joules — a point packet) into
 * the field's effective-eps brightness range, so the particle renders through the
 * SAME {@link mediumCellIntensity} tone-map as a grid cell: one brightness truth.
 * An authored scale (a typical thruster parcel's ~2e7 J lands mid-range against
 * {@link EPS_HALFSAT_J}); tuned in the calibration cycle for the dynamic range.
 */
export const PARTICLE_ENERGY_TO_EFFECTIVE_EPS = 5;

/** A particle's effective cell excitation: its raw energy scaled into the field's
 *  brightness range, feeding {@link mediumCellIntensity} so the particle glows by
 *  the same truth as a grid cell. */
export function particleEffectiveEps(energyJ: number): number {
  return energyJ / PARTICLE_ENERGY_TO_EFFECTIVE_EPS;
}

/** A particle's display brightness through the ONE shared tone-map: its effective
 *  eps and the local density amplifier, saturating against {@link EPS_HALFSAT_J}.
 *  Identical to a grid cell's {@link mediumCellIntensity} — the particle is no
 *  longer "self-luminous with its own intensity". */
export function particleCellBrightness(energyJ: number, rho: number, fxGain: number): number {
  return mediumCellIntensity(particleEffectiveEps(energyJ), rho, fxGain);
}

/**
 * Sample the medium glow intensity at a world point — {@link mediumCellIntensity}
 * at the cell containing `(wx, wy)`. Used by the analytic trails overlay; the
 * ambient glow rasterises the whole field instead (so it does not call this).
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
  return mediumCellIntensity(eps, rho, fxGain);
}

/**
 * Sample the raw AMBIENT mass density ρ (kg per cell) at a world point — the
 * `rho` substrate only, 0 outside the grid. Unlike {@link sampleMediumIntensity},
 * which returns the ε-driven fused glow intensity, this returns the raw ρ
 * component alone. Callers that have their OWN independently-sourced brightness
 * (e.g. `particleGlow`'s self-luminous weapon particles, whose energy is the
 * particle's own `intensity`, not the medium field's ε) sample ρ directly and
 * apply {@link densityAmplifier} to it, rather than double-counting the medium
 * field's separately-rendered ε contribution via `sampleMediumIntensity`.
 */
export function sampleMediumRho(
  field: MediumSnapshot,
  wx: number,
  wy: number,
): number {
  const idx = worldToCellIndex(field, wx, wy);
  if (idx < 0) return 0;
  return field.rho[idx] ?? 0;
}

/**
 * The density amplification factor for a self-luminous source's OWN brightness
 * — the same ramp {@link mediumCellIntensity} applies internally (1× in vacuum,
 * capped at `cap` in dense medium), exposed so an overlay carrying its own
 * brightness (e.g. `particleGlow`'s weapon particles) reads "how much brighter a
 * nebula makes things" identically to the ε-driven field glow. Multiply a
 * source's own normalised intensity by this and re-clamp to [0, 1].
 * `densityAmplifier(0)` is exactly 1, so a source in vacuum (or when no field is
 * resolved) is unchanged. `cap` defaults to {@link RHO_AMPLIFIER_CAP}.
 */
export function densityAmplifier(
  rho: number,
  cap: number = RHO_AMPLIFIER_CAP,
): number {
  return Math.min(cap, 1 + rho / RHO_REF_KG);
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
