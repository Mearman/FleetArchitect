import { z } from "zod";

/** A 2D vector in world space (units are abstract "battle units"). */
export const Vec2 = z.object({
  x: z.number(),
  y: z.number(),
});
export type Vec2 = z.infer<typeof Vec2>;

/** Stable identifier for any entity (ship design, fleet, module, hull...). */
export const EntityId = z.string().min(1);
export type EntityId = z.infer<typeof EntityId>;

/** ISO-8601 timestamp string. Kept loose; consumers format as needed. */
export const IsoTimestamp = z.string().min(1);
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;
