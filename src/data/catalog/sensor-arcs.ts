// ---------------------------------------------------------------------------
// Sensor cone half-arcs (radians). A sensor covers a sector of this half-arc
// about its world bearing; omni uses Math.PI so the cone is a full circle.
// ---------------------------------------------------------------------------
/** All-round: the full half-circle each side, i.e. a 360° cone (a full circle). */
export const SENSOR_OMNI_ARC = Math.PI;
/** Directional scanner: ~29° half-arc (a medium forward sector). */
export const SENSOR_DIRECTIONAL_ARC = 0.5;
/** Wide directional (e.g. gravimetric): ~46° half-arc. */
export const SENSOR_WIDE_ARC = 0.8;
/** Long-range dish: ~11° half-arc (a tight forward beam). */
export const SENSOR_DISH_ARC = 0.2;
