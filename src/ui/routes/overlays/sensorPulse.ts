import { CELL_SIZE } from "@/domain/grid";
import type { OverlayCtx, OverlayDef } from "./types";
import { appendWorldArc, pathWorldCircle } from "@/ui/routes/battleProject";
import { shipIndexFor } from "./shipIndex";

/** Stroke width of an active-radar pulse ring, in display pixels. */
const PULSE_STROKE_WIDTH = 1.5;

/** Base alpha for an outbound pulse ring. Strong enough to read against space. */
const PULSE_ALPHA_OUTBOUND = 0.6;

/** Base alpha for a reflected return pulse. Dimmer than outbound — a return
 *  is weaker than the original emission. */
const PULSE_ALPHA_REFLECTED = 0.35;

/** Stroke colour for an outbound attacker pulse. */
const PULSE_COLOUR_ATTACKER = "#ff8c5a";

/** Stroke colour for an outbound defender pulse. */
const PULSE_COLOUR_DEFENDER = "#5ab0ff";

/** Stroke colour for any reflected return — neutral white-blue to distinguish
 *  it from the outbound pulse without revealing the emitter side colour. */
const PULSE_COLOUR_REFLECTED = "#a0d8ff";

/** Minimum normalised strength before a pulse ring is drawn (prevents drawing
 *  rings with essentially zero alpha). */
const STRENGTH_DRAW_THRESHOLD = 0.001;

/** Emission flash alpha — brief bright dot at the emission origin. */
const EMISSION_FLASH_ALPHA = 0.5;

/** Emission flash radius, in world units (about three-quarters of a cell), so
 *  the flash is spatial — it tilts and scales with the view. */
const EMISSION_FLASH_RADIUS = CELL_SIZE * 0.75;

/** Number of ticks an emission flash remains visible. The tick at which the
 *  emission was recorded (t0) is compared to the current tick; if the delta
 *  is within this window the flash is drawn. */
const EMISSION_FLASH_TICKS = 2;

/**
 * Sensor pulse overlay: renders active-radar pulses as expanding arc rings
 * and EM emission flashes.
 *
 * Outbound pulses are drawn in the emitter's side colour; reflected returns
 * (pulse.reflectedFrom is set) are drawn in a distinct dimmer colour. Strength
 * (if present) is used to alpha-blend the ring so a fresh strong pulse reads
 * more opaque and a decayed weak return fades. Emissions from frame.emissions
 * are drawn as a brief flash at the emission origin when t0 is near the current
 * tick.
 */
function drawSensorPulse(c: OverlayCtx): void {
  const { ctx, frame, t, tick } = c;

  const pulses = frame.pulses;
  if ((pulses === undefined || pulses.length === 0) &&
      (frame.emissions === undefined || frame.emissions.length === 0)) return;

  ctx.save();
  ctx.lineWidth = PULSE_STROKE_WIDTH;
  ctx.setLineDash([]);

  // Shared per-frame id→ship index (built once per frame identity across all
  // overlays — see ./shipIndex). Used to tint outbound pulses by emitter side.
  const ships = shipIndexFor(frame);

  // Draw active-radar pulse rings.
  if (pulses !== undefined) {
    for (const pulse of pulses) {
      const isReflected = pulse.reflectedFrom !== undefined;
      const baseAlpha = isReflected ? PULSE_ALPHA_REFLECTED : PULSE_ALPHA_OUTBOUND;

      // Compute an alpha scale from strength when present. Strength on the
      // SimPulse is the raw EM power and grows very large near the emitter, so
      // we normalise by a reference value rather than using raw strength
      // directly. A simpler heuristic: treat strength as already [0, 1] on the
      // snapshot (the engine can normalise on emit), falling back to 1 when the
      // field is absent so old frames draw at full base alpha.
      const strengthFactor = pulse.strength !== undefined
        ? Math.max(0, Math.min(1, pulse.strength))
        : 1;

      if (strengthFactor < STRENGTH_DRAW_THRESHOLD) continue;

      ctx.globalAlpha = baseAlpha * strengthFactor;

      if (isReflected) {
        ctx.strokeStyle = PULSE_COLOUR_REFLECTED;
      } else {
        const side = ships.get(pulse.emitterId)?.side;
        ctx.strokeStyle = side === "defender" ? PULSE_COLOUR_DEFENDER : PULSE_COLOUR_ATTACKER;
      }

      // arc >= PI means an omni sphere: draw a full circle. Otherwise draw the
      // illuminated arc from bearing - arc to bearing + arc (an open stroke, no
      // centre radii). Both go through the projection so they tilt under iso.
      if (pulse.arc >= Math.PI) {
        pathWorldCircle(ctx, t, pulse.x, pulse.y, pulse.radius);
      } else {
        ctx.beginPath();
        appendWorldArc(
          ctx,
          t,
          pulse.x,
          pulse.y,
          pulse.radius,
          pulse.bearing - pulse.arc,
          pulse.bearing + pulse.arc,
        );
      }
      ctx.stroke();
    }
  }

  // Draw EM emission flashes: a brief bright dot at the emission origin when
  // the emission is new (within EMISSION_FLASH_TICKS of the current tick).
  if (frame.emissions !== undefined) {
    ctx.setLineDash([]);
    for (const em of frame.emissions) {
      const age = tick - em.t0;
      if (age < 0 || age > EMISSION_FLASH_TICKS) continue;
      // Fade from full alpha at age 0 to zero at EMISSION_FLASH_TICKS.
      const fadeFrac = 1 - age / EMISSION_FLASH_TICKS;
      ctx.globalAlpha = EMISSION_FLASH_ALPHA * fadeFrac;
      ctx.fillStyle = "#ffe0a0";
      pathWorldCircle(ctx, t, em.x, em.y, EMISSION_FLASH_RADIUS);
      ctx.fill();
    }
  }

  ctx.restore();
}

/** Sensor pulse overlay: expanding arc rings for active-radar pulses and EM
 *  emission flashes at the source. */
export const sensorPulse: OverlayDef = {
  id: "sensor-pulse",
  label: "Sensor pulses",
  defaultOn: false,
  defaultScope: "all",
  draw: drawSensorPulse,
};
