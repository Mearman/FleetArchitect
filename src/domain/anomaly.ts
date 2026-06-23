/**
 * Pure anomaly-membership helper. Anomalies are carried as a canonical
 * {@link BattleAnomalyKind} array (see `src/schema/battle.ts`); every engine and
 * renderer site that used to gate on `anomaly === "X"` now gates on membership
 * via this helper. A bare leaf — no React, Dexie, DOM, or engine dependency —
 * so every layer (engine, renderer, UI) can import it safely.
 */
import type { BattleAnomalyKind } from "@/schema/battle";

/** True when `kind` is among the active `anomalies`. */
export function hasAnomaly(
  anomalies: readonly BattleAnomalyKind[],
  kind: BattleAnomalyKind,
): boolean {
  return anomalies.includes(kind);
}
