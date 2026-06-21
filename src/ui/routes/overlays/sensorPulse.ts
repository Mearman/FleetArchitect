import type { OverlayCtx, OverlayDef } from "./types";

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

/** Emission flash radius, in display pixels. */
const EMISSION_FLASH_RADIUS = 3;

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

  // Build a side map from ships so we can tint outbound pulses by emitter side.
  const sideByInstanceId = new Map<string, "attacker" | "defender">();
  for (const s of frame.ships) {
    sideByInstanceId.set(s.instanceId, s.side);
  }

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
        const side = sideByInstanceId.get(pulse.emitterId);
        ctx.strokeStyle = side === "defender" ? PULSE_COLOUR_DEFENDER : PULSE_COLOUR_ATTACKER;
      }

      const ox = t.sx(pulse.x);
      const oy = t.sy(pulse.y);
      const rPx = pulse.radius * t.scale;

      ctx.beginPath();
      // arc >= PI means an omni sphere: draw a full circle. Otherwise draw the
      // illuminated arc sector from bearing - arc to bearing + arc.
      if (pulse.arc >= Math.PI) {
        ctx.arc(ox, oy, rPx, 0, Math.PI * 2);
      } else {
        const start = pulse.bearing - pulse.arc;
        const end = pulse.bearing + pulse.arc;
        ctx.moveTo(ox + Math.cos(start) * rPx, oy + Math.sin(start) * rPx);
        ctx.arc(ox, oy, rPx, start, end);
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
      ctx.beginPath();
      ctx.arc(t.sx(em.x), t.sy(em.y), EMISSION_FLASH_RADIUS, 0, Math.PI * 2);
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
