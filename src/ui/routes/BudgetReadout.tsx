import { DEFAULT_FLEET_BUDGET } from "@/domain/points";
import { AnnunciatorLamp } from "@/ui/components/Annunciator";
import { panelLabel } from "@/ui/components/panel.css";
import {
  budgetFill,
  budgetOverWarning,
  budgetRow,
  budgetText,
  budgetTrack,
} from "./FleetBuilderRoute.css";

interface BudgetReadoutProps {
  total: number;
}

/**
 * Recessed neon budget gauge: a phosphor fill bar showing fleet point spend
 * against the default budget cap. Flips to a magenta alarm lamp when the
 * fleet exceeds {@link DEFAULT_FLEET_BUDGET}.
 */
export function BudgetReadout({ total }: BudgetReadoutProps) {
  const overBudget = total > DEFAULT_FLEET_BUDGET;
  const fillPct = Math.min(100, (total / DEFAULT_FLEET_BUDGET) * 100);
  const fillColour = overBudget
    ? "rgba(255,32,196,0.85)"
    : "rgba(80,255,120,0.75)";

  return (
    <div>
      <div className={panelLabel}>Point budget</div>
      <div className={budgetRow}>
        <div className={budgetTrack}>
          <div
            className={budgetFill}
            style={{ width: `${fillPct}%`, background: fillColour }}
          />
        </div>
        <span className={budgetText}>
          {total} / {DEFAULT_FLEET_BUDGET}
        </span>
        <AnnunciatorLamp tint="magenta" lit={overBudget}>
          {overBudget ? "OVER" : "OK"}
        </AnnunciatorLamp>
      </div>
      {overBudget && (
        <div className={budgetOverWarning}>
          Over budget — the battle will still run, but this exceeds the default
          cap.
        </div>
      )}
    </div>
  );
}
