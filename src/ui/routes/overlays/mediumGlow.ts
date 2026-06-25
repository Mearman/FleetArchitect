import {
  EPS_GAIN_J_INV,
  INTENSITY_DRAW_THRESHOLD,
  RHO_REF_KG,
  fxGainFor,
  paletteSample,
  projectCellCentre,
  readFxLevel,
  resolveMediumField,
} from "./mediumShared";
import type { OverlayCtx, OverlayDef } from "./types";

// ---------------------------------------------------------------------------
// Arena medium field: broad ambient ionisation / plume glow (coarse cell view)
// ---------------------------------------------------------------------------
//
// This overlay paints the BROAD ambient field: one soft radial-gradient blob per
// excited cell, additively blended so overlapping cells stack into a smooth
// ionised haze. It is the coarse complement to `mediumTrails.ts`, which draws
// the sharp analytic per-entity streaks. Both overlays share their palette, FX
// gating, field resolution, and brightness mapping via `./mediumShared`, so the two
// views stay visually consistent (denser medium = brighter, identically, in
// both). Drawn beneath the ship layer so hull silhouettes sit on top of the
// glow.
//
// The physical model, the cell <-> world mapping, the brightness formula, and
// the tuning rationale for the named constants are all documented in
// `./mediumShared.ts` (the single source of truth shared by both medium
// overlays). Refer there for why ε drives, ρ amplifies, and the magnitudes.

/**
 * Medium-field glow: additive ionisation glow beneath the ship layer. Reads the
 * `{ rho, eps, widthM, heightM, pitchM }` field resolved for the current tick; for
 * each cell whose ε-driven intensity clears a small threshold, paints a
 * hot-palette disc with `globalCompositeOperation = "lighter"` so overlapping
 * glows stack and brighten. Denser ρ amplifies the glow (nebula-amplification);
 * ε ≈ 0 cells are skipped (undisturbed space stays dark).
 */
function drawMediumGlow(c: OverlayCtx): void {
  const { ctx, t } = c;

  // FX level: `off` → nothing. `reduced` → dimmer gain.
  const fx = readFxLevel();
  if (fx === "off") return;
  const fxGain = fxGainFor(fx);

  // Resolve the field for this tick from the frame history: the most recent
  // emission at-or-before the current tick (deterministic, scrub-safe).
  const field = resolveMediumField(c.frames, c.tick);
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
