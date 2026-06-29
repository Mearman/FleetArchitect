import { lazy } from "react";

/**
 * Route components, loaded on demand via React.lazy so the heavy Battle route —
 * the canvas renderer, every overlay, the battle worker, the sim cache and Dexie
 * tiers, and the catalog's eager Zod parse — stays out of the initial bundle for
 * a user who lands on Home and never opens a battle.
 *
 * Declared in a components-only module (rather than alongside the `router`
 * export in router.tsx) so react-refresh's only-export-components rule holds:
 * fast refresh needs a file's exports to all be components, and the router
 * itself is not one.
 */
export const HomeRoute = lazy(() =>
  import("./routes/HomeRoute").then((m) => ({ default: m.HomeRoute })),
);
export const ShipDesignerRoute = lazy(() =>
  import("./routes/ShipDesignerRoute").then((m) => ({ default: m.ShipDesignerRoute })),
);
export const FleetBuilderRoute = lazy(() =>
  import("./routes/FleetBuilderRoute").then((m) => ({ default: m.FleetBuilderRoute })),
);
export const BattleRoute = lazy(() =>
  import("./routes/BattleRoute").then((m) => ({ default: m.BattleRoute })),
);
export const ImportRoute = lazy(() =>
  import("./routes/ImportRoute").then((m) => ({ default: m.ImportRoute })),
);
