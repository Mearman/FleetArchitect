import type { MediumSnapshot } from "@/schema/battle";
import type { OverlayCtx, OverlayDef } from "./types";

// ---------------------------------------------------------------------------
// Arena medium field: emergent ionisation / plume glow
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
// The overlay renders this as additive glow: hot cells brighten and stack,
// reading as ionised gas — exhaust plumes behind manoeuvring ships, the
// channel a beam cut, the wake of a passing projectile swarm. Drawn beneath the
// ship layer so hull silhouettes sit on top of the glow.

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
// convention.

/**
 * Project the world-space centre of cell (col, row) to a screen point via the
 * overlay's world-to-screen transform. Pure; no allocations beyond the return.
 */
function projectCellCentre(
  t: OverlayCtx["t"],
  col: number,
  row: number,
  widthM: number,
  heightM: number,
  pitchM: number,
): { x: number; y: number } {
  const wx = (col + 0.5 - widthM / 2) * pitchM;
  const wy = (row + 0.5 - heightM / 2) * pitchM;
  return t.project(wx, wy);
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
const EPS_GAIN_J_INV = 3e-7;

/** ρ (kg per cell) at which the density amplifier doubles the glow. Set to half
 *  the nebula target density so a filled nebula triples the glow; ISM ρ is
 *  negligible and leaves the amplifier at 1.0. See rationale. */
const RHO_REF_KG = 5e-13;

/** Cells below this normalised intensity are skipped entirely. Bounds paint
 *  count on a 20k-cell grid to the few cells that actually glow. */
const INTENSITY_DRAW_THRESHOLD = 0.02;

// FX-level multipliers. The FxProvider writes the effective level to
// `document.documentElement.dataset.fx` ("off" | "reduced" | "full"); overlays
// are pure draw functions with no React access, so they read that single source
// of truth directly. `off` → not drawn at all; `reduced` → dimmer (lower gain);
// `full` → full glow.
const FX_GAIN_MULTIPLIER_FULL = 1.0;
const FX_GAIN_MULTIPLIER_REDUCED = 0.5;

/** Colour-ramp stops for the hot palette, sampled by normalised intensity. A
 *  cool-magenta outer haze fades up through pink to a near-white core: reads as
 *  ionised gas (hydrogen H-alpha is red/pink; a hot core washes toward white).
 *  Defensible (real ionised-hydrogen emission is red/pink) and legible against
 *  the dark space backdrop. Stops are [intensity, [r,g,b]]. */
const PALETTE_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0.0, [40, 6, 60]], // deep magenta haze (faint outer glow)
  [0.35, [220, 60, 120]], // pink (ionised hydrogen edge)
  [0.7, [255, 170, 200]], // hot pink (bright plume body)
  [1.0, [255, 248, 240]], // near-white (saturated core)
];

/** Linearly interpolate the palette at normalised intensity t ∈ [0, 1]. */
function paletteSample(t: number): [number, number, number] {
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
// Last-known field cache
// ---------------------------------------------------------------------------

/**
 * The most recent medium snapshot seen, held at module scope so the overlay
 * stays continuous across off-ticks. `frame.medium` is emitted only every
 * `RESOURCE_EVERY` ticks (the medium diffuses slowly, so subsampling bloats no
 * render-side gain — mirrors the per-ship resource block). On an emission tick
 * the cache is replaced; on an off-tick (`frame.medium === undefined`) the
 * overlay draws from this cache. Mirrors the resource-overlay pattern
 * (`heldAtmosphere` in `atmosphereBreach.ts`).
 *
 * Lives at module scope: persists across rAF draws within a battle and is
 * displaced implicitly when a new battle emits its own (different grid shape)
 * field. Typed `MediumSnapshot | undefined` so "never seen" is a clean
 * early-return rather than a sentinel.
 */
let heldMedium: MediumSnapshot | undefined;

/**
 * Read the effective FX level from the DOM dataset the FxProvider maintains.
 * The FxProvider (`src/ui/fx/FxContext.tsx`) writes
 * `document.documentElement.dataset.fx = level` on every change, so this is the
 * single source of truth — no React context needed in a pure draw function.
 * Defaults to "full" when the attribute is absent (e.g. SSR or a missing
 * provider), matching `DEFAULT_PREF`.
 */
function readFxLevel(): "off" | "reduced" | "full" {
  const raw = document.documentElement.dataset["fx"];
  if (raw === "off" || raw === "reduced" || raw === "full") return raw;
  return "full";
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

/**
 * Medium-field glow: additive ionisation glow beneath the ship layer. Reads the
 * last-known `{ rho, eps, widthM, heightM, pitchM }` field; for each cell whose
 * ε-driven intensity clears a small threshold, paints a hot-palette disc with
 * `globalCompositeOperation = "lighter"` so overlapping glows stack and
 * brighten. Denser ρ amplifies the glow (nebula-amplification); ε ≈ 0 cells are
 * skipped (undisturbed space stays dark).
 */
function drawMediumGlow(c: OverlayCtx): void {
  const { ctx, frame, t } = c;

  // FX level: `off` → nothing. `reduced` → dimmer gain.
  const fx = readFxLevel();
  if (fx === "off") return;
  const fxGain = fx === "reduced" ? FX_GAIN_MULTIPLIER_REDUCED : FX_GAIN_MULTIPLIER_FULL;

  // Update the cache on emission ticks; draw from it on off-ticks.
  if (frame.medium !== undefined) {
    heldMedium = frame.medium;
  }
  const field = heldMedium;
  if (field === undefined) return; // no medium has ever been seen

  const { rho, eps, widthM, heightM, pitchM } = field;
  const cellCount = widthM * heightM;
  if (rho.length < cellCount || eps.length < cellCount) return;

  // Cell screen extent: pitch in world units, scaled by the transform. Derive
  // from projecting two horizontally-adjacent cell centres so the size tracks
  // the projection (and stays correct under iso tilt).
  const a = projectCellCentre(t, 0, 0, widthM, heightM, pitchM);
  const b = projectCellCentre(t, 1, 0, widthM, heightM, pitchM);
  const cellPx = Math.hypot(b.x - a.x, b.y - a.y);
  if (cellPx < 1) return; // grid is sub-pixel — nothing useful to paint
  // Glow radius: a little larger than the cell so adjacent cells overlap and
  // the additive blend produces a smooth field rather than a checkerboard.
  const glowPx = cellPx * 0.9;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let row = 0; row < heightM; row += 1) {
    for (let col = 0; col < widthM; col += 1) {
      const i = row * widthM + col;
      const epsHere = eps[i];
      if (epsHere === undefined || epsHere <= 0) continue; // nothing deposited

      const rhoHere = rho[i] ?? 0;
      // ε-driven, ρ-amplified brightness, clamped to [0, 1].
      const intensity = Math.max(
        0,
        Math.min(
          1,
          epsHere * EPS_GAIN_J_INV * fxGain * (1 + rhoHere / RHO_REF_KG),
        ),
      );
      if (intensity < INTENSITY_DRAW_THRESHOLD) continue;

      const p = projectCellCentre(t, col, row, widthM, heightM, pitchM);
      const [r, g, bl] = paletteSample(intensity);

      // Radial gradient: bright core fading to transparent at the glow radius,
      // coloured by the hot palette. Alpha scales with intensity so faint cells
      // read as a wash and bright cells as a solid core.
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowPx);
      const alphaCore = Math.min(1, intensity * 1.1);
      const alphaEdge = intensity * 0.35;
      grad.addColorStop(0, `rgba(${r | 0},${g | 0},${bl | 0},${alphaCore})`);
      grad.addColorStop(0.5, `rgba(${r | 0},${g | 0},${bl | 0},${alphaEdge})`);
      grad.addColorStop(1, `rgba(${r | 0},${g | 0},${bl | 0},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** Overlay definition: arena medium-field glow (plumes, beam channels, wakes),
 *  drawn beneath the ship layer. */
export const mediumGlow: OverlayDef = {
  id: "medium-glow",
  label: "Medium glow (plumes / ionisation)",
  defaultOn: true,
  defaultScope: "all",
  draw: drawMediumGlow,
};
